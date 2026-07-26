import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { requireSession } from "./users";
import { MISSION_TYPE, OBJECTIVE, TTS_LANG } from "./schema";
import { effectivePrice } from "./lib/inr";

// ─── Writes (internal — driven by Telegram / the orchestrator) ──────────────

export const create = internalMutation({
  args: {
    userId: v.id("users"),
    rawRequest: v.string(),
    inputMode: v.union(v.literal("voice"), v.literal("text")),
    missionType: MISSION_TYPE,
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
  handler: async (ctx, args): Promise<Id<"missions">> => {
    return await ctx.db.insert("missions", {
      userId: args.userId,
      rawRequest: args.rawRequest,
      inputMode: args.inputMode,
      missionType: args.missionType,
      brief: args.brief,
      status: "awaiting_approval", // Checkpoint A — nothing dials without a tap
      createdAt: Date.now(),
    });
  },
});

export const setStatus = internalMutation({
  args: {
    missionId: v.id("missions"),
    status: v.union(
      v.literal("pending"),
      v.literal("awaiting_approval"),
      v.literal("discovering"),
      v.literal("calling"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.missionId, { status: args.status });
  },
});

export const setLiveMessageId = internalMutation({
  args: { missionId: v.id("missions"), messageId: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.missionId, { tgLiveMessageId: args.messageId });
  },
});

export const getInternal = internalQuery({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args): Promise<Doc<"missions"> | null> =>
    await ctx.db.get(args.missionId),
});

/**
 * Cross-call leverage: the real quotes this mission has already banked.
 *
 * This is the product's core mechanic, and the reason calls run sequentially.
 * Call N is strictly stronger than call N-1 because it carries a price a real
 * shopkeeper actually said ninety seconds earlier.
 *
 * HARD RULE: only completed calls with an extracted price are returned. If
 * this comes back empty the prompt must tell the model it has no competing
 * quote — a fabricated one is misrepresentation, not cleverness.
 */
export const priorQuotes = internalQuery({
  args: { missionId: v.id("missions"), excludeCallId: v.optional(v.id("calls")) },
  handler: async (ctx, args) => {
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();

    const out: Array<{ shop: string; priceInr: number; effectiveInr: number }> = [];
    for (const c of calls) {
      if (args.excludeCallId && c._id === args.excludeCallId) continue;
      if (c.status !== "closed") continue;
      const price = c.finalQuoteInr;
      if (!price) continue;
      const vendor = await ctx.db.get(c.vendorId);
      out.push({
        shop: vendor?.name ?? "another shop",
        priceInr: price,
        effectiveInr: c.effectivePriceInr ?? price,
      });
    }
    return out.sort((a, b) => a.effectiveInr - b.effectiveInr);
  },
});

/** Recompute the winner and the headline savings number. */
export const finalise = internalMutation({
  args: { missionId: v.id("missions"), summaryText: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();

    const priced = calls.filter((c) => c.effectivePriceInr ?? c.finalQuoteInr);
    let bestCallId: Id<"calls"> | undefined;
    let savedInr: number | undefined;

    if (priced.length > 0) {
      // Rank on effectivePrice, never the raw quote — a 23,500 + GST + delivery
      // quote loses to a 25,000 all-in, and a judge doing the arithmetic on
      // stage will notice if the winner is wrong.
      const sorted = [...priced].sort(
        (a, b) =>
          (a.effectivePriceInr ?? a.finalQuoteInr!) -
          (b.effectivePriceInr ?? b.finalQuoteInr!),
      );
      bestCallId = sorted[0]._id;

      // Savings = best opening quote anyone gave us, minus what we actually got.
      const openings = calls.map((c) => c.openingQuoteInr).filter(Boolean) as number[];
      const bestOpening = openings.length ? Math.min(...openings) : undefined;
      const won = sorted[0].finalQuoteInr;
      if (bestOpening && won && bestOpening > won) savedInr = bestOpening - won;
    }

    await ctx.db.patch(args.missionId, {
      status: "done",
      bestCallId,
      savedInr,
      summaryText: args.summaryText,
    });
    return { bestCallId, savedInr };
  },
});

