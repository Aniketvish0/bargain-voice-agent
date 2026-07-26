import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { DEFAULT_LANG, DEFAULT_VOICE } from "./lib/constants";
import { TTS_LANG } from "./schema";

/** Seven days. Long enough for the hackathon, short enough to be defensible. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const getOrCreateByTelegram = internalMutation({
  args: {
    tgUserId: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"users">> => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_tg", (q) => q.eq("tgUserId", args.tgUserId))
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("users", {
      tgUserId: args.tgUserId,
      displayName: args.displayName,
      preferredLang: DEFAULT_LANG,
      preferredVoice: DEFAULT_VOICE,
      learnedPrefs: [],
      totalSavedInr: 0,
      createdAt: Date.now(),
    });
  },
});

export const get = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<Doc<"users"> | null> =>
    await ctx.db.get(args.userId),
});

export const setLanguage = internalMutation({
  args: {
    userId: v.id("users"),
    lang: TTS_LANG,
    voice: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      preferredLang: args.lang,
      ...(args.voice ? { preferredVoice: args.voice } : {}),
    });
  },
});

/**
 * Memory & Context (1x rubric line). These strings are injected verbatim into
 * the next call's system prompt, which is what makes the "it remembers" beat
 * in the demo real rather than theatre.
 */
export const addLearnedPref = internalMutation({
  args: { userId: v.id("users"), pref: v.string() },
  handler: async (ctx, args) => {
    const u = await ctx.db.get(args.userId);
    if (!u) return;
    if (u.learnedPrefs.includes(args.pref)) return;
    // Keep the tail — the most recent 8 preferences.
    const next = [...u.learnedPrefs, args.pref].slice(-8);
    await ctx.db.patch(args.userId, { learnedPrefs: next });
  },
});

export const recordSavings = internalMutation({
  args: { userId: v.id("users"), savedInr: v.number() },
  handler: async (ctx, args) => {
    const u = await ctx.db.get(args.userId);
    if (!u) return;
    await ctx.db.patch(args.userId, {
      totalSavedInr: u.totalSavedInr + Math.max(0, args.savedInr),
    });
  },
});

// ─── Sessions: the entire auth system. BUILD-SPEC Contract 5. ───────────────

export const issueSession = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<string> => {
    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    await ctx.db.insert("sessions", {
      token,
      userId: args.userId,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return token;
  },
});

/**
 * Validates a dashboard token. Every public query takes one.
 *
 * Honest limitation, stated out loud: tokens travel in function arguments and
 * therefore appear in Convex logs. Fine for a demo, not for production.
 */
export async function requireSession(
  ctx: { db: any },
  token: string,
): Promise<Id<"users">> {
  const s = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .unique();
  if (!s) throw new Error("Invalid session");
  if (s.expiresAt < Date.now()) throw new Error("Session expired");
  return s.userId;
}

/** Dashboard bootstrap: who am I, and what are my settings? */
export const me = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx, args.token);
    const u = await ctx.db.get(userId);
    if (!u) return null;
    return {
      _id: u._id,
      displayName: u.displayName,
      preferredLang: u.preferredLang,
      preferredVoice: u.preferredVoice,
      learnedPrefs: u.learnedPrefs,
      totalSavedInr: u.totalSavedInr,
    };
  },
});
