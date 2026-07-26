import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import * as tg from "./tgApi";
import { transcribe, synthesize } from "./lib/sarvam";
import {
  CURATED_VOICES,
  DEFAULT_LANG,
  isTtsLang,
  TTS_11,
  VOICE_BY_LANG,
} from "./lib/constants";
import type { Brief } from "./intent";

/**
 * Doot — Telegram surface. This is the primary UI.
 *
 * Everything slow happens here, in a scheduled action. The httpAction in
 * http.ts only verifies the secret and schedules, because Telegram retries any
 * non-2XX — and a retry storm here re-triggers real outbound PSTN calls at
 * real money cost.
 */

/** Sarvam REST STT hard-caps at 30s. Guard before spending the API call. */
const MAX_VOICE_SECONDS = 28;

export const handleUpdate = internalAction({
  args: { update: v.any() },
  handler: async (ctx, { update }) => {
    try {
      if (update.callback_query) return await onCallback(ctx, update.callback_query);
      if (update.message) return await onMessage(ctx, update.message);
    } catch (err) {
      // Never rethrow: an exception here is retried by the scheduler, and the
      // user would rather see one apology than nothing at all.
      console.error("handleUpdate failed", err);
      const chatId =
        update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
      if (chatId) {
        await tg.sendMessage(
          chatId,
          "😖 Something broke on my side. Try again in a moment.",
        );
      }
    }
  },
});

// ─── Messages ───────────────────────────────────────────────────────────────

async function onMessage(ctx: any, msg: any) {
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from?.id ?? chatId);

  const allow = process.env.TELEGRAM_ALLOWED_USER_IDS;
  if (allow && allow.trim()) {
    const ids = allow.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length && !ids.includes(tgUserId)) {
      await tg.sendMessage(chatId, "This bot is locked to the build team right now.");
      return;
    }
  }

  const userId: Id<"users"> = await ctx.runMutation(
    internal.users.getOrCreateByTelegram,
    {
      tgUserId,
      displayName: [msg.from?.first_name, msg.from?.last_name]
        .filter(Boolean)
        .join(" ") || undefined,
    },
  );

  const text: string | undefined = msg.text;

  if (text?.startsWith("/start")) return await cmdStart(ctx, chatId, userId);
  if (text?.startsWith("/help")) return await cmdStart(ctx, chatId, userId);
  if (text?.startsWith("/language")) return await cmdLanguage(chatId);
  if (text?.startsWith("/history")) return await cmdHistory(ctx, chatId, userId);
  if (text?.startsWith("/stop")) return await cmdStop(ctx, chatId, userId);

  // ── Voice note: the highest-scoring input path. Sarvam depth + Delight. ──
  if (msg.voice) {
    if ((msg.voice.duration ?? 0) > MAX_VOICE_SECONDS) {
      await tg.sendMessage(
        chatId,
        `🎙 Thoda chhota rakhiye — ${MAX_VOICE_SECONDS} seconds ke andar bata dijiye kya chahiye.`,
      );
      return;
    }
    await tg.sendChatAction(chatId, "typing");
    const audio = await tg.downloadFile(msg.voice.file_id);
    if (!audio) {
      await tg.sendMessage(chatId, "Couldn't fetch that voice note. Try again?");
      return;
    }
    // Telegram gives OGG/Opus; Sarvam accepts it byte-for-byte. No ffmpeg.
    const stt = await transcribe(audio, "voice.ogg");
    if (!stt.transcript.trim()) {
      await tg.sendMessage(chatId, "I couldn't hear anything in that. Try again?");
      return;
    }
    await tg.sendMessage(
      chatId,
      `🎙 <i>“${escapeHtml(stt.transcript)}”</i>\n<code>${stt.languageCode ?? "?"} · ${Math.round((stt.languageProbability ?? 0) * 100)}%</code>`,
    );
    return await startMission(ctx, chatId, userId, stt.transcript, "voice", stt.languageCode);
  }

  if (text && text.trim().length > 3) {
    await tg.sendChatAction(chatId, "typing");
    return await startMission(ctx, chatId, userId, text.trim(), "text");
  }

  await tg.sendMessage(
    chatId,
    "Tell me what you need — type it, or send a voice note 🎙",
  );
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdStart(ctx: any, chatId: number, userId: Id<"users">) {
  const token: string = await ctx.runMutation(internal.users.issueSession, { userId });
  const dash = process.env.DASHBOARD_URL;
  const link = dash ? `\n\n📊 <a href="${dash}/?t=${token}">Open your dashboard</a>` : "";

  await tg.sendMessage(
    chatId,
    [
      "<b>Doot</b> — दूत, an envoy sent to speak on your behalf.",
      "",
      "Tell me what you need from the offline world and I'll phone real businesses, ask in their language, haggle where it helps, and bring back a ranked answer.",
      "",
      "<b>Try:</b>",
      "• <i>Goa mein 14 tarikh se do raat, AC room, chaar hazaar se kam</i>",
      "• <i>koi medical store HSR layout mein raat ko khula hai kya</i>",
      "• <i>250 litre fridge Karol Bagh, pachees hazaar se kam</i>",
      "",
      "🎙 A voice note works too — in any Indian language.",
      "",
      "<code>/language</code> · <code>/history</code> · <code>/stop</code>",
      link,
    ].join("\n"),
  );
}

