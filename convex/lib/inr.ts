/**
 * Doot — Indian money expression parser.
 *
 * Used in two places:
 *   1. Intent extraction — pulling the user's budget out of their request.
 *   2. Post-call extraction — the deterministic cross-check on the LLM's
 *      `priceVerbatim` (BUILD-SPEC §13, two-stage normaliser).
 *
 * WHY THIS IS CODE AND NOT A PROMPT
 * ---------------------------------
 * Live-tested sarvam-30b on real requests: it read "pachees hazaar" as 20000,
 * and — worse — read "table for 20 people" as a ₹20 budget and flipped the
 * whole mission to `negotiate`. Numeral parsing is deterministic work; asking a
 * language model to do it buys nothing and loses money on a real phone call.
 *
 * THE CENTRAL RULE: a bare number is NEVER money. "20 people", "8pm", "14th",
 * "250 litre" must not parse. A number only counts as money when it carries a
 * multiplier (hazaar/lakh/k), a currency marker (₹/rs/rupaye), or sits directly
 * against a budget phrase ("under 4000").
 */

/** Romanised + Devanagari Hindi numerals we actually see in budgets. */
const WORD_NUM: Record<string, number> = {
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5,
  chah: 6, chhah: 6, che: 6, saat: 7, aath: 8, nau: 9, das: 10, dus: 10,
  gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16,
  satrah: 17, atharah: 18, unnis: 19, bees: 20, bis: 20,
  ikkis: 21, bais: 22, bais23: 23, teis: 23, chaubees: 24, chaubis: 24,
  pachees: 25, pachis: 25, paccis: 25, pacchis: 25,
  chabbis: 26, sattais: 27, atthais: 28, untees: 29,
  tees: 30, tis: 30, chalees: 40, chalis: 40, pachaas: 50, pachas: 50,
  saath: 60, sattar: 70, assi: 80, nabbe: 90,
  sau: 100, hazaar: 1000, hazar: 1000, hajaar: 1000, hajar: 1000,
  lakh: 100000, lac: 100000, crore: 10000000, karod: 10000000,
  // Devanagari
  एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5, छह: 6, सात: 7, आठ: 8, नौ: 9,
  दस: 10, बीस: 20, तेईस: 23, चौबीस: 24, पच्चीस: 25, तीस: 30, चालीस: 40,
  पचास: 50, सौ: 100, हज़ार: 1000, हजार: 1000, लाख: 100000, करोड़: 10000000,
};

/** Fractional prefixes. "saade chaubees hazaar" = 24.5 * 1000. */
const PREFIX: Record<string, number> = {
  saade: 0.5, sade: 0.5, "साढ़े": 0.5, "साडे": 0.5, // +0.5
};
const MULT_PREFIX: Record<string, number> = {
  sawa: 1.25, sava: 1.25, "सवा": 1.25,
  paune: 0.75, pone: 0.75, "पौने": 0.75,
};
/** Standalone words that are already a full quantity. */
const STANDALONE: Record<string, number> = {
  dedh: 1.5, derh: 1.5, "डेढ़": 1.5,
  dhai: 2.5, dhaai: 2.5, "ढाई": 2.5,
  adha: 0.5, aadha: 0.5, "आधा": 0.5,
};

const MULTIPLIER: Record<string, number> = {
  k: 1000, hazaar: 1000, hazar: 1000, hajaar: 1000, hajar: 1000,
  thousand: 1000, "हज़ार": 1000, "हजार": 1000,
  lakh: 100000, lac: 100000, lakhs: 100000, "लाख": 100000,
  crore: 10000000, cr: 10000000, "करोड़": 10000000,
};

const CURRENCY = /₹|\brs\.?\b|\brupees?\b|\brupaye\b|\brupaiya\b|रुपये|रुपए/i;

/** Phrases that mark a ceiling. Their presence is what makes it a negotiation. */
const BUDGET_MARKERS =
  /\bse\s*kam\b|\bke\s*andar\b|\bse\s*neeche\b|\btak\b|\bunder\b|\bbelow\b|\bwithin\b|\bupto\b|\bup\s*to\b|\bmax(?:imum)?\b|\bbudget\b|\bse\s*less\b|से\s*कम|के\s*अंदर|तक/i;

/** Phrases that ask for a good deal without naming a number. */
const BARGAIN_MARKERS =
  /\bbest\s*price\b|\bcheapest\b|\bsasta\b|\bsaste\b|\bbargain\b|\bmol\s*bhav\b|\bdiscount\b|\bdeal\b|\bkam\s*kar\b|सस्ता|मोल\s*भाव|छूट/i;

/** Do they ask what it costs, without naming a number? */
const ASKS_ABOUT_COST =
  /\brate\b|\bprice\b|\bcost\b|\bcharge[sd]?\b|\bfee[s]?\b|\bkitna\b|\bkitne\b|\bkya\s*lagega\b|\bhow\s*much\b|कितना|कितने|दाम|कीमत/i;

export type MoneyHit = { valueInr: number; verbatim: string; index: number };

/**
 * Find every money expression in a string. Returns [] for "table for 20 people".
 */
