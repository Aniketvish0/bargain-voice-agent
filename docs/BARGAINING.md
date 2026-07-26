# The Negotiation Engine

> This is Doot's soul. Anyone can build "an agent that calls places." The difference — and the reason the repo is named `bargain-voice-agent` — is that Doot **negotiates**, and it negotiates with information a human on a phone physically cannot hold: **every competing quote, live, at once.**

---

## 1. Inputs (set at Checkpoint A)

| Input | Example | Meaning |
|---|---|---|
| `target_price` | ₹3,500 | What Doot aims for. It opens *below* this (anchor). |
| `walk_away` | ₹4,000 | Hard ceiling. Above this, Doot politely disengages. |
| `item/service` | "double room, 2 nights, AC" | What's being priced — so "cheaper" isn't a worse thing. |
| `must-haves` | AC, near old city | Non-negotiable constraints; price cuts that drop these don't count. |
| `nice-to-haves` | breakfast, late checkout | Bargaining chips to trade. |
| `tone` | polite-firm | How hard to push (respectful by default — these are real people). |

## 2. The negotiation state (per call)

```
{
  base_quote,            // first price the callee gave
  current_offer,         // Doot's live offer
  their_counter,         // callee's latest
  concessions_used,      // [dropped_breakfast, 2-night_bundle, ...]
  rounds,                // stop escalating after N (avoid annoyance)
  best_competing_quote,  // read live from the quote board
  status                 // NEGOTIATING | DEAL | WALK_AWAY | CALLBACK
}
```

## 3. The tactics (Sarvam-M is prompted to use these)

1. **Anchor low, concede slowly.** Open under target; give ground in small, decreasing steps so the callee feels they *won* the last rupee.
2. **Trade, don't just cut.** "I'll skip breakfast if you do ₹3,600." Concede nice-to-haves, never must-haves.
3. **Bundle.** "Two nights instead of one — what's your best rate then?"
4. **Silence & patience.** Pacing matters (Bulbul): a beat of quiet after a counter does real work.
5. **The polite walk.** At `walk_away`: "That's a bit more than I can do, thank you so much" — often triggers a better final offer as Doot is *leaving*.
6. **Competitive leverage** — the star move, §4.

## 4. ⭐ Parallel competitive leverage (the unfair advantage)

Because Doot runs N calls **at the same time** and writes each price to a **live quote board** (Redis), the negotiation engine on every active call can reference the best competing quote *as it happens*:

```
Hotel A quotes ₹3,900  ─┐
Hotel B quotes ₹3,600  ─┼──▶  live quote board: best = ₹3,600
Hotel C quotes ₹4,100  ─┘
        │
        ▼  Doot, still on the line with Hotel A:
   "Sir, mujhe paas hi ₹3,600 mil raha hai — aap ₹3,500 kar do
    toh main abhi aapke saath book kar leta hoon."
        │
        ▼  Hotel A drops to ₹3,550. New best. Board updates.
        ▼  Doot uses ₹3,550 to push Hotel B... and so on.
```

**Why a human can't do this:** you call serially. By the time you reach Hotel C you've forgotten A's exact number, you can't call A back mid-conversation with C, and you certainly can't run a live bidding loop across five vendors. Doot does it in one wall-clock window. This single mechanic is:
- the **Creativity** score (a genuine reframe, not decoration),
- the **Impact** headline (measurable ₹ saved vs. first quote),
- and the **demo moment** judges remember.

### Optional: the second-pass auction (stretch)
Once all first-round quotes are in, Doot can **re-call** the top 2–3 places with the current best number to squeeze a final round — a real-time reverse auction over the phone.

## 5. When Doot escalates (Checkpoint B)

The engine hands control to the human when it hits something outside policy:
- A trade it wasn't authorized for ("breakfast +₹500 — worth it?").
- A price *below* target but with a catch ("₹3,200 but non-refundable").
- Ambiguity on a must-have ("AC hai but window nahi" — acceptable?).

It parks the call gracefully, sends 2–3 options to Telegram, waits (~25s timeout), resumes. On timeout → safe default: "let me confirm and call you back," logged.

## 6. Guardrails on negotiation
- **Never fabricate a competing quote.** Leverage only cites *real* board entries — the signed transcript makes every claim auditable. (This is the trust layer: a made-up "the other guy said ₹3,000" would be both dishonest and unprovable.)
- **Respectful by default.** These are small businesses and real people; tone stays polite-firm, never aggressive. Doot is an envoy, not a bully.
- **Stop at `rounds` cap.** Endless haggling annoys; Doot knows when to close or walk.
- **Disclose it's an AI.** Negotiating while pretending to be human is off-limits.

## 7. What gets written back per call

```
extractions:
  available        bool
  base_price       int      // first quote
  final_price      int      // after negotiation
  concessions      jsonb    // what was traded
  savings_pct      int      // (base - final) / base
  must_haves_met   bool
  confidence       int
  → traceable to recording_url + full turns transcript
```

The ranked deal sheet the user sees leads with `final_price` and shows `savings_pct` — the number that makes the whole thing feel like magic.
