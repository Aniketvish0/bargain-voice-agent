import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { extractJson, chat } from "./lib/sarvam";
import { LLM_EXTRACT } from "./lib/constants";
import { effectivePrice } from "./lib/inr";

/**
 * Post-call extraction and the mission summary. BUILD-SPEC §13.
 *
 * Everything here is OFFLINE — 105B, generous token budget, no latency
 * pressure. Never call any of this from the live loop.
 */

type Extracted = {
  slots?: Array<{
    key: string;
    value: unknown;
    valueVerbatim?: string;
    confidence?: "high" | "medium" | "low";
    turnSeq?: number;
  }>;
  openingQuoteInr?: number | null;
  finalQuoteInr?: number | null;
  priceVerbatim?: string | null;
  deliveryChargeInr?: number | null;
  taxIncluded?: boolean | null;
  quoteTurnSeq?: number | null;
  terms?: string | null;
  contactName?: string | null;
  holdUntil?: string | null;
  closed?: boolean | null;
  memory?: {
    worked?: string[];
    avoid?: string[];
    objections?: string[];
    suspicion?: boolean;
  } | null;
};

const EXTRACT_SYSTEM = `You read a transcript of a phone call between an AI buying assistant
(role "agent") and an Indian business (role "vendor"), and return structured JSON.

The transcript is code-mixed Hindi/English. Prices are often spoken as words.

Return ONLY JSON:
{
  "slots":[{"key":"<objective key>","value":<boolean|number|string>,"valueVerbatim":"<what was actually said>","confidence":"high|medium|low","turnSeq":<int>}],
  "openingQuoteInr": <first price the vendor named, or null>,
  "finalQuoteInr": <last/best price the vendor agreed to, or null>,
  "priceVerbatim": "<the exact words the final price was spoken in>",
  "deliveryChargeInr": <number or null>,
  "taxIncluded": <true|false|null>,
  "quoteTurnSeq": <seq of the turn containing the final price, or null>,
  "terms": "<short summary of what's included, or null>",
  "contactName": "<person's name, or null>",
  "holdUntil": "<how long the price is held, verbatim, or null>",
  "closed": <true if a concrete deal/answer was reached>,
  "memory": {
    "worked": ["<what got them to engage or concede — max 2, short>"],
    "avoid": ["<what made them resist, go quiet, or hang up — max 2, short>"],
    "objections": ["<objections they raised, e.g. season rate — max 2>"],
    "suspicion": <true if they questioned whether you were human>
  }
}

RULES:
- Fill one slot per objective you are given. If an objective was never answered,
  omit it entirely rather than guessing.
- "valueVerbatim" must be a literal substring of the transcript. This is used as
  a cross-check against a deterministic parser, so do not paraphrase it.
- Indian number words: "pachees hazaar"=25000, "saade chaubees hazaar"=24500,
  "chaar hazaar"=4000, "sawa lakh"=125000, "dedh lakh"=150000.
  "saade X"=X+0.5, "sawa X"=X*1.25, "paune X"=X*0.75, "dedh"=1.5.
- Return integers in rupees. NEVER guess a price that was not spoken — null is correct.
- If the vendor gave only one price, openingQuoteInr and finalQuoteInr are the same.
- The agent reads the deal back near the end of the call. That read-back line is the
  most reliable source — prefer it over anything earlier in the transcript.
- "memory" is coaching for the NEXT call in the same mission. Be specific and
  behavioural ("volunteered a discount when two nights was mentioned"), never
  generic ("be polite"). Under 12 words per line. Omit what you did not observe.`;

