"""
mock_call.py — an OFFLINE harness for the negotiation state machine.

Runs bridge/conversation.py's ConversationDriver end to end with NO pipecat,
NO network and NO Sarvam key. It stubs the LLM round-trip with a deterministic
extractor/phraser so the STATE MACHINE (not phrasing quality) is what gets
exercised, then drives one fixed, scripted negotiation and prints a labelled
transcript. It auto-flags two failures:

  REPEAT  — an emitted agent line whose _similar() to the previous emitted
            agent line is >= 0.8 (a re-worded repeat the callee would notice).
  NO_ROOM — the agent fired a fresh counter-offer immediately after the
            "hmm" turn, i.e. without a substantive reply to its last counter.

Run:  python3 bridge/mock_call.py
"""

from __future__ import annotations

import asyncio
import os
import re
import sys
import types


# ── 1. Make the imports in conversation.py resolve with no pipecat installed ──
def _install_pipecat_stub() -> None:
    frames = types.ModuleType("pipecat.frames.frames")

    class EndFrame:  # noqa: D401 - marker frame, no payload
        pass

    class TTSSpeakFrame:
        def __init__(self, text: str):
            self.text = text

    frames.EndFrame = EndFrame
    frames.TTSSpeakFrame = TTSSpeakFrame

    sys.modules.setdefault("pipecat", types.ModuleType("pipecat"))
    sys.modules.setdefault("pipecat.frames", types.ModuleType("pipecat.frames"))
    sys.modules["pipecat.frames.frames"] = frames


def _ensure_lightweight_deps() -> None:
    try:
        import httpx  # noqa: F401
        from loguru import logger  # noqa: F401
    except Exception:  # noqa: BLE001
        import subprocess

        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", "httpx", "loguru"],
            check=False,
        )


_ensure_lightweight_deps()
_install_pipecat_stub()

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import conversation as c  # noqa: E402


# ── 2. Deterministic "LLM": a number/affirmative extractor + a plain phraser ──

_AFFIRM = {
    "haan", "han", "haa", "ji", "theek", "thik", "sahi", "bilkul",
    "ok", "okay", "yes", "yeah", "yep", "ha", "correct", "right",
}
_HINDI_NUM = {
    "ek": 1, "do": 2, "teen": 3, "char": 4, "char,": 4, "paanch": 5, "panch": 5,
    "chhe": 6, "che": 6, "chha": 6, "chhe,": 6, "saat": 7, "aath": 8, "nau": 9, "das": 10,
}


def _find_number(text: str) -> int | None:
    """Pull a rupee figure out of an utterance: digits first, then Hindi words."""
    digits = re.findall(r"\d[\d,]*", text.replace(" ,", ","))
    if digits:
        return int(digits[0].replace(",", ""))
    toks = text.lower().split()
    for i, t in enumerate(toks):
        if t.startswith("hazaar") or t.startswith("hazar"):
            if i > 0 and toks[i - 1].strip(",.") in _HINDI_NUM:
                return _HINDI_NUM[toks[i - 1].strip(",.")] * 1000
    return None


def _extract_slots(utterance: str, objectives, types_map) -> dict:
    heard: dict = {}
    num = _find_number(utterance)
    toks = {w.strip(",.!?।") for w in utterance.lower().split()}
    affirm = bool(toks & _AFFIRM)
    for o in objectives:
        k = o["key"]
        ty = types_map.get(k, "text")
        if ty in ("money", "number") and num is not None:
            heard[k] = num
        elif ty == "boolean" and affirm:
            heard[k] = True
    return heard


def _phrase(instruction: str) -> str:
    """
    Turn a coded goal directive into a short, deterministic spoken line.

    The point is fidelity to the STATE MACHINE, not natural language: counters
    must carry their number (so _similar can tell two counters apart), and a
    re-asked objective must produce the SAME sentence (so a genuine repeat is
    detectable).
    """
    m = re.search(r"THE ONLY NUMBER YOU MAY SAY IS (\d+)", instruction)
    if m:
        return f"Could you do {m.group(1)} rupees?"
    m = re.search(r"come down to (\d+)", instruction)
    if m:
        return f"Great, {m.group(1)} rupees works — shall I confirm that?"
    if "budget allows" in instruction or "well above" in instruction:
        return "I understand — that's above what we can manage today, thank you so much."
    if instruction.startswith("You could NOT get"):
        return "Let me confirm just what I have so far — is that right?"
    if "Read this back" in instruction or "confirm:" in instruction:
        vals = "; ".join(re.findall(r": ([^;.]+)", instruction.split("confirm:")[-1]))
        return f"So — {vals.strip()} — is that right?"
    core = instruction.split(":")[-1].strip()
    return f"Could you tell me — {core}"


def _install_llm_stub(driver) -> None:
    async def stub_extract(self, utterance):
        return _extract_slots(utterance, self._objectives, self._types)

    async def stub_phrase(self, instruction):
        return _phrase(instruction)

    async def stub_complete(self, instruction):
        utterance = next(
            (m["content"] for m in reversed(self._messages) if m["role"] == "user"), ""
        )
        return _extract_slots(utterance, self._objectives, self._types), _phrase(instruction)

    # Install whichever the running version of conversation.py actually calls.
    if hasattr(driver, "_extract"):
        driver._extract = types.MethodType(stub_extract, driver)
    if hasattr(driver, "_phrase"):
        driver._phrase = types.MethodType(stub_phrase, driver)
    if hasattr(driver, "_complete"):
        driver._complete = types.MethodType(stub_complete, driver)


