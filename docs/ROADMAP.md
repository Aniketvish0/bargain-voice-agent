# Roadmap & Build Order

> Hackathon reality: commit by 11:30, running by 12:15. Get the common path working before any edge case eats the sprint. Build in the order that de-risks the critical path first.

## Milestone 0 — De-risk the critical path (do this FIRST, ~30 min)
- [ ] Check **Sarvam Docs**: does Sarvam ship a telephony / voice-agent runtime? If yes → use it, skip the media-bridge glue.
- [ ] If no → confirm telephony provider (Exotel/Plivo/Twilio) + that you can place an outbound call and stream audio over WebSocket.
- [ ] Verify Sarvam Saarika (streaming STT), Bulbul (TTS), Sarvam-M keys work with a hello-world.
- [ ] Confirm concurrent-session quotas (telephony + Sarvam) support ≥ 3 parallel calls.

**If telephony can't stream in time:** fall back to a single call first, prove the voice loop + negotiation, then parallelize.

## Milestone 1 — One call, end to end (the spine)
- [ ] Telegram bot accepts a goal (text first, voice note next) → parse with Sarvam-M.
- [ ] Place one outbound call; run the voice loop: Saarika → Sarvam-M → Bulbul, with barge-in.
- [ ] Extract a structured result (available? price?) → Postgres.
- [ ] Report back to Telegram.

## Milestone 2 — Negotiation
- [ ] Add target/walk-away to the parsed task (Checkpoint A approval).
- [ ] Negotiation state + tactics in the per-call loop (anchor, trade, walk).
- [ ] Write `base_price`, `final_price`, `savings_pct`, concessions.

## Milestone 3 — Fan-out + competitive leverage (the differentiator)
- [ ] Redis queue + max-parallel cap; 3 calls concurrently.
- [ ] Live quote board in Redis; negotiation reads best competing quote.
- [ ] One call demonstrably cites another's price to push a discount.

## Milestone 4 — Human-in-the-loop polish
- [ ] Checkpoint B: mid-call escalation → Telegram inline buttons → resume with timeout default.
- [ ] Checkpoint C: ranked deal card + "Book" buttons → confirmation call → booking write-back.
- [ ] 🎧 "listen to the call" link (recording) on each result.

## Milestone 5 — Rehearse for the rubric
- [ ] 3 clean end-to-end runs (JTBD L5 needs repeatability).
- [ ] Stress voice: accents, code-switch, noise, barge-in, corrections.
- [ ] Record a fallback run in case a live call flakes on stage.

## Cut list (drop these first if time is short)
1. Live places API → use seeded numbers.
2. Cross-language bridge (Saaras) → keep callee + user in one language.
3. Second-pass auction / re-call loop → single negotiation round.
4. Persistent cross-task memory → single-session memory only.
5. Warm-transfer for payment → hand off as a Telegram message with details pre-filled.
6. Status dashboard → the Telegram messages *are* the UI.

## Never cut
- The end-to-end write-back (booking + confirmation #) — that's the JTBD score.
- At least one live negotiation showing competitive leverage — that's Creativity + the demo.
- Honest reporting (recording link, no fake confirmations) — that's Delight + trust.
