# Why the agent sounds broken — root cause and plan

Written after ~20 live calls and an isolated test of the LLM layer.
Short version: **the model is not the problem, and swapping it for GPT or
Claude would not fix any of this.**

---

## 1. The evidence

I replayed the exact conversation state from a failing call against the model
directly, with no telephony, no Pipecat, no orchestration.

**Test A — does it echo the objective text verbatim?**
Told to ask `"AC room available on the 14th for two nights?"`, 3/3 samples
rephrased naturally in Hindi. Zero verbatim echo.

**Test B — with `hasRoom` already filled, told to ask the price, does it
re-ask availability?**
3/3 asked only the price. One acknowledged the known fact first
(*"14th को AC room available है, तो per night rate क्या है?"*) — which is
correct implicit confirmation, not a re-ask.

**Test C — with both slots filled, told to confirm.**
Both `sarvam-30b` and `sarvam-105b`, 3 samples each, all correct:
> *तो, 14th को दो रात के लिए AC room available है, और per night rate 3500 है। क्या यह सही है?*

**Conclusion: given correct state, the model produces exactly the right
sentence, every time.** Every defect the callee experienced came from the
orchestration handing it wrong state, or from the orchestration speaking more
than once per turn.

### So: should we swap in GPT-4o or Claude?

**No.** Three reasons, in order of weight:

1. **It would fix nothing.** The failures are duplicate utterances, stale
   goals, and hallucinated slot values — all upstream of the model. A better
   model receiving the same bad state produces the same bad call.
2. **It costs the rubric.** This is a Sarvam buildathon and "Sarvam capability
   depth" is a 2.5× multiplier on the *Voice Experience* track. Saaras and
   Bulbul stay regardless, but moving the brain out weakens the story for no
   functional gain.
3. **Latency.** We are at ~1.3 s/turn. Production voice agents target
   400–800 ms ([Retell 400–700 ms, Vapi 500–800 ms][a]); above ~800 ms callers
   notice. A cross-provider hop adds, not subtracts.

The one case for a different model is Hindi/Hinglish fluency — and the tests
above show sarvam-30b's Hindi is already good. Keep it.

---

## 2. Root cause

### 2.1 The real defect: more than one utterance per user turn

The callee's own words on the recording:

> *"पहले तो आप हिंदी और इंग्लिश दोनों में बार बार सेम चीज़ क्यों बोल रहे हैं?
> एक ही बात बोल सकते हैं।"*

That is not the model repeating itself. That is **two separate code paths each
emitting speech for one user turn**, sometimes in different languages, so every
text-similarity guard I wrote failed to see them as duplicates.

I claimed "exactly one utterance per turn" as an invariant and verified it by
*reading the source*. It was never enforced at runtime. Paths that can each
call `_say()`: the main reply, the walk-away, the hold branch, the close, and
the silence watchdog — plus two `_respond` tasks can overlap if coalescing
misfires.

Three guards were written against the *symptom* and all three were defeated:

| Guard | Defeated by |
|---|---|
| token-overlap similarity | same sentence in Hindi vs English → near-zero overlap |
| digits parsed from the reply | `"₹2500"` vs `"दो हज़ार पाँच सौ"` → no digits to compare |
| goal + slot signature | correct, but only checks the *main* path; other paths bypass it |

### 2.2 Secondary: hallucinated slot values

An unanswered boolean extracts as `false`, lands in state, and is then narrated
as established fact — *"चूँकि अभी room available नहीं है"* to someone who had
said only "नमस्ते". Partly fixed (a `false` now needs an actual denial word),
but the extractor still volunteers fields nobody asked about.

### 2.3 Secondary: no human texture

There is no backchanneling, no acknowledgement token, no thinking sound. Every
turn is a complete formal sentence. Research is consistent that agents which
acknowledge and backchannel are rated markedly more natural than strict
turn-by-turn ones ([Activant][b], [ML6][c]).

---

## 3. The plan

Ordered by impact per unit of risk. Steps 1–2 are the ones that matter.

### Step 1 — One speech gate. Enforced at runtime, not by reading code.

Every utterance goes through a single `say()` that holds a lock and a
monotonically increasing turn id. Anything arriving for a turn that is already
spoken is **dropped and logged**, not spoken.

```python
async def say(self, task, text, turn_id):
    async with self._speech_lock:
        if turn_id != self._turn_id or self._spoke_this_turn:
            logger.warning(f"DROPPED duplicate utterance: {text[:60]}")
            return
        self._spoke_this_turn = True
        await task.queue_frame(TTSSpeakFrame(text))
```

`_turn_id` increments on every user utterance; `_spoke_this_turn` resets there.
This makes the duplicate structurally impossible regardless of which branch
produced it, and — critically — the dropped ones show up in the log so the bug
becomes visible instead of silent.

**This single change fixes the complaint the callee actually made.**

### Step 2 — Trust code state, never the model's memory of it

- The extractor may only return keys for the objective just asked, plus money.
  Everything else is discarded before it reaches state.
- The confirmation sentence is **built in code** from slot values and handed to
  the model as a string to translate and soften — not composed by it. It cannot
  confirm a number nobody said if it never gets to choose the number.

### Step 3 — Human texture (cheap, high perceived impact)

- **Backchannel while thinking.** On `END_SPEECH`, immediately emit a 200 ms
  token — *"हाँ…"*, *"अच्छा"*, *"हम्म"* — from a pre-rendered cache. Covers the
  ~1.3 s gap so the line is never dead. Pre-rendered, so it costs no latency.
- **Vary the openers.** Every turn currently starts *"तो,"*. Rotate through a
  small set.
- **Shorter turns.** Cap at ~15 words for questions. Long formal sentences are
  the single strongest "robot" signal.
- **`pace=0.95`** on Bulbul. Slightly slower reads as more considered.

### Step 4 — Ask for numbers in words

*"कितने हज़ार?"* rather than *"what is the rate?"*. Saaras handles
*"chhe hazaar"* far more reliably than *"6000"* over 8 kHz audio. One prompt
line, attacks the root of the number-mangling directly.

### Step 5 — Test without a phone

An offline harness that replays a scripted callee through
`ConversationDriver` and asserts:
- exactly one utterance per turn
- no utterance repeated
- no slot set that the script never stated
- the ladder concedes upward

Twenty calls were spent finding bugs that this would have caught in seconds.
**This should have been step 1 on day one.**

---

## 4. What I got wrong

Worth recording, because the pattern repeated:

- **I verified an invariant by reading code instead of enforcing it.** Nothing
  actually prevented a second utterance.
- **I fixed three symptoms of duplication before questioning the design.** Each
  fix was defeated by a case the previous one did not consider.
- **I put example sentences in prompts three separate times**, and each time
  they were read aloud on a live call.
- **I trusted logs over recordings.** The log shows intent; the recording shows
  what the callee heard. They diverged materially, twice. The user had to tell
  me to listen before I did.

---

[a]: https://techsy.io/en/blog/retell-ai-vs-vapi-vs-bland
[b]: https://activantcapital.com/research/voice-agents-2-0
[c]: https://www.ml6.eu/en/blog/stop-building-voice-wrappers-the-architecture-behind-reliable-voice-agents
