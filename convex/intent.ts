import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { chat } from "./lib/sarvam";
import { DEFAULT_LANG, isTtsLang, LLM_LIVE, TTS_11 } from "./lib/constants";
import { inferMissionType, parseBudget } from "./lib/inr";

/**
 * Turn one line of (probably code-mixed) user speech into a structured mission.
 *
 * This is where `missionType` gets decided — availability ⊂ quote ⊂ negotiate.
 * See docs/BUILD-SPEC.md §1.5. Getting the type right matters: letting a
 * "do you have it in stock" request drift into haggling makes short calls long
 * and is the fastest way to get hung up on.
 */

export type Brief = {
  missionType: "availability" | "quote" | "negotiate";
  category: string;
  locality: string;
  constraints: string[];
  objectives: Array<{
    key: string;
    ask: string;
    type: "boolean" | "money" | "date" | "number" | "text";
    required: boolean;
  }>;
  targetPriceInr?: number;
  walkAwayInr?: number;
  language: string;
  clarifyingQuestion?: string;
};

const SYSTEM = `You turn a person's one-line request into a structured calling brief.
They want an AI to phone local Indian businesses on their behalf.

Return ONLY JSON matching this shape:
{
  "missionType": "<availability | quote | negotiate>",
  "category": "<short noun phrase: hotel, refrigerator, restaurant, plumber>",
  "locality": "<Title Case place name, human readable, never snake_case>",
  "constraints": ["<short phrases: 250 litre, AC, 14th to 16th, party of 20>"],
  "objectives": [
    {"key":"<camelCase>","ask":"<question to ask on the phone>","type":"<boolean|money|date|number|text>","required":true}
  ],
  "targetPriceInr": "<integer, or OMIT the key entirely>",
  "walkAwayInr": "<integer, or OMIT the key entirely>",
  "language": "<BCP-47>",
  "clarifyingQuestion": "<ask ONLY if a required field is genuinely unguessable, else OMIT>"
}

RULES FOR missionType — the most important decision. Check in this order:
1. Does the request contain ANY budget or price ceiling? Look for:
   "se kam", "ke andar", "tak", "under", "below", "max", "budget", "se neeche",
   "best price", "cheapest", "sasta", "bargain", "mol bhav", "discount", "deal".
   -> If YES, missionType is "negotiate". This rule wins over everything below.
2. Otherwise, do they ask what something COSTS, with no budget stated?
   e.g. "what do plumbers charge for a leaking tap"  -> "quote"
3. Otherwise they only want to know IF something exists / is free / is open / is in stock.
   e.g. "is the doctor taking walk-ins", "do you deliver to 560102"  -> "availability"

RULES FOR objectives:
- Produce 2 to 4 objectives. Never 1, never more than 4 — a phone call has a turn budget.
- The FIRST objective is always the core availability question (type "boolean").
- For "quote" and "negotiate", exactly one objective must have type "money".
- Add one or two useful secondary objectives the caller would obviously want
  (breakfast included, delivery charge, warranty, closing time, parking).
- "ask" is spoken aloud on a phone call. Under 12 words, natural, no jargon.
- required:true only where a missing answer makes the whole call useless.

RULES FOR prices — read carefully, this is where mistakes happen:
- Indian number words: "chaar hazaar"=4000, "pachees hazaar"/"25 hazaar"=25000,
  "saade chaubees hazaar"=24500, "sawa lakh"=125000, "dedh lakh"=150000, "5k"=5000.
  Prefixes: "saade X"=X+0.5, "sawa X"=X*1.25, "paune X"=X*0.75, "dedh"=1.5.
- NEVER MULTIPLY. If they say 4000 per night for 2 nights, targetPriceInr is 4000,
  not 8000. The price is always the per-unit price they stated.
- targetPriceInr is exactly the number they said. walkAwayInr is ~10% above it,
  unless they stated a hard maximum, in which case walkAwayInr is that maximum.
- If no price is mentioned anywhere, OMIT BOTH KEYS. Do not emit 0. Do not invent
  a number. Do not copy a number from these instructions.

RULES FOR language:
- BCP-47 from this set only: ${TTS_11.join(", ")}.
- Pick the language the CALLEE most likely speaks in that locality, not the user's.
  Goa -> en-IN or hi-IN. Chennai -> ta-IN. Bangalore -> kn-IN. Delhi/NCR -> hi-IN. Mumbai/Pune -> mr-IN or hi-IN.
- When unsure, hi-IN.`;