export const extractCall = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.runQuery(internal.calls.getInternal, { callId: args.callId });
    if (!call) return;
    // The bridge already posted an outcome — don't spend another 105B call.
    if (call.finalQuoteInr !== undefined && call.slots.length > 0) return;

    const turns = await ctx.runQuery(internal.orchestratorQueries.turnsForCall, {
      callId: args.callId,
    });
    if (turns.length < 2) return;

    const mission = await ctx.runQuery(internal.missions.getInternal, {
      missionId: call.missionId,
    });

    const transcript = turns
      .map((t) => `[${t.seq}] ${t.role}: ${t.text}`)
      .join("\n")
      .slice(0, 12000);

    const objectives = (mission?.brief.objectives ?? [])
      .map((o) => `- ${o.key} (${o.type}): ${o.ask}`)
      .join("\n");

    let data: Extracted;
    try {
      data = await extractJson<Extracted>([
        { role: "system", content: EXTRACT_SYSTEM },
        {
          role: "user",
          content: `OBJECTIVES:\n${objectives || "(none)"}\n\nTRANSCRIPT:\n${transcript}`,
        },
      ]);
    } catch (err) {
      console.warn("extractCall LLM failed", err);
      return;
    }

    await ctx.runMutation(internal.calls.applyOutcome, {
      callId: args.callId,
      slots: (data.slots ?? [])
        .filter((s) => s && typeof s.key === "string")
        .map((s) => ({
          key: s.key,
          value: s.value ?? null,
          valueVerbatim: s.valueVerbatim ?? undefined,
          confidence: s.confidence ?? "medium",
          turnSeq: typeof s.turnSeq === "number" ? s.turnSeq : undefined,
        })),
      openingQuoteInr: num(data.openingQuoteInr),
      finalQuoteInr: num(data.finalQuoteInr),
      priceVerbatim: data.priceVerbatim ?? undefined,
      deliveryChargeInr: num(data.deliveryChargeInr),
      taxIncluded: typeof data.taxIncluded === "boolean" ? data.taxIncluded : undefined,
      quoteTurnSeq: num(data.quoteTurnSeq),
      terms: data.terms ?? undefined,
      contactName: data.contactName ?? undefined,
      holdUntil: data.holdUntil ?? undefined,
      closed: typeof data.closed === "boolean" ? data.closed : undefined,
    });

    /**
     * Fold the memory delta in from THIS path too, not only from the bridge's
     * /ingest/outcome.
     *
     * Mission memory used to have exactly one writer — the bridge — so a call
     * where the bridge crashed, timed out, or lost its transcript produced a
     * mission that silently stopped learning. This is the same safety net the
     * rest of `extractCall` already is, extended to §1.5.1. `mergeMemory` is
     * idempotent-ish (it dedupes and keeps the last 4), so double-writing when
     * both paths run is harmless.
     */
    const mem = data.memory;
    if (mem && typeof mem === "object") {
      await ctx.runMutation(internal.missions.mergeMemory, {
        missionId: call.missionId,
        goingRateInr: num(data.finalQuoteInr),
        worked: strList(mem.worked),
        avoid: strList(mem.avoid),
        objections: strList(mem.objections),
        suspicion: mem.suspicion === true,
      });
    }
  },
});

function strList(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s) => typeof s === "string" && s).map(String) : [];
}

