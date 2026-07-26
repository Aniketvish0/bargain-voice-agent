import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

/**
 * Doot — public HTTP surface. BUILD-SPEC Contracts 2 and 4.
 *
 * ⚠️ These live at https://<deployment>.convex.SITE — not .convex.cloud.
 *    Registering a webhook against .convex.cloud silently 404s.
 *
 * Two invariants everything here obeys:
 *   1. Return 2XX fast. Telegram and Twilio both retry non-2XX, and a retry
 *      storm re-triggers real outbound PSTN calls at real money cost.
 *   2. Never do slow work inline. Verify, schedule, return.
 */

const http = httpRouter();

function bridgeAuthed(req: Request): boolean {
  const secret = process.env.BRIDGE_SECRET;
  if (!secret) return false;
  return req.headers.get("x-bridge-secret") === secret;
}

const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

// ─── Telegram ───────────────────────────────────────────────────────────────

http.route({
  path: "/telegram",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (
      req.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
      process.env.TG_WEBHOOK_SECRET
    ) {
      return new Response("forbidden", { status: 403 });
    }

    let update: unknown;
    try {
      update = await req.json();
    } catch {
      return ok(); // malformed body: swallow it, don't make Telegram retry
    }

    // Everything real happens in a scheduled action so a thrown error there
    // cannot turn into a Telegram retry loop.
    await ctx.scheduler.runAfter(0, internal.telegram.handleUpdate, { update });
    return ok();
  }),
});

// ─── Bridge ingest. Contract 2. ─────────────────────────────────────────────

/** One transcript turn. Fire-and-forget from the bridge's audio thread. */
http.route({
  path: "/ingest/turn",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!bridgeAuthed(req)) return new Response("forbidden", { status: 403 });
    const b = await req.json();
    await ctx.runMutation(internal.transcripts.applyBatch, {
      callId: b.callId as Id<"calls">,
      role: b.role,
      text: String(b.text ?? ""),
      final: b.final !== false,
      langCode: strOrUndef(b.langCode),
      langProbability: numOrUndef(b.langProbability),
      sarvamRequestId: strOrUndef(b.sarvamRequestId),
      tsMs: numOrUndef(b.tsMs),
    });
    return ok();
  }),
});

http.route({
  path: "/ingest/langswitch",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!bridgeAuthed(req)) return new Response("forbidden", { status: 403 });
    const b = await req.json();
    await ctx.runMutation(internal.transcripts.recordLangSwitch, {
      callId: b.callId as Id<"calls">,
      fromLang: b.fromLang,
      toLang: b.toLang,
      confidence: Number(b.confidence ?? 0),
      atMs: numOrUndef(b.atMs),
    });
    return ok();
  }),
});

/** Structured outcome, extracted by 105B after the call ends. */
http.route({
  path: "/ingest/outcome",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!bridgeAuthed(req)) return new Response("forbidden", { status: 403 });
    const b = await req.json();
    await ctx.runMutation(internal.calls.applyOutcome, {
      callId: b.callId as Id<"calls">,
      // Same null-vs-undefined trap as /ingest/turn: the extractor emits
      // `"valueVerbatim": null` for a slot it read from a number rather than a
      // phrase, and one such slot would reject the whole outcome.
      slots: (Array.isArray(b.slots) ? b.slots : [])
        .filter((s: any) => s && typeof s.key === "string")
        .map((s: any) => ({
          key: String(s.key).slice(0, 40),
          value: s.value ?? null,
          valueVerbatim: strOrUndef(s.valueVerbatim),
          confidence: ["high", "medium", "low"].includes(s.confidence)
            ? s.confidence
            : "medium",
          turnSeq: numOrUndef(s.turnSeq),
        })),
      openingQuoteInr: numOrUndef(b.openingQuoteInr),
      finalQuoteInr: numOrUndef(b.finalQuoteInr),
      priceVerbatim: strOrUndef(b.priceVerbatim),
      deliveryChargeInr: numOrUndef(b.deliveryChargeInr),
      taxIncluded: typeof b.taxIncluded === "boolean" ? b.taxIncluded : undefined,
      quoteTurnSeq: numOrUndef(b.quoteTurnSeq),
      terms: strOrUndef(b.terms),
      contactName: strOrUndef(b.contactName),
      holdUntil: strOrUndef(b.holdUntil),
      closed: typeof b.closed === "boolean" ? b.closed : undefined,
    });

    // Coaching for the next call in this mission. BUILD-SPEC §1.5.1
    const mem = b.memory;
    if (mem && typeof mem === "object") {
      const call = await ctx.runQuery(internal.calls.getInternal, {
        callId: b.callId as Id<"calls">,
      });
      if (call) {
        await ctx.runMutation(internal.missions.mergeMemory, {
          missionId: call.missionId,
          goingRateInr: numOrUndef(b.finalQuoteInr),
          worked: Array.isArray(mem.worked) ? mem.worked.map(String) : [],
          avoid: Array.isArray(mem.avoid) ? mem.avoid.map(String) : [],
          objections: Array.isArray(mem.objections) ? mem.objections.map(String) : [],
          suspicion: mem.suspicion === true,
        });
      }
    }
    return ok();
  }),
});

