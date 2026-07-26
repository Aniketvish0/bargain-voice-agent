import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireSession } from "./users";

/**
 * Live transcript plumbing. See docs/BUILD-SPEC.md §9, "two rules".
 *
 * RULE 1: during a live call, the ONLY function allowed to write is
 *         applyBatch, at <=4 Hz, touching exactly one `callLive` doc.
 *         Patching `calls` on every ASR chunk causes OCC conflict storms and
 *         burns the free function-call budget.
 * RULE 2: the dashboard subscribes to TWO queries — `turns` (cold, re-runs
 *         only on finals) and `livePartial` (hot, one doc) — and renders
 *         [...turns, partial].
 */

/**
 * Called by the bridge, fire-and-forget, never awaited on the audio thread.
 * A slow write here becomes dead air on a real phone call.
 *
 * `final: true`  -> append an immutable row to `turns` and clear the partial.
 * `final: false` -> update the single hot `callLive` doc only.
 */
export const applyBatch = internalMutation({
  args: {
    callId: v.id("calls"),
    role: v.union(v.literal("agent"), v.literal("vendor"), v.literal("system")),
    text: v.string(),
    final: v.boolean(),
    langCode: v.optional(v.string()),
    langProbability: v.optional(v.number()),
    sarvamRequestId: v.optional(v.string()),
    tsMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const live = await ctx.db
      .query("callLive")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();

    const now = args.tsMs ?? Date.now();

    if (!args.final) {
      // Hot path. One doc, no inserts, no reads of `turns`.
      if (args.role === "system") return;
      if (live) {
        await ctx.db.patch(live._id, {
          partialText: args.text,
          partialRole: args.role,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("callLive", {
          callId: args.callId,
          partialText: args.text,
          partialRole: args.role,
          nextSeq: 0,
          updatedAt: now,
        });
      }
      return;
    }

    const seq = live?.nextSeq ?? 0;
    await ctx.db.insert("turns", {
      callId: args.callId,
      seq,
      role: args.role,
      text: args.text,
      langCode: args.langCode,
      langProbability: args.langProbability,
      sarvamRequestId: args.sarvamRequestId,
      tsMs: now,
    });

    if (live) {
      await ctx.db.patch(live._id, {
        partialText: "",
        nextSeq: seq + 1,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("callLive", {
        callId: args.callId,
        partialText: "",
        partialRole: args.role === "system" ? "agent" : args.role,
        nextSeq: seq + 1,
        updatedAt: now,
      });
    }

    // Track which languages were actually heard, for the dashboard badge.
    if (args.langCode) {
      const call = await ctx.db.get(args.callId);
      if (call && !call.detectedLangs.includes(args.langCode)) {
        await ctx.db.patch(args.callId, {
          detectedLangs: [...call.detectedLangs, args.langCode],
        });
      }
    }
    return { seq };
  },
});

/** "It changed language because he did." Demo this table live. */
export const recordLangSwitch = internalMutation({
  args: {
    callId: v.id("calls"),
    fromLang: v.string(),
    toLang: v.string(),
    confidence: v.number(),
    atMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("langSwitches", {
      callId: args.callId,
      fromLang: args.fromLang,
      toLang: args.toLang,
      confidence: args.confidence,
      atMs: args.atMs ?? Date.now(),
    });
    await ctx.db.patch(args.callId, { lang: args.toLang as any });
  },
});

/** Backfill English + romanised captions after the call. Never during. */
export const annotateTurn = internalMutation({
  args: {
    turnId: v.id("turns"),
    textEn: v.optional(v.string()),
    romanized: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, string> = {};
    if (args.textEn) patch.textEn = args.textEn;
    if (args.romanized) patch.romanized = args.romanized;
    if (Object.keys(patch).length) await ctx.db.patch(args.turnId, patch);
  },
});

// ─── Dashboard reads. Contract 3. ───────────────────────────────────────────

/** COLD. Re-runs only when a final lands. */
export const turns = query({
  args: { token: v.string(), callId: v.id("calls") },
  handler: async (ctx, args) => {
    await requireSession(ctx, args.token);
    return await ctx.db
      .query("turns")
      .withIndex("by_call_seq", (q) => q.eq("callId", args.callId))
      .order("asc")
      .collect();
  },
});

/**
 * HOT. Reads exactly one document.
 *
 * Deliberately takes no token: it is subscribed at up to 4 Hz during a live
 * call and carries only a partial ASR fragment for a callId the client already
 * had to be authorised to see. Keeping session validation off this path is
 * what keeps the hot query cheap.
 */
export const livePartial = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const live = await ctx.db
      .query("callLive")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .unique();
    if (!live || !live.partialText) return null;
    return { text: live.partialText, role: live.partialRole };
  },
});

export const langSwitchesForCall = query({
  args: { token: v.string(), callId: v.id("calls") },
  handler: async (ctx, args) => {
    await requireSession(ctx, args.token);
    return await ctx.db
      .query("langSwitches")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
  },
});
