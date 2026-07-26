/**
 * Doot — Telegram Bot API client.
 *
 * Raw fetch, deliberately. grammY needs an adapter shim for the Convex V8
 * runtime and buys nothing here; these are nine one-line calls.
 *
 * ⚠️ TELEGRAM_BOT_TOKEN must be set with `npx convex env set`, NOT in a local
 *    .env file. A local .env leaves process.env undefined in the deployed
 *    httpAction and every call 404s with a confusing "Not Found" that looks
 *    like a bad token. This is the most common 30-minute loss in this lane.
 */

const API = "https://api.telegram.org";

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not set on this deployment. " +
        'Run: npx convex env set TELEGRAM_BOT_TOKEN "123:ABC" — ' +
        "a local .env file will NOT work.",
    );
  }
  return t;
}

async function call<T = any>(method: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${API}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) {
    // "message is not modified" is expected on the live ticker — not an error.
    const desc: string = data?.description ?? "";
    if (desc.includes("message is not modified")) return null;
    console.error(`Telegram ${method} failed: ${res.status} ${desc}`);
    return null;
  }
  return data.result as T;
}

export type InlineButton = { text: string; callback_data: string };

/** ⚠️ callback_data has a hard 64-BYTE ceiling. Store an id, never a payload. */
export function button(text: string, data: string): InlineButton {
  const bytes = new TextEncoder().encode(data).length;
  if (bytes > 64) {
    throw new Error(
      `callback_data is ${bytes} bytes (max 64): ${data}. Store an id, not a payload.`,
    );
  }
  return { text, callback_data: data };
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  keyboard?: InlineButton[][],
): Promise<{ message_id: number } | null> {
  return await call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  keyboard?: InlineButton[][],
): Promise<void> {
  await call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

/** Stops the little spinner on an inline button. Always call this. */
export async function answerCallbackQuery(
  id: string,
  text?: string,
): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: id, text });
}

export async function sendChatAction(
  chatId: string | number,
  action: "typing" | "record_voice" | "upload_voice",
): Promise<void> {
  await call("sendChatAction", { chat_id: chatId, action });
}

/**
 * Two-step download: getFile gives a path, then a different host serves bytes.
 * Telegram voice notes are OGG/Opus, which Sarvam STT accepts directly.
 */
export async function downloadFile(fileId: string): Promise<ArrayBuffer | null> {
  const f = await call<{ file_path: string }>("getFile", { file_id: fileId });
  if (!f?.file_path) return null;
  const res = await fetch(`${API}/file/bot${token()}/${f.file_path}`);
  if (!res.ok) return null;
  return await res.arrayBuffer();
}

/**
 * sendVoice requires an Ogg-Opus container.
 *
 * ✅ Verified live: Bulbul returns exactly that when you pass
 *    output_audio_codec:"opus" + speech_sample_rate:24000. No ffmpeg, and no
 *    bridge round-trip. See lib/sarvam.ts synthesize().
 */
export async function sendVoice(
  chatId: string | number,
  oggBase64: string,
  caption?: string,
): Promise<void> {
  const bytes = Uint8Array.from(atob(oggBase64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("voice", new Blob([bytes], { type: "audio/ogg" }), "summary.ogg");
  if (caption) {
    form.append("caption", caption.slice(0, 1024));
    form.append("parse_mode", "HTML");
  }
  const res = await fetch(`${API}/bot${token()}/sendVoice`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    console.error(`sendVoice failed: ${res.status} ${await res.text()}`);
  }
}

/** Idempotent. Safe to re-run whenever the tunnel URL changes. */
export async function setWebhook(url: string, secret: string): Promise<any> {
  return await call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}