const FEWSHOT = [
  {
    role: "user" as const,
    content: "Goa mein 14 tarikh se do raat ke liye hotel chahiye, AC, chaar hazaar se kam per night",
  },
  {
    role: "assistant" as const,
    content: JSON.stringify({
      missionType: "negotiate",
      category: "hotel",
      locality: "Goa",
      constraints: ["AC room", "14th, 2 nights"],
      objectives: [
        { key: "hasRoom", ask: "AC room available from the 14th for two nights?", type: "boolean", required: true },
        { key: "pricePerNight", ask: "what is the rate per night", type: "money", required: true },
        { key: "breakfast", ask: "is breakfast included", type: "boolean", required: false },
      ],
      targetPriceInr: 4000,
      walkAwayInr: 4400,
      language: "hi-IN",
    }),
  },
  {
    role: "user" as const,
    content: "koi bhi medical store HSR layout mein raat ko khula hai kya",
  },
  {
    role: "assistant" as const,
    content: JSON.stringify({
      missionType: "availability",
      category: "pharmacy",
      locality: "HSR Layout Bangalore",
      constraints: ["open late night"],
      objectives: [
        { key: "openLate", ask: "are you open late at night", type: "boolean", required: true },
        { key: "closingTime", ask: "what time do you close", type: "text", required: false },
      ],
      language: "kn-IN",
    }),
  },
];

export const extractBrief = internalAction({
  args: { text: v.string(), userPrefLang: v.optional(v.string()) },
  handler: async (_ctx, args): Promise<Brief> => {
    const { content } = await chat({
      model: LLM_LIVE,
      maxTokens: 700,
      temperature: 0.2,
      json: true,
      messages: [
        { role: "system", content: SYSTEM },
        ...FEWSHOT,
        { role: "user", content: args.text },
      ],
    });

    let raw: any;
    try {
      raw = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error(`Intent extraction returned non-JSON: ${content.slice(0, 200)}`);
      raw = JSON.parse(m[0]);
    }

    return normalise(raw, args.text, args.userPrefLang);
  },
});

/**
 * Never trust the model's shape. A malformed brief here becomes a bad phone
 * call to a real stranger, so every field is clamped.
 *
 * Two fields are taken away from the LLM entirely and computed from the raw
 * text instead — see convex/lib/inr.ts for why:
 *   - missionType  (it read "table for 20 people" as a ₹20 budget)
 *   - targetPriceInr (it read "pachees hazaar" as 20000, and leaked the
 *     literal example value from its own instructions into unrelated requests)
 */
export function normalise(raw: any, sourceText: string, userPrefLang?: string): Brief {
  const llmGuess: Brief["missionType"] =
    raw?.missionType === "availability" || raw?.missionType === "quote"
      ? raw.missionType
      : "negotiate";
  const missionType = inferMissionType(sourceText, llmGuess);

  const objectives = Array.isArray(raw?.objectives) ? raw.objectives : [];
  const cleanObjectives = objectives
    .filter((o: any) => o && typeof o.key === "string" && typeof o.ask === "string")
    .slice(0, 4)
    .map((o: any) => ({
      key: String(o.key).slice(0, 40),
      ask: String(o.ask).slice(0, 120),
      type: (["boolean", "money", "date", "number", "text"].includes(o.type)
        ? o.type
        : "text") as Brief["objectives"][number]["type"],
      required: o.required !== false,
    }));

  if (cleanObjectives.length === 0) {
    cleanObjectives.push({
      key: "available",
      ask: "is it available",
      type: "boolean",
      required: true,
    });
  }

  const lang = isTtsLang(raw?.language)
    ? raw.language
    : isTtsLang(userPrefLang)
      ? userPrefLang
      : DEFAULT_LANG;

  // Price comes from the deterministic parser, with the LLM only as a fallback
  // when the parser finds nothing (e.g. an unusual phrasing it doesn't know).
  const parsed = parseBudget(sourceText);
  const target = parsed?.valueInr ?? numOrUndef(raw?.targetPriceInr);
  let walkAway = numOrUndef(raw?.walkAwayInr);
  // A walk-away below the target is nonsense and would make the agent quit
  // on the first counter-offer.
  if (target && (!walkAway || walkAway < target)) walkAway = Math.round(target * 1.1);

  return {
    missionType,
    category: String(raw?.category ?? "").slice(0, 60) || "unknown",
    locality: String(raw?.locality ?? "").slice(0, 80),
    constraints: (Array.isArray(raw?.constraints) ? raw.constraints : [])
      .slice(0, 6)
      .map((c: any) => String(c).slice(0, 60)),
    objectives: cleanObjectives,
    ...(missionType === "availability" || !target
      ? {}
      : { targetPriceInr: target, walkAwayInr: walkAway }),
    language: lang,
    clarifyingQuestion:
      typeof raw?.clarifyingQuestion === "string" && raw.clarifyingQuestion.length > 3
        ? raw.clarifyingQuestion.slice(0, 200)
        : undefined,
  };
}

function numOrUndef(x: any): number | undefined {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}