/** All calls done: rank, summarise, and report back on Telegram. */
export const finishMission = internalAction({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    const mission = await ctx.runQuery(internal.missions.getInternal, {
      missionId: args.missionId,
    });
    if (!mission) return;

    const calls = await ctx.runQuery(internal.orchestratorQueries.callsForMission, {
      missionId: args.missionId,
    });

    const priced = calls
      .filter((c: any) => c.finalQuoteInr)
      .sort(
        (a: any, b: any) =>
          (a.effectivePriceInr ?? a.finalQuoteInr) -
          (b.effectivePriceInr ?? b.finalQuoteInr),
      );
    const answered = calls.filter((c: any) => c.status === "closed");

    const summaryText = renderSummary(mission, calls, priced);

    const { savedInr } = await ctx.runMutation(internal.missions.finalise, {
      missionId: args.missionId,
      summaryText,
    });

    if (savedInr && savedInr > 0) {
      await ctx.runMutation(internal.users.recordSavings, {
        userId: mission.userId,
        savedInr,
      });
    }

    // Memory & Context: remember what this person actually cares about, so the
    // next mission starts smarter. This is what makes "it remembers" real.
    for (const c of mission.brief.constraints.slice(0, 2)) {
      await ctx.runMutation(internal.users.addLearnedPref, {
        userId: mission.userId,
        pref: `${mission.brief.category}: ${c}`,
      });
    }
    if (mission.brief.targetPriceInr) {
      await ctx.runMutation(internal.users.addLearnedPref, {
        userId: mission.userId,
        pref: `budget for ${mission.brief.category} ≈ ₹${mission.brief.targetPriceInr}`,
      });
    }

    const user = await ctx.runQuery(internal.users.get, { userId: mission.userId });
    if (!user) return;

    // Spoken recap in the user's language — the last beat of the demo.
    let voiceText: string | undefined;
    if (answered.length > 0) {
      try {
        const { content } = await chat({
          model: LLM_EXTRACT,
          maxTokens: 220,
          temperature: 0.3,
          messages: [
            {
              role: "system",
              content:
                `Summarise this result for the customer in ${mission.brief.language}, ` +
                `as ONE spoken sentence under 35 words. Natural, warm, no lists, no markdown. ` +
                `Say the winning business and the price plainly. This will be read aloud.`,
            },
            { role: "user", content: summaryText },
          ],
        });
        voiceText = content.trim();
      } catch (err) {
        console.warn("voice summary failed", err);
      }
    }

    await ctx.runAction(internal.telegram.send, {
      chatId: user.tgUserId,
      text: summaryText,
      voiceLang: voiceText ? mission.brief.language : undefined,
      voiceText,
    });
  },
});

function renderSummary(mission: any, calls: any[], priced: any[]): string {
  const esc = (s: string) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  const lines: string[] = [];
  const answered = calls.filter((c) => c.status === "closed");
  const noAnswer = calls.filter((c) => c.status === "no_answer" || c.status === "failed");

  const mins = Math.round(calls.reduce((s, c) => s + (c.durationSec ?? 0), 0) / 60);
  lines.push(
    `<b>✅ ${answered.length} of ${calls.length} answered</b>${mins ? ` · ${mins} min of calls` : ""}`,
  );
  lines.push("");

  if (priced.length > 0) {
    priced.forEach((c: any, i: number) => {
      const drop =
        c.openingQuoteInr && c.finalQuoteInr && c.openingQuoteInr > c.finalQuoteInr
          ? `  <s>${inr(c.openingQuoteInr)}</s> → `
          : "  ";
      const star = i === 0 ? " ⭐" : "";
      lines.push(`<b>${esc(c.vendorName)}</b>${star}`);
      lines.push(`${drop}<b>${inr(c.finalQuoteInr)}</b>`);
      if (c.effectivePriceInr && c.effectivePriceInr !== c.finalQuoteInr) {
        lines.push(`  <i>${inr(c.effectivePriceInr)} all-in</i>`);
      }
      if (c.terms) lines.push(`  <i>${esc(c.terms)}</i>`);
      if (i === 0 && (c.contactName || c.holdUntil)) {
        const bits = [
          c.contactName ? `ask for ${esc(c.contactName)}` : null,
          c.holdUntil ? `held till ${esc(c.holdUntil)}` : null,
        ].filter(Boolean);
        if (bits.length) lines.push(`  📌 ${bits.join(" · ")}`);
      }
      lines.push("");
    });
  } else {
    // Availability missions have no prices — report the answers instead.
    for (const c of answered) {
      lines.push(`<b>${esc(c.vendorName)}</b>`);
      for (const s of c.slots ?? []) {
        const val =
          typeof s.value === "boolean" ? (s.value ? "✅ yes" : "❌ no") : esc(String(s.value));
        lines.push(`  ${esc(s.key)}: ${val}`);
      }
      lines.push("");
    }
  }

  if (noAnswer.length) {
    lines.push(`<i>${noAnswer.length} didn't pick up.</i>`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function num(x: unknown): number | undefined {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}
