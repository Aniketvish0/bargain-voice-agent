# DOOT — Build Specification

**An AI that picks up the phone and haggles for you, in your language.**

Sarvam Epoch Buildathon · GrowthX · Sunday 26 July 2026
Build sprint 10:30–16:30 IST · **Freeze 16:00 · Submit 16:10** (not 16:29)

> **This is the single source of truth.** It replaces the earlier planning docs
> (`PRD.md`, `ARCHITECTURE.md`, `BARGAINING.md`, `DATA_MODEL.md`, `DEMO.md`, `ROADMAP.md`,
> `RUBRIC.md`), whose useful content has been folded in here and whose technical claims are
> corrected in §0.1. They remain in git history at commit `1f32fc3` if you need them.
> **Do not create a second spec.** Two specs and five parallel agents is how a build dies.

---

## 0.1 DECISIONS THAT OVERRIDE THE EARLIER PLANNING DOCS

If you read the original docs, or an agent was primed on them, these five things will cost you time.

> ### 🔴 BEFORE ANY OF THAT — two Sarvam defaults that silently kill the demo
>
> Both verified against primary docs today. Untuned, turn latency is **~3.4 s** and the call is
> dead. Tuned, **~1.27 s**. Full detail in §6.
>
> 1. **`reasoning_effort` is ON by default** on `sarvam-30b`/`105b`, and **reasoning tokens count
>    toward `max_tokens`.** With `max_tokens=60–100` for short spoken turns, the model burns the
>    whole budget thinking and **returns empty content**. Send `"reasoning_effort": null` on every
>    in-call completion.
> 2. **Saaras VAD frames are 512 *samples*, not milliseconds.** At Twilio's 8 kHz the default
>    `negative_frames_count=18` waits **1152 ms of silence** before admitting the vendor stopped.
>    Run STT at **16000 Hz** (frame halves to 32 ms for free — Pipecat resamples) and cut
>    `negative_frames_count` to 6. **Saves ~960 ms on every turn.**
>
> Also: **use `phonenumbers` (libphonenumber), never a hand-rolled E.164 regex.** Tested on 298 real
> Indian numbers, the regex *invented valid-looking numbers from corrupt input* — which here means
> **dialling a stranger.** See §11.

### ① Wrong Sarvam model names — fix this first, it misroutes every agent

The old docs named **Saarika**, **Sarvam-M**, and **Saaras** as three separate components. That
mapping is out of date and will send agents to deprecated endpoints.

| Old docs said | Actually use | Why |
|---|---|---|
| Saarika (streaming ASR) | **`saaras:v3`** | Saaras v3 *is* the current STT model — 23 languages, code-mixed, and it does both transcription and translation via the `mode` kwarg. Saarika is the older line. |
| Sarvam-M (LLM) | **`sarvam-30b`** live, **`sarvam-105b`** offline | Sarvam-M is the older open-weights model. 30B for in-call turns (latency), 105B for extraction and summary. Never put 105B in the live loop. |
| Saaras (speech translation) *(stretch)* | same `saaras:v3`, `mode="translate"` | Not a separate product. It's a constructor kwarg. This makes the "cross-language bridge" stretch goal nearly free. |

See §7 for the full endpoint table.

### ② The telephony open question is closed

The old `PRD.md` listed *"confirm whether Sarvam ships a telephony/voice-agent runtime"* as the biggest
unknown. **Answer: it does not, and you don't need it.**

Sarvam publishes an official Twilio integration guide using Pipecat
(`docs.sarvam.ai/api/integration/build-voice-agent-with-twilio`) with working code. That is the path.
**"Sarvam Conversations" is enterprise-only and there is nothing an on-site rep can unlock** — do not
spend the morning asking.

⚠️ **Do not evaluate Exotel or Plivo-India as the same doc suggests.** Both require business-entity
KYC (Certificate of Incorporation + GST), 1–7 business days. They are impossible today. See §10.

### ③ Twilio trial blocks `<Stream>` — this is binary, not a degradation

`<Stream>` and `<Record>` are **blocked TwiML verbs on a Twilio trial account.** There is no
half-working mode. **You must upgrade (~$20) before anything works.** Enable international
transactions in your bank app first — RBI disables it by default on new Indian cards and the decline
is silent. See §3.

### ④ Parallel calling: correct as an ambition, wrong as the MVP

The old `PRD.md` made *"fan-out, not one call"* and *real-time* cross-call leverage the star mechanic.
The leverage mechanic is absolutely right and is the best idea in the product. **But parallel is the
harder way to get it, and it is not what you should build first.**

| | Sequential (build this) | Parallel (stretch) |
|---|---|---|
| How leverage works | Call N cites call N−1's **finished, extracted** quote | Call B must cite call A's quote **mid-call**, before A has ended |
| Requires | Post-call extraction you're building anyway | Live mid-call quote extraction + shared state across concurrent pipelines |
| Sarvam constraint | None | Burst-opened sockets rejected with **close code 1003**; 3 calls = 6 sockets. Needs ≥300ms stagger (use 500ms), cap 3. Chat ceiling is **40 req/min**. |
| Demo risk | Deterministic | Non-deterministic — the citation may simply not fire |
| Wall clock | ~3× longer | ~1× |

**The judge cannot tell the difference.** What lands on stage is *"it just quoted a price it got from
a different shop ninety seconds ago"* — and sequential guarantees that line fires. Parallel only
saves wall-clock, and you are demoing one mission, not fifty.

**Build sequential. If it's green early, promote parallel.** §13 Block 5 has the prompt.

### ⑤ Checkpoint B (mid-call human escalation) — keep it, but schedule it honestly

This is not in my spec and it is a genuinely excellent idea — pausing a live call, pinging the user
on Telegram, and resuming with *"ek minute please"* is a better demo moment than anything in §18.

But cost it correctly: it needs a pause/resume path in the Pipecat pipeline, a Telegram round-trip
with an unbounded human wait, a filler-audio loop that doesn't trip the 60s Sarvam idle-close
(`keepalive_interval=5.0` handles the socket; you still need audio on the line), and a timeout branch
for when the user doesn't answer.

**Do not attempt it before the G3 gate (§17) is green.** If you get there by 14:00, build it —
it is worth more than the dashboard polish. If not, cut it without regret.

### Also worth knowing

- The old `PRD.md` targeted *"MVP running by 12:15"*. Check the clock against §17 and re-baseline out loud.
- `convex/schema.ts` is currently empty with `schemaValidation: false`. That's a defensible hackathon
  choice, but with five parallel lanes a **frozen, validated schema prevents more bugs than it
  causes**. §9 has one ready to paste. Decide once, now, and don't revisit it at 15:00.

---

## 0.2 HOW TO USE THIS DOCUMENT

This spec is written to be executed by several agents/humans working **in parallel**. Section 16
defines five lanes with **frozen interface contracts**. If you are an agent picking this up:

1. Find your lane in §16.
2. You may only write files inside your lane's directory. Touching another lane's directory is a
   merge-blocking offence.
3. The Convex schema (§9) is frozen at 10:45 and is the **only** shared surface. If you need a field
   that doesn't exist, write it into `meta: v.any()` and move on. A schema change at 15:00 breaks
   three lanes simultaneously.
4. Two things you will be tempted to do at 14:00 and must not: **rewrite the Pipecat example
   "properly"**, and **consolidate the bridge into Convex**. Both are forbidden in writing. See §16.

**If you are reading this later than 11:15**, skip to §3 (procurement) and §17 (hour-by-hour) and
compress: the go/no-go gate at §12 must still be green by 12:30 or you switch to Fallback Rung 2.

---

## 1. THE PRODUCT

*(This section absorbs the product framing from the original `PRD.md`, which has been consolidated
into this document.)*

**One line:** You tell Doot what you need to find out or buy. It finds real businesses, calls them
on the actual phone network, asks and negotiates in the language the shopkeeper speaks, and sends
you back the answer.

The name is *doot* (दूत) — an envoy sent to speak on your behalf.

### The problem

Getting one real answer out of the offline world still means **you, on the phone, one call at a
time**, usually in a language you half-speak. Eight hotels for availability and price. A plumber, a
clinic slot, a part in stock, a catering quote. The only interface is a phone number and a human who
answers in Marathi.

Because you do it serially, you **can't compare live** and you **can't play quotes against each
other**. By the fourth call you've forgotten the first, so you take a worse answer than you had to.

India's offline economy is voice-first and vernacular-first. There is no API for the family-run
hotel. **The API is a phone call in Hindi with background noise, and the pricing endpoint is a
negotiation.**

**Honest competitor:** *you, with your thumb and forty minutes.* Google Duplex made one call, in US
English, and never shipped in India.

### The job to be done

> Given a goal, a place to look, and what I care about — get me a correct, comparable answer from
> each business, negotiated where that applies, **without me making a single call.**

**Definition of done:**
1. A structured, comparable result per business — with recording and transcript.
2. A ranked comparison delivered to the user, best first.
3. A clean human handoff for the final personal step (payment, ID, confirmation).

### Human in the loop — two checkpoints, not full autonomy

| Point | When | What the user does |
|---|---|---|
| **A** | Before dialling | Approve the plan: who it calls, what it asks, target and walk-away. **Mandatory — nothing dials without a tap.** |
| **C** | At the end | Pick the winner. Doot hands over the final personal step. |
| *B (stretch)* | Mid-call | Business asks something off-policy → pause that call, Yes/No on Telegram, resume with *"ek minute please"*. **Gated behind G3** — see §0.1 ⑤. |

### Non-goals for the hackathon

No autonomous payment. No sharing the user's ID or KYC. No cold outreach at scale — one user goal, a
bounded call list, consent-first. No general-purpose assistant: **one job done deeply beats ten done
shallow.**

### Success metrics

- **Task success ≥90% across 3 repeated runs** — every business called, every required slot filled.
- **Negotiation delta** — average % below first-quoted price. This is the headline demo number.
- **Human touches ≤3 taps.**

**The demo sentence that wins:** *An AI ran a live reverse auction over the PSTN and used one
stranger's quote against another's.*

Not "an AI made a phone call" — that was 2024. The differentiator is **cross-call leverage**:
call #2 cites the real price obtained on call #1, ninety seconds earlier.

### Example mission

> User sends a Telegram **voice note in Hindi**:
> *"Karol Bagh mein 250 litre ka fridge chahiye, 25 hazaar se kam."*

Doot transcribes it, extracts `{category: refrigerator, capacity: 250L, locality: Karol Bagh,
targetPriceInr: 25000}`, finds three real electronics dealers with real phone numbers, calls them
sequentially, negotiates each in Hindi, and returns:

```
3 shops called · 6m 40s
  Sharma Electronics   ₹27,500 → ₹24,200   (-12%)
  Gupta Home Appliances ₹26,000 → ₹23,500   (-10%)   ★ BEST
  Karol Bagh Digital    ₹28,000 → ₹25,900   (-7%)

You save ₹3,200 vs. the best opening quote.
Ask for Rakesh. Price held until Tuesday 6 PM.
```

Delivered as a Telegram text table **plus a Bulbul voice note in Hindi**, plus a link to the
dashboard where every transcript is readable.

### Scope boundary

Doot **finds out and reports**. It does **not** book, reserve, pay, or commit. The agent says:
*"I'll pass this to the customer, they'll confirm directly."* This is both an ethical line and a
scope cut that saves you two hours.

---

## 1.5 MISSION TYPES — the generalisation that makes this a product

Haggling is not the only reason to call a business. Most of the time you just want to **know
something that only exists behind a phone number**:

- *Do you have a 250L fridge in stock?*
- *Table for 20 on Saturday at 8?*
- *Is the doctor taking walk-ins today?*
- *Do you deliver to 560102?*
- *Is the AC room free on the 14th?*

### The key insight: the three mission types **nest**

```
availability  ⊂  quote  ⊂  negotiate
```

They are not three products. They are **the same conversation, stopped at different points.**
`missionType` just sets where the agent stops.

| `missionType` | Conversation | Typical length | Reliability |
|---|---|---|---|
| **`availability`** | greet → disclose → **ask** → confirm → thank | 45–90 s | ⭐ highest |
| **`quote`** | …+ ask the price, don't haggle | 90–150 s | high |
| **`negotiate`** | …+ anchor, counter ×≤3, concede, close | 3–4 min | lowest |

**This is a subset, not a new feature.** Same pipeline, same Convex tables, same dashboard. What
changes is one prompt block, which slots the extractor fills, and which comparison view renders.
**Budget ~40 minutes**, and take them from the dashboard-polish budget, not from the bridge.

### Why this is worth building today

1. **It de-risks the entire demo.** An availability call is short, has no adversarial dynamic, and
   almost always succeeds. If negotiation is flaky at 16:00, **you still have a working product to
   show.** This is the cheapest insurance in the build.
2. **It widens Impact (1.5×).** Far more people need "is it in stock" than "haggle for me". Haggling
   is also socially normal in some categories and awkward in others — availability is universally
   appropriate.
3. **It makes the hotel demo one clean arc** instead of two disconnected ones (see below).
4. **It makes `learnedPrefs` visibly useful** — the Memory & Context line — because the objectives
   carry across missions ("always asks about AC", "always asks about parking").

### The unifying mechanic: **objective slots**

