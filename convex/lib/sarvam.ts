/**
 * Doot — Sarvam AI client for the Convex runtime.
 *
 * Plain `fetch`, no SDK, no "use node". Every call here was exercised against
 * the live API on 26 Jul 2026 — the comments record what actually happened,
 * not what the docs imply.
 *
 * Auth: `api-subscription-key` on everything; /v1/* also takes a Bearer token.
 * ⚠️ Auth failure is 403, not 401.
 */

import { LLM_EXTRACT, LLM_LIVE, STT_MODEL, TTS_MODEL } from "./constants";

const BASE = "https://api.sarvam.ai";

function key(): string {
  const k = process.env.SARVAM_API_KEY;
  if (!k) {
    throw new Error(
      "SARVAM_API_KEY is not set on this deployment. " +
        'Run: npx convex env set SARVAM_API_KEY "sk_..."  ' +
        "(a local .env file will NOT work — see BUILD-SPEC §12)",
    );
  }
  return k;
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  return `Sarvam ${res.status}: ${body.slice(0, 400)}`;
}

// ─── Chat ───────────────────────────────────────────────────────────────────

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * ⚠️⚠️ THE MOST IMPORTANT DETAIL IN THIS FILE.
 *
 * Reasoning is ON by default on sarvam-30b/105b, and reasoning tokens count
 * toward max_tokens. Verified live: with max_tokens=60 and default settings,
 * `content` came back **null**, all 60 tokens went to `reasoning_content`, and
 * finish_reason was "length". On a phone call that is dead silence with no
 * error to debug.
 *
 * `reasoning_effort: null` is therefore mandatory, not an optimisation.
 */
export async function chat(opts: {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}): Promise<{ content: string; requestId?: string }> {
  const body: Record<string, unknown> = {
    model: opts.model ?? LLM_LIVE,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 100,
    temperature: opts.temperature ?? 0.4,
    reasoning_effort: null, // ← see the comment above. Never remove.
  };
  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    // If this ever fires, reasoning_effort has been reintroduced somewhere.
    throw new Error(
      `Sarvam chat returned empty content (finish_reason=${data?.choices?.[0]?.finish_reason}). ` +
        `usage=${JSON.stringify(data?.usage)}`,
    );
  }
  return { content, requestId: data?.request_id };
}

/** Extraction / summary. 105B, JSON mode, generous token budget, offline only. */
export async function extractJson<T = unknown>(
  messages: ChatMessage[],
): Promise<T> {
  const { content } = await chat({
    messages,
    model: LLM_EXTRACT,
    maxTokens: 4096,
    temperature: 0.1,
    json: true,
  });
  try {
    return JSON.parse(content) as T;
  } catch {
    // 105B occasionally wraps JSON in prose despite json_object. Salvage it.
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error(`Sarvam returned non-JSON: ${content.slice(0, 200)}`);
  }
}

// ─── Speech to text ─────────────────────────────────────────────────────────

/**
 * Batch STT. Used for Telegram voice notes.
 *
 * ✅ Verified: accepts Telegram's OGG/Opus byte-for-byte. No ffmpeg anywhere.
 * ✅ Verified: `language_code: "unknown"` turns ON auto-detection and the
 *    response carries `language_code` + `language_probability`. Pass a
 *    specific code instead and detection is silently skipped.
 * ⚠️ HARD LIMIT: 30 seconds of audio. Guard on duration before spending a call.
 */
export async function transcribe(
  audio: Blob | ArrayBuffer,
  filename = "audio.ogg",
): Promise<{
  transcript: string;
  languageCode?: string;
  languageProbability?: number;
  requestId?: string;
}> {
  const blob = audio instanceof Blob ? audio : new Blob([audio]);
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", STT_MODEL);
  form.append("language_code", "unknown"); // ← enables auto-detect

  const res = await fetch(`${BASE}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": key() },
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));

  const d = await res.json();
  return {
    transcript: d.transcript ?? "",
    languageCode: d.language_code,
    languageProbability: d.language_probability,
    requestId: d.request_id,
  };
}

// ─── Text to speech ─────────────────────────────────────────────────────────

/**
 * REST TTS.
 *
 * ⚠️ The sample-rate parameter is `speech_sample_rate`, NOT `sample_rate`.
 *    Passing the wrong name is silently ignored: the request stays at the
 *    22050 default and you get a confusing "OPUS codec requires one of these
 *    sample rates ... Current sample rate: 22050 Hz" that never mentions that
 *    your parameter name was wrong.
 *
 * ⚠️ 22050 (the default) is NOT a legal Opus rate. Legal: 8000, 12000, 16000,
 *    24000, 48000.
 *
 * ✅ Verified: opus + speech_sample_rate 24000 returns a genuine OggS /
 *    OpusHead container, so Telegram sendVoice takes it directly. 10 KB vs
 *    135 KB for the same sentence as WAV.
 */
export async function synthesize(opts: {
  text: string;
  lang: string;
  speaker: string;
  /** "opus" → Ogg-Opus for Telegram sendVoice. Omit → RIFF/WAV @22050. */
  codec?: "opus";
  sampleRate?: 8000 | 12000 | 16000 | 24000 | 48000;
  pace?: number;
}): Promise<{ base64: string; mime: string }> {
  const body: Record<string, unknown> = {
    text: opts.text,
    target_language_code: opts.lang,
    speaker: opts.speaker,
    model: TTS_MODEL,
    enable_preprocessing: true, // speaks prices as words, not digit-by-digit
  };
  if (opts.pace) body.pace = opts.pace;
  if (opts.codec === "opus") {
    body.output_audio_codec = "opus";
    body.speech_sample_rate = opts.sampleRate ?? 24000; // ← NOT `sample_rate`
  }

  const res = await fetch(`${BASE}/text-to-speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": key(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));

  const d = await res.json();
  const b64 = d?.audios?.[0];
  if (!b64) throw new Error("Sarvam TTS returned no audio");
  return {
    base64: b64,
    mime: opts.codec === "opus" ? "audio/ogg" : "audio/wav",
  };
}

// ─── Text utilities ─────────────────────────────────────────────────────────

/** Mayura. Renders the transcript to English for the dashboard toggle. */
export async function translate(
  text: string,
  from: string,
  to = "en-IN",
): Promise<string> {
  const res = await fetch(`${BASE}/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": key(),
    },
    body: JSON.stringify({
      input: text,
      source_language_code: from,
      target_language_code: to,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const d = await res.json();
  return d.translated_text ?? text;
}

/** Romanised caption under each Devanagari bubble. */
export async function transliterate(
  text: string,
  from: string,
): Promise<string> {
  const res = await fetch(`${BASE}/transliterate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": key(),
    },
    body: JSON.stringify({
      input: text,
      source_language_code: from,
      target_language_code: "en-IN",
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const d = await res.json();
  return d.transliterated_text ?? text;
}

/** Language ID on typed input — picks the initial call language. */
export async function detectLanguage(text: string): Promise<string | null> {
  const res = await fetch(`${BASE}/text-lid`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": key(),
    },
    body: JSON.stringify({ input: text }),
  });
  if (!res.ok) return null; // non-fatal: fall back to the user's preference
  const d = await res.json();
  return d.language_code ?? null;
}
