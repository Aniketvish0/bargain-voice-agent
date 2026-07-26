import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Doot — Convex schema.
 *
 * FROZEN. See docs/BUILD-SPEC.md §9. Five lanes read this file; a change here
 * at 15:00 breaks three of them at once. If you need a field that does not
 * exist, write it into `meta: v.any()` and move on.
 */

/**
 * The 11 languages Bulbul v3 can SPEAK. Saaras can transcribe 23.
 * Never emit a language outside this set — you can detect Maithili and you
 * cannot answer in it. See BUILD-SPEC §8.
 */
export const TTS_LANG = v.union(
  v.literal("hi-IN"),
  v.literal("en-IN"),
  v.literal("bn-IN"),
  v.literal("gu-IN"),
  v.literal("kn-IN"),
  v.literal("ml-IN"),
  v.literal("mr-IN"),
  v.literal("od-IN"),
  v.literal("pa-IN"),
  v.literal("ta-IN"),
  v.literal("te-IN"),
);

/** availability ⊂ quote ⊂ negotiate — the same call, stopped at different points. §1.5 */
export const MISSION_TYPE = v.union(
  v.literal("availability"),
  v.literal("quote"),
  v.literal("negotiate"),
);

/** What the agent must come back knowing. The unifying mechanic. §1.5 */
export const OBJECTIVE = v.object({
  key: v.string(), // "hasAcRoom"
  ask: v.string(), // "AC room available on the 14th?"
  type: v.union(
    v.literal("boolean"),
    v.literal("money"),
    v.literal("date"),
    v.literal("number"),
    v.literal("text"),
  ),
  required: v.boolean(),
});

/** An answer the agent actually got, with a pointer to where it was said. */
export const SLOT = v.object({
  key: v.string(),
  value: v.any(), // boolean | number | string
  valueVerbatim: v.optional(v.string()), // what was literally said — cross-check source
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  turnSeq: v.optional(v.number()), // links the answer to its transcript line
});

export const CALL_STATUS = v.union(
  v.literal("queued"),
  v.literal("dialing"),
  v.literal("ringing"),
  v.literal("talking"),
  v.literal("closed"),
  v.literal("no_answer"),
  v.literal("failed"),
);

