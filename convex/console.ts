import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireSession } from "./users";
import { synthesize } from "./lib/sarvam";
import {
  CURATED_VOICES,
  DEFAULT_LANG,
  DEFAULT_VOICE,
  isTtsLang,
  V3_SPEAKERS,
  VOICE_META,
  VOICE_SAMPLE,
} from "./lib/constants";
import { TTS_LANG } from "./schema";

/**
 * The console's own public surface.
 *
 * WHY THIS IS SEPARATE FROM TELEGRAM
 * ----------------------------------
 * The console used to be a *projection* of the Telegram bot: the only way to
 * get a session was for the bot to DM you a `?t=` link, so no bot meant no
 * console. That coupling is backwards. The two are peer front-ends over one
 * store — you can start a mission in either and see it in both, because a
 * mission belongs to a USER, not to a surface.
 *
 * What makes them one place:
 *   - `sessions` is the only auth system, and this file can mint one too.
 *   - `missions` are keyed by userId, so `missions.list` already returns
 *     Telegram-started and console-started missions together.
 *   - `chatMessages` carries a `surface` discriminator, so the conversation
 *     history interleaves both and says which is which.
 *
 * Additive by design, like webconsole.ts: nothing here edits telegram.ts,
 * orchestrator.ts or calls.ts.
 */

// ─── 1. Sign-in without Telegram ────────────────────────────────────────────

/**
 * Get-or-create an identity and hand back a session token.
 *
 * `users` is keyed by `tgUserId`, which is a frozen unique index (§9). Rather
 * than migrate it, this reuses it as a generic identity key with a namespace:
 *
 *   "1212129150"   → a Telegram numeric id. Signing in with it lands you on
 *                    the SAME user row the bot uses, so your Telegram missions
 *                    and your console missions are one history.
 *   "web:pulkit"   → a console-only identity.
 *
 * ⚠️ HONEST LIMITATION, stated out loud: there is no password. Anyone who
 * knows a Telegram id can mint a session for it. That is the same posture as
 * the `?t=` token (which travels in a URL and appears in Convex logs — see
 * users.ts) and it is fine for a demo and wrong for production. The fix is an
 * OAuth provider in front of this function, not a change to it.
 */
export const signIn = mutation({
  args: {
    /** Telegram numeric id to join that history, or any handle for a fresh one. */
    handle: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ token: string; userId: Id<"users">; displayName?: string; linkedTelegram: boolean }> => {
    const raw = (args.handle ?? "").trim();
    const isTelegramId = /^\d{5,}$/.test(raw);
    const key = raw ? (isTelegramId ? raw : `web:${slug(raw)}`) : "web:console";

    let user = await ctx.db
      .query("users")
      .withIndex("by_tg", (q) => q.eq("tgUserId", key))
      .unique();

    if (!user) {
      const id = await ctx.db.insert("users", {
        tgUserId: key,
        displayName: args.displayName ?? (raw && !isTelegramId ? raw : "Console user"),
        preferredLang: DEFAULT_LANG,
        preferredVoice: DEFAULT_VOICE,
        learnedPrefs: [],
        totalSavedInr: 0,
        createdAt: Date.now(),
      });
      user = (await ctx.db.get(id))!;
    }

    const token: string = await ctx.runMutation(internal.users.issueSession, {
      userId: user._id,
    });

    return {
      token,
      userId: user._id,
      displayName: user.displayName,
      linkedTelegram: isTelegramId,
    };
  },
});

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "console";
}

// ─── 2. Voice & language preferences ────────────────────────────────────────

/**
 * The picker's options. A query rather than a client-side constant so the list
 * can never drift from `V3_SPEAKERS` — a name that is not in that array is a
 * 400 from Sarvam TTS at dial time, i.e. a dead call, not a styling bug.
 */
export const voices = query({
  args: {},
  handler: async () => ({
    voices: VOICE_META.filter((v) => (V3_SPEAKERS as readonly string[]).includes(v.id)),
    languages: Object.keys(VOICE_SAMPLE),
    curated: CURATED_VOICES,
  }),
});

export const setPrefs = mutation({
  args: {
    token: v.string(),
    language: v.optional(TTS_LANG),
    voice: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx, args.token);
    const patch: Record<string, string> = {};
    if (args.language && isTtsLang(args.language)) patch.preferredLang = args.language;
    // Never persist a speaker Sarvam will reject.
    if (args.voice && (V3_SPEAKERS as readonly string[]).includes(args.voice)) {
      patch.preferredVoice = args.voice;
    }
    if (Object.keys(patch).length) await ctx.db.patch(userId, patch);
    return { ok: true, ...patch };
  },
});

/**
 * "Hear who will be calling."
 *
 * Renders one sample line through the SAME model and speaker the call will
 * use, so what you audition is what the shopkeeper hears. Returns base64 WAV
 * for the browser to play — no storage round trip, the clip is ~1 second.
 */
export const previewVoice = action({
  args: {
    token: v.string(),
    voice: v.string(),
    language: TTS_LANG,
    /** Optional custom line. Capped — this is a preview, not a TTS endpoint. */
    text: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; base64?: string; mime?: string; reason?: string }> => {
    await ctx.runQuery(api.users.me, { token: args.token }).then((me) => {
      if (!me) throw new Error("Invalid session");
    });

    if (!(V3_SPEAKERS as readonly string[]).includes(args.voice)) {
      return { ok: false, reason: `"${args.voice}" is not a bulbul:v3 speaker` };
    }

    const text = (args.text ?? VOICE_SAMPLE[args.language] ?? VOICE_SAMPLE["en-IN"]).slice(0, 200);
    try {
      const { base64, mime } = await synthesize({
        text,
        lang: args.language,
        speaker: args.voice,
      });
      return { ok: true, base64, mime };
    } catch (err: any) {
      return { ok: false, reason: String(err?.message ?? err).slice(0, 200) };
    }
  },
});

// ─── 3. One conversation history, both surfaces ─────────────────────────────

/**
 * Everything this user has said or been told, on Telegram AND in the console,
 * oldest first. `surface` is returned so the UI can badge where each line came
 * from — the point is that they are one thread, not that they look identical.
 */
export const history = query({
  args: { token: v.string(), missionId: v.optional(v.id("missions")), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx, args.token);
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(Math.min(args.limit ?? 200, 400));

    return rows
      .filter((m) => !args.missionId || m.missionId === args.missionId)
      .map((m) => ({
        _id: m._id,
        role: m.role,
        text: m.text,
        surface: m.surface,
        missionId: m.missionId,
        createdAt: m.createdAt,
      }))
      .reverse();
  },
});

/** The console logging its own side of the conversation into the shared table. */
export const log = mutation({
  args: {
    token: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    missionId: v.optional(v.id("missions")),
  },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx, args.token);
    await ctx.db.insert("chatMessages", {
      userId,
      missionId: args.missionId,
      role: args.role,
      text: args.text.slice(0, 4000),
      surface: "web",
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});
