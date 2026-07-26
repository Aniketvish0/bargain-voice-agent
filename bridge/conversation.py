"""
orydl — the conversation loop.

WHY THIS EXISTS
---------------
Pipecat's LLMContextAggregatorPair owns turn-taking, and on a real phone line
it would not hand us a completed turn (see the note in bot.py). Rather than
keep tuning someone else's turn model, we run the loop ourselves.

DESIGN PRINCIPLE: the callee never adapts to us.

A shopkeeper who picks up the phone owes us nothing. They will answer in two
words, ramble for thirty seconds, talk over the greeting, go quiet, or say
"haan" three times. Every one of those has to work. So:

  * Short answers count. "haan", "3000", "nahi hai" are complete turns — the
    smart-turn model rejected exactly these.
  * Fragments get coalesced. If they pause mid-thought, we wait a beat and
    join the pieces rather than replying to half a sentence.
  * Talking over us is fine. A newer utterance supersedes an in-flight reply;
    we cancel and answer the newer thing.
  * Silence is handled. We nudge once, then close politely.
  * One reply at a time, always. No overlapping speech from our side.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import httpx
from loguru import logger

from pipecat.frames.frames import EndFrame, TTSSpeakFrame

SARVAM_CHAT = "https://api.sarvam.ai/v1/chat/completions"

# How long to wait for the callee to keep talking before we answer. Long enough
# to coalesce "haan..." + "...teen hazaar", short enough not to feel dead.
COALESCE_SECS = float(os.getenv("COALESCE_SECS", "0.7"))
# Hard ceiling on turns so a chatty callee cannot run the call forever.
MAX_TURNS = int(os.getenv("MAX_TURNS", "16"))
# Nudge after this much silence, then close.
SILENCE_NUDGE_SECS = float(os.getenv("SILENCE_NUDGE_SECS", "9"))

NUDGE = {
    "hi-IN": "हैलो, आप सुन रहे हैं?",
    "en-IN": "Hello, are you still there?",
}
CLOSE = {
    "hi-IN": "कोई बात नहीं, मैं बाद में कोशिश करूँगा। धन्यवाद!",
    "en-IN": "No problem, I'll try later. Thank you!",
}


class ConversationDriver:
    """One instance per call. Owns the message history and the reply loop."""

    def __init__(self, *, state, convex, system_prompt: str, api_key: str):
        self._state = state
        self._convex = convex
        self._api_key = api_key
        self._messages: list[dict[str, str]] = [
            {"role": "system", "content": system_prompt}
        ]
        self._pending: list[str] = []
        self._timer: asyncio.Task | None = None
        self._reply: asyncio.Task | None = None
        self._turns = 0
        self._closing = False
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=4.0))
        self._last_activity = time.monotonic()
        self._watchdog: asyncio.Task | None = None

    # ── input ───────────────────────────────────────────────────────────────

    async def on_user_text(self, text: str, task) -> None:
        """A final transcript arrived. Coalesce, then answer."""
        if self._closing:
            return
        self._last_activity = time.monotonic()
        self._pending.append(text)

        # They're still going — restart the coalesce window instead of
        # replying to a fragment.
        if self._timer and not self._timer.done():
            self._timer.cancel()

        # They talked over our reply. The newer thing wins.
        if self._reply and not self._reply.done():
            logger.info(f"[{self._state.call_id}] callee spoke over us — superseding reply")
            self._reply.cancel()

        self._timer = asyncio.create_task(self._after_pause(task))
        if self._watchdog is None:
            self._watchdog = asyncio.create_task(self._watch_silence(task))

    async def greet_done(self) -> None:
        self._last_activity = time.monotonic()

    # ── loop ────────────────────────────────────────────────────────────────

    async def _after_pause(self, task) -> None:
        try:
            await asyncio.sleep(COALESCE_SECS)
        except asyncio.CancelledError:
            return
        utterance = " ".join(self._pending).strip()
        self._pending.clear()
        if not utterance:
            return
        self._reply = asyncio.create_task(self._respond(utterance, task))

    async def _respond(self, utterance: str, task) -> None:
        if self._closing:
            return
        self._turns += 1
        if self._turns > MAX_TURNS:
            logger.info(f"[{self._state.call_id}] turn cap reached, closing")
            await self._say(task, CLOSE.get(self._state.language, CLOSE["en-IN"]))
            await self._hangup(task)
            return

        self._messages.append({"role": "user", "content": utterance})
        try:
            reply = await self._complete()
        except asyncio.CancelledError:
            self._messages.pop()  # they superseded it; don't poison the history
            raise
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[{self._state.call_id}] LLM failed: {e}")
            return

        if not reply:
            return
        self._messages.append({"role": "assistant", "content": reply})
        self._convex.turn(self._state.call_id, "agent", reply)
        self._state.transcript.append(
            {"seq": self._state.turn_seq, "role": "agent", "text": reply}
        )
        self._state.turn_seq += 1
        await self._say(task, reply)
        self._last_activity = time.monotonic()

    async def _complete(self) -> str:
        # Pin the reply language on EVERY turn.
        #
        # Saaras auto-detects per utterance, and a garbled two-word reply gets
        # mislabelled easily. Observed live: one noisy "এটা।" came back as
        # bn-IN, the model read the history and answered the shopkeeper in
        # Bengali for the rest of the call. The mission language is the
        # authority; a real language switch goes through the confidence- and
        # hysteresis-gated path in bot.py, never through transcript drift.
        pin = {
            "role": "system",
            "content": (
                f"Reply ONLY in {self._state.language}. Ignore the language of the "
                f"last transcript — it is often mis-detected on short or noisy "
                f"speech. One short spoken sentence, under 25 words."
            ),
        }
        convo = [self._messages[0]] + self._messages[-12:][1:] + [pin]
        r = await self._client.post(
            SARVAM_CHAT,
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={
                "model": os.getenv("LLM_MODEL", "sarvam-30b"),
                "messages": convo,
                "max_tokens": int(os.getenv("LLM_MAX_TOKENS", "110")),
                "temperature": 0.4,
                # MANDATORY. Reasoning is on by default and its tokens count
                # against max_tokens, so a small cap returns content: null.
                "reasoning_effort": None,
            },
        )
        if r.status_code >= 400:
            raise RuntimeError(f"{r.status_code}: {r.text[:160]}")
        data = r.json()
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content")
        return (content or "").strip()

    async def _say(self, task, text: str) -> None:
        await task.queue_frame(TTSSpeakFrame(text))

    async def _hangup(self, task) -> None:
        self._closing = True
        await asyncio.sleep(2.5)  # let the closing line finish
        await task.queue_frame(EndFrame())

    async def _watch_silence(self, task) -> None:
        """One nudge, then a polite exit. Nobody should sit on a dead line."""
        nudged = False
        try:
            while not self._closing:
                await asyncio.sleep(1.0)
                quiet = time.monotonic() - self._last_activity
                if quiet < SILENCE_NUDGE_SECS:
                    continue
                if not nudged:
                    nudged = True
                    self._last_activity = time.monotonic()
                    await self._say(task, NUDGE.get(self._state.language, NUDGE["en-IN"]))
                else:
                    await self._say(task, CLOSE.get(self._state.language, CLOSE["en-IN"]))
                    await self._hangup(task)
                    return
        except asyncio.CancelledError:
            return

    async def aclose(self) -> None:
        for t in (self._timer, self._reply, self._watchdog):
            if t and not t.done():
                t.cancel()
        await self._client.aclose()

    @property
    def messages(self) -> list[dict[str, str]]:
        return self._messages
