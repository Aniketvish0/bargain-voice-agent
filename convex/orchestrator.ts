import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { DIAL_STAGGER_MS, MAX_VENDORS_PER_MISSION } from "./lib/constants";
import type { Candidate } from "./vendors";

/**
 * Doot — mission orchestrator.
 *
 * WHY CALLS ARE SEQUENTIAL
 * ------------------------
 * The product's core mechanic is cross-call leverage: call N cites a price a
 * real shopkeeper gave us on call N-1, ninety seconds earlier. That only works
 * if call N-1 has FINISHED and been extracted. Running the calls in parallel
 * would buy ~3x wall-clock and cost the entire thesis, because at T+60s no
 * call has produced a quote yet and there is nothing honest to cite.
 *
 * Two independent constraints point the same way:
 *   - Sarvam rejects burst-opened sockets with close code 1003; three
 *     concurrent calls open six sockets.
 *   - The chat endpoint ceiling is 40 req/min.
 *
 * The chain advances from `afterCall`, which is scheduled atomically inside
 * the same mutation that marks a call terminal.
 */

export const runMission = internalAction({
  args: { missionId: v.id("missions"), chatId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const mission = await ctx.runQuery(internal.missions.getInternal, {
      missionId: args.missionId,
    });
    if (!mission || mission.status === "cancelled") return;

    const { category, locality } = mission.brief;

    // Leads first: hand-verified and always available. Places is the upgrade,
    // not the dependency — this ordering is what keeps a GCP billing screen
    // off the critical path.
    let candidates: Candidate[] = await ctx.runQuery(internal.vendors.fromLeads, {
      category,
      locality,
      limit: MAX_VENDORS_PER_MISSION,
    });

    if (candidates.length < MAX_VENDORS_PER_MISSION) {
      const extra: Candidate[] = await ctx.runAction(internal.vendors.fromPlaces, {
        category,
        locality,
        limit: MAX_VENDORS_PER_MISSION,
      });
      const seen = new Set(candidates.map((c) => c.phoneE164));
      for (const c of extra) {
        if (candidates.length >= MAX_VENDORS_PER_MISSION) break;
        if (seen.has(c.phoneE164)) continue;
        seen.add(c.phoneE164);
        candidates.push(c);
      }
    }

    if (candidates.length === 0) {
      await ctx.runMutation(internal.missions.setStatus, {
        missionId: args.missionId,
        status: "failed",
      });
      if (args.chatId) {
        await ctx.runAction(internal.telegram.send, {
          chatId: args.chatId,
          text:
            `😕 I couldn't find any <b>${escape(category)}</b> in <b>${escape(locality)}</b> with a phone number.\n\n` +
            `Try a bigger area, or a different category — coverage is thin for some local trades.`,
        });
      }
      return;
    }

    const from = process.env.TWILIO_FROM_NUMBER ?? "";

    // Budget fit BEFORE the compliance gate. A luxury resort will never quote a
    // budget rate, so calling it wastes our credits and a real receptionist's
    // afternoon. Discovery ranks on rating x reviews, which actively promotes
    // exactly the vendors we cannot afford. BUILD-SPEC §1.5.2
    const fit: Array<{ plausible: boolean; reason?: string }> = await ctx.runAction(
      internal.fit.screen,
      {
        candidates: candidates.map((c) => ({ name: c.name, address: c.address })),
        category,
        locality,
        targetPriceInr: mission.brief.targetPriceInr,
      },
    );

    // Gate every candidate. Rejects still get a row so the gate is visible.
    const gated = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (fit[i] && !fit[i].plausible) {
        gated.push({
          ...c,
          gatePassed: false,
          gateReason: fit[i].reason ?? "Likely out of budget",
        });
        continue;
      }
      const g = await ctx.runQuery(internal.gate.check, {
        phone: c.phoneE164,
        fromNumber: from || undefined,
      });
      gated.push({ ...c, gatePassed: g.ok, gateReason: g.reason });
    }

    await ctx.runMutation(internal.vendors.insertForMission, {
      missionId: args.missionId,
      candidates: gated,
    });

    const vendors = await ctx.runQuery(internal.vendors.forMission, {
      missionId: args.missionId,
    });
    const callable = vendors.filter((v) => v.gatePassed);

    if (args.chatId) {
      const msg = await ctx.runAction(internal.telegram.sendAndRemember, {
        chatId: args.chatId,
        missionId: args.missionId,
        text: renderRoster(vendors),
      });
      void msg;
    }

    if (callable.length === 0) {
      await ctx.runMutation(internal.missions.setStatus, {
        missionId: args.missionId,
        status: "failed",
      });
      return;
    }

    await ctx.runMutation(internal.missions.setStatus, {
      missionId: args.missionId,
      status: "calling",
    });

    // Create every call row up front so the dashboard can render the full
    // roster immediately, then dial only the first.
    for (const vendor of callable) {
      await ctx.runMutation(internal.calls.createForVendor, {
        missionId: args.missionId,
        vendorId: vendor._id,
        userId: mission.userId,
        phoneE164: vendor.phoneE164,
        fromNumber: from,
        lang: mission.brief.language,
      });
    }

    await ctx.scheduler.runAfter(DIAL_STAGGER_MS, internal.orchestrator.dialNext, {
      missionId: args.missionId,
    });
  },
});