Every mission declares **what it must come back knowing.** The agent's job is to fill every required
slot; the CONFIRM read-back verifies them out loud. Negotiation is simply slot-filling *plus a price
policy on the money slot.*

```ts
objectives: [
  { key: "hasAcRoom",     ask: "AC room available on the 14th?", type: "boolean", required: true  },
  { key: "pricePerNight", ask: "rate per night",                 type: "money",   required: true  },
  { key: "breakfast",     ask: "is breakfast included?",         type: "boolean", required: false },
]
```

The intent extractor (`sarvam-30b`, `json_object`) produces this list from the user's one-line
request. **This is also the natural place to ask the user a clarifying question** — if a required
slot can't be inferred, the Telegram confirmation card asks for it before dialling.

> **This is why the read-back turn (§13 Block 6) is the centre of the design, not a nicety.**
> It is how *every* mission type closes: the agent reads back every filled slot in one clean
> sentence and gets a yes. One high-signal line in the transcript, for every mission type, every
> time.

### The demo consequence — one call, three acts

The hotel mission chains all three naturally, which is exactly how a human would make the call:

> **"Is there an AC room free on the 14th?"** → *availability*
> **"What's the rate per night?"** → *quote*
> **"Calangute is quoting 3,200 — can you do 3,000?"** → *negotiate*

**One phone call. Three capabilities. Zero extra demo time.** Run it as `missionType: "negotiate"`
and the earlier acts happen on the way through. If the negotiation act fails live, the first two
still landed and the call still produced a real answer.

---

## 2. HOW THIS SCORES

Judging is 50 points across six weighted parameters. Every feature below is mapped to the line it
farms. **Build the high-multiplier lines first.**

| Parameter | ×    | What literally scores it |
|---|---|---|
| **Job-to-be-done completion** | **2.5** | A real PSTN call to a real business that produces a real, lower price. Nothing else. |
| **Sarvam capability depth** (track: **Voice Experience**) | **2.5** | Eight distinct Sarvam surfaces in one flow (§7). Put them on one slide with checkmarks. |
| Creativity | 1.5 | Cross-call price citation. Mid-call language switching. |
| Impact | 1.5 | ₹ saved, minutes saved, and the compliance posture (§15) — "this is the responsible version". |
| Memory & Context | 1.0 | `learnedPrefs` carried across missions; the left-rail conversation history; the dashboard. |
| Delight | 1.0 | The Negotiation Arc component; the Bulbul voice-note reply; the live transcript typing itself. |

Scale is L1=1 … L5=5 per parameter.

**Judges perform "database spot checks and contact checks."** This is a gift, not a threat — see
the closing move in §18. Keep `record=True` on every call from 11:00 onward so by 16:00 you have a
Convex table with 8–12 genuine completed negotiations to be spot-checked.

**Pick ONE Sarvam track: Voice Experience.** Only the chosen capability scores. Do not dilute into
Document Intelligence or Dubbing.

---

## 3. WHAT YOU NEED TO PROCURE — the T+0 checklist

This is the answer to *"we need a phone number, is there anything else?"* — a phone number is not
one thing, and it is the item with the most hidden gates.

### Critical path — one person, 20 minutes, does nothing else

| # | Item | Notes |
|---|---|---|
| 1 | **Enable international transactions in your bank app, FIRST** | RBI disables intl by default on new Indian cards. A silent 3DS decline at 11:00 kills the whole day. **Carry two cards from different banks.** |
| 2 | **Twilio account → UPGRADE IMMEDIATELY (~$20)** | **Non-negotiable.** `<Stream>` and `<Record>` are *blocked TwiML verbs on trial*. There is no degraded mode — it is a binary gate. Trial also restricts you to 5 verified numbers and to your signup country. |
| 3 | **Buy a US local number** | Console → Buy a Number → filter **Address Requirement = None**. ~$1.15/mo. |
| 4 | **Geo Permissions → India, BOTH low-risk AND high-risk** | Voice → Settings → Geo Permissions. Indian *mobiles* land in the high-risk range, and high-risk requires the upgraded account. Missing this = error 21215. |
| 5 | **Ring test within 5 minutes of upgrading** | §12 has the curl. You want a fraud hold to surface at T+30, not T+300. |
| 6 | **Sarvam API key + ₹2,000 top-up** | Free credits are **₹100 ≈ 8–12 calls**. You will burn that before lunch on voice-picking alone. Top-up is self-serve INR at `dashboard.sarvam.ai/billing` — no GST, no KYC, no intl card needed. |

### Fast — next 20 minutes, in parallel

7. **Convex project** — `npm create convex@latest`, GitHub OAuth, no card. *Every laptop logs into
   Convex now, not at 14:00.*
8. **Telegram bot token** from @BotFather.
9. **ngrok authenticated** — free tier gives one auto-assigned persistent `*.ngrok-free.dev`. You
   **cannot** reserve a custom domain on free; don't go hunting for it. Install `cloudflared` as a
   hot spare — venue networks sometimes block one provider and not the other.
10. **Google Cloud project + billing enabled + Places API (New) enabled.** The billing-enable step is
    the slow part. Hard-cut at 12:30 if it isn't working (§13).
11. **Vercel account** linked to the repo.

### Things you didn't ask about but need

12. **A second physical phone** on a teammate — your guaranteed pickup, and a genuine PSTN call on
    the identical code path.
13. **Pre-arranged consent from 3 real businesses.** At lunch, walk to three shops near the venue (or
    WhatsApp three you know) and get explicit consent to be called by an AI around 17:45. Log it in
    `consentEvents`. TRAI's Feb 2025 amendment caps explicit-consent validity at 7 days, so lunchtime
    consent for an evening demo is comfortably valid.
14. **A wired earbud or lav mic into the room PA.** Never open speakerphone — see Risk 3.
15. **A recorded fallback video**, cut by 14:30.

### Explicitly forbidden today

**Do not open signup flows for Exotel, Ozonetel, Knowlarity, Plivo-India DIDs, or Telnyx
international.** All require business-entity KYC, Certificate of Incorporation + GST, and take 1–7
business days. Telnyx Level-2 verification alone is ≤48h. These are Category C — impossible today —
and an agent will waste 40 minutes discovering that.

---

## 4. ARCHITECTURE

Four processes. **Convex is the only shared surface; nothing else talks to anything else.**

```
 Telegram  ──webhook──▶  CONVEX  (httpAction @ *.convex.site)
   (voice note or text)        │
                               ├─ internalAction: Saaras batch STT   (if voice note)
                               ├─ internalAction: sarvam-30b intent extraction → brief
                               ├─ internalAction: Places searchText / leads.json → vendors[]
                               ├─ complianceGate() per vendor
                               └─ scheduler.runAfter(i * 500ms, dial)   ← 500ms STAGGER, mandatory
                                          │
                                          ▼  POST https://<ngrok>/call   (x-bridge-secret)
                               BRIDGE  (Python 3.12 · FastAPI + Pipecat · laptop behind ngrok)
                                          │
                                          ├─ twilio.calls.create(to=+91…, from=+1…,
                                          │     twiml=<Connect><Stream><Parameter name="callId"/>)
                                          ▼
                          Twilio PSTN ──mulaw/8k──▶ /ws   (TwilioFrameSerializer)
                                          │
                       ┌──────────────────┴───────────────────┐
                       │  Pipecat pipeline @ 8000 Hz          │
                       │  transport.input()                   │
                       │    → SarvamSTT(saaras:v3,            │
                       │        language="unknown",           │
                       │        mode="codemix")               │
                       │    → context.user()                  │
                       │    → SarvamLLM(sarvam-30b)           │
                       │    → SarvamTTS(bulbul:v3)            │
                       │    → transport.output()              │
                       │    → context.assistant()             │
                       └──────────────────┬───────────────────┘
                                          │ fire-and-forget POSTs
                                          │ (NEVER awaited on the audio thread — a slow
                                          │  POST becomes dead air on a live phone call)
                                          ▼
                       CONVEX   /ingest/turn · /ingest/status · /ingest/outcome · /ingest/langswitch
                                          │
                                          ▼  reactive useQuery over websocket (~100ms)
                       DASHBOARD (Vite+React)          TELEGRAM (Bulbul voice-note summary)
```

**Why the bridge is a separate process and cannot be folded into Convex:** Convex `httpAction`
handlers take a `Request` and return a `Response`. There is no socket-upgrade API. Convex
*structurally cannot* terminate a Twilio media stream. This is not a preference and it is not
negotiable at 14:00.

---

## 5. END-TO-END DATA FLOW FOR ONE CALL

| T | Step |
|---|---|
| **+0.0s** | User sends Telegram voice note: *"Karol Bagh mein 250 litre ka fridge chahiye, 25 hazaar se kam."* |
| **+0.3s** | Telegram webhook → `POST https://<dep>.convex.site/telegram`. Verify `X-Telegram-Bot-Api-Secret-Token`. **Return 200 in <100ms**, schedule the real work. |
| **+0.5s** | `internalAction`: `getFile` → download OGG from `api.telegram.org/file/bot<TOK>/<path>` → `POST https://api.sarvam.ai/speech-to-text` multipart, `model=saaras:v3`, `language_code=unknown`. **OGG/Opus is accepted directly — no ffmpeg.** ⚠️ 30-second cap on the sync endpoint. → transcript + `language_code`. **Sarvam surface ①** |
| **+1.5s** | `POST https://api.sarvam.ai/v1/chat/completions`, `model=sarvam-30b`, `response_format={"type":"json_object"}` → `{category, locality, constraints[], targetPriceInr, walkAwayInr, language}`. Insert `missions` row. **Sarvam surface ②** |
| **+2.0s** | Vendor resolution → up to 3 `vendors` rows. Each runs `complianceGate()`. **Rejected vendors still get a row, with `gateReason`** — so judges can watch the gate working. |
| **+2.5s** | `scheduler.runAfter(idx * 500, internal.calls.dial)`. The **500ms stagger is mandatory**: Sarvam rejects burst-opened sockets with close code 1003 well below the stated concurrency ceiling. |
| **+3.0s** | `dial` action → `POST https://<ngrok>/call` with the brief and `priorQuotes[]`. Bridge calls `twilio.calls.create(...)`, returns `{twilioCallSid}` → patched onto `calls`. |
| **+8.0s** | Vendor answers. Twilio opens `wss://<ngrok>/ws`, sends `event:start` with `customParameters.callId` and `mediaFormat {audio/x-mulaw, 8000, 1}`. Bridge looks up the brief by `callId`, builds the system prompt, queues `LLMRunFrame()` **so the agent speaks first**. |
| **+8.5s** | Bulbul speaks the disclosure opener. Serializer converts PCM→mulaw. Bridge fire-and-forgets `/ingest/turn`. Dashboard renders it ~100ms later. **Sarvam surface ③** |
| **+12s** | Vendor replies in Hinglish. Serializer mulaw→PCM16 → Saaras at 8kHz → `{transcript, language_code, language_probability}`. **Sarvam surface ④** — if language changed, confident, in TTS_11, and stable for 2 finals → `TTSUpdateSettingsFrame` + a `langSwitches` row. |
| **+13s** | `sarvam-30b`, `max_tokens=100` → one short counter-offer. **`priorQuotes` from earlier completed calls in this mission are in the system prompt. This is the cross-call reverse-auction moment.** Loop 8–14 turns. |
| **+230s** | Agent closes (name + hold-until + price) or hits walk-away and exits politely. `maxCallDurationSec=240` hard guard. |
| **+232s** | Twilio `StatusCallback` → `/ingest/status`. ⚠️ **form-encoded**, not JSON. `internalMutation` patches `calls` and **atomically** schedules `summarizeCall` + the next vendor. |
| **+234s** | `sarvam-105b`, `response_format=json_object` over the transcript → structured outcome → `/ingest/outcome`. **Sarvam surface ⑤** |
| **+236s** | Mayura translate → English transcript for the dashboard toggle. Transliterate → romanised line under each Devanagari bubble. **Sarvam surfaces ⑥ + ⑦** |
| **+240s** | All calls done → comparison computed → Telegram gets a **Bulbul voice note** (REST TTS @ 22050Hz, a *different* speaker from the call voice) + text table + dashboard deep link. |
| *(stretch)* | Batch Saaras with `with_diarization=True` over the Twilio recording → per-speaker talk-time metrics. **Sarvam surface ⑧** |

---

## 6. STACK — exact packages

### Bridge — Python **3.12**

Not 3.13: `audioop` was removed from the stdlib and `requires_python>=3.11` will happily let 3.13
install and then fail deep inside a dependency.

```bash
uv venv --python 3.12
uv pip install "pipecat-ai[websocket,sarvam,silero]>=1.6.0" twilio fastapi uvicorn \
               python-dotenv loguru httpx audioop-lts
```

**Start from the official example, do not write from scratch:**

```bash
git clone --depth 1 https://github.com/pipecat-ai/pipecat-examples
cd pipecat-examples/twilio-chatbot/outbound/
```

It already has `server.py`, `bot.py`, `server_utils.py`, and `/dialout → calls.create → /twiml → /ws`
wired end to end. **Swap Deepgram/Cartesia/OpenAI for the Sarvam trio and change nothing structural.**