export function findMoney(text: string): MoneyHit[] {
  const hits: MoneyHit[] = [];
  const t = text.toLowerCase();

  // ── Pass 1: digits with an explicit multiplier or currency. ───────────────
  // 25k · 25 hazaar · ₹24,500 · Rs 24.5k · 1.5 lakh · 25000/-
  const mult = Object.keys(MULTIPLIER).sort((a, b) => b.length - a.length).join("|");
  const reDigit = new RegExp(
    String.raw`(₹\s*)?(\d[\d,]*(?:\.\d+)?)\s*(${mult})?\b`,
    "gi",
  );
  for (const m of t.matchAll(reDigit)) {
    const [full, rupeeSym, numStr, multWord] = m;
    const n = parseFloat(numStr.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;

    const start = m.index ?? 0;
    const before = t.slice(Math.max(0, start - 22), start);
    const after = t.slice(start + full.length, start + full.length + 14);

    let value: number | null = null;
    if (multWord) {
      value = n * MULTIPLIER[multWord.toLowerCase()];
    } else if (rupeeSym || CURRENCY.test(before) || CURRENCY.test(after)) {
      value = n;
    } else if (BUDGET_MARKERS.test(before) || BUDGET_MARKERS.test(after)) {
      // "under 4000" — a budget phrase makes a bare number money.
      // Guard against "under 20 people": require a plausible rupee magnitude.
      if (n >= 100) value = n;
    }
    if (value === null) continue;
    if (value < 10 || value > 100_000_000) continue; // sanity band
    hits.push({ valueInr: Math.round(value), verbatim: full.trim(), index: start });
  }

  // ── Pass 2: word numerals. "pachees hazaar", "saade chaubees hazaar". ─────
  const tokens = t.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    let j = i;
    let frac = 0;
    let scale = 1;

    if (PREFIX[tokens[j]] !== undefined) { frac = PREFIX[tokens[j]]; j++; }
    else if (MULT_PREFIX[tokens[j]] !== undefined) { scale = MULT_PREFIX[tokens[j]]; j++; }

    let base: number | null = null;
    if (j < tokens.length && STANDALONE[tokens[j]] !== undefined) {
      base = STANDALONE[tokens[j]]; j++;
    } else if (j < tokens.length && WORD_NUM[tokens[j]] !== undefined && !MULTIPLIER[tokens[j]]) {
      base = WORD_NUM[tokens[j]]; j++;
    } else if (j < tokens.length && /^\d+$/.test(tokens[j] ?? "") && (frac || scale !== 1)) {
      base = parseInt(tokens[j]!, 10); j++;
    } else if ((frac || scale !== 1) && j < tokens.length && MULTIPLIER[tokens[j]!] !== undefined) {
      base = 1; // "sawa lakh" = 1.25 x lakh, "saade lakh" = 1.5 x lakh
    }
    if (base === null) continue;

    // A word numeral is only money if a multiplier follows. "bees log" is 20 people.
    const multTok = tokens[j];
    if (!multTok || MULTIPLIER[multTok] === undefined) continue;

    const value = (base + frac) * scale * MULTIPLIER[multTok];
    if (value < 10 || value > 100_000_000) continue;
    hits.push({
      valueInr: Math.round(value),
      verbatim: tokens.slice(i, j + 1).join(" "),
      index: t.indexOf(tokens[i]!),
    });
  }

  // Dedupe by value, keep the longest verbatim (the most specific match).
  const byValue = new Map<number, MoneyHit>();
  for (const h of hits) {
    const prev = byValue.get(h.valueInr);
    if (!prev || h.verbatim.length > prev.verbatim.length) byValue.set(h.valueInr, h);
  }
  return [...byValue.values()].sort((a, b) => a.index - b.index);
}

/** The single most likely budget in a request: the largest money expression. */
export function parseBudget(text: string): MoneyHit | null {
  const hits = findMoney(text);
  if (hits.length === 0) return null;
  return hits.reduce((a, b) => (b.valueInr > a.valueInr ? b : a));
}

export function hasBudgetMarker(text: string): boolean {
  return BUDGET_MARKERS.test(text);
}

export function hasBargainMarker(text: string): boolean {
  return BARGAIN_MARKERS.test(text);
}

/**
 * Decide the mission type from the raw text, deterministically.
 * The LLM only gets to choose between "quote" and "availability".
 */
export function inferMissionType(
  text: string,
  llmGuess: "availability" | "quote" | "negotiate",
): "availability" | "quote" | "negotiate" {
  const money = parseBudget(text);
  // A stated ceiling, or an explicit ask for a deal, means negotiate. Full stop.
  if ((money && hasBudgetMarker(text)) || hasBargainMarker(text)) return "negotiate";
  // A price with no ceiling phrase is still a price the user cares about.
  if (money) return "negotiate";
  // No money anywhere: the model may not invent a negotiation.
  if (llmGuess !== "negotiate") return llmGuess;
  return ASKS_ABOUT_COST.test(text) ? "quote" : "availability";
}

/** quote + delivery + GST. Rank on this, never the raw quote. BUILD-SPEC §13. */
export function effectivePrice(opts: {
  quotedPriceInr?: number | null;
  deliveryChargeInr?: number | null;
  taxIncluded?: boolean | null;
}): number | undefined {
  const q = opts.quotedPriceInr;
  if (!q || !Number.isFinite(q)) return undefined;
  const delivery = opts.deliveryChargeInr ?? 0;
  const gst = opts.taxIncluded === false ? q * 0.18 : 0;
  return Math.round(q + delivery + gst);
}
