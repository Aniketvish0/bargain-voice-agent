<div align="center">

# 🤝 Doot — the calling envoy that negotiates for you

**You give it one goal. It calls ten places at once, haggles each one down in their own language, and brings back the best deal — while you do something else.**

*दूत (doot) = envoy / messenger — someone you send to speak on your behalf.*

Built on [Sarvam AI](https://www.sarvam.ai/) · Voice-first · Human-in-the-loop via Telegram

</div>

---

## The one-line pitch

> Getting a real answer out of the offline world still means **you, on the phone, one call at a time, in a language you half-speak.** Doot makes all those calls in parallel, negotiates on every one of them, and pulls you in only at the two moments that actually need a human.

## The thing no human and no competitor can do

Doot calls **N places simultaneously** and holds every quote **live**. So it does what you physically can't:

> 🎯 **Parallel competitive leverage** — *"The place down the road just quoted me ₹3,200 — can you do better?"*
>
> You call serially and forget quote #1 by the time you reach #4. Doot plays all of them against each other **in real time**, driving every price down at once.

Google Duplex made *one* restaurant call, in US English, and never shipped in India. The honest competitor here is **you, with your thumb and 40 minutes**.

## How it works

```
   You (Telegram)                    Doot                         The offline world
        │                             │                                  │
        │  "Find me a room in Jaipur, │                                  │
        │   2 people, under ₹4k,      │                                  │
        │   near old city" 🎤 ───────▶│                                  │
        │                             │  parses goal + budget            │
        │  ◀── plan + 5 places ───────│                                  │
        │  ✅ Approve  (Checkpoint A) │                                  │
        │                             │── calls 5 hotels in parallel ───▶│ 🏨🏨🏨🏨🏨
        │                             │   negotiates each in Hindi       │
        │                             │   uses quote #3 vs quote #1      │
        │  ◀── "Hotel B: breakfast    │                                  │
        │      +₹500?" (Checkpoint B) │                                  │
        │  ✅ Yes ───────────────────▶│  resumes that call seamlessly    │
        │                             │                                  │
        │  ◀── ranked deals + 🎧 ─────│  best negotiated price each      │
        │  ✅ Book Hotel B (Checkpt C)│                                  │
        │                             │── calls back, confirms, books ──▶│ 🏨✔
        │  ◀── confirmation #A4821 ───│                                  │
```

You made **zero calls**.

## Human-in-the-loop, done right

Not fully autonomous (scary), not babysitting every call (pointless) — **three checkpoints**:

| | Checkpoint | What you do |
|---|---|---|
| **A** | Before dialing | Approve the plan: who Doot calls, what it asks, your budget & walk-away price |
| **B** | Mid-call escalation | A callee asks something off-policy → Doot pauses *that one call*, pings you Yes/No, resumes |
| **C** | Closing | You pick the winner; Doot books it (or hands you the final personal step — payment/ID) |

## Powered by Sarvam AI

**Selected capability: Voice Experience** — the product lives or dies on holding a real, code-switched, noisy phone call *and negotiating on it*.

| Component | Role |
|---|---|
| **Saarika** (streaming ASR) | Transcribes the callee — accents, Hindi-English code-switch, shop noise, corrections |
| **Bulbul** (TTS) | Doot's voice — firm when anchoring a price, warm when closing, "ek minute" on a pause |
| **Sarvam-M** (LLM) | The negotiation brain, slot-filling, cross-call leverage, ranking, Telegram reasoning |
| **Saaras** (speech translation) *(stretch)* | Bridges your language ↔ the callee's when they differ |

## Documentation

| Doc | What's inside |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Product requirements — problem, user, JTBD, features, rubric mapping |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, per-call voice loop, concurrency, stack, latency budget |
| [`docs/BARGAINING.md`](docs/BARGAINING.md) | **The negotiation engine** — strategy, cross-call leverage, walk-away logic |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Postgres schema, state machine, traceability |
| [`docs/DEMO.md`](docs/DEMO.md) | The 3-minute demo script for judges |
| [`docs/RUBRIC.md`](docs/RUBRIC.md) | How Doot maps to the Sarvam × GrowthX rubric, axis by axis |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Hackathon MVP cut, milestones, and what to defer |

## Quickstart

```bash
git clone https://github.com/Aniketvish0/bargain-voice-agent.git
cd bargain-voice-agent
cp .env.example .env        # fill in Sarvam, Telegram, and telephony keys
# see docs/ARCHITECTURE.md §"Suggested stack" for the service layout
```

> ⚠️ **Critical path before you build anything:** confirm whether Sarvam ships a bundled telephony / voice-agent runtime (check the Sarvam Docs). If it does, use it and skip the media-bridge glue. If not, wire Exotel/Plivo/Twilio media streams to Sarvam's streaming ASR/TTS. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Trust & consent (built in, not bolted on)

- **AI disclosure** in the first line of every call, on behalf of a named user
- **Do-not-call** honoured and logged
- **Signed recording + transcript** for every call — so "did Doot really get that price?" is *provable*
- **No autonomous payment, no giving out your ID** — those are always yours to approve (Checkpoint C)

## License

[MIT](LICENSE)