Sarvam's own reference implementation is at
`https://docs.sarvam.ai/api/integration/build-voice-agent-with-twilio` — it uses
`pip install "pipecat-ai[websocket,sarvam]"`, launches with `python agent.py --transport twilio`,
and serves FastAPI on port 7860 at `/ws`. That guide covers the **inbound** pattern; we need
**outbound**, which is why we start from `pipecat-examples/twilio-chatbot/outbound/`.

### Backend — `convex@^1.42`

Runs on the default (non-Node) runtime. `fetch` works. **No `"use node"` directive needed.**

### Dashboard

```bash
git clone --depth 1 https://github.com/get-convex/template-react-vite-shadcn
```

Verified `npm install` + `vite build` clean. Use the plain variant, **not** `convexauth`.

Do **not** use `vercel/ai-chatbot` (hard-binds Postgres + Drizzle + Auth.js — an hour of ripping out).
Do **not** use `assistant-ui` (models an interactive composer chat; a call transcript is read-only
and two-party).

### Telegram

**No separate process.** Webhook lands directly on a Convex `httpAction`.

### Tunnel

ngrok free, auto-assigned persistent `*.ngrok-free.dev`. `cloudflared` installed as hot spare.

### Fallback LLM path

If `SarvamLLMService` misbehaves, `OpenAILLMService(base_url="https://api.sarvam.ai/v1",
model="sarvam-30b")` works and is still 100% Sarvam for judging purposes.

### The service config, frozen

```python
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.services.sarvam.llm import SarvamLLMService
from pipecat.frames.frames import TTSUpdateSettingsFrame, LLMRunFrame

stt = SarvamSTTService(
    api_key=SARVAM_KEY,
    model="saaras:v3",
    mode="transcribe",                 # constructor kwarg, NOT a Settings field. See §8(b).
    sample_rate=16000,                 # ⚠️ NOT 8000. This is the single biggest latency win
                                       #    in the whole build — see the VAD note below.
    settings={
        "language": "unknown",         # ← this is what turns on auto-detection
        "vad_signals": True,           # need START_SPEECH for barge-in
        "negative_frames_count": 6,    # default 18 → 192ms endpoint instead of 1152ms
        "negative_frames_window": 8,   # default 24
        "min_speech_frames": 2,
        "first_turn_min_speech_frames": 4,   # default 8 — vendors answer fast
        "positive_speech_threshold": 0.6,    # default 0.7 — noisy shops
        "negative_speech_threshold": 0.45,
        # Bias the recogniser toward the words we must not misrecognise:
        "prompt": f"hazaar lakh rupaye GST delivery warranty {CATEGORY} {' '.join(MUST_HAVES)}",
    },
    keepalive_interval=5.0,            # Sarvam closes idle sockets at 60s
)

tts = SarvamTTSService(
    api_key=SARVAM_KEY,
    sample_rate=8000,                  # bulbul:v3 default is 24000 — MUST override
    settings=SarvamTTSService.Settings(
        model="bulbul:v3",
        voice="anushka",
        # ⚠️ SEE OPEN QUESTION Q1 — field may be `language` or `target_language_code`
        language=Language.HI,
        pace=1.0,
        enable_preprocessing=True,     # makes prices speak as words, not digits
        min_buffer_size=30,            # faster first audio out
    ),
)

llm = SarvamLLMService(
    api_key=SARVAM_KEY,
    settings=SarvamLLMService.Settings(
        model="sarvam-30b",
        max_tokens=100,
        reasoning_effort=None,   # ⚠️⚠️ MANDATORY. See the box below. Without this your
                                 #    agent returns EMPTY STRINGS on a live phone call.
        temperature=0.4,
    ),
)

task = PipelineTask(
    pipeline,
    params=PipelineParams(
        audio_in_sample_rate=8000,
        audio_out_sample_rate=8000,
        allow_interruptions=ALLOW_INTERRUPTIONS,   # env flag — flip to False if the room is loud
    ),
)
```

**Do not set `output_audio_codec`.** It does not exist on the Pipecat service, and Sarvam's STT
WebSocket only accepts `wav | pcm_s16le | pcm_l16 | pcm_raw` inbound — mulaw is not accepted, so a
decode is unavoidable regardless. `TwilioFrameSerializer` owns both conversions.

### ⚠️ THE TWO DEFAULTS THAT WILL KILL YOUR DEMO

Both verified against Sarvam's primary docs today. Untuned, your turn latency is **~3.4 seconds** and
the call is dead. Tuned, it is **~1.27 s**. Neither fix takes more than a minute to apply.

#### ① `reasoning_effort` is ON by default — and it can return *empty content*

The `sarvam-30b` and `sarvam-105b` model pages both state reasoning is **enabled by default**, and —
the part that kills you — **reasoning tokens count toward completion tokens**. Sarvam's own docs warn:
*"a small max_tokens can be consumed entirely by reasoning."*

Your in-call turns cap `max_tokens` at 60–100 to keep spoken replies short. **The model will happily
burn that entire budget thinking and emit nothing at all.** You will see a silent phone call and an
LLM that "works fine" in curl with a bigger token cap.

> Send `"reasoning_effort": null` explicitly on **every in-call completion**. Not "low". `null`.

*(Docs conflict on the default — the chat-completions parameter reference says `medium`, the model
pages say `low`. It doesn't matter: it's on either way.)*

Note the side effect: temperature defaults differ by mode (0.5 with reasoning, 0.2 without), so set
`temperature` explicitly too.

#### ② Saaras VAD frames are measured in SAMPLES, not milliseconds

> *"One frame is 512 audio samples — 32 ms at 16 kHz, 64 ms at 8 kHz."* — Sarvam streaming STT guide

Default `negative_frames_count` is **18**. Twilio gives you 8 kHz. So the naive path waits
**18 × 64 ms = 1152 ms of silence** before it will even admit the vendor stopped talking — more than
two-thirds of your entire conversational budget, spent before the LLM is called.

Two fixes that compound:

- **Run STT at 16000 Hz, not 8000.** Because the frame is defined in *samples*, upsampling halves it
  to 32 ms **for free**. Pipecat resamples for you. The docs independently call 16 kHz the preferred
  rate. This is why §6 sets `sample_rate=16000` on the STT while the *pipeline* stays at 8000.
- **Cut `negative_frames_count` 18 → 6** and `negative_frames_window` 24 → 8.

6 × 32 ms = **192 ms**. That saves ~960 ms on *every single turn*.

⚠️ Tradeoff: 6 frames is aggressive and will cut in when a vendor pauses mid-thought. **If you hear
the agent interrupting during your first test call, step to 8 (256 ms) and re-test.** Try
`high_vad_sensitivity=true` before touching the fine-grained params.

---

## 7. SARVAM API SURFACE — the eight surfaces

Auth header: `api-subscription-key: <KEY>` on everything. `/v1/*` additionally accepts
`Authorization: Bearer <KEY>`. **Auth failure returns 403, not 401** — don't spend ten minutes
debugging a 401 you'll never see.

| # | Surface | Endpoint | Key params |
|---|---|---|---|
| ① | **Streaming STT** (phone leg) | `wss://api.sarvam.ai/speech-to-text/ws` | `model=saaras:v3`, `language-code=unknown`, `mode=codemix`, `sample_rate=8000`, `input_audio_codec=pcm_s16le`, `vad_signals=true`, `high_vad_sensitivity=false` |
| ② | **Batch STT** (Telegram voice note) | `POST https://api.sarvam.ai/speech-to-text` | multipart `file` + `model=saaras:v3`, `language_code=unknown`. Accepts OGG/Opus directly. **30s cap.** |
| ③ | **Streaming TTS** (phone leg) | `wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3` | `target_language_code`, `speaker`, `speech_sample_rate=8000`, `pace=1.0`, `min_buffer_size=30`, `enable_preprocessing=true` |
| ④ | **Chat — live loop** | `POST https://api.sarvam.ai/v1/chat/completions` | `model=sarvam-30b`, `max_tokens=100`, `temperature=0.4`, **`reasoning_effort=null`** ⚠️ |
| ⑤ | **Chat — extraction** | same | `model=sarvam-105b`, `response_format={"type":"json_object"}`, `max_tokens=4096`, **`reasoning_effort=null`** ⚠️ |
| ⑥ | **REST TTS** (Telegram voice note, voice preview) | `POST https://api.sarvam.ai/text-to-speech` | `{text, target_language_code, speaker, model:"bulbul:v3", sample_rate:22050}` → `audios[0]` base64 |
| ⑦ | **Translate (Mayura)** + **Transliterate** | `POST /translate`, `POST /transliterate` | Hindi transcript → English toggle; romanised line under Devanagari |
| ⑧ | **Batch diarized analytics** *(stretch)* | Batch STT job | `saaras:v3`, `mode=translate`, `with_diarization=True` → `SPEAKER_00/01` + `start_time_seconds` → talk-time metrics per speaker |

**Streaming TTS has no server-side cancel message.** Barge-in is client-side; Pipecat handles it.
The TTS config **is** re-sendable mid-connection and the buffer auto-flushes — that is what makes
mid-call voice switching possible.

### Speakers — no list endpoint exists, hardcode

bulbul:v3, lowercase and case-sensitive, default `shubh`:

```
anushka  shubh  aditya  ritu  priya  neha  rahul  pooja
simran   kavya  ishita  shreya  anand  tanya  suhani  rupali
```

23 male + 14 female voices exist in total. **Ship 6–8 curated in the picker, not 39.**
⚠️ **v2 and v3 speaker sets are not interchangeable.**

### Rate limits and money — Starter tier

| Limit | Value |
|---|---|
| STT WebSocket concurrency | 20 |
| TTS WebSocket concurrency | 30 (bulbul:v3 — halved vs v2) |
| bulbul:v3 REST | 30 req/min |
| **sarvam-30b / 105b chat** | **40 req/min** ← the real ceiling for 3 parallel calls |
| **`max_tokens` ceiling** | **Plan-capped: Starter 4096 · Pro 8192 · Business 64000.** Fine for in-call turns at 60–100; confirm your tier before designing the extraction call, since 105B Starter is also 4096. |
| Burst behaviour | **Sockets opened in a burst are rejected below the stated ceiling, close code 1003. Space ≥300ms. We use 500ms.** |

Pricing: STT ₹30/hr · bulbul:v3 ₹30/10K chars · 30B ₹2.5 per 1M tok · 105B ₹10 per 1M tok.
Free credits ₹100 ≈ 8–12 four-minute calls.

**Running out of Sarvam credits at 15:00 is a more probable death than the Twilio card, and nobody
budgets for it. Top up ₹2,000 at T+0:10.**

### Free time-savers

- MCP server: `https://docs.sarvam.ai/_mcp/server` — wire it into Claude Code
- Append `.md` to any Sarvam docs URL for clean markdown
- `https://docs.sarvam.ai/llms-full.txt`
- Cookbook: `github.com/sarvamai/sarvam-ai-cookbook` — **the LiveKit "Collection Agent" recipe is
  structurally a negotiator**, read it
- Discord `discord.com/invite/5rAsykttcs` — Sarvam staff are likely live during the buildathon

---

## 8. LANGUAGE DETECTION AND SWITCHING — the complete answer

You asked whether the agent can detect the callee's language and adapt, rather than the user picking
it up front. **Yes — and it's native, not custom.** Do both: auto-detect with a manual override.

### (a) Detect

Set `language-code=unknown` on the STT socket. Every response then carries `language_code` (BCP-47)
and `language_probability` (0–1).

⚠️ **These fields are populated *only* when the param is omitted or set to `unknown`.** Pass a
specific code and detection is skipped and probability comes back null. Detection is per-utterance,
so no reconnection is needed when the speaker changes.

### (b) `transcribe` vs `codemix` — ship `transcribe`, revisit only if you have time

`mode="codemix"` returns Indic words in native script and English words in Latin:

> `मेरा phone number है 9840950950`

That is how a shopkeeper actually speaks and it demos beautifully. **But ship `transcribe`.**

**Reason: numerals.** `transcribe` gives native script with the best accuracy on numbers, and in this
product **the number is the entire deliverable.** A prettier transcript that misreads
*"चौबीस हज़ार पाँच सौ"* as 24,000 loses you the Job-to-be-done score, which is the 2.5× line.
Sarvam's own IVR guide also recommends plain `transcribe`.

Keep `STT_MODE` as an env var so it is a one-word flip. If you have spare time, run the Q3 experiment
and consider using `codemix` **only for the displayed transcript** while `transcribe` feeds the LLM —
you get the visual flex without risking the extraction.

Also pass the `prompt` param to bias the recogniser toward the words you cannot afford to lose:

```python
"prompt": f"hazaar lakh rupaye GST delivery warranty {CATEGORY} {' '.join(MUST_HAVES)}"
```

### (c) Reply in the detected language

`TTSUpdateSettingsFrame(language=…, voice=…)` is a first-class Pipecat frame. ~20 lines total.
**Gate it hard or it flaps every turn:**

