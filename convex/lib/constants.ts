/**
 * Doot — frozen constants. See docs/BUILD-SPEC.md §7, §8, §15.
 *
 * Everything in here was verified against the live Sarvam API on 26 Jul 2026.
 * Do not "clean these up" from memory — several are counter-intuitive.
 */

/** The 11 languages Bulbul v3 can SPEAK. Saaras transcribes 23. */
export const TTS_11 = [
  "hi-IN",
  "en-IN",
  "bn-IN",
  "gu-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "od-IN",
  "pa-IN",
  "ta-IN",
  "te-IN",
] as const;

export type TtsLang = (typeof TTS_11)[number];

export function isTtsLang(x: string | undefined | null): x is TtsLang {
  return !!x && (TTS_11 as readonly string[]).includes(x);
}

/**
 * The 38 REAL bulbul:v3 speakers, recovered from the API's 400 error body.
 * ⚠️ `anushka` is v2 ONLY and returns 400 on v3. Do not add it back.
 */
export const V3_SPEAKERS = [
  "aditya", "ritu", "ashutosh", "priya", "neha", "rahul", "pooja", "rohan",
  "simran", "kavya", "amit", "dev", "ishita", "shreya", "ratan", "varun",
  "manan", "sumit", "roopa", "kabir", "aayan", "shubh", "advait", "anand",
  "tanya", "tarun", "sunny", "mani", "gokul", "vijay", "shruti", "suhani",
  "mohit", "kavitha", "rehan", "soham", "rupali", "niharika",
] as const;

/** One default voice per speakable language. All verified present in V3_SPEAKERS. */
export const VOICE_BY_LANG: Record<TtsLang, string> = {
  "hi-IN": "simran",
  "en-IN": "anand",
  "bn-IN": "shreya",
  "gu-IN": "pooja",
  "kn-IN": "priya",
  "ml-IN": "rupali",
  "mr-IN": "neha",
  "od-IN": "suhani",
  "pa-IN": "tanya",
  "ta-IN": "kavya",
  "te-IN": "ishita",
};

/** Shown in the dashboard picker. 8, not 38. */
export const CURATED_VOICES = [
  "simran", "anand", "kavya", "priya", "neha", "shubh", "ishita", "rahul",
] as const;

export const DEFAULT_LANG: TtsLang = "hi-IN";
export const DEFAULT_VOICE = VOICE_BY_LANG[DEFAULT_LANG];

// ── Sarvam models ───────────────────────────────────────────────────────────
export const STT_MODEL = "saaras:v3";
export const TTS_MODEL = "bulbul:v3";
/** In-call turns. Latency matters more than depth. */
export const LLM_LIVE = "sarvam-30b";
/** Offline extraction + summary. NEVER in the live loop. */
export const LLM_EXTRACT = "sarvam-105b";

// ── Compliance. BUILD-SPEC §15. These numbers are quotable on stage. ────────
export const MAX_VENDORS_PER_MISSION = 3;
export const MAX_DIALS_PER_MISSION = 5;
/** TCCCPR "Bulk" trips above 20/day. We sit at 15 deliberately. */
export const MAX_DIALS_PER_NUMBER_PER_DAY = 15;
export const MAX_DIALS_PER_NUMBER_PER_WEEK = 60;
export const CALL_WINDOW_START_IST = 10;
export const CALL_WINDOW_END_IST = 20;
export const MAX_CALL_DURATION_SEC = 240;
export const MAX_TURNS = 16;
/** ⚠️ Sarvam rejects burst-opened sockets with close code 1003. Do not lower. */
export const DIAL_STAGGER_MS = 500;

/** Emergency, government, and commercial short codes. Never dial. */
export const BLOCKED_PREFIXES = [
  "100", "101", "102", "103", "108", "112", "1091", "1098",
  "139", "181", "1930", "1800", "1860", "140", "1600",
];

// ── Disclosure. Spoken in the first 4 seconds of every call. §13 Block 1 ────
export const DISCLOSURE: Record<string, string> = {
  "hi-IN":
    "एक बात पहले बता दूँ, मैं एक AI असिस्टेंट हूँ और यह कॉल रिकॉर्ड हो रही है।",
  "en-IN":
    "Quick heads-up: I'm an AI assistant, and this call is being recorded.",
};

/** Fires BEFORE the LLM sees the turn. Hang up within 2s and write a dnc row. */
export const BOW_OUT_PATTERNS =
  /don'?t call|stop calling|remove my number|not interested|who is this|is this a robot|कॉल मत|फ़?ोन मत|परेशान|नंबर हटा/i;

export const BOW_OUT_LINE: Record<string, string> = {
  "hi-IN": "बिलकुल, माफ़ कीजिए। दोबारा कॉल नहीं आएगा। धन्यवाद।",
  "en-IN": "Of course, I'm sorry to bother you. We won't call again. Thank you.",
};
