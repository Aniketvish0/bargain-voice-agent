# Contributing

Doot is a hackathon build (Sarvam × GrowthX). Speed matters — but two rules are non-negotiable because they *are* the product's integrity.

## The two rules that never bend
1. **Never fabricate a quote or a confirmation.** Competitive leverage cites only real, board-recorded prices. A booking is only "confirmed" when a real confirmation number was captured. The signed transcript must back every claim.
2. **Doot always discloses it's an AI** at the start of every call, on behalf of a named user. No impersonation.

## Working style for the sprint
- Build along [`docs/ROADMAP.md`](docs/ROADMAP.md) milestones, in order. De-risk telephony first.
- Get the common path green before edge cases. Repeatability (3 clean runs) is the JTBD score.
- Keep Sarvam-M prompts short — turn latency < ~1s is the Voice score.
- Every extracted fact must trace to a `call` + `turn` + recording.

## Setup
```bash
cp .env.example .env      # fill Sarvam, Telegram, telephony keys
# then follow docs/ARCHITECTURE.md §"Suggested stack"
```

## Commits
- Small, working increments. Don't break `main` — it's the demo.
- Message format: `feat: …`, `fix: …`, `docs: …`.

## Before the demo
- Run the [`docs/DEMO.md`](docs/DEMO.md) script end to end at least 3 times.
- Record one full fallback run. Never debug on stage.