```python
TTS_11 = {"hi-IN","en-IN","bn-IN","gu-IN","kn-IN","ml-IN",
          "mr-IN","od-IN","pa-IN","ta-IN","te-IN"}

VOICE = {"hi-IN":"anushka", "ta-IN":"kavya",  "te-IN":"ishita", "kn-IN":"priya",
         "mr-IN":"neha",    "bn-IN":"shreya", "ml-IN":"rupali", "gu-IN":"pooja",
         "pa-IN":"tanya",   "od-IN":"suhani", "en-IN":"anand"}

async def on_final(d):                       # d = STT data payload
    lang = d.get("language_code")
    conf = d.get("language_probability") or 0.0
    if lang not in TTS_11 or lang == state.lang or conf < 0.80:
        state.streak = 0
        return
    state.streak += 1
    if state.streak < 2:                     # hysteresis: 2 consecutive confident finals
        return
    await task.queue_frame(TTSUpdateSettingsFrame(language=lang, voice=VOICE[lang]))
    await ingest_lang_switch(state.callId, state.lang, lang, conf)
    state.lang, state.streak = lang, 0
```

### The asymmetry you must respect

**STT covers 23 languages. TTS covers 11.** You can transcribe Maithili, Kashmiri or Santali and you
**cannot answer in them**. Membership in `TTS_11` is checked before any switch, and the demo is
constrained to those 11 — otherwise your flagship feature fails live on stage.

### Why this architecture is forced, not chosen

Neither STT WebSocket channel accepts a language reconfiguration mid-stream —
`/speech-to-text/ws` has no config message at all, and `/speech-to-text-translate/ws`'s config
carries only `prompt`. So **STT-auto-detect + TTS-reconfigure is the only shape that works.**

For typed Telegram requests, run `POST /text-lid` to pick the initial call language.

**On stage, say: "it just changed language because he did."** Nobody else will demo this.

---

## 9. CONVEX SCHEMA — frozen at 10:45, never renegotiated

Lane B owns this file. Every other lane reads it.

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The 11 TTS languages. STT knows 23; never emit outside this set.
const TTS_LANG = v.union(
  v.literal("hi-IN"), v.literal("en-IN"), v.literal("bn-IN"), v.literal("gu-IN"),
  v.literal("kn-IN"), v.literal("ml-IN"), v.literal("mr-IN"), v.literal("od-IN"),
  v.literal("pa-IN"), v.literal("ta-IN"), v.literal("te-IN"));

export default defineSchema({
  users: defineTable({
    tgUserId: v.string(),
    displayName: v.optional(v.string()),
    preferredLang: TTS_LANG,
    preferredVoice: v.string(),
    learnedPrefs: v.array(v.string()),   // ← Memory & Context rubric. Injected verbatim into prompts.
    totalSavedInr: v.number(),
    createdAt: v.number(),
  }).index("by_tg", ["tgUserId"]),

  sessions: defineTable({                // the entire auth system. See Contract 5.
    token: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  missions: defineTable({
    userId: v.id("users"),
    rawRequest: v.string(),
    inputMode: v.union(v.literal("voice"), v.literal("text")),
    // See §1.5 — availability ⊂ quote ⊂ negotiate. Controls where the conversation stops.
    missionType: v.union(v.literal("availability"), v.literal("quote"), v.literal("negotiate")),
    brief: v.object({
      category: v.string(),
      locality: v.string(),
      constraints: v.array(v.string()),
      // Objective slots the agent must come back having filled. §1.5.
      objectives: v.array(v.object({
        key: v.string(),          // "hasAcRoom"
        ask: v.string(),          // "AC room available on the 14th?"
        type: v.union(v.literal("boolean"), v.literal("money"),
                      v.literal("date"), v.literal("number"), v.literal("text")),
        required: v.boolean(),
      })),
      // Only meaningful when missionType === "negotiate".
      targetPriceInr: v.optional(v.number()),
      walkAwayInr: v.optional(v.number()),
      language: TTS_LANG,
    }),
    status: v.union(v.literal("pending"), v.literal("discovering"),
                    v.literal("calling"), v.literal("done"), v.literal("failed")),
    bestCallId: v.optional(v.id("calls")),
    savedInr: v.optional(v.number()),
    summaryText: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_user_created", ["userId", "createdAt"])
    .index("by_status", ["status"]),

  vendors: defineTable({
    missionId: v.id("missions"),
    name: v.string(),
    phoneE164: v.string(),
    address: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    source: v.union(v.literal("curated"), v.literal("places")),  // for the judges' contact check
    rank: v.number(),
    gatePassed: v.boolean(),
    gateReason: v.optional(v.string()),   // show the compliance gate working
  }).index("by_mission_rank", ["missionId", "rank"])
    .index("by_phone", ["phoneE164"]),

  calls: defineTable({                    // COLD table. ~6 patches per call, total.
    missionId: v.id("missions"),
    vendorId: v.id("vendors"),
    userId: v.id("users"),
    phoneE164: v.string(),
    fromNumber: v.string(),
    status: v.union(v.literal("queued"), v.literal("dialing"), v.literal("ringing"),
                    v.literal("talking"), v.literal("closed"),
                    v.literal("no_answer"), v.literal("failed")),
    twilioCallSid: v.optional(v.string()),
    lang: TTS_LANG,
    voice: v.string(),
    detectedLangs: v.array(v.string()),
    // Generic slot answers — works for every missionType. §1.5.
    slots: v.array(v.object({
      key: v.string(),
      value: v.any(),                         // boolean | number | string
      valueVerbatim: v.optional(v.string()),  // what was actually said — cross-check source
      confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
      turnSeq: v.optional(v.number()),        // links the answer to its transcript line
    })),
    openingQuoteInr: v.optional(v.number()),  // ← the negotiation ARC, not just a price
    finalQuoteInr: v.optional(v.number()),
    effectivePriceInr: v.optional(v.number()), // quote + delivery + GST. RANK ON THIS. §13.
    quoteTurnSeq: v.optional(v.number()),     // links the price to its transcript line
    terms: v.optional(v.string()),
    contactName: v.optional(v.string()),
    holdUntil: v.optional(v.string()),
    closed: v.optional(v.boolean()),
    recordingUrl: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    meta: v.optional(v.any()),              // ← escape hatch. Use this instead of changing the schema.
  }).index("by_mission", ["missionId"])
    .index("by_sid", ["twilioCallSid"])
    .index("by_status", ["status"])
    .index("by_from_time", ["fromNumber", "startedAt"]),

  turns: defineTable({                    // append-only. FINALS ONLY. Never one row per ASR chunk.
    callId: v.id("calls"),
    seq: v.number(),
    role: v.union(v.literal("agent"), v.literal("vendor"), v.literal("system")),
    text: v.string(),
    textEn: v.optional(v.string()),
    romanized: v.optional(v.string()),
    langCode: v.optional(v.string()),
    langProbability: v.optional(v.number()),
    sarvamRequestId: v.optional(v.string()),  // audit trail — proves a real API call to a judge
    tsMs: v.number(),
  }).index("by_call_seq", ["callId", "seq"]),

  callLive: defineTable({                 // HOT. Exactly one row per call. Max 4 Hz.
    callId: v.id("calls"),
    partialText: v.string(),
    partialRole: v.union(v.literal("agent"), v.literal("vendor")),
    nextSeq: v.number(),
    updatedAt: v.number(),
  }).index("by_call", ["callId"]),

  langSwitches: defineTable({             // demo this table live
    callId: v.id("calls"),
    atMs: v.number(),
    fromLang: v.string(),
    toLang: v.string(),
    confidence: v.number(),
  }).index("by_call", ["callId"]),

  consentEvents: defineTable({
    callId: v.optional(v.id("calls")),
    phoneE164: v.string(),
    language: v.string(),
    channel: v.union(v.literal("prearranged"), v.literal("on_call")),
    disclosureText: v.string(),
    calleeResponse: v.optional(v.string()),
    consentGiven: v.boolean(),
    atMs: v.number(),
  }).index("by_phone", ["phoneE164"]),

  dnc: defineTable({                      // global, permanent, honoured across all users
    phoneE164: v.string(),
    reason: v.string(),
    callId: v.optional(v.id("calls")),
    atMs: v.number(),
  }).index("by_phone", ["phoneE164"]),

  chatMessages: defineTable({
    userId: v.id("users"),
    missionId: v.optional(v.id("missions")),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    audioStorageId: v.optional(v.id("_storage")),
    surface: v.union(v.literal("telegram"), v.literal("web")),
    createdAt: v.number(),
  }).index("by_user_created", ["userId", "createdAt"]),
});
```

### Two rules enforced in review

1. **The only function allowed to write during a live call is `internal.transcripts.applyBatch`**,
   at ≤4 Hz, touching exactly one `callLive` doc. Patching `calls.turnCount` on every chunk causes
   OCC conflict storms and burns through the 1M free function calls.
2. **The dashboard subscribes to two queries**, not one: `turns` (cold, re-runs only on finals) and
   `livePartial` (hot, reads a single doc). It renders `[...turns, partial]`.

---

## 10. THE TELEPHONY DECISION

### DECIDED: Twilio, upgraded, US +1 caller ID → +91, `<Connect><Stream>`, Pipecat bridge.

Twilio's India Voice Guidelines, verbatim: *"Outbound calls to India can only be made from
international (non-Indian) numbers."* A US caller ID dialling +91 is the **documented, supported
path**. No KYC, no DLT, no GST, no Certificate of Incorporation.

The June 2026 SHAKEN/STIR + Trust Hub tightening applies to calls **terminating in the US** —
international calls take Level C attestation and sit outside it.

An Indian +91 caller ID is **unobtainable at any price today**, and +91→+91 has been hard-blocked
since 2024-08-01.

⚠️ **CLI spoofing is a cognizable, non-bailable offence under s.42(3)(c) of the Telecommunications
Act 2023. Never.**

### The go/no-go ring test — run at T+25, within 5 minutes of upgrading

```bash
curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$SID/Calls.json" \
  --data-urlencode "To=+919XXXXXXXXX" \
  --data-urlencode "From=$US_NUM" \
  --data-urlencode 'Twiml=<Response><Say>Namaste. Telephony works.</Say></Response>' \
  -u "$SID:$TOKEN"
```

| Result | Meaning |
|---|---|
| `21215` | Geo permissions — go enable India high-risk |
| `21264` | You are still on trial — the upgrade didn't take |
| Created but silent | Carrier-side. Try a number on a different operator. |

### Call-create parameters — frozen

```python
twilio.calls.create(
    to=phone,
    from_=US_NUM,
    twiml=f'<Response><Connect><Stream url="wss://{NGROK}/ws">'
          f'<Parameter name="callId" value="{callId}"/>'
          f'</Stream></Connect></Response>',        # ≤4000 chars
    record=True,          # judge spot-check + fallback footage. Free. Do this from 11:00 onward.
    timeout=12,           # ring budget, then move on to the next vendor
    status_callback=f"{CONVEX_SITE}/ingest/status",
    status_callback_event=["initiated", "ringing", "answered", "completed"],
)
```

⚠️ **No `MachineDetection`.** Synchronous AMD holds the callee in silence for several seconds before
your TwiML executes, and *causes* the hangups it was meant to prevent. If voicemail becomes a real
problem, use `async_amd=True` + `async_amd_status_callback` — never the synchronous flag. For three
pre-consented calls, AMD is pure downside.

### Fallback ladder — each rung has an owner and a decision time

| # | Rung | Trigger | Build cost | Notes |
|---|---|---|---|---|
| **1** | Twilio + `<Connect><Stream>` + Pipecat/Sarvam streaming | default | — | Sub-1.5s turns, barge-in |
| **2** | Twilio + `<Play>`/`<Record>` turn loop, **100% inside Convex** | G3 not green by **12:30** — the integrator decides alone, no committee | 60–90 min | No ngrok, no bridge process, no resampling. `ctx.storage.getUrl()` is public so Twilio can `<Play>` it. Batch Saaras + REST Bulbul. ~3–5s/turn, which reads as "the agent is thinking". Same prompt, same schema, same dashboard. **Still needs the paid account** — `<Record>` is also trial-blocked. |
| **3** | Plivo international | Twilio account suspended (no same-day appeal) | 45 min | **Warm the signup at T+0, don't wait.** `<Stream bidirectional="true" contentType="audio/x-l16;rate=8000">` — **L16, so no mulaw conversion at all.** With `bidirectional="true"`, `audioTrack` must not be `outbound`/`both`. An official Plivo+Pipecat+Sarvam guide exists. +$0.004/min. |
| **4** | Browser "vendor" tab (MediaRecorder → same Saaras/30b/Bulbul loop) + one recorded real PSTN call as evidence | no PSTN by 14:00 | 30 min | **Say out loud what it is.** Keeps 100% of Sarvam depth, loses some job-to-be-done. |
| **✗** | Exotel / Ozonetel / Knowlarity / Plivo-India DIDs / Telnyx intl / any +91 origination | — | — | **Category C. Forbid anyone from opening these signup flows today.** |

### Who we call

**Pre-consented businesses only.** See §3 item 13. One teammate in the corridor on a real phone is
the hot spare — that is still a genuine PSTN call on the identical code path, and **saying so out
loud scores better than hiding it**.

---

## 11. CONTACT DISCOVERY — finding real phone numbers

### DECIDED: run two tracks from minute zero. OSM seed is the floor; Places is the upgrade.

**This section was rewritten after live testing today.** An earlier draft called OpenStreetMap
coverage "poor" and made Places the primary. That was wrong for the seed use case: a researcher ran
an Overpass query today and **pulled 117 real Indian businesses with validated E.164 numbers in
60 seconds, with no API key, no billing, and no signup.**

| Track | Owner | Time | Risk |
|---|---|---|---|
| **A — Google Places (New)** | one person | 20 min | **Blocking.** Billing is a hard gate. |
| **B — OSM Overpass seed** | one person | 30 min | **Zero.** No key, no billing, no signup. |

**Run B first.** Then `find_vendors()` tries Places and silently falls back to the Convex seed.
Judges doing database spot-checks see real, dialable +91 numbers either way.

### ⚠️ Measured coverage — this changes your demo

Actual OSM phone-number counts pulled today:

| Query | Usable numbers |
|---|---:|
| **Goa hotels** | **82** ✅ |
| HSR Layout restaurants | 32 ✅ |
| **Karol Bagh appliance/electronics** | **3** ❌ |

**Your headline "250L fridge in Karol Bagh" demo is your single weakest category.** Small electronics
dealers barely exist in OSM (~13% phone coverage vs 34.8% for Goa hotels).

> **Lead the demo with the Goa hotel query, not the fridge.** It is the same product, the same code
> path, and the same negotiation — with 27× the data behind it. Keep the fridge as the second
> example only if Places billing comes through, or hand-curate ~8 Karol Bagh dealers into
> `leads.json`.

### Track B — the OSM seeder

⚠️ **`overpass-api.de` was returning HTTP 504 on every request today (26 Jul 2026).**
`https://overpass.kumi.systems/api/interpreter` worked every time. **The seeder must rotate mirrors
or Track B dies too.**

Query shape — nodes and ways with a phone tag, inside a bounding box:

```
[out:json][timeout:60];
(
  node["tourism"="hotel"]["phone"](15.2,73.7,15.6,74.0);
  way ["tourism"="hotel"]["phone"](15.2,73.7,15.6,74.0);
  node["tourism"="hotel"]["contact:phone"](15.2,73.7,15.6,74.0);
  way ["tourism"="hotel"]["contact:phone"](15.2,73.7,15.6,74.0);
);
out center tags;
```

Read **both** `phone` and `contact:phone` — Indian POIs use them interchangeably and reading only one
halves your yield.

### ⚠️ Use libphonenumber. Do NOT hand-roll the E.164 regex.

An earlier draft of this document contained a hand-rolled `toE164()` regex. **Delete it.** Tested
against 298 real Indian phone strings, `phonenumbers` (libphonenumber) won 296/298 — and both
differences were the regex **inventing a valid-looking number out of corrupt input.**

In this product, that means **dialling a stranger.** This is a safety bug, not a style preference.

```python
import phonenumbers

def to_e164(raw: str) -> str | None:
    try:
        n = phonenumbers.parse(raw, "IN")
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(n):
        return None
    return phonenumbers.format_number(n, phonenumbers.PhoneNumberFormat.E164)
```

**Never infer mobile-vs-landline from the first digit** — that heuristic is proven false for Indian
numbering. Use `phonenumbers.number_type(n)` if you need it.

### Track A — Google Places API (New)

⚠️ **Enable "Places API (New)", NOT the legacy "Places API".** Legacy is deprecated and can no
longer be newly enabled; picking the wrong one yields `SERVICE_DISABLED` and eats 20 minutes of
confused debugging.

⚠️ **Billing is a hard gate.** Verified live today: no key → `403 PERMISSION_DENIED` *"Method doesn't
allow unregistered callers"*; bad key → `400 INVALID_ARGUMENT` / `API_KEY_INVALID`.

Free tier: **~7,000 Enterprise-SKU calls/month on India billing** — vastly more than a hackathon
needs. *(Google replaced the flat $200 credit with per-SKU allowances in March 2025; verify the
current number in your console rather than trusting any doc.)*

**The endpoint**

```
POST https://places.googleapis.com/v1/places:searchText
Content-Type: application/json
X-Goog-Api-Key: $GOOGLE_PLACES_KEY
X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,
                  places.nationalPhoneNumber,places.internationalPhoneNumber,
                  places.rating,places.userRatingCount,places.businessStatus,
                  places.googleMapsUri
```

```json
{
  "textQuery": "electronics shops selling refrigerators in Karol Bagh Delhi",
  "regionCode": "IN",
  "languageCode": "en",
  "maxResultCount": 10,
  "locationBias": {
    "circle": { "center": {"latitude": 28.6519, "longitude": 77.1909}, "radius": 3000.0 }
  }
}
```

**The single most important fact:** `internationalPhoneNumber` and `nationalPhoneNumber` are in the
**Enterprise** field-mask SKU, not Essentials or Pro. Requesting them promotes the whole request to
the Enterprise tier and its price. **Good news: you get the phone number directly in `searchText` —
no second Place Details round-trip per result.** Ask for the phone in the field mask and you're done
in one call.

⚠️ **Billing must be enabled on the GCP project or the API returns `REQUEST_DENIED` regardless of
key validity.** This is the slow step. Start it at T+0 and hard-cut at **12:30** if it isn't green.

⚠️ Google replaced the old flat $200/month credit with a per-SKU monthly free allowance in March
2025. Verify your current quota in the console rather than trusting a number from a blog post — but
either way, a hackathon's worth of requests is free. **Confidence: medium. Verify in console, don't
debug from docs.**

### Ranking and filtering

```ts
const vendors = places
  .filter(p => p.businessStatus === "OPERATIONAL")
  .filter(p => p.internationalPhoneNumber)          // no phone = useless to us
  .filter(p => (p.userRatingCount ?? 0) >= 5)       // kills ghost listings
  .sort((a, b) => (b.rating ?? 0) * Math.log1p(b.userRatingCount ?? 0)
                - (a.rating ?? 0) * Math.log1p(a.userRatingCount ?? 0))
  .slice(0, 3);
```

### India coverage on Places

Better than OSM — Places ingests Google Business Profile, which Indian SMBs actively claim for
WhatsApp and calls. But **Google publishes no coverage statistic and no credible third-party
measurement exists**, so treat any specific number as unverified. Expect strong coverage for hotels,
restaurants and branded retail; weaker for kirana and market-stall vendors.

### The demo floor: `leads.json` — Lane E, first deliverable

**Build this before you build the Places integration.** It removes the GCP billing screen from your
critical path entirely. Seed it from the OSM run, then hand-verify.

15–20 businesses, weighted toward the categories that actually have coverage, each personally
checked to have a working number:

```json
[
  {
    "category": "refrigerator",
    "locality": "Karol Bagh, Delhi",
    "name": "Sharma Electronics",
    "phoneE164": "+9111XXXXXXXX",
    "address": "…",
    "sourceUrl": "https://maps.google.com/…",
    "source": "curated",
    "consentObtained": true
  }
]
```

`source: "curated"` vs `"places"` is a real field in the `vendors` table, so when a judge asks
"where did this number come from?" the answer is on screen.

### Rejected alternatives — do not spend time here

| Option | Verdict |
|---|---|
| **Justdial / IndiaMART scraping** | **Trap.** Cloudflare-class protection plus DPDP Act exposure. A commercial "Justdial Scraper API" industry exists *precisely because* this is not a 6-hour job. |
| **Yelp Fusion** | India unsupported. Verified. |
| **Zomato / Swiggy / MMT APIs** | No open public API for phone numbers. |

*(OpenStreetMap is no longer on this list — it was promoted to the primary seed above.)*

---

## 12. TELEGRAM LAYER

### Architecture: Convex `httpAction` **is** the webhook. No separate process.

⚠️ **`httpAction`s live at `https://<deployment>.convex.site` — NOT `.convex.cloud`.** Registering
the webhook against `.convex.cloud` silently 404s and you will lose twenty minutes.

**Use raw `fetch` against `api.telegram.org`, not grammY.** grammY needs an adapter shim to run in
Convex's runtime; for six hours, four raw fetch calls (`sendMessage`, `editMessageText`, `getFile`,
`sendAudio`) are fewer moving parts than a framework.

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/telegram",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    // 1. Verify the secret. Telegram sends it as a header on every update.
    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== process.env.TG_WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await req.json();

    // 2. Schedule the real work and return 200 IMMEDIATELY.
    //    Telegram retries aggressively if you are slow. Never await Sarvam here.
    await ctx.scheduler.runAfter(0, internal.telegram.handleUpdate, { update });
    return new Response(null, { status: 200 });
  }),
});