async function cmdLanguage(chatId: number) {
  const rows: tg.InlineButton[][] = [];
  const labels: Record<string, string> = {
    "hi-IN": "हिन्दी", "en-IN": "English", "ta-IN": "தமிழ்", "te-IN": "తెలుగు",
    "kn-IN": "ಕನ್ನಡ", "mr-IN": "मराठी", "bn-IN": "বাংলা", "gu-IN": "ગુજરાતી",
    "ml-IN": "മലയാളം", "pa-IN": "ਪੰਜਾਬੀ", "od-IN": "ଓଡ଼ିଆ",
  };
  rows.push([tg.button("✨ Auto-detect (recommended)", "lang:auto")]);
  const langs = [...TTS_11];
  for (let i = 0; i < langs.length; i += 2) {
    rows.push(
      langs.slice(i, i + 2).map((l) => tg.button(labels[l] ?? l, `lang:${l}`)),
    );
  }
  await tg.sendMessage(
    chatId,
    "<b>Call language</b>\n\nAuto-detect listens to whoever picks up and switches mid-call to match them. Pick a fixed language only if you know better.",
    rows,
  );
}

async function cmdHistory(ctx: any, chatId: number, userId: Id<"users">) {
  const rows = await ctx.runQuery(internal.telegramQueries.recentMissions, { userId });
  if (!rows.length) {
    await tg.sendMessage(chatId, "No missions yet. Tell me what you need 🙂");
    return;
  }
  const lines = rows.map((m: any) => {
    const saved = m.savedInr ? ` · <b>saved ₹${m.savedInr.toLocaleString("en-IN")}</b>` : "";
    return `${statusEmoji(m.status)} <b>${escapeHtml(m.category)}</b> — ${escapeHtml(m.locality)}${saved}`;
  });
  await tg.sendMessage(chatId, ["<b>Recent missions</b>", "", ...lines].join("\n"));
}

async function cmdStop(ctx: any, chatId: number, userId: Id<"users">) {
  const n = await ctx.runMutation(internal.telegramQueries.cancelActive, { userId });
  await tg.sendMessage(
    chatId,
    n > 0 ? `🛑 Stopped ${n} mission${n > 1 ? "s" : ""}.` : "Nothing running.",
  );
}

// ─── Mission creation → Checkpoint A ────────────────────────────────────────

