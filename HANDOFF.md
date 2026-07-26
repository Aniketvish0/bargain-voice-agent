# orydl — handoff

Written 26 Jul 2026, after ~17 live PSTN calls. Everything below is verified
against the running system unless explicitly marked otherwise.

Read in this order: this file → [`GO-LIVE.md`](GO-LIVE.md) (wiring) →
[`docs/BUILD-SPEC.md`](docs/BUILD-SPEC.md) (why anything is the way it is).

---

## 1. What is running right now

| Piece | Where | State |
|---|---|---|
| Convex **prod** | `careful-fly-767` | deployed, 6 env vars set, 82 leads |
| Bridge (Pipecat + Twilio) | `localhost:7860` + ngrok | up |
| Dashboard (Vite) | `localhost:5173/?t=<token>` | up |
| Landing console (Next.js) | `frontend/` | being wired by a separate agent |
| Telegram bot | `@orydl_bot` | webhook live on `careful-fly-767.convex.site` |
| Twilio | `+1 608 817 7942` | Full account, India geo enabled both tiers |

**Deploy key** (full permissions, unlike the `preview:` ones):

```bash
export CONVEX_DEPLOY_KEY='prod:careful-fly-767|eyJ2MiI6IjhhNzY2Y2I5ZjdlMTQyMzI4YjEyM2JkNGZiOGYxYzYzIn0='
npx convex deploy -y            # also enables `convex run`, `data`, `env`, `import`
```

Restart the bridge:

```bash
cd bridge && nohup .venv/bin/python -m uvicorn server:app \
  --host 0.0.0.0 --port 7860 --log-level info > /tmp/bridge.log 2>&1 &
curl localhost:7860/health
```

⚠️ If ngrok restarts, its URL changes and **every subsequent call breaks silently**
(the URL is baked into the TwiML). Update `NGROK_HOST` in `bridge/.env` and
`BRIDGE_URL` via `npx convex env set`.

---

## 2. THE NEXT TASK — 5-run mission-memory test

**Not yet done. This is the highest-value remaining verification.**

The claim in BUILD-SPEC §1.5.1 is that call N gets *better* than call N−1 within a
mission, because it inherits `missions.memory`. That has never been proven on a
real call. Prove it or find out it doesn't work.

### Design

