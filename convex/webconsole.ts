import { v } from "convex/values";
import { action, internalAction, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireSession } from "./users";
import { chat } from "./lib/sarvam";
import {
  DEFAULT_LANG,
  DIAL_STAGGER_MS,
  isTtsLang,
  LLM_LIVE,
  MAX_VENDORS_PER_MISSION,
} from "./lib/constants";
import type { Brief } from "./intent";
import type { Candidate } from "./vendors";

/**
 * Endpoint layer for the web console.
 *
 * Deliberately additive: this file calls existing internal functions and edits
 * none of them, so the voice-agent work in orchestrator/calls/telegram can
 * proceed in parallel without merge pain.
 *
 * It splits what `orchestrator.runMission` does in one shot into the two beats
 * the console needs:
 *
 *   goal  → discover  → a roster you can look at   (nothing dials)
 *   pick  → startCalls → the existing dial chain    (orchestrator.dialNext)
 *
 * Telegram keeps its own one-shot path untouched.
 */

/** How many candidates to surface for picking. Dials stay capped separately. */
const ROSTER_SIZE = 10;

// ─── 1. Goal in ────────────────────────────────────────────────────────────

export const submitGoal = action({
  args: { token: v.string(), text: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    missionId: Id<"missions"> | null;
    clarifyingQuestion?: string;
    reply: string;
  }> => {
    const me = await ctx.runQuery(api.users.me, { token: args.token });
    if (!me) throw new Error("Invalid session");

    const brief: Brief = await ctx.runAction(internal.intent.extractBrief, {
      text: args.text,
      userPrefLang: me.preferredLang ?? DEFAULT_LANG,
    });

    // The model can refuse to guess. Surface the question instead of inventing
    // a locality and dialling strangers on a bad assumption.
    if (brief.clarifyingQuestion) {
      return { missionId: null, clarifyingQuestion: brief.clarifyingQuestion, reply: brief.clarifyingQuestion };
    }

    const lang = isTtsLang(brief.language) ? brief.language : DEFAULT_LANG;

    const missionId: Id<"missions"> = await ctx.runMutation(
      internal.missions.create,
      {
        userId: me._id,
        rawRequest: args.text,
        inputMode: "text",
        missionType: brief.missionType,
        brief: {
          category: brief.category,
          locality: brief.locality,
          constraints: brief.constraints,
          objectives: brief.objectives,
          targetPriceInr: brief.targetPriceInr,
          walkAwayInr: brief.walkAwayInr,
          language: lang,
        },
      },
    );

    await ctx.runMutation(internal.missions.setStatus, {
      missionId,
      status: "discovering",
    });
    await ctx.scheduler.runAfter(0, internal.webconsole.discover, { missionId });

    return {
      missionId,
      reply: `Looking for ${brief.category} in ${brief.locality}. Nothing dials until you say so.`,
    };
  },
});

// ─── 2. Discovery, without dialling ────────────────────────────────────────

/**
 * The discovery half of `orchestrator.runMission`, stopping before any call
 * row is created. Leaves the mission in `awaiting_approval` — Checkpoint A.
 */