export default http;
```

**Register it once:**

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<dep>.convex.site/telegram" \
  -d "secret_token=$TG_WEBHOOK_SECRET" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"
```

### Voice-note input — a Sarvam-depth scoring surface, build it

```
message.voice.file_id
  → GET api.telegram.org/bot<TOK>/getFile?file_id=…      → { file_path }
  → GET api.telegram.org/file/bot<TOK>/<file_path>       → OGG/Opus bytes
  → POST api.sarvam.ai/speech-to-text  (multipart)       → transcript + language_code
```

✅ **Telegram delivers OGG/Opus and Sarvam STT accepts OGG/Opus directly. No ffmpeg. No transcode.**
Confirmed twice: Sarvam's own integration guide, and the OpenAPI format enum.

⚠️ **The REST STT endpoint hard-caps at 30 seconds.** Guard on `msg.voice.duration` **before** you
spend the API call — write this in the first five minutes of the handler, not after it fails on
stage:

```ts
if (msg.voice.duration > 28) {
  return reply("Thoda chhota rakhiye — 25 seconds mein bata dijiye kya chahiye 🙏");
}
```

### The five Telegram traps — all two-line guards, write them the first time

1. ⚠️ **`npx convex env set`, not a local `.env`.** Convex env vars must be set on the **deployed**
   deployment or `process.env.TELEGRAM_BOT_TOKEN` is `undefined` in production httpActions and every
   call 404s with a confusing *"Not Found"* from `api.telegram.org`. **This is the single most common
   way this lane loses 30 minutes.**
2. ⚠️ **Telegram retries any non-2XX response.** If `handleUpdate` throws inside the *httpAction*
   rather than inside the *scheduled action*, one bug **re-triggers outbound PSTN calls repeatedly at
   real money cost.** The try/catch-return-200 wrapper is not optional here.
3. **`callback_data` has a 64-byte ceiling.** Store an id, not a payload.
4. **`400: message is not modified`** on the live ticker — compare before editing.
5. **A voice note outside the TTS-11** (Urdu, Assamese, Maithili) detects fine and then has no voice
   to answer in. **Sarvam's own judges will absolutely try this.** Explicit fallback map to `hi-IN`.

### Suggested file split — one agent owns the lane end to end

`convex/http.ts` (router + secret + dedupe + schedule, ~60 lines) ·
`convex/tgApi.ts` (9-method fetch client, ~80) ·
`convex/telegram.ts` (commands, voice ingest, callback gate, ~250) ·
`convex/liveCard.ts` (the 1.5s ticker) · `convex/voiceOut.ts` (Bulbul → sendVoice)

**Sequence it:** get `/start` echoing green *first* — a broken webhook at 15:00 is unrecoverable.
Then the voice-note → STT → brief → confirmation-card path, which is **the highest-scoring 45
minutes in the entire build** (Sarvam depth 2.5× + Job-to-be-done 2.5× + Delight 1×, all at once).
The live ticker has zero dependency on the bridge being finished — it just reads rows.

### Live call updates — one message, edited, debounced

**Telegram rate limits:** roughly **1 message per second per chat** and ~30/sec globally.
`editMessageText` counts against the same budget. Editing to identical text returns
`400: message is not modified`.

**Strategy:** send **one** message when the call starts, then `editMessageText` on it at **most once
per second**, re-rendering the last ~6 turns. Never one message per turn — a 14-turn call would
blow the per-chat limit and spam the user.

```ts
// Debounce in Convex: a mutation stamps `pendingRender`, and a single scheduled
// action 1000ms later reads the latest state and does ONE edit.
// Guard against the identical-text error before calling editMessageText.
if (rendered === lastRendered) return;
```

### Voice-note output — the one real format mismatch

`sendVoice` requires **OGG encoded with OPUS**. `sendAudio` requires **MP3 or M4A**. Bulbul REST
returns **WAV** base64. **Convex cannot run ffmpeg.**

**But Bulbul may be able to emit Opus directly** — `output_audio_codec: "opus"` exists and is
undocumented as to container. Ogg-Opus → `sendVoice` works; WebM or raw → `sendVoice` 400s.

> **Run this 2-minute probe before 11:00 and hardcode the winning branch:**
> request `output_audio_codec: "opus"` from Bulbul REST, write the bytes to a file, check the magic
> bytes (`OggS` = Ogg container), and try `sendVoice`.

**Decision tree:** Ogg-Opus → `sendVoice`, done. Anything else → add a 15-line `POST /tts-ogg` to the
bridge (Python, which *can* run ffmpeg). **Bridge not up → `sendDocument`**, which accepts any format
and always works.

Do not spend more than 10 minutes on this; it is a Delight point, not a rubric line.

### UX and commands

| Command | Behaviour |
|---|---|
| `/start` | Create user, issue dashboard deep link |
| free text / voice note | Parse intent → show a **confirmation card** → dial |
| `/history` | Last 5 missions with savings |
| `/language` | Inline keyboard: 6 curated languages + "Auto-detect ★" |
| `/stop` | Kill all in-flight calls for this user |

**The confirmation gate is mandatory** — never dial without one tap. Inline keyboard:

