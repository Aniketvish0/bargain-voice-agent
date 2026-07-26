import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { SLOT, TTS_LANG } from "./schema";
import { effectivePrice, findMoney } from "./lib/inr";
import { MAX_CALL_DURATION_SEC, VOICE_BY_LANG } from "./lib/constants";

export const createForVendor = internalMutation({
  args: {
    missionId: v.id("missions"),
    vendorId: v.id("vendors"),
    userId: v.id("users"),
    phoneE164: v.string(),
    fromNumber: v.string(),
    lang: TTS_LANG,
  },
  handler: async (ctx, args): Promise<Id<"calls">> =>
    await ctx.db.insert("calls", {
      missionId: args.missionId,
      vendorId: args.vendorId,
      userId: args.userId,
      phoneE164: args.phoneE164,
      fromNumber: args.fromNumber,
      status: "queued",
      lang: args.lang,
      voice: VOICE_BY_LANG[args.lang],
      detectedLangs: [],
      slots: [],
    }),
});

export const patch = internalMutation({
  args: {
    callId: v.id("calls"),
    status: v.optional(v.string()),
    twilioCallSid: v.optional(v.string()),
    lastError: v.optional(v.string()),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const p: Record<string, unknown> = {};
    if (args.status) p.status = args.status;
    if (args.twilioCallSid) p.twilioCallSid = args.twilioCallSid;
    if (args.lastError) p.lastError = args.lastError;
    if (args.startedAt) p.startedAt = args.startedAt;
    await ctx.db.patch(args.callId, p);
  },
});

export const getInternal = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args): Promise<Doc<"calls"> | null> =>
    await ctx.db.get(args.callId),
});

/**
 * Structured outcome from the post-call 105B extraction.
 *
 * Stage 2 of the two-stage normaliser (BUILD-SPEC §13): the model returns both
 * a number and the verbatim string it read it from; we re-parse the verbatim
 * deterministically and downgrade confidence if they disagree by >2%. The LLM
 * stays primary — the parser is only a cross-check. Do not invert that.
 */
export const applyOutcome = internalMutation({
  args: {
    callId: v.id("calls"),
    slots: v.array(SLOT),
    openingQuoteInr: v.optional(v.number()),
    finalQuoteInr: v.optional(v.number()),
    priceVerbatim: v.optional(v.string()),
    deliveryChargeInr: v.optional(v.number()),
    taxIncluded: v.optional(v.boolean()),
    quoteTurnSeq: v.optional(v.number()),
    terms: v.optional(v.string()),
    contactName: v.optional(v.string()),
    holdUntil: v.optional(v.string()),
    closed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) return;

    let slots = args.slots;
    let finalQuote = args.finalQuoteInr;

    if (args.priceVerbatim && finalQuote) {
      const reparsed = findMoney(args.priceVerbatim)[0]?.valueInr;
      if (reparsed && Math.abs(reparsed - finalQuote) / finalQuote > 0.02) {
        console.warn(
          `Price disagreement on ${args.callId}: model=${finalQuote} parser=${reparsed} from "${args.priceVerbatim}"`,
        );
        slots = slots.map((s) =>
          s.key.toLowerCase().includes("price") ? { ...s, confidence: "low" as const } : s,
        );
      }
    }

    await ctx.db.patch(args.callId, {
      slots,
      openingQuoteInr: args.openingQuoteInr ?? call.openingQuoteInr,
      finalQuoteInr: finalQuote ?? call.finalQuoteInr,
      effectivePriceInr: effectivePrice({
        quotedPriceInr: finalQuote ?? call.finalQuoteInr,
        deliveryChargeInr: args.deliveryChargeInr,
        taxIncluded: args.taxIncluded ?? true,
      }),
      quoteTurnSeq: args.quoteTurnSeq,
      terms: args.terms,
      contactName: args.contactName,
      holdUntil: args.holdUntil,
      closed: args.closed,
      meta: {
        ...(call.meta ?? {}),
        priceVerbatim: args.priceVerbatim,
        deliveryChargeInr: args.deliveryChargeInr,
        taxIncluded: args.taxIncluded,
      },
    });
  },
});

/**
 * Twilio StatusCallback lands here.
 *
 * This is the atomic hinge of the sequential design: when a call completes we
 * mark it, then schedule BOTH the summary and the next vendor in one
 * transaction. Doing it anywhere else risks two calls dialling at once, or the
 * chain stalling silently.
 */