export const discover = internalAction({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const mission = await ctx.runQuery(internal.missions.getInternal, {
      missionId: args.missionId,
    });
    if (!mission || mission.status === "cancelled") return;

    const { category, locality } = mission.brief;

    // Leads first — hand-verified, seeded from OSM, always available. Places is
    // the upgrade, not the dependency.
    let candidates: Candidate[] = await ctx.runQuery(internal.vendors.fromLeads, {
      category,
      locality,
      limit: ROSTER_SIZE,
    });

    if (candidates.length < ROSTER_SIZE) {
      const extra: Candidate[] = await ctx.runAction(internal.vendors.fromPlaces, {
        category,
        locality,
        limit: ROSTER_SIZE,
      });
      const seen = new Set(candidates.map((c) => c.phoneE164));
      for (const c of extra) {
        if (candidates.length >= ROSTER_SIZE) break;
        if (seen.has(c.phoneE164)) continue;
        seen.add(c.phoneE164);
        candidates.push(c);
      }
    }

    if (candidates.length === 0) {
      await ctx.runMutation(internal.missions.setStatus, {
        missionId: args.missionId,
        status: "failed",
      });
      return;
    }

    const from = process.env.TWILIO_FROM_NUMBER ?? "";

    // Gate every candidate. Rejects still get a row, so the gate is visible.
    const gated = [];
    for (const c of candidates) {
      const g = await ctx.runQuery(internal.gate.check, {
        phone: c.phoneE164,
        fromNumber: from || undefined,
      });
      gated.push({ ...c, gatePassed: g.ok, gateReason: g.reason });
    }

    await ctx.runMutation(internal.vendors.insertForMission, {
      missionId: args.missionId,
      candidates: gated,
    });

    await ctx.runMutation(internal.missions.setStatus, {
      missionId: args.missionId,
      status: "awaiting_approval",
    });
  },
});

// ─── 3. The roster the console picks from ──────────────────────────────────

export const roster = query({
  args: { token: v.string(), missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx, args.token);
    const mission = await ctx.db.get(args.missionId);
    if (!mission || mission.userId !== userId) return null;

    const vendors = await ctx.db
      .query("vendors")
      .withIndex("by_mission_rank", (q) => q.eq("missionId", args.missionId))
      .collect();

    const calls = await ctx.db
      .query("calls")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();
    const calledVendorIds = new Set(calls.map((c) => c.vendorId));

    return {
      status: mission.status,
      maxDials: MAX_VENDORS_PER_MISSION,
      vendors: vendors.map((v) => ({
        _id: v._id,
        name: v.name,
        phoneE164: v.phoneE164,
        address: v.address,
        sourceUrl: v.sourceUrl,
        source: v.source,
        rank: v.rank,
        gatePassed: v.gatePassed,
        gateReason: v.gateReason,
        queued: calledVendorIds.has(v._id),
      })),
    };
  },
});

// ─── 4. Dial the picked subset ─────────────────────────────────────────────

/**
 * Creates the call rows and hands off to the existing dial chain.
 *
 * Caps at MAX_VENDORS_PER_MISSION regardless of what was asked for — the
 * compliance posture in BUILD-SPEC §15 is "≤ 3 businesses per request", and a
 * cap you can only breach by editing a constant is the point.
 */
export const startCalls = mutation({
  args: {
    token: v.string(),
    missionId: v.id("missions"),
    vendorIds: v.array(v.id("vendors")),
  },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx, args.token);
    const mission = await ctx.db.get(args.missionId);
    if (!mission || mission.userId !== userId) throw new Error("Not found");

    const existing = await ctx.db
      .query("calls")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();
    const already = new Set(existing.map((c) => c.vendorId));

    const from = process.env.TWILIO_FROM_NUMBER ?? "";
    const budget = MAX_VENDORS_PER_MISSION - existing.length;
    if (budget <= 0) {
      return { queued: 0, skippedGate: 0, capped: true, cap: MAX_VENDORS_PER_MISSION };
    }

    let queued = 0;
    let skippedGate = 0;
    for (const vendorId of args.vendorIds) {
      if (queued >= budget) break;
      const vendor = await ctx.db.get(vendorId);
      if (!vendor || vendor.missionId !== args.missionId) continue;
      if (already.has(vendorId)) continue;
      if (!vendor.gatePassed) {
        skippedGate++;
        continue;
      }
      await ctx.db.insert("calls", {
        missionId: args.missionId,
        vendorId,
        userId,
        phoneE164: vendor.phoneE164,
        fromNumber: from,
        status: "queued",
        lang: mission.brief.language,
        voice: VOICE_FALLBACK,
        detectedLangs: [],
        slots: [],
      });
      queued++;
    }

    if (queued === 0) {
      return {
        queued: 0,
        skippedGate,
        capped: args.vendorIds.length > budget,
        cap: MAX_VENDORS_PER_MISSION,
      };
    }

    await ctx.db.patch(args.missionId, { status: "calling" });
    await ctx.scheduler.runAfter(DIAL_STAGGER_MS, internal.orchestrator.dialNext, {
      missionId: args.missionId,
    });

    return {
      queued,
      skippedGate,
      capped: args.vendorIds.length > budget,
      cap: MAX_VENDORS_PER_MISSION,
    };
  },
});