```
📋 Karol Bagh · 250L fridge
   Target ₹25,000 · Walk away ₹27,000
   3 shops found

   [ 📞 Call all 3 ]  [ ✏️ Edit ]  [ ✖️ Cancel ]
```

This is both good UX and your answer when a judge asks about autonomy: **a human authorises every
call.**

### Dashboard linking — 20 minutes, no OAuth

Bot inserts a `sessions` row and DMs `https://<app>/?t=<token>`. Dashboard stores it in
`localStorage`, passes `token` to every query, and `requireSession(ctx, token)` validates it via the
`by_token` index.

**No Clerk** (45 minutes of OAuth callback config you do not have). **No Convex Auth** (officially
beta). Say out loud that tokens appear in function args and logs — fine for a demo, not production.

---

## 13. THE NEGOTIATION BRAIN

**This is worth more than any UI work and is under-resourced at every hackathon.** Lane E owns it
from 12:30 and does nothing else until 14:00.

### Structure — six blocks, under 500 tokens total, `max_tokens=100`

#### Block 1 — Identity and mandatory disclosure (first 4 seconds)

Order matters: **buyer intent first** (keeps the shopkeeper on the line), **disclosure second**,
**consent question third**.

> नमस्ते! मैं **{{userFirstName}}** जी की तरफ़ से बात कर रहा हूँ — उन्हें **{{ask}}** चाहिए।
> एक बात पहले बता दूँ, मैं एक **AI असिस्टेंट** हूँ और यह कॉल रिकॉर्ड हो रही है।
> क्या मैं आगे बात करूँ?

English equivalent:

> Hello! I'm calling on behalf of **{{userFirstName}}** — they're looking for **{{ask}}**.
> Quick heads-up: I'm an **AI assistant**, and this call is being recorded.
> Is it alright if I continue?

TRAI's Feb 2025 amendment classifies AI-generated voices as "artificial" voices under robocall
rules. **Disclosure costs three seconds, removes the entire ethical objection, and converts your
biggest liability into an Impact talking point.**

#### Block 2 — Objectives, and the BATNA

**Always present — this is the slot list from §1.5:**

```
You must come back knowing these. Ask them one at a time, in this order:
{{#objectives}}
  - {{ask}}{{#required}}  (REQUIRED){{/required}}
{{/objectives}}
Do not move on until every REQUIRED item has a clear answer.
If they cannot answer one, say so plainly rather than guessing.
```

**Appended only when `missionType === "negotiate"`:**

```
Target ₹{{targetPriceInr}}. Walk-away ₹{{walkAwayInr}}.
If they will not go below the walk-away price, thank them politely and end the call.
```

⚠️ **For `availability` and `quote` missions, Blocks 3, 4 and 5 are omitted entirely.** The agent
asks, confirms, and thanks. Do not let a `quote` mission drift into haggling — it makes short calls
long and is the fastest way to get hung up on.

#### Block 3 — Anti-anchoring

```
Ask THEIR rate first. Never state your budget before they name a number.
Never accept the first price.
```

#### Block 4 — Concession ladder

```
Make at most 3 counter-offers.
First counter ≈ 80% of their opening. Then 88%. Then 94%.
Never move twice without them moving once.
```

#### Block 5 — Cross-call leverage · **the money shot**

Injected **only** from actual Convex rows:

```
{{#priorQuotes}}
A real competing quote exists — you may cite it:
"{{shop}} में यही ₹{{priceInr}} में मिल रहा है।"
{{/priorQuotes}}
```

⚠️ **Hard rule: if `priorQuotes` is empty, the model must state it has no competing quote.**
A fabricated quote is misrepresentation exposure under CPA 2019 / s.318 BNS, and it is the single
thing that would turn a clever agent into fraud.

**This is why calls are SEQUENTIAL, not parallel.** Call N is strictly stronger than call N−1
because it carries a real, verifiable price obtained ninety seconds earlier. Parallelism would buy
you 90 seconds of wall-clock and cost you the entire product thesis.

#### Block 6 — Close artifact, and the **read-back** ⭐

```
Before hanging up, obtain:
  (a) the contact person's name
  (b) how long the price is held
  (c) availability
Then read the whole deal back as ONE clean sentence and ask them to confirm.
```

> **This is the single highest-leverage design decision in the build, and it is one extra turn.**
>
> *"तो: चौबीस हज़ार पाँच सौ, GST के साथ, मंगलवार डिलीवरी — सही है?"*
>
> Most implementations break at extraction because they treat the transcript as **given** and then
> try to parse a messy four-minute code-mixed conversation. **Engineer the transcript instead.**
> The read-back guarantees that exactly one high-signal, unambiguous sentence containing every field
> you need exists in the record. Extraction accuracy on that single line is far higher than on the
> whole call.
>
> It also does double duty as a genuine UX courtesy and as proof-of-agreement for the judges.

### Style constraints — this is what makes it sound human

- **One question per turn.** Never two.
- **Under two sentences per turn.** This is a phone call being fed to TTS — no markdown, no lists,
  no bullet points, max ~25 words.
- **Prices in words**, not digits: `तेईस हज़ार पाँच सौ`, never digit-by-digit.
  *This single detail kills the illusion faster than anything else.* `enable_preprocessing=true` on
  the TTS handles most of it; the prompt handles the rest.
- **Occasional filler while thinking**: `एक मिनट रुकिए`, `अच्छा`, `हाँ जी`.
- **Register: deferential but savvy.** Not a call-centre robot.

### Guardrail block — verbatim, non-negotiable

```
1. You are an AI assistant. If asked whether you are human, say no, immediately and plainly.
2. You have no human name. Never invent one. State the customer's FIRST name only —
   never their phone number, address, or any other detail.
3. Never claim to represent a company, brand, government body, or named real person.
4. Never state a competing price that was not actually collected on an earlier call this session.
5. Never confirm, book, reserve, or commit to pay. Say: "I'll pass this to the customer,
   they'll confirm directly."
6. Never ask for or accept OTP, UPI ID, card details, bank details, or Aadhaar.
7. If they object, ask you to stop, or sound annoyed: apologise in ONE sentence, say you
   won't call again, and end the call. Do not persuade.
8. Be warm. Never pressure, never guilt, never imply urgency that isn't real.
```

**"Are you a bot?" / "क्या आप रोबोट हैं?"** — the answer is scripted, not generated:

> जी हाँ, मैं एक AI असिस्टेंट हूँ, {{userFirstName}} जी की तरफ़ से बात कर रहा हूँ।
> अगर आप चाहें तो मैं उन्हें बोल दूँ कि वो खुद कॉल करें?
>
> *(Yes, I'm an AI assistant calling for {{userFirstName}}. If you'd prefer, I can ask them to
> call you directly?)*

### The hangup reflex — regex on every STT final, fires **before** the LLM sees it

```
/don'?t call|stop calling|remove my number|not interested|who is this|is this a robot|
 कॉल मत|फ़?ोन मत|परेशान|नंबर हटा/i
```

→ speak `BOW_OUT` → hang up within 2 seconds → insert a `dnc` row → mark the recording for deletion.

**Demo this on stage.** A judge watching an AI voluntarily hang up and blacklist a number is worth
more than a fifth negotiation feature.

### Call state machine

```
GREET → DISCLOSE → [consent?] → QUALIFY → ANCHOR → COUNTER ×≤3 → CONCEDE → CLOSE
                        │                                                    │
                        │                                              CONFIRM (read-back ⭐)
                        │                                                    │
                        └── refused ──▶ BOW_OUT ──▶ hangup + dnc row      THANK
```

⚠️ **Do not let the LLM choose its own state.** A deterministic controller picks the state from turn
count plus whether a price has been extracted. Implement it as a Python dict of allowed transitions
with per-state turn caps, and inject the current state as a one-line `# CURRENT PHASE` **suffix on
the system prompt** each turn — do not swap prompts wholesale.

**Tactic → encoding.** Each tactic is a phase rule, not a vibe:

| Tactic | Encoding |
|---|---|
| anchor | ANCHOR phase, exactly one turn, must contain `OPENING_ANCHOR` |
| **cite** | COUNTER phase, **allowed only if `priorQuotes` is non-empty** |
| bundle | COUNTER turn ≥2 — ask for value, not price |
| reciprocity | CONCEDE phase, offer only from `NICE_TO_HAVES` |
| silence | after any vendor turn containing a number, ~40% of the time emit only `"hmm"` / `"achha"` (≤2 words) and stop |
| deadline | only if `DEADLINE_IS_REAL` |
| walk_away | price > `WALK_AWAY` after 2 counters → forced THANK |

**Guards:** `maxTurns = 16` · `maxCallDurationSec = 240` · walk-away breach → exit politely ·
silence >8s → one re-prompt, then close.

### Latency budget — a phone call dies above ~1.5s of dead air

Measured budget for one turn — end of vendor speech → first audio in the vendor's ear.
**"Naive" is what you get from library defaults. "Tuned" is what you ship.**

| Stage | Naive | Tuned | How |
|---|---:|---:|---|
| Twilio → ngrok → bridge | 80 ms | 80 ms | colocate the ngrok region |
| buffer + resample 8k→16k | 0 ms | 20 ms | *adds* time, saves far more |
| **Saaras VAD end-of-speech** | **1152 ms** | **192 ms** | ⭐ 16 kHz + `negative_frames_count=6` |
| Saaras final transcript emit | 120 ms | 120 ms | estimate — unverified, least trustworthy row |
| **LLM time-to-first-token** | **1400 ms** | **350 ms** | ⭐ `reasoning_effort=None` |
| LLM → first TTS chunk | 300 ms | 150 ms | `min_buffer_size` 50 → 25 |
| Bulbul first audio byte | 250 ms | 240 ms | documented sub-250 ms |
| bridge → Twilio → vendor ear | 120 ms | 120 ms | — |
| **TOTAL** | **3422 ms** ❌ | **1272 ms** ✅ | |

**With a filler injected on a 350 ms timer, perceived dead air drops to ~652 ms.** That is
comfortably conversational.

Instrument four timestamps per turn (END_SPEECH, transcript, LLM first token, TTS first byte) and log
them to Convex. **Measure before you write any negotiation logic.** If you cannot get a measured p50
under 1.5 s by the G3 gate, cut: drop mid-call language switching, pin `hi-IN`, drop the CONCEDE
state.

**If you're still over budget, cut in this order:** (1) `max_tokens` → 60, (2) shorten the system
prompt, (3) pre-render six filler WAVs at boot and play one immediately on END_SPEECH so the line is
never silent, (4) drop `codemix`.

**Use sarvam-30b for in-call turns and sarvam-105b only for offline extraction and summary.** Never
put 105B in the live loop.

### Structured extraction — two stages, non-negotiable

`sarvam-105b`, `response_format={"type":"json_object"}`, `max_tokens=4096`, **`reasoning_effort=null`**.

**Stage 1 — the LLM returns both a normalised integer AND the verbatim string it read it from.**

Every mission type fills `slots`; only `negotiate` fills the price-arc fields.

```json
{
  "slots": [
    {"key": "hasAcRoom",     "value": true, "valueVerbatim": "haan ji AC room hai", "confidence": "high", "turnSeq": 6},
    {"key": "pricePerNight", "value": 3000, "valueVerbatim": "teen hazaar",         "confidence": "high", "turnSeq": 14},
    {"key": "breakfast",     "value": false,"valueVerbatim": "breakfast alag hai",  "confidence": "medium","turnSeq": 9}
  ],
  "openingQuoteInr": 27500,
  "finalQuoteInr": 24200,
  "priceVerbatim": "chaubees hazaar do sau",
  "quoteTurnSeq": 11,
  "deliveryChargeInr": 0,
  "taxIncluded": false,
  "deliveryDays": 2,
  "terms": "free delivery, 1 year warranty",
  "contactName": "Rakesh",
  "holdUntil": "Tuesday 6 PM",
  "closed": true,
  "willingnessToNegotiate": "high",
  "confidence": 0.9
}
```

**Stage 2 — a deterministic Python normaliser re-parses `priceVerbatim`.**
If the two disagree by more than 2%, drop `confidence` to `"low"` and flag the row in the dashboard.

⚠️ **Keep the ordering: the LLM is primary, the normaliser is only a cross-check.** Do not invert it.
The Hindi numeral table is irregular and regional romanisations vary wildly
(`pachees` / `pachis` / `paccis`), and `saath` (60) collides with `saath` (with) — the table is
best-effort by construction.

### `effectivePriceInr` — rank on this, never on the raw quote

```
effectivePriceInr = quotedPriceInr
                  + (deliveryChargeInr or 0)
                  + (taxIncluded ? 0 : quotedPriceInr * 0.18)
```

A ₹23,500 quote plus GST and ₹500 delivery loses to a ₹25,000 all-in quote. **If you rank on the raw
number, your winner will sometimes be wrong on stage** — and a judge who does the arithmetic will
catch it.

**The extraction prompt must handle Indian number expressions explicitly.** This is the #1 silent
failure. Give the model these mappings in the prompt:

| Spoken | Value |
|---|---|
| `पचीस हज़ार` / `pachees hazaar` / `25k` | 25000 |
| `साढ़े चौबीस हज़ार` / `saade chaubees hazaar` | 24500 |
| `चौबीस हज़ार पाँच सौ` | 24500 |
| `सवा लाख` | 125000 |
| `डेढ़ लाख` | 150000 |
| `24,500` / `24500/-` / `Rs 24.5k` | 24500 |