export default defineSchema({
  users: defineTable({
    tgUserId: v.string(),
    displayName: v.optional(v.string()),
    preferredLang: TTS_LANG,
    preferredVoice: v.string(),
    /** Memory & Context rubric line. Injected verbatim into the call prompt. */
    learnedPrefs: v.array(v.string()),
    totalSavedInr: v.number(),
    createdAt: v.number(),
  }).index("by_tg", ["tgUserId"]),

  /** The entire auth system. See BUILD-SPEC Contract 5. */
  sessions: defineTable({
    token: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  missions: defineTable({
    userId: v.id("users"),
    rawRequest: v.string(),
    inputMode: v.union(v.literal("voice"), v.literal("text")),
    missionType: MISSION_TYPE,
    brief: v.object({
      category: v.string(),
      locality: v.string(),
      constraints: v.array(v.string()),
      objectives: v.array(OBJECTIVE),
      /** Only meaningful when missionType === "negotiate". */
      targetPriceInr: v.optional(v.number()),
      walkAwayInr: v.optional(v.number()),
      language: TTS_LANG,
    }),
    status: v.union(
      v.literal("pending"),
      v.literal("awaiting_approval"),
      v.literal("discovering"),
      v.literal("calling"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    bestCallId: v.optional(v.id("calls")),
    savedInr: v.optional(v.number()),
    summaryText: v.optional(v.string()),
    /** Telegram message we keep editing with live progress. */
    tgLiveMessageId: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_status", ["status"]),

  vendors: defineTable({
    missionId: v.id("missions"),
    name: v.string(),
    phoneE164: v.string(),
    address: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    /** For the judges' contact check — where did this number come from? */
    source: v.union(
      v.literal("curated"),
      v.literal("osm"),
      v.literal("places"),
    ),
    rank: v.number(),
    gatePassed: v.boolean(),
    /** Populated when the compliance gate rejects — we show the gate working. */
    gateReason: v.optional(v.string()),
  })
    .index("by_mission_rank", ["missionId", "rank"])
    .index("by_phone", ["phoneE164"]),

  /** COLD table. ~6 patches per call, total. */
  calls: defineTable({
    missionId: v.id("missions"),
    vendorId: v.id("vendors"),
    userId: v.id("users"),
    phoneE164: v.string(),
    fromNumber: v.string(),
    status: CALL_STATUS,
    twilioCallSid: v.optional(v.string()),
    lang: TTS_LANG,
    voice: v.string(),
    detectedLangs: v.array(v.string()),

    /** Works for every missionType. §1.5 */
    slots: v.array(SLOT),

    /** The negotiation ARC, not just a price. */
    openingQuoteInr: v.optional(v.number()),
    finalQuoteInr: v.optional(v.number()),
    /** quote + delivery + GST. RANK ON THIS, never the raw quote. §13 */
    effectivePriceInr: v.optional(v.number()),
    quoteTurnSeq: v.optional(v.number()),

    terms: v.optional(v.string()),
    contactName: v.optional(v.string()),
    holdUntil: v.optional(v.string()),
    closed: v.optional(v.boolean()),

    recordingUrl: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    /** Escape hatch. Use this instead of changing the schema. */
    meta: v.optional(v.any()),
  })
    .index("by_mission", ["missionId"])
    .index("by_sid", ["twilioCallSid"])
    .index("by_status", ["status"])
    .index("by_phone", ["phoneE164"])
    .index("by_from_time", ["fromNumber", "startedAt"]),

  /** Append-only. FINALS ONLY. Never one row per ASR chunk. */
  turns: defineTable({
    callId: v.id("calls"),
    seq: v.number(),
    role: v.union(v.literal("agent"), v.literal("vendor"), v.literal("system")),
    text: v.string(),
    textEn: v.optional(v.string()),
    romanized: v.optional(v.string()),
    langCode: v.optional(v.string()),
    langProbability: v.optional(v.number()),
    /** Audit trail — proves a real Sarvam call happened, for the spot check. */
    sarvamRequestId: v.optional(v.string()),
    tsMs: v.number(),
  }).index("by_call_seq", ["callId", "seq"]),

  /** HOT. Exactly one row per call. Max 4 Hz. See the two rules in §9. */
  callLive: defineTable({
    callId: v.id("calls"),
    partialText: v.string(),
    partialRole: v.union(v.literal("agent"), v.literal("vendor")),
    nextSeq: v.number(),
    updatedAt: v.number(),
  }).index("by_call", ["callId"]),

  /** Demo this table live. "It changed language because he did." */
  langSwitches: defineTable({
    callId: v.id("calls"),
    atMs: v.number(),
    fromLang: v.string(),
    toLang: v.string(),
    confidence: v.number(),
  }).index("by_call", ["callId"]),

  consentEvents: defineTable({
    callId: v.optional(v.id("calls")),
    phoneE164: v.string(),
    language: v.string(),
    channel: v.union(v.literal("prearranged"), v.literal("on_call")),
    disclosureText: v.string(),
    calleeResponse: v.optional(v.string()),
    consentGiven: v.boolean(),
    atMs: v.number(),
  }).index("by_phone", ["phoneE164"]),

  /** Global, permanent, honoured across all users. */
  dnc: defineTable({
    phoneE164: v.string(),
    reason: v.string(),
    callId: v.optional(v.id("calls")),
    atMs: v.number(),
  }).index("by_phone", ["phoneE164"]),

  chatMessages: defineTable({
    userId: v.id("users"),
    missionId: v.optional(v.id("missions")),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    audioStorageId: v.optional(v.id("_storage")),
    surface: v.union(v.literal("telegram"), v.literal("web")),
    createdAt: v.number(),
  }).index("by_user_created", ["userId", "createdAt"]),

  /** Seeded vendor pool — the demo floor when Places billing isn't up. §11 */
  leads: defineTable({
    category: v.string(),
    locality: v.string(),
    city: v.string(),
    name: v.string(),
    phoneE164: v.string(),
    address: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    source: v.union(v.literal("curated"), v.literal("osm")),
    consentObtained: v.boolean(),
  })
    .index("by_category_locality", ["category", "locality"])
    .index("by_category", ["category"]),
});