/**
 * `calls.createForVendor` picks the voice from VOICE_BY_LANG, but that map is
 * not exported. The dial path re-resolves the voice from `lang` anyway, so a
 * sane default here is enough and keeps this file from editing calls.ts.
 */
const VOICE_FALLBACK = "simran";

export const stop = mutation({
  args: { token: v.string(), missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx, args.token);
    const m = await ctx.db.get(args.missionId);
    if (!m || m.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.missionId, { status: "cancelled" });
    return { ok: true };
  },
});

// ─── 5. Natural-language control ───────────────────────────────────────────

export type ConsoleCommand =
  | { kind: "call"; count?: number; names?: string[]; all?: boolean }
  | { kind: "stop" }
  | { kind: "status" }
  | { kind: "goal"; text: string }
  | { kind: "unknown" };

/**
 * Turn a line the user typed into a command against the CURRENT mission.
 *
 * Deterministic patterns run first — they are instant, free, and cover the
 * phrasings a demo actually uses. The model is the fallback, not the path.
 */
function parseCommandLocally(text: string): ConsoleCommand | null {
  const t = text.trim().toLowerCase();
  if (!t) return { kind: "unknown" };

  if (/^(stop|cancel|abort|halt|band karo|ruko)\b/.test(t)) return { kind: "stop" };
  if (/^(status|what'?s happening|kya ho raha|update)\b/.test(t)) return { kind: "status" };

  const callish = /\b(call|dial|phone|ring|baat karo)\b/.test(t);
  if (callish) {
    if (/\b(all|everyone|sab|sabko)\b/.test(t)) return { kind: "call", all: true };
    const n = t.match(/\b(?:top|first|pehle|any)\s+(\d+)\b/) ?? t.match(/\b(\d+)\s+(?:of them|numbers|shops|hotels|places)\b/);
    if (n) return { kind: "call", count: parseInt(n[1], 10) };
    const num = t.match(/\b(\d+)\b/);
    if (num && t.split(/\s+/).length <= 4) return { kind: "call", count: parseInt(num[1], 10) };
    return { kind: "call" };
  }

  return null; // let the model decide
}

export const command = action({
  args: {
    token: v.string(),
    text: v.string(),
    missionId: v.optional(v.id("missions")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    reply: string;
    action: string;
    missionId?: Id<"missions">;
    vendorIds?: Id<"vendors">[];
  }> => {
    const me = await ctx.runQuery(api.users.me, { token: args.token });
    if (!me) throw new Error("Invalid session");

    let cmd = parseCommandLocally(args.text);

    // No mission in context means the only sensible reading is a new goal.
    if (!args.missionId) {
      const res = await ctx.runAction(api.webconsole.submitGoal, {
        token: args.token,
        text: args.text,
      });
      return {
        reply: res.reply,
        action: res.missionId ? "goal" : "clarify",
        missionId: res.missionId ?? undefined,
      };
    }

    const roster = await ctx.runQuery(api.webconsole.roster, {
      token: args.token,
      missionId: args.missionId,
    });
    if (!roster) throw new Error("Mission not found");

    if (!cmd) cmd = await classifyWithModel(args.text, roster.vendors.map((v) => v.name));

    switch (cmd.kind) {
      case "stop": {
        await ctx.runMutation(api.webconsole.stop, {
          token: args.token,
          missionId: args.missionId,
        });
        return { reply: "Stopped. No further numbers will be dialled.", action: "stop" };
      }

      case "status": {
        return { reply: describe(roster), action: "status" };
      }

      case "goal": {
        const res = await ctx.runAction(api.webconsole.submitGoal, {
          token: args.token,
          text: cmd.text || args.text,
        });
        return {
          reply: res.reply,
          action: res.missionId ? "goal" : "clarify",
          missionId: res.missionId ?? undefined,
        };
      }

      case "call": {
        const callable = roster.vendors.filter((v) => v.gatePassed && !v.queued);
        if (callable.length === 0) {
          const blocked = roster.vendors.filter((v) => !v.gatePassed).length;
          return {
            reply: blocked
              ? `Nothing left to dial — ${blocked} of these are blocked by the compliance gate.`
              : "Every number on this roster is already queued.",
            action: "noop",
          };
        }

        let picked = callable;
        if (cmd.names?.length) {
          const wanted = cmd.names.map((n) => n.toLowerCase());
          const matched = callable.filter((v) =>
            wanted.some((w) => v.name.toLowerCase().includes(w)),
          );
          if (matched.length) picked = matched;
        } else if (cmd.count) {
          picked = callable.slice(0, cmd.count);
        } else if (!cmd.all) {
          picked = callable.slice(0, roster.maxDials);
        }

        const asked = picked.length;
        picked = picked.slice(0, roster.maxDials);

        const res = await ctx.runMutation(api.webconsole.startCalls, {
          token: args.token,
          missionId: args.missionId,
          vendorIds: picked.map((v) => v._id),
        });

        const bits = [
          `Dialling ${res.queued} ${res.queued === 1 ? "number" : "numbers"}, one at a time — each call carries the previous quote in as leverage.`,
        ];
        if (asked > res.queued || res.capped) {
          bits.push(
            `Capped at ${roster.maxDials} businesses per request (BUILD-SPEC §15 compliance posture).`,
          );
        }
        if (res.skippedGate) {
          bits.push(`${res.skippedGate} skipped by the compliance gate.`);
        }
        return {
          reply: bits.join(" "),
          action: "call",
          vendorIds: picked.map((v) => v._id),
        };
      }

      default:
        return {
          reply:
            "I can find businesses for a goal, dial a subset, or stop. Try “call the top 3”, “call Maria Paulo”, “status”, or just describe a new goal.",
          action: "noop",
        };
    }
  },
});

function describe(roster: any): string {
  const ok = roster.vendors.filter((v: any) => v.gatePassed).length;
  const blocked = roster.vendors.length - ok;
  const queued = roster.vendors.filter((v: any) => v.queued).length;
  return [
    `${roster.vendors.length} found · ${ok} dialable${blocked ? ` · ${blocked} gate-blocked` : ""}`,
    queued ? `${queued} already queued.` : `Nothing dialled yet.`,
    `Mission is ${roster.status}.`,
  ].join(" · ");
}

const CLASSIFY_SYSTEM = `You route one line of user input in a phone-calling agent console.
Reply with JSON only, no prose.

Shapes:
  {"kind":"call","count":3}            - dial a number of businesses
  {"kind":"call","names":["Maria"]}    - dial specific businesses by name
  {"kind":"call","all":true}           - dial everything dialable
  {"kind":"stop"}                      - stop dialling
  {"kind":"status"}                    - report current state
  {"kind":"goal","text":"..."}         - this is a NEW goal to go find businesses for
  {"kind":"unknown"}                   - anything else

Input may be Hindi, English, or code-mixed. If the user describes something to
buy, book, or ask about, that is a "goal".`;

async function classifyWithModel(
  text: string,
  vendorNames: string[],
): Promise<ConsoleCommand> {
  try {
    const { content } = await chat({
      model: LLM_LIVE,
      maxTokens: 120,
      temperature: 0.1,
      json: true,
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        {
          role: "user",
          content: `Businesses on screen: ${vendorNames.join(", ") || "(none)"}\n\nUser said: ${text}`,
        },
      ],
    });
    const m = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : content);
    if (parsed && typeof parsed.kind === "string") return parsed as ConsoleCommand;
  } catch (err) {
    console.warn("console classify failed", err);
  }
  // A failed classification must not dial anything.
  return { kind: "unknown" };
}