- **Five calls, all to the same number** (`+918882655977`, consented), but each
  presented as a **different business and a different persona** — different hotel
  name, different opening rate, different attitude (one brusque, one chatty, one
  who claims "season rate hai", one who caves quickly, one who won't move).
- **One mission, five vendors** — not five separate missions. Memory is per
  mission; separate missions share nothing.
- **Kick it off from Telegram**, exactly as a user would. Do not call the bridge
  directly. The whole point is to exercise the real path:
  `Telegram → intent → discovery → gate → sequential dial → extract → memory → next call`.
- **No code changes during the run.** If something breaks, note it and continue.
  The test is whether the *existing* memory mechanism works.

### Setup

Seed five consented vendor rows pointing at the same number under distinct names:

```bash
cat > /tmp/personas.jsonl <<'EOF'
{"category":"hotel","locality":"Goa MEMTEST","city":"Goa","name":"Sea Pearl Resort","phoneE164":"+918882655977","source":"curated","consentObtained":true}
{"category":"hotel","locality":"Goa MEMTEST","city":"Goa","name":"Palm Court Inn","phoneE164":"+918882655977","source":"curated","consentObtained":true}
...five in total, distinct names...
EOF
npx convex import --table leads --format jsonLines --append /tmp/personas.jsonl -y
```

⚠️ `vendors.insertForMission` **dedupes by phone number**, so five rows with the
same number collapse to one. Either relax that dedupe for the test, or give each
persona a distinct-but-equivalent E.164 you control. Decide before starting.

Also note `MAX_VENDORS_PER_MISSION = 3` in `convex/lib/constants.ts` — raise it to
5 for this test.

### What to measure

After each call, capture:

```bash
npx convex data missions --limit 1        # missions.memory should GROW
npx convex data calls --limit 5           # finalQuoteInr per call
grep "LEARNED THIS MISSION" /tmp/bridge.log
```

| Signal | Passing looks like |
|---|---|
| `missions.memory` populated after call 1 | `goingRateInr`, `worked`, `avoid`, `objections` non-empty |
| Memory reaches call 2's prompt | `LEARNED THIS MISSION` block in the bridge log |
| Cross-call citation | call 3 names a real earlier shop and its real price |
| **Improvement** | later calls reach a *lower* final price, or reach it in fewer turns |
| Objection pre-emption | if two personas say "season rate", call 4 answers it before it's raised |

**Be honest in the write-up.** "Memory populated but produced no behavioural
change" is a real and useful result. Do not claim improvement you cannot show in
the numbers.

### Report back through Telegram

The user explicitly wants the full experience, not just logs: the mission summary,
the ranked comparison, and the Bulbul voice note should all arrive in Telegram as
designed (`convex/summarise.ts` → `finishMission` → `internal.telegram.send`).
Verify that actually fires at the end of the mission — it has not been observed
end-to-end yet.

---

## 3. Known bugs, most important first

### 🔴 The callee gets no room to answer at a price point
> *"user ko yes/no bhi nahi bolne deta on a price point when negotiating"*

Reported on the last run and **not yet fixed**. After making a counter-offer the
agent moves on before the callee can accept or refuse. Suspects, in order:

1. `COALESCE_SECS = 0.7` in `conversation.py` — too short when someone is
   thinking about a number. A price decision takes longer than a factual answer.
2. `_awaiting_counter_reply` is cleared at the *top* of `on_user_text`, so any
   noise — a cough, a "hmm" — counts as their reply and unlocks the next rung.
3. The counter and the follow-up goal can still land close together.

Suggested fix: hold a longer window specifically after a counter (~1.5s), and
require a *substantive* utterance, not any utterance, to clear
`_awaiting_counter_reply`.

### 🟠 Numbers over 8 kHz audio
"6000" has come back as `86000`, `0`, `False`, `"not given"`, `60000`. Guards
exist (sanity band, repeat-means-believe, type checks, implicit read-back) and
each reduces it, but the information genuinely isn't in the audio. Saaras rejects
the `prompt` biasing parameter that would help.

**Cheapest real improvement, untried:** have the agent ask in words —
*"kitne hazaar?"* rather than *"what's the rate?"*. Saaras handles *"chhe hazaar"*
far more reliably than *"6000"*. One prompt line, attacks the cause.

### 🟠 sarvam-30b is overloaded in a single call
One request currently does three jobs: extract JSON slots, obey a turn directive,
and phrase a natural sentence. Most remaining defects trace to this — hallucinated
`hasRoom: False` on a turn about price, instruction examples spoken aloud, the
wrong number said while the directive named another.

**Recommended architectural change:** split into two calls — a cheap extraction
pass, then a phrasing pass with the goal already decided. ~300 ms extra latency
against a ~1.3 s budget. This likely fixes a whole family of bugs at once and is
the single highest-leverage change left.

### 🟡 Smaller
- Silence nudge occasionally fires while the callee is still thinking.
- `hasRoom: False` still appears sometimes despite the unsolicited-boolean guard.
- Mission memory is wired end-to-end but **never verified on a real call** (§2).
- The Telegram voice-note summary path is built but unobserved in a full run.

---

## 4. Hard-won facts — do not rediscover these

Every one cost a live call.

**Sarvam**
- `reasoning_effort` defaults ON; its tokens count against `max_tokens`, so a small
  cap returns `content: null` with **no error**. Always pass `null`.
- `anushka` is a `bulbul:v2` voice and 400s on v3. The valid v3 list is only
  recoverable from the API's own error body. Hindi default: `simran`.
- REST TTS rate param is `speech_sample_rate`, **not** `sample_rate`.
- TTS `min_buffer_size` has an undocumented valid range: 50–200. `25` and `500+`
  are rejected with a 422 that kills the entire config → total silence on the line.
- `saaras:v3` rejects the `prompt` parameter outright.
- `language_code: "unknown"` is what enables auto-detection; passing a specific
  code silently disables it.
- Opus TTS needs `output_audio_codec:"opus"` **and** `speech_sample_rate:24000`;
  the default 22050 is not a legal Opus rate.

**Pipecat 1.6.0**
- `PipelineParams(allow_interruptions=...)` is **deprecated since 0.0.99 and
  silently ignored**. It does nothing.
- STT accepts only `audio/wav` as `input_audio_codec`, despite Sarvam documenting four.
- STT `sample_rate` must match the transport (8000). 16000 starves the VAD and the
  agent goes deaf while every log looks clean.
- Language must be a `Language` enum; the raw string `"hi-IN"` falls back to `en-IN`.
- The VAD knobs live on `SarvamSTTSettings`, not `InputParams`.
- Default turn-stop is a smart-turn **model** that judges short replies ("haan",
  "6000") unfinished — the LLM was never invoked once across 8 calls. We drive the
  loop ourselves in `conversation.py`; don't hand it back.

**Convex**
- `httpAction`s live at `.convex.site`, the client at `.convex.cloud`.
- Env vars must be set with `npx convex env set`; a local `.env` leaves
  `process.env` undefined in deployed functions.
- `preview:` deploy keys can deploy but **cannot** set env vars. You need `prod:`.
- `v.optional()` means the key is *absent*, not `null` — explicit nulls fail import.

**Twilio**
- `<Stream>`/`<Record>` are blocked on trial. Upgrading is binary, not a nicety.
- India needs geo permissions on **both** low- and high-risk tiers.
- StatusCallback posts **form-encoded**, not JSON.

**Design lessons**
- The LLM must not drive the state machine. Telling it "don't repeat yourself"
  fails — it rewords slightly and continues. Code owns the goal; the model only
  phrases it.
- Never put an example sentence in a turn directive. It gets spoken verbatim.
  This shipped three times.
- Explicit confirmation ("did I hear that right?") on every value is what callees
  find most annoying. Fold it implicitly into the next question.
- A concession ladder goes **up** when refused. Lowering your offer after a
  refusal reads as insulting.

---

## 5. Repo layout

```
bridge/          Python 3.12. FastAPI + Pipecat + Twilio media stream.
                 conversation.py  ← the turn policy and negotiation brain
                 prompts.py       ← system prompt, disclosure, failure lines
                 bot.py           ← Pipecat pipeline wiring
convex/          Backend, DB, scheduler, Telegram webhook, ingest endpoints.
web/             Vite dashboard — mission rail, live transcript, comparison.
frontend/        Next.js landing/console (teammate's; being wired separately).
scripts/         OSM lead seeder + leads.jsonl (82 real businesses).
docs/BUILD-SPEC.md   Single source of truth for architecture and rationale.
GO-LIVE.md       Ordered wiring runbook and failure→cause table.
```

---

## 6. If you demo today

- **Lead with Goa hotels** — 27 OSM leads. Karol Bagh electronics has 3.
- **Only dial consented numbers.** The `leads` table holds real businesses that
  never opted in; the gate checks hours and DNC, not consent.
- **Record a good run first.** Run 14 (graceful walk-away) and run 9 (clean close
  at 6000 → 5640) are both demo-worthy and cost nothing to capture while the
  system is up.
- Wired earbud into the PA, never speakerphone.
- The unit check below verifies most negotiation logic with no phone call:

```bash
cd bridge && .venv/bin/python -c "
import conversation as c
d=object.__new__(c.ConversationDriver)
d._mission_type='negotiate'; d._target=4000; d._best_price=6000; d._counters=0
d._awaiting_counter_reply=False; d._last_offer=None; d._walked_away=False
d._deal_agreed=False; d._prior_quotes=[]; d._types={'p':'money'}
d._objectives=[{'key':'p','ask':'rate','type':'money','required':True}]
d._slots={'p':6000}; d._asks={'p':3}
class S: language='hi-IN'; call_id='t'
d._state=S()
for _ in range(4):
    k,_x=d._next_goal(); d._awaiting_counter_reply=False
    print(k, d._last_offer)"
# expect: counter 4800 | counter 5280 | counter 5640 | walkaway
```