/** The callee objected. Hang up, blacklist, never call again. */
http.route({
  path: "/ingest/dnc",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!bridgeAuthed(req)) return new Response("forbidden", { status: 403 });
    const b = await req.json();
    await ctx.runMutation(internal.gate.addToDnc, {
      phone: String(b.phone),
      reason: String(b.reason ?? "Callee asked not to be called"),
      callId: b.callId ? (b.callId as Id<"calls">) : undefined,
    });
    return ok();
  }),
});

http.route({
  path: "/ingest/consent",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!bridgeAuthed(req)) return new Response("forbidden", { status: 403 });
    const b = await req.json();
    await ctx.runMutation(internal.gate.logConsent, {
      callId: b.callId ? (b.callId as Id<"calls">) : undefined,
      phone: String(b.phone),
      language: String(b.language ?? "hi-IN"),
      channel: b.channel === "prearranged" ? "prearranged" : "on_call",
      disclosureText: String(b.disclosureText ?? ""),
      calleeResponse: strOrUndef(b.calleeResponse),
      consentGiven: b.consentGiven !== false,
    });
    return ok();
  }),
});

/**
 * Twilio StatusCallback.
 *
 * ⚠️ Twilio posts application/x-www-form-urlencoded, NOT JSON.
 *    `await req.json()` throws here. This is a classic 20-minute loss.
 *
 * Deliberately does not require the bridge secret: Twilio posts directly and
 * cannot set custom headers. The CallSid is the capability — we only act on
 * SIDs that already exist in our own `calls` table.
 */
http.route({
  path: "/ingest/status",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const form = new URLSearchParams(await req.text());
    const sid = form.get("CallSid");
    if (!sid) return ok();

    await ctx.runMutation(internal.calls.onProviderStatus, {
      twilioCallSid: sid,
      callStatus: form.get("CallStatus") ?? "unknown",
      durationSec: form.get("CallDuration")
        ? Number(form.get("CallDuration"))
        : undefined,
      recordingUrl: form.get("RecordingUrl") ?? undefined,
    });
    return ok();
  }),
});

/** Liveness probe — the bridge checks this on boot so misconfig fails loudly. */
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return ok({
      ok: true,
      service: "doot",
      hasSarvamKey: !!process.env.SARVAM_API_KEY,
      hasTelegramToken: !!process.env.TELEGRAM_BOT_TOKEN,
      hasBridgeSecret: !!process.env.BRIDGE_SECRET,
      hasTgWebhookSecret: !!process.env.TG_WEBHOOK_SECRET,
      bridgeUrl: process.env.BRIDGE_URL ?? null,
    });
  }),
});

/**
 * ⚠️ `v.optional(T)` accepts `undefined` or an ABSENT key. It rejects `null`.
 *
 * Python's `json.dumps` turns `None` into `null`, and `bridge/convex_client.py`
 * always sends every optional key — so a turn with no detected language posts
 * `"langCode": null` and the whole mutation fails argument validation with a
 * 500. That is not a hypothetical: it silently emptied the `turns` table for
 * the entire project, because `_post` is fire-and-forget by design and the
 * bridge only logs the failure at WARNING while the call carries on sounding
 * perfect. Extraction still worked (the bridge summarises from its own
 * in-memory transcript), so every downstream artifact looked healthy while the
 * dashboard had no transcript to show.
 *
 * Normalise at this boundary, not in the mutations: this is the only place
 * where untyped JSON from another runtime enters the system.
 */
function strOrUndef(x: unknown): string | undefined {
  return typeof x === "string" && x.length > 0 ? x : undefined;
}

function numOrUndef(x: unknown): number | undefined {
  if (x === null || x === undefined || x === "") return undefined;
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

export default http;