Instruct: *"Return integers in rupees. `साढ़े X` = X + 0.5. `सवा X` = X × 1.25. `पौने X` = X × 0.75.
`डेढ़` = 1.5. If no price was quoted, return null — never guess."*

### Post-call summary — the 4 lines a human actually reads

```
✅ Gupta Home Appliances — ₹23,500  (was ₹26,000, −10%)
   250L Samsung, free delivery, 1yr warranty
   Ask for Rakesh · held till Tue 6 PM
   📞 4m 12s · Hindi
```

### Failure branches — the literal spoken response for each

| Situation | Response |
|---|---|
| **No answer** (12s ring) | Mark `no_answer`, move to next vendor silently |
| **IVR / voicemail** | Detect a >10s uninterrupted stream with no turn-taking → hang up, mark `no_answer`. **Never leave a voicemail.** |
| **Wrong number** | *"माफ़ कीजिए, ग़लती से लग गया। धन्यवाद!"* → hangup |
| **"We don't sell that"** | *"ठीक है जी, समझ गया। धन्यवाद, आपका दिन शुभ हो!"* → hangup, mark `closed:false` |
| **Annoyed / hostile** | ONE apology sentence → hangup → `dnc` row |
| **"Remove my number"** | *"बिलकुल, माफ़ कीजिए। दोबारा कॉल नहीं आएगा।"* → hangup → `dnc` row **permanently** |
| **Long silence (>8s)** | One re-prompt: *"हैलो, आप सुन रहे हैं?"* → then close |
| **Language outside TTS_11** | Do **not** attempt to switch. Continue in Hindi or English, log `detectedLangs`. Failing to guard this crashes your flagship feature live. |

---

## 14. DASHBOARD

**Stack:** `get-convex/template-react-vite-shadcn` → Vite + React + Convex + shadcn/ui + Tailwind.
Deploy to Vercel. Do not debate dark mode; ship dark.

**Three panels:**

```
┌──────────────┬────────────────────────────┬──────────────────┐
│ MISSIONS     │  LIVE TRANSCRIPT           │  DEAL COMPARISON │
│ (left rail)  │                            │                  │
│              │  🔴 CALL IN PROGRESS       │  Sharma    ₹24.2k│
│ ▸ Fridge     │  ─────────────────────     │  Gupta ★   ₹23.5k│
│   Karol Bagh │  🤖 नमस्ते! मैं…           │  KB Digital ₹25.9k│
│   ₹3,200 ✓   │  👤 हाँ बोलिए              │                  │
│              │  🤖 फ्रिज का रेट क्या है?   │  SAVED ₹3,200    │
│ ▸ Goa hotel  │  👤 सत्ताईस हज़ार          │  6m 40s          │
│   ₹1,800 ✓   │  🤖 अभी Nehru Place में…   │                  │
│              │     ▌                      │  [▶ play call]   │
└──────────────┴────────────────────────────┴──────────────────┘
```

### The live transcript component

Subscribe to **two** queries and render `[...turns, partial]`:

```tsx
const turns   = useQuery(api.transcripts.turns,       { token, callId });
const partial = useQuery(api.transcripts.livePartial, { callId });
```

Per turn: speaker avatar (🤖 agent / 👤 vendor), the text in native script, a **romanised line
underneath** (from Sarvam transliterate), a language badge when it changes, and a timestamp.
The partial gets a blinking cursor.

### The Negotiation Arc — your Delight component

Not a price table. A **visual arc per vendor**:

```
Sharma Electronics
  ₹27,500 ─────────────╮
                       ╰──▶ ₹24,200   −12%   ●───● 11 turns · 4m 12s
```

Struck-through opening → animated drop → final. Clicking the final price **scrolls the transcript to
`quoteTurnSeq`** — the exact line where the price was agreed. That link between number and evidence
is what makes it feel real rather than generated.

### The Answer Matrix — render this for `availability` and `quote` missions

Same component slot, different shape. Vendors down the side, objectives across the top:

```
                      AC room 14th   Rate/night   Breakfast   Parking
  Sea Breeze Resort        ✅          ₹3,000        ❌          ✅
  Calangute Inn            ✅          ₹3,200        ✅          ❌
  Palm Grove               ❌            —           —           —
```

Every cell is clickable and **scrolls the transcript to the `turnSeq` where that answer was
spoken**. Grey a cell when `confidence: "low"`.

**On a projector this reads better than the price ladder** — a judge parses a matrix in two seconds.
It is also the honest view when a mission isn't about money at all. Pick the view from
`mission.missionType`; for `negotiate`, show the matrix *and* the arc.

### Language / voice picker

`api.voice.preview({speaker, lang})` is a Convex **action** returning base64 WAV.
⚠️ **Never call Sarvam from the browser** — the key would be in the client bundle.

Ship **6–8 curated voices**, not 39. Include an **"Auto-detect ★"** option and make it the default.

### Judge-facing contact-check panel

A small collapsible strip on each call: `phoneE164 · twilioCallSid · durationSec · <audio src=recordingUrl>`.

They were going to ask anyway. Put it on screen before they do.

### Demoing on a projector

18px minimum body text · `tabular-nums` on every price · dark theme · high-contrast speaker colours ·
**no animations longer than 200ms**. Test at 15:30 on the actual projector.

---

## 15. COMPLIANCE AND SAFETY

Not a legal opinion — an implementable posture that is defensible on stage.

### Hard constants, quotable

| Rule | Value |
|---|---|
| Businesses per request | ≤ 3 |
| Dials per request | ≤ 5 |
| Attempts per business | 1 per 24h |
| **Dials per originating number** | **≤ 15 / 24h** (TCCCPR "Bulk" trips above 20 — say that number out loud) |
| Dials per 7 days | ≤ 60 (Bulk trips above 100) |
| Call window | **10:00–20:00 IST** (Schedule-II default-off bands are 21:00–10:00) |
| Max call duration | 240 s |

**Blocked prefixes — hardcode and reject:**
`100 101 102 103 108 112 1091 1098 139 181 1930 1800 1860 140 1600`

### The four non-negotiables

1. **Disclosure inside the first 4 seconds.** Logged to `consentEvents` with the exact wording used.
2. **A permanent global DNC list**, honoured across all users, written the instant anyone objects.
3. **Never fabricate a competing quote.** Cite only prices in the `calls` table from this session.
4. **Never transact.** No booking, no payment, no OTP, no UPI.

### What to say to judges — one slide, thirty seconds

> "Three things make this the responsible version. Every call opens by saying it's an AI and that
> it's recording — here's the consent log. Every number that objects goes on a permanent do-not-call
> list — here's that table, and you'll see it get a new row in the demo. And we cap at fifteen dials
> a day per number, which keeps us under TRAI's bulk-communication threshold of twenty. A human taps
> 'call' before anything dials. We never book and we never pay."

**Then offer to call a judge's phone.** They were going to contact-check you anyway; pre-empting it
converts a threat into your closing flourish.

---

## 16. WORKSTREAM SPLIT — five lanes, frozen contracts

### Governing rules — stated at kickoff, enforced by the integrator

- Convex is the **only** shared surface. No lane imports another lane's code. No lane runs another
  lane's process.
- **Directory ownership is exclusive.** Touching another lane's directory is a merge-blocking offence.
- Contracts below are **frozen**. A missing field goes into `meta: v.any()`.
- 🚫 **Nobody rewrites the Pipecat example "properly."** An agent will want to at 14:00. Forbidden.
- 🚫 **Nobody consolidates the bridge into Convex.** It is structurally impossible (§4). Forbidden.

| Lane | Owns (exclusive) | Consumes | Produces |
|---|---|---|---|
| **A — Bridge** *(best engineer, human-driven, no solo agent)* | `bridge/` | nothing | HTTP POSTs to Convex; `POST /call` endpoint |
| **B — Convex** | `convex/` | nothing | the schema + every query/mutation others read |
| **C — Telegram** | `convex/telegram.ts`, `convex/intent.ts` | Convex client | `missions` rows; voice-note summaries |
| **D — Dashboard** | `web/` | Convex queries only | the projector artifact |
| **E — Leads / Prompt / Demo** | `leads.json`, `prompts/`, demo assets | reads Convex | seed data, the prompt pack, the fallback video |

### Contract 1 — Convex → Bridge

```
POST https://<NGROK>/call          header: x-bridge-secret: $BRIDGE_SECRET

{ callId, missionId, phoneE164, language, voice, userFirstName,
  brief: { category, locality, constraints[], targetPriceInr, walkAwayInr },
  priorQuotes: [ { shop, priceInr } ] }

→ 202 { twilioCallSid }   |   4xx { error }
```

### Contract 2 — Bridge → Convex

All POST, all carry `x-bridge-secret`, all **fire-and-forget — never awaited on the audio thread.**
A slow POST becomes dead air on a live phone call.

```
POST {CONVEX_SITE}/ingest/turn
  { callId, role:"agent"|"vendor", text, langCode?, langProbability?,
    sarvamRequestId?, tsMs, final:true }

POST {CONVEX_SITE}/ingest/status          ← Twilio StatusCallback posts here directly too
  { callId?, CallSid, CallStatus, CallDuration?, RecordingUrl? }

POST {CONVEX_SITE}/ingest/outcome
  { callId, openingQuoteInr, finalQuoteInr, quoteTurnSeq, terms,
    contactName, holdUntil, closed, detectedLangs:[] }

POST {CONVEX_SITE}/ingest/langswitch
  { callId, fromLang, toLang, confidence, atMs }
```

⚠️ **Twilio posts `application/x-www-form-urlencoded`, not JSON.** `await req.json()` throws.
Use `new URLSearchParams(await req.text())`.

⚠️ **`.convex.site`, not `.convex.cloud`.**

### Contract 3 — Convex → Dashboard

Lane B publishes, Lane D consumes, nothing else.

```
api.missions.list      ({token})                → Mission[]
api.missions.get       ({token, missionId})     → { mission, calls[], vendors[] }
api.transcripts.turns  ({token, callId})        → Turn[]              (cold, finals only)
api.transcripts.livePartial ({callId})          → {text, role} | null (hot, one doc)
api.calls.comparison   ({token, missionId})     → { calls[], winnerId, savedInr }
api.voice.preview      ({speaker, lang})        → base64 wav   ← ACTION, never call Sarvam from the browser
```

### Contract 4 — Convex → Telegram

```
internal.telegram.send({ tgUserId, text?, voiceBase64? })
internal.auth.issueDashboardLink({ tgUserId }) → "https://<app>/?t=<token>"
```

### Contract 5 — Auth

One path, 20 minutes, already decided in §12.

### Env — one frozen list, `.env.example` committed at kickoff

```
SARVAM_API_KEY        TWILIO_ACCOUNT_SID    TWILIO_AUTH_TOKEN    TWILIO_US_NUMBER
NGROK_HOST            CONVEX_URL            CONVEX_SITE_URL      BRIDGE_SECRET
TELEGRAM_BOT_TOKEN    TG_WEBHOOK_SECRET     DASHBOARD_URL        GOOGLE_PLACES_KEY
STT_MODE=codemix      ALLOW_INTERRUPTIONS=true
```

---

## 17. HOUR BY HOUR

### First 15 minutes — ALL HANDS, NO CODE

Integrator creates: repo, Convex project (`npm create convex@latest`, GitHub OAuth, no card),
`schema.ts` pasted verbatim from §9, `.env.example`, @BotFather bot. **Every laptop does the Convex
GitHub login now, not at 14:00.** Contracts pasted into this file. Keys in a pinned message.

| Time | A · Bridge | B · Convex | C · Telegram | D · Dashboard | E · Leads/Prompt/Demo |
|---|---|---|---|---|---|
| **+0:15** | **G0** Twilio upgrade · US number · Geo Permissions IN (low **and** high) | schema push, `http.ts` skeleton | @BotFather, webhook → `.convex.site` | clone template, `npm i`, build | Sarvam signup + **₹2,000 top-up** |
| **+0:30** | **G1** curl ring test | ingest endpoints + shared secret | text intake → `missions` | 3-panel shell | **`leads.json` — 15–20 hand-verified real businesses** |
| **+0:50** | **G2** ngrok + `<Connect><Stream>`, log frames | `startMission`, `listMissions`, `getMission` | intent via sarvam-30b `json_object` | seed script: 2 finished negotiations | ″ |
| **+1:15** | **⚑ G3 GO/NO-GO — Bulbul audible on a real phone** | `applyBatch` (4 Hz, one hot doc) | | live transcript wired to seed data | Places `searchText` + field mask |
| **+1:45** | **G4** Saaras inbound → terminal | `dial` action + 500 ms stagger + `complianceGate` | **voice-note intake** (Saaras batch) | dashboard demoable standalone ✅ | **hard cut on Places if broken** |
| **+2:15** | **G5** 30b in the loop — it counter-offers | `onProviderStatus`, scheduler chain, `reapStuck` cron | live progress (edit one message) | 3 call cards, live status pills | **prompt pack v1 → Lane A** |
| **+3:00** | `POST /call` endpoint; turns → Convex | `learnedPrefs` memory + `buildContextPrompt` | | quote ticking down live | prompt v2 after hearing a real call |
| **+3:45** | 105b outcome extraction; recording URL | comparison query + `savedInr` | **Bulbul voice-note summary out** | **Negotiation Arc** | **record the fallback video** |
| **+4:30** | **3 concurrent calls test** + mid-call language switch | Mayura translate + transliterate | deep link to dashboard | contact-check panel | **test in the actual room on the actual PA** |
| **+5:15** | buffer / stabilise | buffer | buffer | 18px, dark, `tabular-nums` | rehearse ×3, pre-fill submission |
| **16:00** | **FREEZE.** Copy fixes only. Integrator holds the merge button. | | | | |
| **16:10** | **SUBMIT.** | | | | |