// ─── Reads (public — the dashboard. Contract 3.) ────────────────────────────

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx, args.token);
    const missions = await ctx.db
      .query("missions")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(40);

    return await Promise.all(
      missions.map(async (m) => {
        const calls = await ctx.db
          .query("calls")
          .withIndex("by_mission", (q) => q.eq("missionId", m._id))
          .collect();
        return {
          _id: m._id,
          rawRequest: m.rawRequest,
          missionType: m.missionType,
          category: m.brief.category,
          locality: m.brief.locality,
          language: m.brief.language,
          status: m.status,
          savedInr: m.savedInr,
          callCount: calls.length,
          liveCount: calls.filter(
            (c) => c.status === "talking" || c.status === "dialing" || c.status === "ringing",
          ).length,
          createdAt: m.createdAt,
        };
      }),
    );
  },
});

export const get = query({
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

    return { mission, vendors, calls };
  },
});

/**
 * The comparison view. Feeds both the Negotiation Arc and the Answer Matrix.
 */
export const comparison = query({
  args: { token: v.string(), missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx, args.token);
    const mission = await ctx.db.get(args.missionId);
    if (!mission || mission.userId !== userId) return null;

    const calls = await ctx.db
      .query("calls")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();

    const rows = await Promise.all(
      calls.map(async (c) => {
        const vendor = await ctx.db.get(c.vendorId);
        return {
          callId: c._id,
          vendorName: vendor?.name ?? "Unknown",
          phoneE164: c.phoneE164,
          status: c.status,
          openingQuoteInr: c.openingQuoteInr,
          finalQuoteInr: c.finalQuoteInr,
          effectivePriceInr:
            c.effectivePriceInr ??
            effectivePrice({ quotedPriceInr: c.finalQuoteInr, taxIncluded: true }),
          dropPct:
            c.openingQuoteInr && c.finalQuoteInr && c.openingQuoteInr > 0
              ? Math.round(
                  ((c.openingQuoteInr - c.finalQuoteInr) / c.openingQuoteInr) * 100,
                )
              : undefined,
          slots: c.slots,
          quoteTurnSeq: c.quoteTurnSeq,
          contactName: c.contactName,
          holdUntil: c.holdUntil,
          terms: c.terms,
          durationSec: c.durationSec,
          recordingUrl: c.recordingUrl,
          lang: c.lang,
          detectedLangs: c.detectedLangs,
          twilioCallSid: c.twilioCallSid,
        };
      }),
    );

    const priced = rows.filter((r) => r.effectivePriceInr);
    const winnerId = priced.length
      ? priced.reduce((a, b) =>
          (b.effectivePriceInr ?? Infinity) < (a.effectivePriceInr ?? Infinity) ? b : a,
        ).callId
      : undefined;

    return {
      missionType: mission.missionType,
      objectives: mission.brief.objectives,
      rows,
      winnerId,
      savedInr: mission.savedInr,
      summaryText: mission.summaryText,
    };
  },
});

/** Checkpoint A — the user taps "Call all 3". Nothing dials before this. */
export const approve = mutation({
  args: { token: v.string(), missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx, args.token);
    const m = await ctx.db.get(args.missionId);
    if (!m || m.userId !== userId) throw new Error("Not found");
    if (m.status !== "awaiting_approval") return { ok: false, status: m.status };
    await ctx.db.patch(args.missionId, { status: "discovering" });
    return { ok: true };
  },
});

export const cancel = mutation({
  args: { token: v.string(), missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx, args.token);
    const m = await ctx.db.get(args.missionId);
    if (!m || m.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.missionId, { status: "cancelled" });
    return { ok: true };
  },
});