export const onProviderStatus = internalMutation({
  args: {
    twilioCallSid: v.string(),
    callStatus: v.string(),
    durationSec: v.optional(v.number()),
    recordingUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db
      .query("calls")
      .withIndex("by_sid", (q) => q.eq("twilioCallSid", args.twilioCallSid))
      .unique();
    if (!call) return;

    const map: Record<string, Doc<"calls">["status"]> = {
      queued: "dialing",
      initiated: "dialing",
      ringing: "ringing",
      "in-progress": "talking",
      answered: "talking",
      completed: "closed",
      busy: "no_answer",
      "no-answer": "no_answer",
      failed: "failed",
      canceled: "failed",
    };
    const next = map[args.callStatus] ?? call.status;

    const patchDoc: Record<string, unknown> = { status: next };
    if (args.durationSec !== undefined) patchDoc.durationSec = args.durationSec;
    if (args.recordingUrl) patchDoc.recordingUrl = args.recordingUrl;
    if (next === "talking" && !call.startedAt) patchDoc.startedAt = Date.now();

    const terminal = ["closed", "no_answer", "failed"].includes(next);
    if (terminal && !call.endedAt) patchDoc.endedAt = Date.now();

    await ctx.db.patch(call._id, patchDoc);

    if (terminal) {
      // Atomic: advance the chain from inside the same mutation.
      await ctx.scheduler.runAfter(0, internal.orchestrator.afterCall, {
        missionId: call.missionId,
        callId: call._id,
      });
    }
  },
});

/** Sweeps calls the provider never reported on. Guards against a stalled chain. */
export const reapStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - (MAX_CALL_DURATION_SEC + 90) * 1000;
    for (const status of ["dialing", "ringing", "talking"] as const) {
      const rows = await ctx.db
        .query("calls")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      for (const c of rows) {
        const started = c.startedAt ?? c._creationTime;
        if (started > cutoff) continue;
        await ctx.db.patch(c._id, {
          status: "failed",
          endedAt: Date.now(),
          lastError: "Timed out with no provider callback",
        });
        await ctx.scheduler.runAfter(0, internal.orchestrator.afterCall, {
          missionId: c.missionId,
          callId: c._id,
        });
      }
    }
  },
});

/**
 * Hand one call to the bridge. Contract 1.
 *
 * The bridge owns Twilio entirely — Convex never talks to Twilio directly,
 * because the media stream needs a long-lived WebSocket that a Convex
 * httpAction structurally cannot hold.
 */
export const dial = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.runQuery(internal.calls.getInternal, { callId: args.callId });
    if (!call) return;

    /**
     * Fail this call AND advance the chain.
     *
     * Every failure path must go through here. An early `return` that skips
     * scheduling `afterCall` strands the mission forever: call 1 goes to
     * "failed" and calls 2 and 3 sit at "queued" with nothing to wake them.
     * That bug shipped once and cost a stalled demo run — do not reintroduce it.
     */
    const failAndAdvance = async (reason: string) => {
      await ctx.runMutation(internal.calls.patch, {
        callId: args.callId,
        status: "failed",
        lastError: reason.slice(0, 300),
      });
      await ctx.scheduler.runAfter(0, internal.orchestrator.afterCall, {
        missionId: call.missionId,
        callId: args.callId,
      });
    };

    const bridgeUrl = process.env.BRIDGE_URL;
    const secret = process.env.BRIDGE_SECRET;
    if (!bridgeUrl || !secret) {
      await failAndAdvance("BRIDGE_URL / BRIDGE_SECRET not configured");
      return;
    }
    const mission = await ctx.runQuery(internal.missions.getInternal, {
      missionId: call.missionId,
    });
    if (!mission || mission.status === "cancelled") return;  // deliberate stop, not a failure

    const user = await ctx.runQuery(internal.users.get, { userId: call.userId });
    const priorQuotes = await ctx.runQuery(internal.missions.priorQuotes, {
      missionId: call.missionId,
      excludeCallId: args.callId,
    });

    await ctx.runMutation(internal.calls.patch, {
      callId: args.callId,
      status: "dialing",
      startedAt: Date.now(),
    });

    try {
      const res = await fetch(`${bridgeUrl.replace(/\/$/, "")}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bridge-secret": secret },
        body: JSON.stringify({
          callId: args.callId,
          missionId: call.missionId,
          phoneE164: call.phoneE164,
          language: call.lang,
          voice: call.voice,
          missionType: mission.missionType,
          userFirstName: (user?.displayName ?? "").split(" ")[0] || "our customer",
          learnedPrefs: user?.learnedPrefs ?? [],
          brief: {
            category: mission.brief.category,
            locality: mission.brief.locality,
            constraints: mission.brief.constraints,
            objectives: mission.brief.objectives,
            targetPriceInr: mission.brief.targetPriceInr,
            walkAwayInr: mission.brief.walkAwayInr,
          },
          // Only real, banked quotes. Empty means the agent must say it has none.
          priorQuotes,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`bridge ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json().catch(() => ({}) as any);
      if (data?.twilioCallSid) {
        await ctx.runMutation(internal.calls.patch, {
          callId: args.callId,
          twilioCallSid: data.twilioCallSid,
        });
      }
    } catch (err: any) {
      // One dead vendor must not strand the mission.
      await failAndAdvance(String(err?.message ?? err));
    }
  },
});