async function startMission(
  ctx: any,
  chatId: number,
  userId: Id<"users">,
  rawText: string,
  inputMode: "voice" | "text",
  detectedLang?: string,
) {
  const user = await ctx.runQuery(internal.users.get, { userId });

  // One conversation, two surfaces. The console reads this same table through
  // `console.history`, so a mission started here shows up there and vice
  // versa. Telegram is a peer front-end, not the owner of the thread.
  await ctx.runMutation(internal.telegramQueries.logChat, {
    userId,
    role: "user",
    text: rawText,
    surface: "telegram",
  });

  const brief: Brief = await ctx.runAction(internal.intent.extractBrief, {
    text: rawText,
    userPrefLang: detectedLang ?? user?.preferredLang ?? DEFAULT_LANG,
  });

  if (brief.clarifyingQuestion) {
    await tg.sendMessage(chatId, `🤔 ${escapeHtml(brief.clarifyingQuestion)}`);
    await ctx.runMutation(internal.telegramQueries.logChat, {
      userId,
      role: "assistant",
      text: brief.clarifyingQuestion,
      surface: "telegram",
    });
    return;
  }

  const lang = isTtsLang(brief.language) ? brief.language : DEFAULT_LANG;

  const missionId: Id<"missions"> = await ctx.runMutation(internal.missions.create, {
    userId,
    rawRequest: rawText,
    inputMode,
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
  });

  await ctx.runMutation(internal.telegramQueries.logChat, {
    userId,
    missionId,
    role: "assistant",
    text:
      `Looking for ${brief.category}${brief.locality ? ` in ${brief.locality}` : ""}. ` +
      `Waiting for you to approve the roster — nothing dials yet.`,
    surface: "telegram",
  });

  await tg.sendMessage(chatId, renderBriefCard(brief, lang), [
    [
      tg.button("📞 Find & call", `go:${missionId}`),
      tg.button("✖️ Cancel", `no:${missionId}`),
    ],
  ]);
}

function renderBriefCard(b: Brief, lang: string): string {
  const typeLabel = {
    availability: "🔎 Availability check",
    quote: "💬 Get a quote",
    negotiate: "🤝 Negotiate",
  }[b.missionType];

  const lines = [
    `<b>${typeLabel}</b>`,
    "",
    `<b>${escapeHtml(b.category)}</b> · ${escapeHtml(b.locality) || "anywhere"}`,
  ];
  if (b.constraints.length) lines.push(`<i>${escapeHtml(b.constraints.join(" · "))}</i>`);
  lines.push("");
  lines.push("<b>I'll ask them:</b>");
  for (const o of b.objectives) {
    lines.push(`  ${o.required ? "•" : "◦"} ${escapeHtml(o.ask)}`);
  }
  if (b.targetPriceInr) {
    lines.push("");
    lines.push(
      `🎯 Target <b>₹${b.targetPriceInr.toLocaleString("en-IN")}</b>` +
        (b.walkAwayInr ? ` · walk away above ₹${b.walkAwayInr.toLocaleString("en-IN")}` : ""),
    );
  }
  lines.push("");
  lines.push(`🗣 Calling in <code>${lang}</code>, switching if they speak another language.`);
  return lines.join("\n");
}

// ─── Callbacks ──────────────────────────────────────────────────────────────

