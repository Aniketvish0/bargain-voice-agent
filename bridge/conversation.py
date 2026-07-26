"""
orydl — the conversation loop.

TWO DESIGN PRINCIPLES, both learned the hard way on live calls.

1. THE CALLEE NEVER ADAPTS TO US.
   A shopkeeper who picks up owes us nothing. They answer in two words, ramble,
   talk over the greeting, go quiet, or say "haan" five times. All of it works.

2. THE LLM DOES NOT DRIVE THE STATE MACHINE.
   Code owns which objective is outstanding and what to ask next. The LLM is
   only the language layer: it phrases the question and interprets the answer.

   Why: with the LLM in charge it said "तो per night rate ₹6000 है।" five times
   while the callee answered "Yes" to each. Instructing a model not to repeat
   itself does not work — it rewords slightly and carries on. The fix is
   architectural, not a better prompt. Once a slot is filled, or has been asked
   twice, code moves on and the loop becomes structurally impossible.

   See voxam.hashnode.dev/stop-letting-llm-drive-voice-agent-state-machine

LANGUAGE: the agent FOLLOWS the callee. If they answer in Tamil, we reply in
Tamil — that is the whole point of an Indic voice agent, not drift to be
suppressed. What stays fixed is the VOICE; swapping speaker mid-call sounds
broken. The only guard is against noise: a garbled two-word fragment must not
flip the conversation (one mis-detected "এটা।" once turned a Hindi call
Bengali), so a language change needs at least three words behind it.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

import httpx
from loguru import logger

from pipecat.frames.frames import EndFrame, TTSSpeakFrame

SARVAM_CHAT = "https://api.sarvam.ai/v1/chat/completions"

COALESCE_SECS = float(os.getenv("COALESCE_SECS", "0.7"))
MAX_TURNS = int(os.getenv("MAX_TURNS", "16"))
SILENCE_NUDGE_SECS = float(os.getenv("SILENCE_NUDGE_SECS", "10"))
# Ask any one objective at most this many times, then accept it is unanswerable.
MAX_ASKS_PER_OBJECTIVE = 2

NUDGE = {
    "hi-IN": "हैलो, आप सुन रहे हैं?",
    "en-IN": "Hello, are you still there?",
}
CLOSE = {
    "hi-IN": "ठीक है जी, बहुत धन्यवाद। आपका दिन शुभ हो!",
    "en-IN": "Alright, thank you so much. Have a good day!",
}


def _similar(a: str, b: str) -> float:
    """Cheap token overlap. Catches a reworded repeat that a == b would miss."""
    ta, tb = set(a.lower().split()), set(b.lower().split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))


class ConversationDriver:
    """One per call. Owns slot state, picks the next goal, phrases it via the LLM."""

    def __init__(self, *, state, convex, system_prompt: str, api_key: str, brief: dict):
        self._state = state
        self._convex = convex
        self._api_key = api_key
        self._messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]

        b = brief.get("brief", {})
        self._objectives: list[dict] = b.get("objectives", [])
        self._target = b.get("targetPriceInr")
        self._mission_type = brief.get("missionType", "negotiate")
        self._prior_quotes = brief.get("priorQuotes", [])

        # ── the state machine, owned by code ────────────────────────────────
        self._slots: dict[str, Any] = {}
        self._asks: dict[str, int] = {o["key"]: 0 for o in self._objectives}
        self._counters = 0
        self._best_price: int | None = None

        self._pending: list[str] = []
        self._timer: asyncio.Task | None = None
        self._reply: asyncio.Task | None = None
        self._watchdog: asyncio.Task | None = None
        self._turns = 0
        self._closing = False
        self._stall = 0
        self._reply_lang = state.language
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=4.0))
        self._last_activity = time.monotonic()

    # ── input ───────────────────────────────────────────────────────────────

    def seed_greeting(self, text: str) -> None:
        """
        Record the opening line as our first assistant turn.

        It is spoken via a raw TTSSpeakFrame, so without this the model has no
        idea it already introduced itself — and saying so in the system prompt
        was not enough; it greeted the same shopkeeper twice.
        """
        self._messages.append({"role": "assistant", "content": text})
        self._last_activity = time.monotonic()

    async def on_user_text(self, text: str, task, lang_code: str | None = None) -> None:
        if self._closing:
            return
        self._last_activity = time.monotonic()
        self._pending.append(text)

        # Follow the callee's language, but only on substantial speech.
        if lang_code and len(text.split()) >= 3:
            if lang_code != self._reply_lang:
                logger.info(f"[{self._state.call_id}] following callee into {lang_code}")
            self._reply_lang = lang_code

        if self._timer and not self._timer.done():
            self._timer.cancel()
        if self._reply and not self._reply.done():
            logger.info(f"[{self._state.call_id}] callee spoke over us — superseding")
            self._reply.cancel()

        self._timer = asyncio.create_task(self._after_pause(task))
        if self._watchdog is None:
            self._watchdog = asyncio.create_task(self._watch_silence(task))

    # ── the state machine ───────────────────────────────────────────────────

    def _next_goal(self) -> tuple[str, str]:
        """
        Decide what to do next. A pure function of slot state — no LLM involved.
        This is what makes an infinite re-ask impossible.
        """
        # 1. An objective still unanswered, and not already asked twice?
        for o in self._objectives:
            k = o["key"]
            if k in self._slots or self._asks[k] >= MAX_ASKS_PER_OBJECTIVE:
                continue
            self._asks[k] += 1
            if self._asks[k] == 1:
                return "ask", f"Ask this, in your own natural words: {o['ask']}"
            return "ask", (
                f"They did not answer clearly. Ask MUCH more simply, in different "
                f"words, and do not repeat your previous sentence: {o['ask']}"
            )

        # 2. Everything gathered — negotiate, if that is the mission.
        if self._mission_type == "negotiate" and self._target and self._best_price:
            if self._best_price > self._target and self._counters < 3:
                self._counters += 1
                step = (0.80, 0.88, 0.94)[self._counters - 1]
                offer = max(self._target, int(self._best_price * step))
                cite = ""
                if self._prior_quotes:
                    q = min(self._prior_quotes, key=lambda x: x.get("priceInr", 10**9))
                    cite = (
                        f" You may cite that {q['shop']} quoted {q['priceInr']} rupees — "
                        f"a REAL quote from an earlier call. Say the shop name and the "
                        f"number exactly; never invent one."
                    )
                return "counter", (
                    f"They quoted {self._best_price}. Counter at about {offer} rupees, "
                    f"warmly and briefly.{cite}"
                )

        # 3. Read the deal back and close.
        known = ", ".join(f"{k}={v}" for k, v in self._slots.items()) or "what they told you"
        return "confirm", (
            f"Read the outcome back in ONE sentence and ask them to confirm: {known}. "
            f"If you do not have their name yet, ask for it in the same sentence."
        )

    # ── loop ────────────────────────────────────────────────────────────────

    async def _after_pause(self, task) -> None:
        try:
            await asyncio.sleep(COALESCE_SECS)
        except asyncio.CancelledError:
            return
        utterance = " ".join(self._pending).strip()
        self._pending.clear()
        if utterance:
            self._reply = asyncio.create_task(self._respond(utterance, task))

    async def _respond(self, utterance: str, task) -> None:
        if self._closing:
            return
        self._turns += 1
        if self._turns > MAX_TURNS:
            await self._close(task)
            return

        goal_kind, instruction = self._next_goal()
        self._messages.append({"role": "user", "content": utterance})

        try:
            heard, reply = await self._complete(instruction)
        except asyncio.CancelledError:
            self._messages.pop()  # superseded; don't poison the history
            raise
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[{self._state.call_id}] LLM failed: {e}")
            return

        # Fold in anything they told us, whether or not we asked for it.
        for k, v in (heard or {}).items():
            if v is None or k not in self._asks:
                continue
            self._slots[k] = v
            if isinstance(v, (int, float)) and v > 100:
                self._best_price = int(v)
        if heard:
            logger.info(f"[{self._state.call_id}] goal={goal_kind} slots={self._slots}")

        if not reply:
            return

        last_agent = next(
            (m["content"] for m in reversed(self._messages) if m["role"] == "assistant"), ""
        )
        if last_agent and _similar(reply, last_agent) > 0.7:
            self._stall += 1
            logger.info(f"[{self._state.call_id}] near-repeat #{self._stall}")
            if self._stall >= 2:
                await self._close(task)
                return
        else:
            self._stall = 0

        self._messages.append({"role": "assistant", "content": reply})
        self._convex.turn(self._state.call_id, "agent", reply)
        self._state.transcript.append(
            {"seq": self._state.turn_seq, "role": "agent", "text": reply}
        )
        self._state.turn_seq += 1
        await self._say(task, reply)
        self._last_activity = time.monotonic()

        if goal_kind == "confirm":
            await asyncio.sleep(6.0)
            await self._close(task)

    async def _complete(self, instruction: str) -> tuple[dict, str]:
        """One round trip: interpret what they said AND phrase the next line."""
        keys = ", ".join(f'"{o["key"]}"' for o in self._objectives) or '"none"'
        director = {
            "role": "system",
            "content": (
                f"YOUR NEXT MOVE: {instruction}\n"
                f"ALREADY KNOWN — never ask about these again: "
                f"{json.dumps(self._slots, ensure_ascii=False) if self._slots else 'nothing yet'}\n"
                f"LANGUAGE: reply in {self._reply_lang}, matching the caller.\n"
                f"LENGTH: ONE spoken sentence, under 25 words. No markdown, no lists.\n\n"
                f'Return ONLY JSON: {{"heard": {{}}, "reply": "..."}}\n'
                f'"heard" = values the caller JUST gave, keyed by: {keys}. Integers in '
                f"rupees for money, true/false for yes/no. Omit anything they did not "
                f'actually say — never guess. "reply" = exactly what you will speak next.'
            ),
        }
        convo = [self._messages[0]] + self._messages[-10:][1:] + [director]
        r = await self._client.post(
            SARVAM_CHAT,
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={
                "model": os.getenv("LLM_MODEL", "sarvam-30b"),
                "messages": convo,
                "max_tokens": 220,
                "temperature": 0.4,
                "reasoning_effort": None,  # else content comes back null
                "response_format": {"type": "json_object"},
            },
        )
        if r.status_code >= 400:
            raise RuntimeError(f"{r.status_code}: {r.text[:160]}")
        content = (r.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            a, b = content.find("{"), content.rfind("}")
            if a < 0 or b < 0:
                return {}, content.strip()[:300]  # salvage — better than silence
            data = json.loads(content[a : b + 1])
        return data.get("heard") or {}, (data.get("reply") or "").strip()

    # ── exits ───────────────────────────────────────────────────────────────

    async def _say(self, task, text: str) -> None:
        await task.queue_frame(TTSSpeakFrame(text))

    async def _close(self, task) -> None:
        if self._closing:
            return
        self._closing = True
        await self._say(task, CLOSE.get(self._reply_lang, CLOSE["en-IN"]))
        await asyncio.sleep(3.0)
        await task.queue_frame(EndFrame())

    async def _watch_silence(self, task) -> None:
        """One nudge, then a polite exit. Nobody should sit on a dead line."""
        nudged = False
        try:
            while not self._closing:
                await asyncio.sleep(1.0)
                if time.monotonic() - self._last_activity < SILENCE_NUDGE_SECS:
                    continue
                if not nudged:
                    nudged = True
                    self._last_activity = time.monotonic()
                    await self._say(task, NUDGE.get(self._reply_lang, NUDGE["en-IN"]))
                else:
                    await self._close(task)
                    return
        except asyncio.CancelledError:
            return

    async def aclose(self) -> None:
        for t in (self._timer, self._reply, self._watchdog):
            if t and not t.done():
                t.cancel()
        await self._client.aclose()

    @property
    def slots(self) -> dict[str, Any]:
        return self._slots
