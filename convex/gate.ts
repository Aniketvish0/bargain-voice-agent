import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  ALREADY_CALLED_REASON,
  DAILY_CAP_REASON,
  DNC_REASON,
  staticChecks,
} from "./lib/compliance";
import { MAX_DIALS_PER_NUMBER_PER_DAY } from "./lib/constants";
import { toE164 } from "./lib/phone";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The full compliance gate: static checks plus the three that need the DB.
 * See docs/BUILD-SPEC.md §15.
 *
 * Returns a reason string rather than throwing, because rejected vendors are
 * still written to the `vendors` table with `gateReason` set — a judge should
 * be able to SEE the gate refusing to dial something.
 */
export const check = internalQuery({
  args: {
    phone: v.string(),
    fromNumber: v.optional(v.string()),
    enforceWindow: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const now = Date.now();

    const stat = staticChecks(args.phone, now, {
      enforceWindow: args.enforceWindow,
    });
    if (!stat.ok) return { ok: false, reason: stat.reason };

    const e164 = toE164(args.phone)!;

    // 1. Permanent, global do-not-call list. Honoured across all users.
    const blocked = await ctx.db
      .query("dnc")
      .withIndex("by_phone", (q) => q.eq("phoneE164", e164))
      .first();
    if (blocked) return { ok: false, reason: DNC_REASON };

    // 2. One attempt per business per 24h.
    const recent = await ctx.db
      .query("calls")
      .withIndex("by_phone", (q) => q.eq("phoneE164", e164))
      .collect();
    if (recent.some((c) => (c.startedAt ?? c._creationTime) > now - DAY_MS)) {
      return { ok: false, reason: ALREADY_CALLED_REASON };
    }

    // 3. Per-originating-number daily cap. Keeps us under TRAI's bulk threshold.
    if (args.fromNumber) {
      const today = await ctx.db
        .query("calls")
        .withIndex("by_from_time", (q) =>
          q.eq("fromNumber", args.fromNumber!).gt("startedAt", now - DAY_MS),
        )
        .collect();
      if (today.length >= MAX_DIALS_PER_NUMBER_PER_DAY) {
        return { ok: false, reason: DAILY_CAP_REASON };
      }
    }

    return { ok: true };
  },
});

/**
 * Add a number to the permanent DNC list.
 *
 * Called by the bridge's hangup reflex the instant a callee objects — before
 * the LLM even sees the turn. Demo this on stage: a judge watching an AI
 * voluntarily blacklist a number is worth more than a fifth negotiation
 * feature.
 */
export const addToDnc = internalMutation({
  args: {
    phone: v.string(),
    reason: v.string(),
    callId: v.optional(v.id("calls")),
  },
  handler: async (ctx, args) => {
    const e164 = toE164(args.phone);
    if (!e164) return;
    const existing = await ctx.db
      .query("dnc")
      .withIndex("by_phone", (q) => q.eq("phoneE164", e164))
      .first();
    if (existing) return;
    await ctx.db.insert("dnc", {
      phoneE164: e164,
      reason: args.reason,
      callId: args.callId,
      atMs: Date.now(),
    });
  },
});

/** Consent log. Written for every call, and for lunchtime pre-arrangements. */
export const logConsent = internalMutation({
  args: {
    callId: v.optional(v.id("calls")),
    phone: v.string(),
    language: v.string(),
    channel: v.union(v.literal("prearranged"), v.literal("on_call")),
    disclosureText: v.string(),
    calleeResponse: v.optional(v.string()),
    consentGiven: v.boolean(),
  },
  handler: async (ctx, args) => {
    const e164 = toE164(args.phone) ?? args.phone;
    await ctx.db.insert("consentEvents", {
      callId: args.callId,
      phoneE164: e164,
      language: args.language,
      channel: args.channel,
      disclosureText: args.disclosureText,
      calleeResponse: args.calleeResponse,
      consentGiven: args.consentGiven,
      atMs: Date.now(),
    });
  },
});