# ── 3. Fakes for state / convex / task ────────────────────────────────────────

class FakeState:
    def __init__(self):
        self.language = "hi-IN"
        self.call_id = "mock"
        self.transcript: list = []
        self.turn_seq = 0


class FakeConvex:
    """Every method used by the driver is a capturing no-op."""

    def __init__(self):
        self.calls: list = []

    def turn(self, *a, **k):
        self.calls.append(("turn", a, k))

    def __getattr__(self, name):
        def _noop(*a, **k):
            self.calls.append((name, a, k))
        return _noop


class FakeTask:
    """Captures the .text of every TTSSpeakFrame in the order it is spoken."""

    def __init__(self):
        self.lines: list[str] = []

    async def queue_frame(self, frame):
        text = getattr(frame, "text", None)
        if text is not None:
            self.lines.append(text)


# ── 4. The scripted scenario (shared, so transcripts are comparable) ──────────

BRIEF = {
    "missionType": "negotiate",
    "brief": {
        "targetPriceInr": 4000,
        "objectives": [
            {"key": "available", "ask": "room available on the 14th?",
             "type": "boolean", "required": True},
            {"key": "price", "ask": "per-night rate?", "type": "money", "required": True},
        ],
    },
    "priorQuotes": [],
}

VENDOR_TURNS = [
    "haan ji room available hai",       # 1 available=true
    "rate hai chhe hazaar",             # 2 price=6000 -> agent should COUNTER ~4800
    "hmm",                              # 3 NOISE — agent must WAIT, not counter again
    "nahi itna kam nahi, 5500 last",    # 4 refusal + new number -> counter UP toward them
    "theek hai 5000 kar dete hain",     # 5 concession -> agent confirms/closes
]


def _similar(a: str, b: str) -> float:
    return c._similar(a, b)


async def run() -> None:
    state = FakeState()
    convex = FakeConvex()
    task = FakeTask()

    driver = c.ConversationDriver(
        state=state,
        convex=convex,
        system_prompt="(mock system prompt)",
        api_key="mock-key-never-used",
        brief=BRIEF,
    )
    _install_llm_stub(driver)

    # Mirror bot.py's on-connect: greet, mark objective #1 asked, seed history.
    greeting = "Namaste — is a room available on the 14th?"
    driver.mark_asked_in_greeting()
    driver.seed_greeting(greeting)
    task.lines.append(greeting)
    state.transcript.append({"seq": state.turn_seq, "role": "agent", "text": greeting})
    state.turn_seq += 1

    # Wait long enough that _after_pause fires even when a counter has widened
    # the coalesce window.
    window = max(
        c.COALESCE_SECS,
        getattr(c, "COUNTER_COALESCE_SECS", c.COALESCE_SECS),
    ) + 0.5

    print("=" * 68)
    print(f"MOCK NEGOTIATION  (target=4000, COALESCE_SECS={c.COALESCE_SECS}, "
          f"COUNTER_COALESCE_SECS={getattr(c, 'COUNTER_COALESCE_SECS', 'n/a')})")
    print("=" * 68)
    print(f"  AGENT (greeting): {greeting}")

    repeat_flags: list[str] = []
    no_room_flag = False
    prev_agent_line = greeting

    for i, vendor in enumerate(VENDOR_TURNS, start=1):
        before = len(task.lines)
        await driver.on_user_text(vendor, task, lang_code="hi-IN")
        await asyncio.sleep(window)
        new_lines = task.lines[before:]

        print(f"\n  VENDOR turn {i}: {vendor!r}")
        if not new_lines:
            print("    AGENT: (silence — held / waiting)")
        for line in new_lines:
            sim = _similar(line, prev_agent_line)
            tag = f"   [REPEAT sim={sim:.2f}]" if sim >= 0.8 else ""
            if sim >= 0.8:
                repeat_flags.append(f"turn {i}: {line!r} ~ {prev_agent_line!r}")
            print(f"    AGENT: {line}{tag}")
            prev_agent_line = line

        # NO_ROOM: a brand-new counter-offer fired right after the "hmm" turn.
        if i == 3 and any(re.search(r"\bdo \d+ rupees", ln) for ln in new_lines):
            no_room_flag = True

    await driver.aclose()

    print("\n" + "=" * 68)
    print("AUTOMATIC FLAGS")
    print("=" * 68)
    print(f"  NO_ROOM after 'hmm' : {'FAIL' if no_room_flag else 'ok'}")
    print(f"  REPEAT lines        : {'FAIL' if repeat_flags else 'ok'}")
    for r in repeat_flags:
        print(f"      - {r}")
    print(f"  final slots         : {driver.slots}")
    print(f"  best_price          : {driver._best_price}")
    print(f"  counters made       : {driver._counters}")
    print("=" * 68)


if __name__ == "__main__":
    asyncio.run(run())
