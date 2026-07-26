import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  DEFAULT_LANG,
  DIAL_STAGGER_MS,
  isTtsLang,
  MAX_PERSONAS_PER_DIRECT_MISSION,
  VOICE_BY_LANG,
  type TtsLang,
} from "./lib/constants";
import { formatPretty, toE164 } from "./lib/phone";
import { MISSION_TYPE, OBJECTIVE, TTS_LANG } from "./schema";
import type { Brief } from "./intent";

/**
 * Direct dial — the user already knows the number.
 *
 * WHY THIS EXISTS
 * ---------------
 * Discovery (leads → OSM → Places) is the interesting path, but it is also the
 * fragile one: coverage is thin for some trades, and on stage a category with
 * three OSM hits is a dead demo. When someone already has the number — their
 * own landlord, the shop they always use, a consented test line — making them
 * describe a category so we can rediscover that number is theatre.
 *
 * This is the SAME machinery, entered one step later:
 *
 *   discovery path:  goal → candidates → gate → vendors → calls → dialNext
 *   direct path:            ONE number  → gate → vendor  → call  → dialNext
 *
 * Everything downstream of the gate is byte-identical to
 * `orchestrator.runMission`, deliberately: the bridge, the dial chain,
 * extraction, mission memory and the dashboard cannot tell the two apart.
 *
 * THE GATE IS NOT OPTIONAL HERE. A hand-typed number is the *most* likely
 * source of a mistyped digit, so `internal.gate.check` runs before any row is
 * written and its reason is returned to the caller verbatim. See §15.
 */

/** What the console gets back. A refusal is a result, not an exception. */
export type DirectResult = {
  ok: boolean;
  reason?: string;
  missionId?: Id<"missions">;
  callIds?: Id<"calls">[];
  phoneE164?: string;
  missionType?: "availability" | "quote" | "negotiate";
  objectives?: Brief["objectives"];
  language?: string;
};

/**
 * Public entry point for the console.
 *
 * An action rather than a mutation because deriving objectives from free text
 * needs `internal.intent.extractBrief`, which is an action (it calls Sarvam).
 * All the database work is in `place` below, which is a single mutation, so
 * the gate check and the rows it guards are still one transaction.
 */
