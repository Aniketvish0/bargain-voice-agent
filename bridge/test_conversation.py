"""
Offline conversation harness — no phone, no Twilio, no Pipecat.

WHY THIS EXISTS
---------------
Twenty live calls were spent finding bugs this catches in seconds, on someone
else's phone. Worse, the bug that mattered most — the agent speaking twice per
turn — was one I had "verified" by reading the source. Reading is not testing.

Run:  .venv/bin/python test_conversation.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass, field
from typing import Any

os.environ.setdefault("SARVAM_API_KEY", "test")

from conversation import ConversationDriver  # noqa: E402


# ── fakes ───────────────────────────────────────────────────────────────────

@dataclass
class FakeTask:
    """Records every frame the driver tries to speak."""
    spoken: list[str] = field(default_factory=list)
    ended: bool = False

    async def queue_frame(self, frame):
        name = type(frame).__name__
        if name == "EndFrame":
            self.ended = True
        elif hasattr(frame, "text"):
            self.spoken.append(frame.text)

    async def queue_frames(self, frames):
        for f in frames:
            await self.queue_frame(f)


class FakeConvex:
    def turn(self, *a, **k): pass
    def lang_switch(self, *a, **k): pass
    def outcome(self, *a, **k): pass
    def dnc(self, *a, **k): pass
    def consent(self, *a, **k): pass


@dataclass
class FakeState:
    call_id: str = "test"
    phone: str = "+910000000000"
    language: str = "hi-IN"
    user_first_name: str = "Pulkit"
    turn_seq: int = 0
    transcript: list = field(default_factory=list)


BRIEF = {
    "missionType": "negotiate",
    "brief": {
        "category": "hotel room",
        "locality": "Goa",
        "constraints": ["AC room"],
        "objectives": [
            {"key": "hasRoom", "ask": "AC room available on the 14th?", "type": "boolean", "required": True},
            {"key": "pricePerNight", "ask": "what is the rate per night", "type": "money", "required": True},
        ],
        "targetPriceInr": 4000,
        "walkAwayInr": 4400,
    },
    "priorQuotes": [],
}


def make_driver(scripted: list[tuple[dict, str]]) -> ConversationDriver:
    """A driver whose LLM calls are replaced by a fixed script."""
    d = ConversationDriver(
        state=FakeState(), convex=FakeConvex(),
        system_prompt="test", api_key="test", brief=BRIEF,
    )
    seq = list(scripted)

    async def fake_extract(utterance):
        return seq[min(d._turns, len(seq) - 1)][0] if seq else {}

    async def fake_phrase(instruction):
        return seq[min(d._turns - 1, len(seq) - 1)][1] if seq else "ok"

    d._extract = fake_extract      # type: ignore[assignment]
    d._phrase = fake_phrase        # type: ignore[assignment]
    return d


# ── tests ───────────────────────────────────────────────────────────────────

async def t_one_utterance_per_turn():
    """THE invariant. Five branches could each speak for one turn."""
    d = make_driver([({"hasRoom": True}, "reply one")])
    task = FakeTask()
    d._turn_id = 1
    await d._say(task, "first")
    await d._say(task, "second — must be DROPPED")
    await d._say(task, "third — must be DROPPED")
    assert task.spoken == ["first"], task.spoken
    return "one utterance per turn, extras dropped"


async def t_gate_rearms_next_turn():
    d = make_driver([])
    task = FakeTask()
    d._turn_id = 1
    await d._say(task, "turn one")
    d._turn_id = 2                       # a new inbound utterance
    await d._say(task, "turn two")
    assert task.spoken == ["turn one", "turn two"], task.spoken
    return "gate re-arms on the next user turn"


async def t_closing_line_always_lands():
    """force=True: hanging up silently is worse than one extra sentence."""
    d = make_driver([])
    task = FakeTask()
    d._turn_id = 1
    await d._say(task, "already spoke")
    await d._say(task, "goodbye", force=True)
    assert "goodbye" in task.spoken, task.spoken
    return "closing line bypasses the gate deliberately"


async def t_scripted_reflex_wins():
    """A bow-out must not stack on top of an in-flight reply."""
    d = make_driver([])
    task = FakeTask()
    d._turn_id = 1
    await d._say(task, "mid-reply")
    await d.speak_scripted(task, "sorry, we won't call again", terminal=True)
    assert task.spoken[-1] == "sorry, we won't call again", task.spoken
    return "scripted reflex speaks even after a reply"


async def t_ladder_concedes_upward():
    d = make_driver([])
    d._slots = {"hasRoom": True, "pricePerNight": 6000}
    d._asks = {"hasRoom": 3, "pricePerNight": 3}
    d._best_price = 6000
    offers = []
    for _ in range(3):
        kind, _i = d._next_goal()
        d._awaiting_counter_reply = False
        if kind == "counter":
            offers.append(d._last_offer)
    assert offers == sorted(offers), f"ladder must not go down: {offers}"
    assert all(o < 6000 for o in offers), f"never bid at/above their ask: {offers}"
    return f"ladder concedes upward and stays under their ask: {offers}"


async def t_no_invented_denial():
    """A false boolean with no denial word is a failed extraction, not a fact."""
    from conversation import _NEGATIVE
    assert not _NEGATIVE.search("नमस्ते")
    assert not _NEGATIVE.search("Yes, it is available")
    assert _NEGATIVE.search("नहीं है")
    assert _NEGATIVE.search("sold out")
    return "denial detection distinguishes silence from refusal"


async def t_fragment_is_not_acceptance():
    from conversation import _HEDGE
    assert _HEDGE.match("हाँ मैं।"), "bare fragment must not bank a price"
    assert not _HEDGE.match("haan ji theek hai 4800 chalega")
    return "a two-word fragment is not agreement to a price"


TESTS = [
    t_one_utterance_per_turn,
    t_gate_rearms_next_turn,
    t_closing_line_always_lands,
    t_scripted_reflex_wins,
    t_ladder_concedes_upward,
    t_no_invented_denial,
    t_fragment_is_not_acceptance,
]


async def main() -> int:
    ok = fail = 0
    for t in TESTS:
        try:
            msg = await t()
            print(f"  PASS  {t.__name__:32} {msg}")
            ok += 1
        except AssertionError as e:
            print(f"  FAIL  {t.__name__:32} {e}")
            fail += 1
        except Exception as e:  # noqa: BLE001
            print(f"  ERR   {t.__name__:32} {type(e).__name__}: {e}")
            fail += 1
    print(f"\n  {ok} passed, {fail} failed")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
