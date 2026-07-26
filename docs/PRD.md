# Doot — Product Requirements Document

> **Project:** `bargain-voice-agent` (codename **Doot**)
> **One-liner:** You give Doot one goal and a budget. It calls N places in parallel, negotiates each one down in their own language, brings back one ranked deal sheet on Telegram, and pulls you in only at the moments that need a human.

---

## 1. The problem

Getting one real answer — and a *good price* — out of the offline world still means **you, on the phone, one call at a time**:

- Travelling: check 8 hotels for availability + price, then try to haggle each. That's 8 serial calls, most in a language you half-speak.
- A plumber / clinic slot / part in stock / catering quote — the only interface is a phone number and a human who answers in Marathi.
- You do them serially, so you **can't compare live** and you **can't play quotes against each other**. By the 4th call you've forgotten the 1st, so you take a worse price than you had to.

India's offline economy is voice-first and vernacular-first. There is no API for the family-run hotel or the local vendor — the "API" is a phone call in Hindi/Kannada/Tamil with background noise, and the "pricing endpoint" is a negotiation.

**Honest competitor:** *you, with your thumb and 40 minutes* — who also leaves money on the table because you can't negotiate five places at once. Google Duplex made *one* call, in US English, and never shipped in India.

## 2. Target user & job-to-be-done

**Primary user (hackathon persona):** a busy individual who needs a real-world outcome + a fair price that lives behind phone numbers. Start with **"book a stay while travelling, at the best negotiated rate."**

**The exact job:** *Given a goal, a set of places to call, and a target/walk-away price, get a correct, comparable, negotiated quote from each — and close (or tee up) the one I pick — without me making a single call.*

**Definition of done (what gets written back):**
1. A **structured, negotiated result per place** — available? *final* price after haggling? what was conceded? recording + transcript.
2. A **ranked comparison** delivered to the user, best deal first.
3. A **booking/hold** on the chosen place (confirmation number captured), OR a clean human-handoff for the final personal step (payment / ID).

## 3. What makes it different (the non-obvious choices)

1. **Fan-out, not one call.** N calls run concurrently. Wall-clock ≈ one call, not N.
2. **Parallel competitive leverage (the star mechanic).** Doot holds every live quote and plays them against each other in real time — *"the place down the road quoted ₹3,200, can you beat it?"* No human can do this serially. See [`BARGAINING.md`](BARGAINING.md).
3. **Two-to-three checkpoint human-in-the-loop** — not full autonomy, not babysitting:
   - **A — approve the plan** (places, questions, budget, walk-away) before dialing.
   - **B — mid-call escalation:** off-policy ask → pause *that* call, ping Yes/No on Telegram, resume seamlessly (the caller hears "ek minute please").
   - **C — you pick the winner;** Doot books it, or hands you the final personal step (payment/ID) pre-filled.
4. **Telegram is the whole UI.** No app. Text or voice note in; ranked cards + inline buttons out. Everything Doot learns lives in a DB the user reads through the chat.
5. **Vernacular by default.** Doot speaks each business in *their* language and reports back to you in *yours*.
6. **Consent-first trust layer.** AI disclosure, do-not-call honoured, signed recording+transcript per call. Makes it deployable and makes every claimed price provable.

## 4. Features

### MVP (must be running by 12:15)
- Telegram bot: accept a goal (text + voice note), parse goal + budget + walk-away, confirm the plan (Checkpoint A).
- Seeded list of 3–5 target businesses with phone numbers.
- Concurrent outbound calls (start with 3 parallel) via telephony + Sarvam voice loop.
- **Negotiation on each call** with a target/walk-away price and at least one competitive-leverage move.
- Per-call structured extraction (final price + concessions) → DB.
- Ranked comparison card back to Telegram with inline "Book #2" buttons (Checkpoint C).
- One mid-call escalation to Telegram and back (Checkpoint B) — the money demo moment.
- Final: confirm the chosen booking on a call-back, capture confirmation number, write to DB, summarise to user.

### Stretch (only if MVP is green across 3 test runs)
- Live places API for real numbers.
- Full cross-call leverage loop (re-call earlier places with a better competing quote).
- Warm-transfer / three-way for the payment step.
- Cross-language bridge (Saaras): user speaks Hindi, callee speaks Tamil.
- Persistent user memory (preferred budget, dietary needs, past choices) reused across tasks.
- Deadline/reminder follow-ups.

## 5. Sarvam AI usage — **selected capability: Voice Experience (2.5×)**

Depth on one capability beats breadth. The scored capability is **Voice Experience**: the product lives or dies on whether Doot can hold a real phone conversation with a small Indian business *and negotiate on it*.

| Sarvam component | Role in Doot |
|---|---|
| **Saarika (streaming ASR)** | Real-time transcription of the callee — accents, Hindi-English code-switch, noisy shop backgrounds, "haan bolo", partial words, corrections. The make-or-break L4/L5 axis. |
| **Bulbul (TTS)** | Doot's voice — firm when anchoring a price, warm when closing, deliberate pacing on numbers, "ek minute" during a Checkpoint-B pause. |
| **Sarvam-M (LLM)** | Per-call negotiation policy + slot-filling + escalation logic, the extractor, the cross-call leverage engine, the ranker, and Telegram-side reasoning. |
| **Saaras (speech translation)** *(stretch)* | Bridges user's language ↔ callee's language when they differ. |

**Why this hits L4→L5 on Voice:** follow-ups build on the last answer ("aap ne kaha do room hain — dono mein AC hai?"), Doot reads irritation/hesitation and adjusts firmness, handles barge-in without restarting, recovers from "no wait, 13th nahi, 14th", and shifts pace deliberately (brisk for confirmations, slow for prices). Test against accents, code-switch, noise, interruptions, corrections.

## 6. Non-goals (for the hackathon)
- No autonomous payment or sharing the user's ID/KYC — always human-owned (Checkpoint C).
- No spam / cold-outreach at scale — one user goal, a bounded call list, consent-first.
- No general-purpose assistant — one job (negotiated booking) done deeply beats ten done shallow.

## 7. Success metrics
- **Task success:** ≥ 90% across 3 repeated runs — every place called, structured negotiated result, chosen one booked. (JTBD L5 target.)
- **Negotiation delta:** average % below first-quoted price (the headline demo number).
- **Wall-clock:** N-place task completes in ≈ the time of the slowest single call.
- **Human touches:** ≤ 3 taps from user (approve plan, resolve one escalation, pick winner).

## 8. Risks & open decisions
- **Telephony choice (biggest unknown):** confirm whether Sarvam ships a telephony/voice-agent runtime (check Sarvam Docs). If not, wire Exotel/Plivo/Twilio media streams. **De-risk first — critical path.**
- **Latency budget:** stream everything (ASR partials, chunked TTS), keep Sarvam-M turns short. Rehearse turn-taking; it *is* the Voice score.
- **Real callees for the demo:** line up 3 cooperative, briefed numbers so the live demo doesn't depend on the wild.
- **Concurrency limits:** check Sarvam + telephony concurrent-session quotas before promising N parallel.

See [`RUBRIC.md`](RUBRIC.md) for full rubric mapping and [`ROADMAP.md`](ROADMAP.md) for the build order.
