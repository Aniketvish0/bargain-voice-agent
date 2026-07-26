import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { chat } from "./lib/sarvam";
import { LLM_LIVE } from "./lib/constants";

/**
 * Vendor fit — do not call a five-star for a ₹4,000 room. BUILD-SPEC §1.5.2
 *
 * Live failure that motivated this: a ₹4,000/night Goa mission dialled The
 * Leela Palace. Discovery ranks on rating × review count, which actively
 * promotes the most expensive vendors in any category — exactly the ones a
 * budget-conscious mission cannot use. The call wastes our credits and a real
 * receptionist's afternoon, and it makes the agent look stupid.
 *
 * Three tiers, cheapest first. Most rejections never reach the LLM.
 */

/** Chains that will never quote a budget rate. Zero-cost reject. */
const LUXURY = [
  "leela", "taj ", "the taj", "oberoi", "itc ", "marriott", "hyatt", "hilton",
  "radisson", "novotel", "st regis", "st. regis", "ritz", "four seasons",
  "le meridien", "sheraton", "westin", "jw ", "sofitel", "fairmont",
  "intercontinental", "kempinski", "shangri", "grand hyatt", "raffles",
];

/** The other direction: a dhaba cannot cater a ₹50,000 banquet. */
const BUDGET_TIER = ["dhaba", "lodge", "guest house", "guesthouse", "hostel", "dormitory"];

export type FitVerdict = { plausible: boolean; reason?: string };

/**
 * Free checks. Returns null when it cannot decide, so the caller can escalate.
 */
export function quickFit(
  name: string,
  targetPriceInr: number | undefined,
  priceLevel?: string,
): FitVerdict | null {
  if (!targetPriceInr) return { plausible: true }; // availability mission — price is irrelevant
  const n = name.toLowerCase();

  if (priceLevel === "PRICE_LEVEL_VERY_EXPENSIVE" && targetPriceInr < 15000) {
    return { plausible: false, reason: "Very expensive venue, far above budget" };
  }
  if (priceLevel === "PRICE_LEVEL_EXPENSIVE" && targetPriceInr < 6000) {
    return { plausible: false, reason: "Expensive venue, above budget" };
  }
  if (priceLevel === "PRICE_LEVEL_INEXPENSIVE" && targetPriceInr > 20000) {
    return { plausible: false, reason: "Budget venue, unlikely to serve this requirement" };
  }

  if (LUXURY.some((b) => n.includes(b)) && targetPriceInr < 12000) {
    return { plausible: false, reason: "Luxury chain — will not quote this budget" };
  }
  if (BUDGET_TIER.some((b) => n.includes(b)) && targetPriceInr > 25000) {
    return { plausible: false, reason: "Budget-tier venue for a premium requirement" };
  }
  return null; // undecided — let the LLM look at it
}

/**
 * One cheap screen for everything the heuristics could not settle.
 *
 * Deliberately biased toward CALLING: a false reject silently loses a good
 * vendor and the user never learns why, whereas a false accept costs one short
 * call. Only clear mismatches are rejected.
 */
export const screen = internalAction({
  args: {
    candidates: v.array(
      v.object({
        name: v.string(),
        address: v.optional(v.string()),
        priceLevel: v.optional(v.string()),
      }),
    ),
    category: v.string(),
    locality: v.string(),
    targetPriceInr: v.optional(v.number()),
  },
  handler: async (_ctx, args): Promise<FitVerdict[]> => {
    // Heuristics first; only escalate the undecided ones.
    const quick = args.candidates.map((c) =>
      quickFit(c.name, args.targetPriceInr, c.priceLevel),
    );
    if (!args.targetPriceInr || quick.every((q) => q !== null)) {
      return quick.map((q) => q ?? { plausible: true });
    }

    const undecided = args.candidates
      .map((c, i) => ({ c, i }))
      .filter(({ i }) => quick[i] === null);

    const list = undecided
      .map(({ c, i }) => `${i}. ${c.name}${c.address ? ` — ${c.address}` : ""}`)
      .join("\n");

    try {
      const { content } = await chat({
        model: LLM_LIVE,
        maxTokens: 400,
        temperature: 0.1,
        json: true,
        messages: [
          {
            role: "system",
            content:
              `A buyer wants ${args.category} in ${args.locality} for about ` +
              `₹${args.targetPriceInr}. For each business below, decide whether it is ` +
              `PLAUSIBLE that they could serve that budget.\n\n` +
              `Reject only CLEAR mismatches — a five-star resort for a budget room, or ` +
              `a roadside stall for a premium order. When unsure, say plausible: true; ` +
              `a wasted call is far cheaper than silently skipping a good vendor.\n\n` +
              `Return ONLY JSON: {"verdicts":[{"i":0,"plausible":true,"reason":"short"}]}`,
          },
          { role: "user", content: list },
        ],
      });

      const parsed = JSON.parse(
        content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1),
      );
      const byIndex = new Map<number, FitVerdict>();
      for (const vd of parsed.verdicts ?? []) {
        if (typeof vd?.i === "number") {
          byIndex.set(vd.i, {
            plausible: vd.plausible !== false,
            reason: vd.reason ? String(vd.reason).slice(0, 90) : undefined,
          });
        }
      }
      return args.candidates.map(
        (_, i) => quick[i] ?? byIndex.get(i) ?? { plausible: true },
      );
    } catch (err) {
      // Screening is an optimisation, never a gate. Fail open.
      console.warn("vendor fit screen failed, allowing all", err);
      return args.candidates.map((_, i) => quick[i] ?? { plausible: true });
    }
  },
});