export const createDirectMission = action({
  args: {
    token: v.string(),
    phoneE164: v.string(),
    category: v.string(),
    locality: v.optional(v.string()),
    /** Free text: "ask if they have an AC room on the 14th and what it costs". */
    objectives: v.optional(v.string()),
    targetPriceInr: v.optional(v.number()),
    language: v.optional(TTS_LANG),
    /**
     * Names to place sequential calls under, all to the SAME number.
     *
     * WHY THIS EXISTS
     * ---------------
     * Cross-call leverage (§1.5) and mission memory (§1.5.1) are the two
     * claims that only show up from call 2 onward: call N cites the price call
     * N−1 got, BY NAME, and inherits what that call learned. Demonstrating
     * either needs several vendors — but we have exactly one consented line to
     * dial, so a direct mission would only ever prove call 1.
     *
     * Personas close that gap honestly. Each name becomes a real `vendors`
     * row, so `missions.priorQuotes` attributes each quote to the shop that
     * gave it and call 3 genuinely says "Leela Hotel quoted me ₹7,000" —
     * the same code path, the same data, with one person playing all the
     * parts. Nothing is faked downstream; only the roster is.
     *
     * ⚠️ Every persona dials the one number in `phoneE164`. This is a testing
     * affordance for a CONSENTED line, not a way to reach several businesses.
     */
    personas: v.optional(v.array(v.string())),
    /** Legacy/simple form of `personas`: N unnamed sequential calls. */
    attempts: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DirectResult> => {
    const me = await ctx.runQuery(api.users.me, { token: args.token });
    if (!me) throw new Error("Invalid session");

    // libphonenumber, never a regex — a hand-typed number is precisely the
    // corrupt input a regex "fixes" into a stranger's phone. See lib/phone.ts.
    const e164 = toE164(args.phoneE164);
    if (!e164) {
      return { ok: false, reason: `"${args.phoneE164}" is not a valid Indian phone number` };
    }

    const category = args.category.trim() || "business";
    const locality = (args.locality ?? "").trim();

    // One line of natural language is what `extractBrief` is built to read, so
    // reassemble the form fields into one rather than inventing a second
    // extraction prompt that would drift out of sync with the first.
    const rawRequest = [
      args.objectives?.trim() ||
        `find out if ${category} is available and what it costs`,
      `— ${category}`,
      locality ? `in ${locality}` : "",
      args.targetPriceInr ? `, under ₹${args.targetPriceInr}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    let brief: Brief;
    try {
      brief = await ctx.runAction(internal.intent.extractBrief, {
        text: rawRequest,
        userPrefLang: args.language ?? me.preferredLang ?? DEFAULT_LANG,
      });
    } catch (err: any) {
      return { ok: false, reason: `Couldn't read that goal: ${err?.message ?? err}` };
    }

    // The form is more authoritative than the model on the fields the user
    // actually typed. The model only fills the gaps.
    const language: TtsLang = isTtsLang(args.language)
      ? args.language
      : isTtsLang(brief.language)
        ? brief.language
        : DEFAULT_LANG;
    const target = args.targetPriceInr ?? brief.targetPriceInr;
    // An explicit price ceiling means haggle, whatever the model decided.
    const missionType = target ? "negotiate" : brief.missionType;

    const res: DirectResult = await ctx.runMutation(internal.direct.place, {
      userId: me._id,
      rawRequest,
      phoneE164: e164,
      vendorName: `Direct dial · ${formatPretty(e164)}`,
      missionType,
      personas: (args.personas ?? [])
        .map((p) => p.trim().slice(0, 60))
        .filter(Boolean),
      attempts: args.attempts ?? 1,
      brief: {
        category,
        locality: locality || brief.locality || "direct dial",
        constraints: brief.constraints,
        objectives: brief.objectives,
        ...(target ? { targetPriceInr: target, walkAwayInr: brief.walkAwayInr ?? Math.round(target * 1.1) } : {}),
        language,
      },
    });

    return {
      ...res,
      objectives: brief.objectives,
      missionType,
      language,
      phoneE164: e164,
    };
  },
});

/**
 * Gate, then write. One transaction.
 *
 * Shape lifted from `orchestrator.runMission`'s tail: gate → vendors →
 * `calls` rows created up front so the dashboard renders the full roster
 * immediately → schedule `dialNext` once. Do not "optimise" this into dialling
 * inline; the chain is advanced from `calls.onProviderStatus` and expects to
 * own that.
 */
export const place = internalMutation({
  args: {
    userId: v.id("users"),
    rawRequest: v.string(),
    phoneE164: v.string(),
    vendorName: v.string(),
    missionType: MISSION_TYPE,
    personas: v.array(v.string()),
    attempts: v.number(),
    brief: v.object({
      category: v.string(),
      locality: v.string(),
      constraints: v.array(v.string()),
      objectives: v.array(OBJECTIVE),
      targetPriceInr: v.optional(v.number()),
      walkAwayInr: v.optional(v.number()),
      language: TTS_LANG,
    }),
  },
  handler: async (ctx, args): Promise<DirectResult> => {
    const from = process.env.TWILIO_FROM_NUMBER ?? "";

    // ── The compliance gate. Nothing below this line runs if it refuses. ────
    const gate = await ctx.runQuery(internal.gate.check, {
      phone: args.phoneE164,
      fromNumber: from || undefined,
    });
    if (!gate.ok) {
      return { ok: false, reason: gate.reason ?? "Blocked by the compliance gate" };
    }

    /**
     * `MAX_VENDORS_PER_MISSION` (3) caps how many DISTINCT BUSINESSES one
     * request may disturb — that is the §15 posture and it is not relaxed
     * here. A direct mission has exactly one business by construction, so the
     * relevant limit for personas is a different one: how many times we may
     * ring a single consented line. That is what MAX_PERSONAS_PER_DIRECT_MISSION
     * bounds, and the per-originating-number daily cap (15/day, checked by the
     * gate above) still bounds the total across every mission today.
     */
    const names = args.personas.slice(0, MAX_PERSONAS_PER_DIRECT_MISSION);
    const count = names.length
      ? names.length
      : Math.max(1, Math.min(args.attempts, MAX_PERSONAS_PER_DIRECT_MISSION));

    const missionId = await ctx.db.insert("missions", {
      userId: args.userId,
      rawRequest: args.rawRequest,
      inputMode: "text",
      missionType: args.missionType,
      brief: args.brief,
      // Checkpoint A is already satisfied: the human typed this exact number
      // and pressed Call. There is no roster to approve.
      status: "calling",
      createdAt: Date.now(),
    });

    const callIds: Id<"calls">[] = [];
    for (let i = 0; i < count; i++) {
      const vendorId = await ctx.db.insert("vendors", {
        missionId,
        name: names[i] ?? (count > 1 ? `${args.vendorName} (call ${i + 1})` : args.vendorName),
        phoneE164: args.phoneE164,
        // The number came from a human, not from discovery. "curated" is the
        // honest label in the frozen source union — see schema.ts §9.
        source: "curated",
        rank: i,
        gatePassed: true,
      });
      callIds.push(
        await ctx.db.insert("calls", {
          missionId,
          vendorId,
          userId: args.userId,
          phoneE164: args.phoneE164,
          fromNumber: from,
          status: "queued",
          lang: args.brief.language,
          voice: VOICE_BY_LANG[args.brief.language],
          detectedLangs: [],
          slots: [],
        }),
      );
    }

    /**
     * Put the direct dial into the SHARED conversation thread.
     *
     * `chatMessages` is what makes Telegram and the console one history rather
     * than two. A mission created from the direct-dial form is still something
     * the user asked for, so it belongs in that thread — otherwise the console
     * shows a mission in the rail with no conversation explaining where it
     * came from, and the Telegram history looks like the only real one.
     */
    await ctx.runMutation(internal.telegramQueries.logChat, {
      userId: args.userId,
      missionId,
      role: "user",
      text: args.rawRequest,
      surface: "web",
    });
    await ctx.runMutation(internal.telegramQueries.logChat, {
      userId: args.userId,
      missionId,
      role: "assistant",
      text:
        count > 1
          ? `Calling ${args.phoneE164} ${count} times as ${names.join(", ")} — one at a time, each carrying the last real quote in as leverage.`
          : `Calling ${args.phoneE164} now — ${args.missionType}.`,
      surface: "web",
    });

    await ctx.scheduler.runAfter(DIAL_STAGGER_MS, internal.orchestrator.dialNext, {
      missionId,
    });

    return { ok: true, missionId, callIds, phoneE164: args.phoneE164 };
  },
});
