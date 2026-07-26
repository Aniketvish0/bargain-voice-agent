import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";

/** DB helpers for the orchestrator, which is actions-only. */

/**
 * The next call to place, or null if the mission is finished.
 *
 * Returns null while anything is still in flight — this is what enforces
 * "one call at a time" and therefore keeps cross-call citation honest.
 */
export const nextQueuedCall = internalQuery({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args): Promise<Id<"calls"> | null> => {
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();

    const inFlight = calls.some((c) =>
      ["dialing", "ringing", "talking"].includes(c.status),
    );
    if (inFlight) return null;

    const queued = calls
      .filter((c) => c.status === "queued")
      .sort((a, b) => a._creationTime - b._creationTime);
    return queued[0]?._id ?? null;
  },
});

export const callsForMission = internalQuery({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();
    return await Promise.all(
      calls.map(async (c) => ({
        ...c,
        vendorName: (await ctx.db.get(c.vendorId))?.name ?? "Unknown",
      })),
    );
  },
});

export const turnsForCall = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("turns")
      .withIndex("by_call_seq", (q) => q.eq("callId", args.callId))
      .order("asc")
      .collect(),
});
