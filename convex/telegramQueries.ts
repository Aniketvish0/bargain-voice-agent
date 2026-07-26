import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Query/mutation helpers for the Telegram lane.
 *
 * Split from telegram.ts purely so that file stays actions-only and easy to
 * reason about — actions cannot touch the database directly.
 */

export const recentMissions = internalQuery({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("missions")
      .withIndex("by_user_created", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit ?? 5);
    return rows.map((m) => ({
      _id: m._id,
      category: m.brief.category,
      locality: m.brief.locality,
      status: m.status,
      savedInr: m.savedInr,
      missionType: m.missionType,
    }));
  },
});

export const cancelActive = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<number> => {
    const active = await ctx.db
      .query("missions")
      .withIndex("by_user_created", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);
    let n = 0;
    for (const m of active) {
      if (["awaiting_approval", "discovering", "calling", "pending"].includes(m.status)) {
        await ctx.db.patch(m._id, { status: "cancelled" });
        n++;
      }
    }
    return n;
  },
});

/** Chat log — feeds the ChatGPT-style left rail on the dashboard. */
export const logChat = internalMutation({
  args: {
    userId: v.id("users"),
    missionId: v.optional(v.id("missions")),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    surface: v.union(v.literal("telegram"), v.literal("web")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("chatMessages", {
      userId: args.userId,
      missionId: args.missionId,
      role: args.role,
      text: args.text,
      surface: args.surface,
      createdAt: Date.now(),
    });
  },
});