**⚑ G3 is the whole project.** If Bulbul audio is not audible on a real phone by 12:30, the
integrator alone (no committee) switches to Fallback Rung 2 (§10).

**Test 3 concurrent calls by 15:00, not 16:20.** If unstable, demo sequentially — a sequential demo
that works beats a parallel demo that crashes. *(And sequential is the correct product design
anyway — see §13 Block 5.)*

---

## 18. DEMO SCRIPT — 3 minutes

**Setup before you speak:** dashboard on the projector (dark, 18px) · phone on a **wired earbud or
lav into the room PA, never open speakerphone** · Telegram on a second window · fallback video paused
in a muted tab at the right frame · DND on · `caffeinate -disu` · Slack quit.

**0:00–0:20 — The stab.** No slides, no team intros, no architecture.
> "Every Indian negotiates ten times a week and loses every time, because the other side does this
> for a living and you do it once. Watch."

**0:20–0:45 — Voice in.** Send a Telegram **voice note in Hindi** — **under 25 seconds** (§12):

> *"Goa mein 14 tarikh se do raat ke liye hotel chahiye, AC, chaar hazaar se kam per night."*

Saaras transcribes live on screen, the intent card fills, three real hotels with real phone numbers
appear. **Read one number out loud** — *"that's a real hotel, call it after the demo."*

> ⚠️ **Lead with hotels, not the fridge.** Measured today: Goa hotels return 82 usable phone numbers
> from OSM; Karol Bagh appliance dealers return 3. Same product, same code path, 27× the data. Keep
> the fridge as example #2 only if Places billing came through. See §11.

**0:45–1:05 — Dial.** One tap. Three cards go to "dialing". One connects. **The room hears a
stranger say "Hello?"** That sound is what separates you from every browser demo in the building.

**1:05–2:10 — THE CALL. Say nothing.** Let the room hear a Hindi negotiation while the transcript
types itself in Devanagari, turn by turn. Two independent channels agreeing in real time is what
makes it unfakeable.

> **⭐ The moment lands ≈1:35.** The shopkeeper counter-offers. The agent doesn't accept — it says,
> in Hindi:
>
> *"देखिए, अभी मैंने Calangute में बात की, वहाँ AC room तीन हज़ार दो सौ में मिल रहा है।
> आप तीन हज़ार कर दीजिए तो मैं अभी confirm कर देता हूँ।"*
>
> — quoting a **real price it obtained on a different phone call ninety seconds earlier**, with the
> dashboard highlighting the source call.
>
> Not "an AI made a phone call." **"An AI ran a live reverse auction over the PSTN and used one
> stranger against another."** Point at the screen and say nothing for three seconds.

**2:10–2:35 — Land it.** Agent gets a name and a hold-until time, closes, hangs up. Comparison
resolves: three shops, three arcs, one winner. **"₹3,200 saved. 6 minutes 40 seconds of your life
back."** Telegram pings with a Bulbul voice note in Hindi. You never typed a word.

**2:35–2:50 — Memory + the switch.** *"It remembers."* Scroll the left rail to an earlier
negotiation; show that today's brief already carried *"budget usually ₹4k, prefers AC, speaks
Hindi."* If a language switch fired, show the `langSwitches` row: **"it changed language because he
did."**

**2:50–3:00 — The invitation.**
> "Every transcript, every number, every recording is in Convex right now — spot-check any row.
> Here's the consent log, here's the DNC list, here's the fifteen-calls-a-day cap that keeps us
> under TRAI's bulk threshold. And if you give me your number, it'll call you."

**Offer to call a judge.** Keep it as a one-field form on screen.

### Fallback tiers — all armed by 15:00

| Tier | What | Note |
|---|---|---|
| **0** | Real consented business | primary |
| **1** | Teammate in the corridor on a real phone | genuine PSTN, identical code path — **say so, nobody deducts** |
| **2** | The 90-second recorded video | judges forgive a recording; they don't forgive silence |
| **3** | The Convex table with 8–12 real completed negotiations accumulated all day | `record=True` from G1 onward generates this asset for free |

**Never debug in front of judges.** One failed attempt, one sentence, next tier.
**Dead-air budget: 5 seconds.**

---

## 19. CUT LIST — say these out loud at kickoff

Auth/login/multi-user · booking or payment · inbound calls · WhatsApp · a real domain · mobile
responsive · tests · CI · vector search / RAG / embeddings · multi-turn clarification in Telegram
(one message in, go) · error-recovery UI (a red "failed" pill is enough) · voice cloning · custom VAD
tuning past one knob · admin panels · landing page · Docker · retries and queues · analytics ·
dark-mode debate · a README over 10 lines · pronunciation dictionary · anything containing the word
"scalable" · **rewriting the Pipecat example properly** · **consolidating the bridge into Convex** ·
**Exotel/Plivo-India/Ozonetel/Knowlarity signup flows**.

**The last three are the dangerous ones.** An agent will drift into each of them between 13:00 and
15:00.

**Promote to MUST if G5 lands early:** cross-call price citation. It is the single highest-scoring
feature in the build and it is one field (`priorQuotes`) in the prompt. **Wire it before any CSS.**

---

## 20. TOP 5 RISKS

**1 · Twilio fails to upgrade, or upgrades and gets fraud-held.**
`<Stream>` and `<Record>` are blocked TwiML verbs on trial — there is no half-working mode, the
project is simply dead. RBI disables international transactions by default on new Indian cards and
3DS mismatches decline silently. Fraud holds have **no same-day appeal**.
→ *Enable intl in the bank app before you start. Two cards, different banks. Ring test within 5
minutes of upgrading. **Warm a Plivo signup in parallel from T+0** — the ring test detects death
without curing it.*

**2 · Sarvam credits exhausted mid-afternoon.**
₹100 free ≈ 8–12 calls. Six hours of iterative voice-picking and STT debugging burns it before lunch,
and nobody plans for it. Discovering it at 15:00 costs twenty minutes of confused 403s.
→ *₹2,000 top-up at T+0:10. Same person, same breath as the Twilio card.*

**3 · Echo / self-interruption on stage.**
Phone speakerphone → room PA → phone mic → VAD fires → the agent interrupts itself → cascade. This
kills more voice demos than any API, and a 200-person hall is a continuous VAD trigger.
→ *Wired earbud or lav into the PA, never open speakerphone. `high_vad_sensitivity=False`.
`ALLOW_INTERRUPTIONS` as an env flag flippable in five seconds. **Test in the actual room on the
actual PA at 15:30.***

**4 · Burst-rejected Sarvam sockets kill the parallel-call feature.**
Three concurrent calls open six sockets simultaneously; Sarvam rejects bursts well below the stated
concurrency ceiling and closes with code 1003. Separately, 3 calls × one LLM turn per ~6s approaches
the **40 req/min** chat ceiling.
→ *500ms stagger between dials (two lines). Cap concurrency at 3. One LLM call per turn, no retry
loops. Test three concurrent calls at 15:00.*

**5 · Nobody answers, or answers and hangs up on a US caller ID.**
A +1 number calling a Delhi shop on a Sunday reads as spam. **This is the highest-probability live
failure and it is social, not technical.** An Indian caller ID is unobtainable at any price.
→ *Pre-arranged consent at lunch (valid 7 days per TRAI Feb 2025), logged in `consentEvents`.
Disclosure inside the first 4 seconds. Three dials with a 12s ring budget. Teammate in the corridor
as a guaranteed pickup. `record=True` all day so Tier 3 is always full.*

**Runner-up, cheap to prevent:** ngrok's URL is baked into your TwiML. **Restarting ngrok silently
breaks every subsequent call while everything else looks fine.** Free tier gives one auto-assigned
persistent `*.ngrok-free.dev` — you cannot reserve a custom one, don't go hunting for a paid
feature. Hardcode it early and **never restart ngrok after 16:00**. Keep `cloudflared` installed;
venue networks sometimes block one provider and not the other.

---

## 21. OPEN QUESTIONS — each with the experiment that closes it

### Q1 · Do the Pipecat Sarvam service signatures match the docs? **Run this at minute 16.**

Sarvam's official guide writes `SarvamTTSService.Settings(target_language_code="hi-IN")`, while
Pipecat's own API reference lists the field as `language`. The TTS doc gives the import path
`pipecat.services.sarvam` while the STT doc gives `pipecat.services.sarvam.stt`. `pipecat-ai` 1.6.0
is days old. **Resolve empirically before Lane A writes a line:**

```bash
python -c "
import inspect
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.services.sarvam.llm import SarvamLLMService
print(inspect.signature(SarvamSTTService.__init__))
print(SarvamSTTService.Settings.model_fields.keys())
print(SarvamTTSService.Settings.model_fields.keys())
print(inspect.signature(SarvamLLMService.__init__))"
```

*Pre-decided fallback:* TTS via `SarvamTTSService`; LLM via
`OpenAILLMService(base_url="https://api.sarvam.ai/v1", model="sarvam-30b")`; STT via a hand-rolled
Saaras WS client in a custom `FrameProcessor`. **Budget 30 minutes for this specific unknown, and
check it at minute 16, not at 13:00.**

### Q2 · Can an Indian-billing account buy a US local number without a regulatory bundle?

Twilio's US regulatory page 404s and the Regulatory FAQ is non-committal.
*60-second experiment at T+20:* Console → Phone Numbers → Buy, set **Address Requirement = None**,
filter US local, attempt purchase. **If blocked, buy a US toll-free or a UK/Canada local instead** —
any non-Indian number satisfies the India rule.

### Q3 · Does `mode="codemix"` degrade sarvam-30b's comprehension vs `transcribe`?

Sarvam's own IVR guide recommends `transcribe` for IVR; we want `codemix` for Hinglish fidelity.
This is an empirical quality question, not a documentation one.
*10-minute experiment right after G5:* run the same 60-second scripted haggle twice, once per mode,
and diff the counter-offers. `STT_MODE` is already an env var. If `codemix` produces worse
counter-offers, flip it and keep codemix only for the **displayed** transcript.

### Q4 · Does `TTSUpdateSettingsFrame` swap the Bulbul voice mid-connection without an audible gap?

Documented as supported and the Sarvam config message auto-flushes the buffer, but the perceptual
result on a live PSTN leg is unverified.
*10-minute experiment at 15:00:* call a teammate, have them switch Hindi→Tamil mid-sentence, listen
for the gap. **If it stutters, downgrade to a *logged* `langSwitches` row plus a dashboard badge
("detected Tamil") without actually switching the voice** — you keep 80% of the judging value at zero
live risk.

### Q5 · Has TRAI's TCCCPR Third Amendment been notified in the Gazette?

Draft 13 Mar 2026, counter-comments closed 27 Apr 2026. If notified, A2P/robo-call pre-declaration to
the originating access provider becomes a live duty and undeclared calls are auto-treated as UCC.
Unverified as of today.
*Not resolvable in 10 minutes and not on the critical path.* Assume it is coming: the ≤15 dials/24h
cap, the disclosure, and the consent log are defensible under either version. Put a
`meta.a2pDeclared` flag in the schema and move on.

### Q6 · Sarvam's Acceptable Use Policy on outbound calling.

`sarvam.ai` returns 403 to automated fetchers, so no researcher could read it. **A platform-ToS
violation is the one thing that could kill your API key mid-demo.**
*3-minute experiment:* open the ToS from the logged-in Sarvam dashboard in a browser and skim for
outbound-calling and voice-cloning clauses before 12:00. We use stock Bulbul voices only and never
clone an identifiable person, which already covers the likely clause.

### Q7 · Google Places free-tier shape in 2026.

The old flat $200/month credit was replaced by per-SKU monthly free allowances in March 2025, and
phone numbers sit in the **Enterprise** SKU. Exact current allowance unverified.
*2-minute check in the GCP console billing page.* Either way `leads.json` (§11) makes this
non-blocking — **build `leads.json` first.**

---

## APPENDIX — sources

- Sarvam × Twilio voice agent (official): `https://docs.sarvam.ai/api/integration/build-voice-agent-with-twilio`
- Sarvam call-analytics pipeline (official): `https://docs.sarvam.ai/api/cookbook/guides/call-analytics-pipeline`
- Sarvam docs, machine-readable: `https://docs.sarvam.ai/llms-full.txt` · append `.md` to any docs URL
- Sarvam MCP server: `https://docs.sarvam.ai/_mcp/server`
- Sarvam cookbook: `https://github.com/sarvamai/sarvam-ai-cookbook`
- Pipecat outbound example: `https://github.com/pipecat-ai/pipecat-examples` → `twilio-chatbot/outbound/`
- Convex Vite+shadcn template: `https://github.com/get-convex/template-react-vite-shadcn`
- Buildathon rules and rubric: `https://growthx.club/docs/sarvam`

