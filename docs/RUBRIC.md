# Rubric Mapping (Sarvam × GrowthX)

Half the score sits on two 2.5× levers: **Job-to-be-done** and the **one selected Sarvam capability**. Doot is engineered so the security/negotiation *is* a human-grade voice conversation completing a real job — which lands both heavy axes at once.

**Selected Sarvam capability: Voice Experience** (Document Intelligence & Dubbing score 0 — not selected).

| Parameter | Mult | Target | Max | How Doot earns it |
|---|---|---|---|---|
| **Job-to-be-done** | 2.5× | **L4–L5** | 12.5 | Calls N places, negotiates, extracts structured results, ranks, and **books the chosen one with a confirmation number** — end to end, across 3 repeated runs. Payment/ID handoff is the only human step. |
| **Voice Experience** | 2.5× | **L4** | 12.5 | Survives accents, Hindi-English code-switch, noisy lines, barge-in, corrections on real small-business callees. Follow-ups build on prior answers; firmness/pace shift during negotiation. |
| **Creativity** | 1.5× | **L4–L5** | 7.5 | **Parallel competitive leverage** — playing live quotes against each other — is a genuine reframe no competent team would default to, reinforced by fan-out + 3-checkpoint HITL. |
| **Impact** | 1.5× | **L3–L4** | 7.5 | Named user; quantified time saved (8 serial calls @ ~5 min → ~1 call of wall-clock + 2 taps) **and money saved** (avg % below first quote — a hard, defensible number). |
| **Memory & Context** | 1× | **L3–L4** | 5 | Task state + budget + user prefs survive across Telegram turns and a paused/resumed call; corrections propagate; per-user isolation. |
| **Delight** | 1× | **L4** | 5 | The fear moment is "did it actually work / am I stuck / did I overpay?" Doot answers honestly, shows the **recording**, never fake-confirms a booking or a price it didn't get. |

**Illustrative weighted total (conservative L4-heavy read):**
`10 + 10 + 6 + 6 + 4 + 4 = 40 / 50 (80%)`, with L5 upside on JTBD, Voice, and Creativity pushing toward ~45.

## Where the points are won or lost

- **Do NOT spread across capabilities.** One deep Voice Experience beats Voice + Docs + Dubbing done shallow. Additional capabilities add **zero** points.
- **JTBD is proven by the write-back**, not the pitch: a real booking record + confirmation number + updated DB across 3 runs is L5; "it talked about booking" is L1.
- **Voice L4→L5 is won in rehearsal**: deliberately test accents, code-switch, noise, interruptions, "no wait, actually" corrections. Turn-taking latency < ~1s.
- **Creativity is won by the leverage mechanic** — make sure the demo *shows* one quote being used to beat another, live.
- **Impact is won with a number**: report `savings_pct` and wall-clock, not "empowering Bharat."
- **Delight is won by honesty**: play the recording; expose uncertainty; never falsely reassure.

See [`DEMO.md`](DEMO.md) for the script that hits each of these on stage.