/** Dial the next queued call, if the mission is still live. */
export const dialNext = internalAction({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const mission = await ctx.runQuery(internal.missions.getInternal, {
      missionId: args.missionId,
    });
    if (!mission || mission.status !== "calling") return;

    const next = await ctx.runQuery(internal.orchestratorQueries.nextQueuedCall, {
      missionId: args.missionId,
    });
    if (!next) return;

    await ctx.runAction(internal.calls.dial, { callId: next });
  },
});

/**
 * A call reached a terminal state. Extract it, then advance the chain.
 * Scheduled atomically from inside `calls.onProviderStatus`.
 */
export const afterCall = internalAction({
  args: { missionId: v.id("missions"), callId: v.id("calls") },
  handler: async (ctx, args) => {
    /**
     * ⚠️ WAIT FOR THE OUTCOME BEFORE ADVANCING. This is not politeness.
     *
     * Two things happen when a call ends, and they race:
     *   - Twilio POSTs "completed" to /ingest/status, which lands here almost
     *     immediately, and
     *   - the bridge runs `extract_outcome` in its `finally` block, which is a
     *     105B round trip taking several seconds, and only THEN posts the
     *     quote and the `memory` delta to /ingest/outcome.
     *
     * Twilio always wins. So without this wait we dial vendor N+1 with
     * `mission.memory` still empty and `priorQuotes` still empty — which is
     * precisely the failure §1.5.1 exists to prevent. The mechanic silently
     * degrades to "three unrelated phone calls" while every table still looks
     * populated afterwards, because the memory lands a few seconds later.
     *
     * Bounded, because a dead bridge must not strand the mission: after
     * OUTCOME_GRACE_MS we fall through to the Convex-side extraction below.
     */
    await waitForOutcome(ctx, args.callId);

    // The bridge normally posts /ingest/outcome itself; this is the safety net
    // for calls that died before it could. It no-ops if the bridge won.
    await ctx.runAction(internal.summarise.extractCall, { callId: args.callId }).catch(
      (e) => console.warn("extractCall failed", e),
    );

    const mission = await ctx.runQuery(internal.missions.getInternal, {
      missionId: args.missionId,
    });
    if (!mission || mission.status === "cancelled") return;

    const next = await ctx.runQuery(internal.orchestratorQueries.nextQueuedCall, {
      missionId: args.missionId,
    });

    if (next) {
      // Stagger. Sarvam rejects burst-opened sockets below its stated ceiling.
      await ctx.scheduler.runAfter(DIAL_STAGGER_MS, internal.orchestrator.dialNext, {
        missionId: args.missionId,
      });
      return;
    }

    await ctx.runAction(internal.summarise.finishMission, {
      missionId: args.missionId,
    });
  },
});

/** Generous enough for a 105B extraction, short enough not to stall a demo. */
const OUTCOME_GRACE_MS = 12_000;
const OUTCOME_POLL_MS = 750;

/**
 * Block until the bridge's post-call extraction has landed on this call, or
 * the grace period expires. Returns true if an outcome arrived.
 *
 * "An outcome arrived" is read off the call row rather than a flag, because
 * the bridge writes through `calls.applyOutcome` and adding a flag would mean
 * touching the frozen schema. A row with slots or a quote has been extracted.
 */
async function waitForOutcome(ctx: any, callId: Id<"calls">): Promise<boolean> {
  const deadline = Date.now() + OUTCOME_GRACE_MS;
  while (Date.now() < deadline) {
    const call = await ctx.runQuery(internal.calls.getInternal, { callId });
    if (!call) return false;
    if ((call.slots?.length ?? 0) > 0 || call.finalQuoteInr !== undefined) return true;
    // A call nobody picked up will never produce an outcome. Don't burn 12s.
    if (call.status === "no_answer" || call.status === "failed") return false;
    await new Promise((r) => setTimeout(r, OUTCOME_POLL_MS));
  }
  console.warn(`outcome never arrived for ${callId} — dialling on without it`);
  return false;
}

function renderRoster(vendors: Array<any>): string {
  const lines = ["<b>📇 Found these</b>", ""];
  for (const v of vendors) {
    if (v.gatePassed) {
      lines.push(`📞 <b>${escape(v.name)}</b>\n     <code>${v.phoneE164}</code>`);
    } else {
      lines.push(`🚫 <s>${escape(v.name)}</s>\n     <i>${escape(v.gateReason ?? "blocked")}</i>`);
    }
  }
  const n = vendors.filter((v) => v.gatePassed).length;
  lines.push("");
  lines.push(`⏳ Calling ${n} of them, one at a time…`);
  return lines.join("\n");
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