async function onCallback(ctx: any, cq: any) {
  const chatId = cq.message?.chat?.id;
  const data: string = cq.data ?? "";
  const [kind, arg] = data.split(":");

  if (kind === "lang") {
    const tgUserId = String(cq.from?.id);
    const userId: Id<"users"> = await ctx.runMutation(
      internal.users.getOrCreateByTelegram,
      { tgUserId },
    );
    const lang = arg === "auto" ? DEFAULT_LANG : arg;
    if (isTtsLang(lang)) {
      await ctx.runMutation(internal.users.setLanguage, {
        userId,
        lang,
        voice: VOICE_BY_LANG[lang],
      });
    }
    await tg.answerCallbackQuery(cq.id, arg === "auto" ? "Auto-detect on" : `Set to ${arg}`);
    await tg.sendMessage(
      chatId,
      arg === "auto"
        ? "✨ Auto-detect on — I'll match whoever picks up."
        : `🗣 Calls will start in <code>${arg}</code>.`,
    );
    return;
  }

  if (kind === "no") {
    await ctx.runMutation(internal.missions.setStatus, {
      missionId: arg as Id<"missions">,
      status: "cancelled",
    });
    await tg.answerCallbackQuery(cq.id, "Cancelled");
    await tg.editMessageText(chatId, cq.message.message_id, "✖️ Cancelled.");
    return;
  }

  if (kind === "go") {
    await tg.answerCallbackQuery(cq.id, "Finding businesses…");
    const missionId = arg as Id<"missions">;
    await ctx.runMutation(internal.missions.setStatus, {
      missionId,
      status: "discovering",
    });
    await tg.editMessageText(
      chatId,
      cq.message.message_id,
      cq.message.text
        ? `${escapeHtml(cq.message.text)}\n\n⏳ <b>Finding businesses…</b>`
        : "⏳ <b>Finding businesses…</b>",
    );
    // Discovery + dialling is owned by the orchestrator.
    await ctx.scheduler.runAfter(0, internal.orchestrator.runMission, {
      missionId,
      chatId: String(chatId),
    });
    return;
  }

  await tg.answerCallbackQuery(cq.id);
}

// ─── Outbound helpers used by the orchestrator ──────────────────────────────

export const send = internalAction({
  args: {
    chatId: v.string(),
    text: v.optional(v.string()),
    voiceLang: v.optional(v.string()),
    voiceText: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    if (args.text) await tg.sendMessage(args.chatId, args.text);
    if (args.voiceText && args.voiceLang) {
      const lang = isTtsLang(args.voiceLang) ? args.voiceLang : DEFAULT_LANG;
      // A different speaker from the one used on the call — it should sound
      // like your assistant reporting back, not like the negotiator.
      const audio = await synthesize({
        text: args.voiceText,
        lang,
        speaker: CURATED_VOICES[0] === VOICE_BY_LANG[lang] ? "anand" : VOICE_BY_LANG[lang],
        codec: "opus",
        sampleRate: 24000,
      });
      await tg.sendVoice(args.chatId, audio.base64);
    }
  },
});

/** Edit one message in place. Debounced by the caller — 1 msg/sec per chat. */
export const editLive = internalAction({
  args: { chatId: v.string(), messageId: v.number(), text: v.string() },
  handler: async (_ctx, args) => {
    await tg.editMessageText(args.chatId, args.messageId, args.text);
  },
});

export const sendAndRemember = internalAction({
  args: { chatId: v.string(), missionId: v.id("missions"), text: v.string() },
  handler: async (ctx, args): Promise<number | null> => {
    const m = await tg.sendMessage(args.chatId, args.text);
    if (m?.message_id) {
      await ctx.runMutation(internal.missions.setLiveMessageId, {
        missionId: args.missionId,
        messageId: m.message_id,
      });
    }
    return m?.message_id ?? null;
  },
});

/** Registers the webhook. Run once after the deployment URL is known. */
export const registerWebhook = internalAction({
  args: { convexSiteUrl: v.string() },
  handler: async (_ctx, args) => {
    const secret = process.env.TG_WEBHOOK_SECRET;
    if (!secret) throw new Error("TG_WEBHOOK_SECRET not set on this deployment");
    const url = `${args.convexSiteUrl.replace(/\/$/, "")}/telegram`;
    const r = await tg.setWebhook(url, secret);
    console.log("setWebhook", url, JSON.stringify(r));
    return r;
  },
});

// ─── util ───────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function statusEmoji(s: string): string {
  return (
    { done: "✅", calling: "📞", discovering: "🔎", failed: "⚠️", cancelled: "✖️" }[s] ??
    "•"
  );
}
