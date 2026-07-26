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

import re

import httpx
from loguru import logger

from pipecat.frames.frames import EndFrame, TTSSpeakFrame

SARVAM_CHAT = "https://api.sarvam.ai/v1/chat/completions"

COALESCE_SECS = float(os.getenv("COALESCE_SECS", "0.7"))
# After WE make a counter-offer, the callee is weighing a number, not answering
# a factual question — they pause longer, and the answer often dribbles out in
# fragments ("nahi... itna kam nahi... 5500 last"). Coalescing on the normal
# 0.7s window chopped that in half and fired our next rung mid-thought, so hold
# a wider window specifically while a counter is outstanding.
COUNTER_COALESCE_SECS = float(os.getenv("COUNTER_COALESCE_SECS", "1.5"))
MAX_TURNS = int(os.getenv("MAX_TURNS", "16"))
# 10s fired mid-conversation while the callee was still thinking. Phone
# pauses run long, especially when someone is checking a register.
SILENCE_NUDGE_SECS = float(os.getenv("SILENCE_NUDGE_SECS", "14"))
# Ask any one objective at most this many times, then accept it is unanswerable.
MAX_ASKS_PER_OBJECTIVE = 3

NUDGE = {
    "hi-IN": "हैलो, आप सुन रहे हैं?",
    "en-IN": "Hello, are you still there?",
}
CLOSE = {
    "hi-IN": "ठीक है जी, बहुत धन्यवाद। आपका दिन शुभ हो!",
    "en-IN": "Alright, thank you so much. Have a good day!",
}
# Used when we declined on price. A cheerful "have a good day" straight after
# turning someone down sounds oblivious.
WALKAWAY_CLOSE = {
    "hi-IN": "फिर भी आपका बहुत धन्यवाद जी, समय देने के लिए। रेट बदले तो ज़रूर बताइएगा।",
    "en-IN": "Thank you for your time anyway. If your rate changes, do let us know.",
}


_NUM = re.compile(r"\d[\d,]*")

# Words that actually constitute a denial. Anything else, and a False from the
# model is a failed extraction rather than something the callee told us.
# Fillers and false starts that carry no commitment on their own.
_HEDGE = re.compile(
    r"^\s*(haan|हाँ|हां|ha|ji|जी)\s*(main|मैं|matlab|मतलब|woh|वो|but|lekin|लेकिन)?\s*[।.,]?\s*$",
    re.IGNORECASE,
)

_NEGATIVE = re.compile(
    r"\bno\b|\bnot\b|\bnahi+n?\b|\bnahin\b|\bcan'?t\b|\bcannot\b|\bunavailable\b|"
    r"\bsold out\b|\bbooked\b|\bfull\b|नहीं|नही|खाली नहीं|इल्ल|இல்லை|ಇಲ್ಲ",
    re.IGNORECASE,
)


def _similar(a: str, b: str) -> float:
    """
    Token overlap, but NUMBER-AWARE.

    Two counter-offers share nearly every word — "could you do 5000" vs
    "could you do 4800" scored 0.8 and got flagged as a repeat, so the agent
    stopped negotiating and hung up mid-sentence on the callee. When the
    figures differ, the turns are different by definition: the number IS the
    content of a counter-offer.
    """
    na = set(_NUM.findall(a.replace(",", "")))
    nb = set(_NUM.findall(b.replace(",", "")))
    if na and nb and na != nb:
        return 0.0

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
        self._types: dict[str, str] = {
            o["key"]: o.get("type", "text") for o in self._objectives
        }
        self._target = b.get("targetPriceInr")
        self._mission_type = brief.get("missionType", "negotiate")
        self._prior_quotes = brief.get("priorQuotes", [])

        # ── the state machine, owned by code ────────────────────────────────
        self._slots: dict[str, Any] = {}
        self._asks: dict[str, int] = {o["key"]: 0 for o in self._objectives}
        self._counters = 0
        self._best_price: int | None = None
        # Guard: a counter must be answered before we make another one.
        # Without this the follow-up counter and the next turn's goal both
        # fired, so the agent bid 4800 and then immediately 5280 against
        # itself with the callee never having spoken.
        self._awaiting_counter_reply = False
        self._confirmed = False
        self._pending_ask: str | None = None
        self._last_offer: int | None = None
        self._just_heard: dict = {}
        self._just_asked_recently: set = set()
        self._odd_price_seen: int | None = None
        # The last price the CALLEE stated, kept apart from our own offers so a
        # wrongly-banked counter can be reverted to something they really said.
        self._their_price: int | None = None
        # (goal, numbers) of our last utterance. Language-independent, unlike
        # token overlap — the same confirmation in English then Hindi slipped
        # straight past the text comparison.
        self._last_sig: tuple | None = None
        # ── speech gate ──
        self._speech_lock = asyncio.Lock()
        self._turn_id = 0        # increments on every inbound utterance
        self._spoke_turn = -1    # the turn we last spoke for
        self._disclosure: str | None = None  # beat two, pending
        self._walked_away = False
        self._deal_agreed = False

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

    async def speak_scripted(self, task, text: str, *, terminal: bool = False) -> None:
        """
        For lines the reflexes own — the bow-out and the "are you a bot?"
        answer. They used to queue TTS directly from bot.py, bypassing the gate
        entirely, so either could land on top of a reply already in flight.

        Cancels any pending reply first: a scripted reflex always wins, because
        both of them are responses to something the callee said that matters
        more than whatever we were about to say.
        """
        if self._timer and not self._timer.done():
            self._timer.cancel()
        if self._reply and not self._reply.done():
            self._reply.cancel()
        self._pending.clear()
        await self._say(task, text, force=terminal)

    def set_disclosure(self, text: str) -> None:
        """
        Beat two. Spoken as our FIRST real turn, prefixed to whatever we say,
        so the AI disclosure lands within ~10 seconds — before we ask anything
        of them — without being the very first thing they hear.
        """
        self._disclosure = text

    def arm_greeting(self) -> None:
        """The opener is turn 0; let it through the gate."""
        self._spoke_turn = -1

    def seed_greeting(self, text: str) -> None:
        """
        Record the opening line as our first assistant turn.

        It is spoken via a raw TTSSpeakFrame, so without this the model has no
        idea it already introduced itself — and saying so in the system prompt
        was not enough; it greeted the same shopkeeper twice.
        """
        self._messages.append({"role": "assistant", "content": text})
        self._last_activity = time.monotonic()

    def mark_asked_in_greeting(self) -> None:
        """
        The opening line already asks objective #1, so count it as asked.
        Without this the agent's very next move repeats the question the callee
        just heard.
        """
        if self._objectives:
            # Fully consume it. Setting 1 left room under the cap, so the state
            # machine asked the very same question again as its first move —
            # the duplicate the callee noticed immediately.
            first = self._objectives[0]["key"]
            self._asks[first] = MAX_ASKS_PER_OBJECTIVE
            # The greeting asked it, so their first answer is a legitimate
            # response to it — otherwise we discard the very answer we asked for.
            self._just_asked_recently = {first}

    async def on_user_text(self, text: str, task, lang_code: str | None = None) -> None:
        if self._closing:
            return
        self._last_activity = time.monotonic()
        self._turn_id += 1        # new turn — the gate re-arms
        self._pending.append(text)
        # NOTE: do NOT clear _awaiting_counter_reply here. Clearing it on ANY
        # incoming text meant a cough, an "hmm" or a backchannel counted as
        # "they replied" and unlocked our next rung before the callee had
        # actually accepted or refused the price. The guard is now lifted only
        # by a SUBSTANTIVE reply — an affirmative, a refusal, or a number —
        # inside _respond, once we have seen what they actually said.

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
        # Start the watchdog only after they have spoken once. Starting it at
        # connect meant "हैलो, आप सुन रहे हैं?" fired while the greeting was
        # still playing.
        if self._watchdog is None:
            self._watchdog = asyncio.create_task(self._watch_silence(task))

    # ── the state machine ───────────────────────────────────────────────────

    def _next_goal(self) -> tuple[str, str]:
        """
        Decide what to do next. A pure function of slot state — no LLM involved.
        This is what makes an infinite re-ask impossible.
        """
        # 0. A counter-offer is still outstanding and the last thing we heard was
        #    not substantive (a cough, an "hmm", a backchannel). Do NOT counter
        #    again and — just as important — do NOT fall through to reading the
        #    deal back at their price. Hold: say nothing and give them room to
        #    actually accept or refuse. _respond clears this guard the moment a
        #    substantive reply lands.
        if self._awaiting_counter_reply:
            return "hold", ""

        # 1. An objective still unanswered, and not already asked twice?
        for o in self._objectives:
            k = o["key"]
            if k in self._slots or self._asks[k] >= MAX_ASKS_PER_OBJECTIVE:
                continue
            self._pending_ask = k  # counted in _respond, only once we SPEAK it
            if self._asks[k] == 0:
                return "ask", f"Ask this, in your own natural words: {o['ask']}"
            return "ask", (
                f"They did not answer clearly. Ask MUCH more simply, in different "
                f"words, and do not repeat your previous sentence: {o['ask']}"
            )

        # 2. Everything gathered — negotiate, if that is the mission.
        if self._mission_type == "negotiate" and self._target and self._best_price:
            if (
                self._best_price > self._target
                and self._counters < 3
                and not self._awaiting_counter_reply
            ):
                self._counters += 1
                self._awaiting_counter_reply = True
                step = (0.80, 0.88, 0.94)[self._counters - 1]
                offer = max(self._target, int(self._best_price * step))
                # A CONCESSION LADDER GOES UP, NOT DOWN.
                #
                # I previously clamped offers to never increase. That is
                # backwards and the callee called it out: they refused 5000 and
                # the agent came back with 4800. Lowering your offer after a
                # refusal is irrational and reads as insulting — when they say
                # no, you move TOWARD them.
                #
                # The only real ceiling is their own asking price: never offer
                # at or above what they are already asking, or you are
                # negotiating against yourself.
                prev_offer = self._last_offer
                if prev_offer is not None:
                    offer = max(offer, prev_offer)
                offer = min(offer, self._best_price - 1)
                # The ladder cannot advance: their price dropped enough that a
                # fresh rung would land at (or below) what we already offered.
                # Repeating the same figure is not a negotiation move, it is a
                # loop — take their price and close instead of saying "4840?"
                # twice. (Observed: they conceded 6000 -> 5000 and the agent kept
                # re-proposing its own 4840.)
                if prev_offer is not None and offer <= prev_offer:
                    self._awaiting_counter_reply = False
                    self._counters = 3  # ladder exhausted; go and confirm
                    return "confirm", (
                        f"They have come down to {self._best_price}, which is as good as "
                        f"you will get. Accept it warmly, read the whole deal back in ONE "
                        f"sentence, and ask them to confirm."
                    )
                self._last_offer = offer
                # NEVER bid above something they have already offered. The
                # ladder is computed off their quote, so once they concede the
                # next rung can land higher than their own latest number —
                # observed live: they said 5000 and the agent asked for 5280.
                # If the rung is not an improvement, take their price.
                if offer >= self._best_price:
                    self._awaiting_counter_reply = False
                    self._counters = 3  # ladder exhausted; go and confirm
                    return "confirm", (
                        f"They have come down to {self._best_price}, which is as good as "
                        f"you will get. Accept it warmly, read the whole deal back in ONE "
                        f"sentence, and ask them to confirm."
                    )
                cite = ""
                if self._prior_quotes:
                    q = min(self._prior_quotes, key=lambda x: x.get("priceInr", 10**9))
                    cite = (
                        f" You may cite that {q['shop']} quoted {q['priceInr']} rupees — "
                        f"a REAL quote from an earlier call. Say the shop name and the "
                        f"number exactly; never invent one."
                    )
                moved = (
                    f"You already offered less and they refused, so you are COMING UP to "
                    f"meet them. Frame it as movement on your side, not a fresh demand. "
                    if self._counters > 1
                    else ""
                )
                return "counter", (
                    f"{moved}Their price is {self._best_price}. Do NOT accept it. "
                    f"THE ONLY NUMBER YOU MAY SAY IS {offer}. Say {offer}, not "
                    f"{self._best_price}. Ask warmly, in one natural spoken sentence, "
                    f"whether they can do {offer}. Do NOT mention a budget or a "
                    f"maximum.{cite}"
                )

        # 2b. Their price is far above what we can do and the ladder is spent.
        #     Say so, honestly and warmly, instead of hanging up on them.
        # If their price is at or below what we last asked for, we WON — taking
        # that to a walk-away is nonsense. Live: it declined 3500 while its own
        # standing offer was 3760.
        if (
            self._best_price
            and self._last_offer
            and self._best_price <= self._last_offer
        ):
            self._deal_agreed = True

        if (
            self._mission_type == "negotiate"
            and self._target
            and self._best_price
            and self._best_price > self._target * 1.25
            and self._counters >= 3
            and not self._deal_agreed  # they accepted our price — that is a WIN
            and not self._walked_away  # latch: say it once, not every turn
        ):
            self._walked_away = True
            return "walkaway", (
                f"They will not go below {self._best_price}, and that is well above "
                f"what the customer can do. Tell them so plainly and warmly in ONE or "
                f"TWO sentences: thank them, say honestly that this is more than the "
                f"customer's budget allows so you cannot take it forward today, and "
                f"leave the door open in case their rate changes. Do NOT state the "
                f"customer's budget figure. Do not sound like a machine giving up — "
                f"sound like a person who is genuinely sorry it did not work out."
            )

        # 3. Read the deal back and close.
        # Only ever read back what we ACTUALLY have. When the price slot was
        # empty the model filled the gap with a literal "₹[price]" and said it
        # out loud. Never hand it a hole to improvise into.
        filled = {k: v for k, v in self._slots.items() if v is not None}
        pretty = {
            o["key"]: o["ask"].rstrip("?") for o in self._objectives
        }
        known = "; ".join(f"{pretty.get(k, k)}: {v}" for k, v in filled.items())

        missing_required = [
            o for o in self._objectives
            if o.get("required") and o["key"] not in filled
        ]
        if missing_required:
            return "confirm", (
                f"You could NOT get: {', '.join(o['ask'] for o in missing_required)}. "
                f"Do not invent it, do not use a placeholder, do not say a number you "
                f"were not given. Briefly confirm only what you DID learn"
                + (f" ({known})" if known else "")
                + ", say the customer will follow up on the rest, and thank them."
            )

        return "confirm", (
            f"Read this back in ONE sentence using these exact values, then ask them to "
            f"confirm: {known}. If you do not have their name, ask for it in the same "
            f"sentence. Never speak a placeholder or a field name."
        )

    # ── loop ────────────────────────────────────────────────────────────────

    async def _after_pause(self, task) -> None:
        # Hold a wider window while a counter is on the table — a price decision
        # comes slower and more fragmented than a factual answer.
        window = COUNTER_COALESCE_SECS if self._awaiting_counter_reply else COALESCE_SECS
        try:
            await asyncio.sleep(window)
        except asyncio.CancelledError:
            return
        utterance = " ".join(self._pending).strip()
        self._pending.clear()
        if utterance:
            self._reply = asyncio.create_task(self._respond(utterance, task))

    _YES = (
        "yes", "yeah", "yep", "haan", "han", "ha", "ji", "sahi", "correct", "right",
        "ok", "okay", "theek", "thik", "बिलकुल", "हाँ", "ठीक", "सही", "હા", "ஆம்",
    )

    def _is_affirmative(self, text: str) -> bool:
        # Token-aware, NOT substring. `w in t` matched "ha" inside "hai" and
        # "hazaar", so "rate hai chhe hazaar" and even "nahi bhai" read as
        # "yes". Harmless while the LLM lagged a turn behind the utterance, but
        # once code decides the goal from the SAME utterance that carried the
        # price, that false positive banked a counter nobody had accepted.
        toks = [w.strip(" .!?।,\"'") for w in text.lower().split()]
        return len(toks) <= 4 and any(w in self._YES for w in toks)

    async def _respond(self, utterance: str, task) -> None:
        if self._closing:
            return

        # They confirmed the read-back. We have what we came for — say thanks
        # and hang up. Without this the agent kept re-confirming while the
        # callee answered "Yes" four times over 112 seconds.
        missing = [
            o for o in self._objectives
            if o.get("required") and o["key"] not in self._slots
        ]
        if self._confirmed and self._is_affirmative(utterance) and not missing:
            logger.info(f"[{self._state.call_id}] deal confirmed — closing")
            await self._close(task)
            return
        if self._confirmed and missing:
            # They said yes, but to something else — we still do not have what
            # we came for. Observed live: the callee answered "Yes, it is"
            # about the ROOM, we read it as agreeing the whole deal, and hung
            # up before they could ever state a price.
            logger.info(
                f"[{self._state.call_id}] 'yes' but still missing "
                f"{[o['key'] for o in missing]} — not closing"
            )
            self._confirmed = False
            for o in missing:
                self._asks[o["key"]] = 0  # give it another honest attempt
        self._turns += 1
        if self._turns > MAX_TURNS:
            await self._close(task)
            return

        self._messages.append({"role": "user", "content": utterance})

        # PASS 1 — EXTRACTION. Read what they JUST said, BEFORE any goal is
        # chosen. Deciding the goal off pre-fold slot state was a one-turn lag:
        # their price landed but the goal was still "ask the price", so we
        # re-asked it and only countered a turn later — landing that counter on
        # top of the next (often empty) utterance. Extract, fold, THEN decide.
        try:
            heard = await self._extract(utterance)
        except asyncio.CancelledError:
            self._messages.pop()  # superseded; don't poison the history
            raise
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[{self._state.call_id}] extract failed: {e}")
            heard = {}

        # Fold in anything they told us, whether or not we asked for it.
        rejected_price = False
        self._just_heard = {}
        price_just_landed = False
        had_price = self._best_price is not None
        affirmative = self._is_affirmative(utterance)
        for k, v in (heard or {}).items():
            if v is None or k not in self._asks:
                continue

            # UNSOLICITED BOOLEANS ARE NOISE. Asked for the price, the model
            # also volunteered hasRoom=False — while the callee had just said
            # "Yes, it is available". The agent then announced "so it's not
            # available" and the whole call went sideways off one hallucinated
            # field. Only believe a boolean for the objective we actually just
            # asked, and never believe a False when they just said yes.
            if isinstance(v, bool):
                if k != self._pending_ask and k not in self._just_asked_recently:
                    logger.info(f"[{self._state.call_id}] ignoring unsolicited {k}={v}")
                    continue
                # A False needs actual evidence of denial. Without it we end up
                # announcing "so it's not available" to someone who never said
                # that — the single worst failure mode on these calls.
                if v is False and not _NEGATIVE.search(utterance):
                    logger.info(
                        f"[{self._state.call_id}] {k}=False with no denial heard "
                        f"— treating as unanswered"
                    )
                    continue
                if v is False and affirmative:
                    logger.info(
                        f"[{self._state.call_id}] model said {k}=False but they were "
                        f"affirmative — recording True"
                    )
                    v = True

            # TYPE CHECK. The model returned pricePerNight=False — a boolean
            # for a money slot. That counted as "filled", so the agent never
            # asked the price and jumped straight to confirming a deal with no
            # number in it. A slot may only be filled by a value of its own
            # declared type.
            want = self._types.get(k, "text")
            if want == "money":
                # 0 is not a price. It slipped past the sanity band (which only
                # looks at values > 100) and marked the slot filled, so the
                # agent stopped asking and confirmed a deal worth nothing.
                if isinstance(v, bool) or not isinstance(v, (int, float)) or v <= 0:
                    logger.info(f"[{self._state.call_id}] ignoring {k}={v!r} (want money)")
                    continue
            elif want == "number":
                if isinstance(v, bool) or not isinstance(v, (int, float)) or v <= 0:
                    logger.info(f"[{self._state.call_id}] ignoring {k}={v!r} (want {want})")
                    continue
            elif want == "boolean":
                if not isinstance(v, bool):
                    logger.info(f"[{self._state.call_id}] ignoring {k}={v!r} (want bool)")
                    continue

            # PRICE SANITY. Telephone STT fragments numbers badly: a real
            # "6000" arrived as "A 6000" then "86000", the coalescer glued
            # them, and the deal sheet recorded Rs 86,000/night against a
            # Rs 4,000 target. A figure that far out is a transcription
            # artefact, not an expensive hotel. Drop it and ask again.
            if isinstance(v, (int, float)) and v > 100 and self._target:
                if (v > self._target * 6 or v < self._target * 0.15) and \
                        self._odd_price_seen != int(v):
                    # First time only. Saying the same figure twice is
                    # evidence, not a transcription artefact — live, a seller
                    # repeated 60000 three times against an 8000 target and we
                    # kept telling them we hadn't caught it.
                    self._odd_price_seen = int(v)
                    logger.warning(
                        f"[{self._state.call_id}] implausible price {v} vs target "
                        f"{self._target} - treating as misheard, re-asking"
                    )
                    self._asks[k] = max(0, self._asks[k] - 1)
                    rejected_price = True
                    continue

            self._slots[k] = v
            self._just_heard[k] = v   # echoed implicitly in the next question
            if isinstance(v, (int, float)) and v > 100:
                # Keep their BEST (lowest) offer, not the latest. They conceded
                # 6000 -> 5000, and tracking only the latest made the next
                # ladder step bid 5280 — above an offer already on the table.
                self._best_price = (
                    int(v) if self._best_price is None else min(self._best_price, int(v))
                )
                self._their_price = int(v)
                if not had_price:
                    price_just_landed = True
        if heard:
            logger.info(f"[{self._state.call_id}] extracted {heard}; slots={self._slots}")

        # A SUBSTANTIVE reply — an affirmative, a refusal, or a number — is what
        # lifts the counter guard. A cough, an "hmm" or a backchannel must not.
        # (This is the other half of the guard fix; on_user_text no longer
        # clears it on every utterance.)
        if self._awaiting_counter_reply and self._is_substantive(utterance, heard):
            self._awaiting_counter_reply = False
            # Did they ACCEPT our standing offer, or move again? An affirmative
            # with NO fresh number means they took our last_offer — bank it as
            # the deal so the next goal confirms it instead of haggling on past
            # their yes (previously we won 5280, heard "yes", then confirmed the
            # original 6000 because the accepted figure was never written back).
            # A new number is a concession/counter and is left to the ladder.
            heard_price = any(
                self._types.get(k) in ("money", "number") for k in (heard or {})
            )
            if (
            self._last_offer
            and self._is_affirmative(utterance)
            and not heard_price
            # A bare fragment is not agreement to a price. "हाँ मैं।" is a
            # false start, not a deal — it banked our own 4800 as theirs.
            and len(utterance.split()) >= 2
            and not _NEGATIVE.search(utterance)
            and not _HEDGE.search(utterance)
        ):
                logger.info(f"[{self._state.call_id}] counter accepted at {self._last_offer}")
                self._best_price = self._last_offer
                for o in self._objectives:
                    if o.get("type") == "money":
                        self._slots[o["key"]] = self._last_offer
                self._counters = 3        # done haggling
                self._deal_agreed = True  # we WON — never walk away now

        # They pushed back after we banked a price. Undo it and reopen — the
        # agent confirmed 4800 straight through an explicit "नहीं नहीं, कोई
        # डिस्काउंट नहीं है" and then hung up mid-objection.
        if _NEGATIVE.search(utterance) and self._deal_agreed:
            logger.info(
                f"[{self._state.call_id}] refusal after agreement — reverting "
                f"{self._best_price} to their last stated price {self._their_price}"
            )
            self._deal_agreed = False
            self._confirmed = False
            if self._their_price:
                self._best_price = self._their_price
                for o in self._objectives:
                    if o.get("type") == "money":
                        self._slots[o["key"]] = self._their_price

        goal_kind, instruction = self._next_goal()

        # HOLD: a counter is on the table and nothing substantive came back. Say
        # nothing and give them room — do NOT counter again, and do NOT fall
        # through to reading the deal back at their price. This is the fix for
        # "the callee gets no room to answer at a price point".
        if goal_kind == "hold":
            logger.info(
                f"[{self._state.call_id}] holding — awaiting a real answer to our counter"
            )
            self._last_activity = time.monotonic()
            return

        # PASS 2 — PHRASING. The goal is already decided by code; the model only
        # puts it into words. On a rejected price we do not phrase at all — the
        # reply that quoted the bad figure ("so that's ₹86,000, correct?") was
        # generated in the same breath as the figure. Say a fixed request to
        # repeat the number instead.
        if rejected_price:
            reply = {
                "hi-IN": "माफ़ कीजिए, नंबर ठीक से सुनाई नहीं दिया — rate फिर से बता दीजिए?",
                "en-IN": "Sorry, I didn't catch that number — could you say the rate again?",
            }.get(self._reply_lang, "Sorry, could you repeat the rate please?")
        else:
            try:
                reply = await self._phrase(instruction)
            except asyncio.CancelledError:
                self._messages.pop()  # superseded; don't poison the history
                raise
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[{self._state.call_id}] phrase failed: {e}")
                return

        if not reply:
            return

        sig = (
            goal_kind,
            tuple(sorted((k, str(v)) for k, v in self._slots.items())),
            self._last_offer,
        )
        if sig == self._last_sig:
            self._stall += 1
            logger.info(
                f"[{self._state.call_id}] same goal+numbers as last turn "
                f"({goal_kind}) — not saying it twice"
            )
            for o in self._objectives:
                if o["key"] not in self._slots:
                    self._asks[o["key"]] = MAX_ASKS_PER_OBJECTIVE
                    break
            if self._stall >= 2:
                await self._close(task)
            return
        self._last_sig = sig

        last_agent = next(
            (m["content"] for m in reversed(self._messages) if m["role"] == "assistant"), ""
        )
        if last_agent and _similar(reply, last_agent) > 0.7:
            self._stall += 1
            logger.info(f"[{self._state.call_id}] near-repeat #{self._stall} - advancing")
            # Do NOT hang up on someone because OUR phrasing repeated - that is
            # us cutting the call on them. Burn the current objective so
            # _next_goal moves on, and say a short acknowledgement instead of
            # the duplicate sentence.
            for o in self._objectives:
                if o["key"] not in self._slots:
                    self._asks[o["key"]] = MAX_ASKS_PER_OBJECTIVE
                    break
            if self._stall >= 3:
                await self._close(task)
                return
            # No second utterance, no canned filler. Burn the stuck objective
            # (done above) and let the NEXT user turn get a fresh goal. Saying
            # anything at all here is what produced the repetition.
            # Three, not two — and never while the negotiation still has rungs
            # left. We cut a callee off mid-sentence at strike two.
            ladder_live = (
                self._mission_type == "negotiate"
                and self._best_price
                and self._counters < 3
            )
            if self._stall >= 3 and not ladder_live:
                await self._close(task)
            return
        else:
            self._stall = 0

        if self._disclosure:
            reply = f"{self._disclosure} {reply}"
            self._disclosure = None

        self._messages.append({"role": "assistant", "content": reply})
        self._convex.turn(self._state.call_id, "agent", reply)
        self._state.transcript.append(
            {"seq": self._state.turn_seq, "role": "agent", "text": reply}
        )
        self._state.turn_seq += 1
        await self._say(task, reply)
        self._last_activity = time.monotonic()

        # We used to close 6s after the readback, which hung up on people
        # mid-sentence. Let the silence watchdog end the call instead - it
        # already waits for a genuine pause.
        if goal_kind == "confirm":
            self._confirmed = True

        # We have said our piece about the price. Give them a moment to react
        # (they often improve the offer right here), then close politely.
        if goal_kind == "walkaway":
            # Give them a beat to improve the offer — they often do, right
            # here — then close. Do not restate the decline.
            await asyncio.sleep(7.0)
            if not self._closing:
                await self._close(task)

    # Refusal / rejection markers, across the Indic languages we see most. Used
    # only to decide whether an utterance is SUBSTANTIVE enough to lift the
    # counter guard — never to drive the state machine.
    _NO = (
        "no", "nope", "nah", "nahi", "nahin", "na", "mat", "nako", "venda",
        "illai", "cannot", "can't", "cant", "won't", "wont", "नहीं", "ना", "मत",
    )
    _HINDI_NUM_WORDS = (
        "hazaar", "hazar", "sau", "lakh", "ek", "do", "teen", "char", "paanch",
        "panch", "chhe", "che", "saat", "aath", "nau", "das",
    )

    def _is_substantive(self, utterance: str, heard: dict) -> bool:
        """
        Did the callee actually respond to our counter, or just make noise?

        A price decision is answered by an ACCEPTANCE, a REFUSAL, or a NUMBER.
        Everything else — "hmm", "achha", a cough, silence broken by a
        throat-clear — is a backchannel and must NOT be read as "they replied",
        or we counter over them before they have decided. Kept deliberately
        wide: when unsure, treat it as substantive rather than talk over them.
        """
        if heard:  # the extractor pulled a real slot value out of it
            return True
        t = utterance.lower()
        toks = {w.strip(" .!?।,") for w in t.split()}
        if self._is_affirmative(utterance):
            return True
        if toks & set(self._NO):
            return True
        if _NUM.search(t):
            return True
        if toks & set(self._HINDI_NUM_WORDS):
            return True
        return False

    async def _extract(self, utterance: str) -> dict:
        """
        PASS 1 — a cheap, directive-free read of the caller's last utterance.

        Split out from phrasing on purpose: one call doing extraction AND
        obeying a turn directive AND writing a sentence is what produced
        hallucinated slots (hasRoom=False on a price turn), directive example
        text spoken aloud, and the wrong number said. This pass has ONE job —
        report what they said — so it cannot be pulled off task by the goal.
        """
        keys = ", ".join(f'"{o["key"]}"' for o in self._objectives) or '"none"'
        extractor = {
            "role": "system",
            "content": (
                f"You are a transcription analyst, not a speaker. Do NOT reply to the "
                f"caller, do NOT negotiate, do NOT ask anything.\n"
                f'The caller just said: "{utterance}"\n'
                f"Report ONLY what THIS line states, as JSON: {{\"heard\": {{}}}}\n"
                f'"heard" is keyed by: {keys}. Integers in rupees for money/number slots, '
                f"true/false for yes/no slots. Omit any key they did not actually address "
                f"in this line — never guess a number, never invent a boolean, never carry "
                f"a value over from earlier. If they said nothing informative, return "
                f'{{"heard": {{}}}}.'
            ),
        }
        convo = [self._messages[0]] + self._messages[-6:] + [extractor]
        r = await self._client.post(
            SARVAM_CHAT,
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={
                "model": os.getenv("LLM_MODEL", "sarvam-30b"),
                "messages": convo,
                "max_tokens": 120,
                "temperature": 0.0,
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
                return {}
            data = json.loads(content[a : b + 1])
        return data.get("heard") or {}

    async def _phrase(self, instruction: str) -> str:
        """
        PASS 2 — put the ALREADY-DECIDED goal into one spoken sentence.

        Code has chosen the move (ask / counter / confirm / walkaway) and the
        exact number; this pass only phrases it. It is told the facts are
        already recorded so it does not re-extract, and it may not introduce a
        number of its own — removing the class of bug where the directive named
        one figure and the model spoke another.
        """
        director = {
            "role": "system",
            "content": (
                f"YOUR NEXT MOVE: {instruction}\n"
                + (
                    f"ACKNOWLEDGE what they just told you inside that same sentence, "
                    f"briefly and naturally — they said {self._just_heard}. Repeat the "
                    f"key value back as part of your question rather than as a separate "
                    f"'did I hear that right?'. One sentence does both jobs.\n"
                    if self._just_heard
                    else ""
                )
                + f"NEVER ask them to confirm a number that YOU proposed — only ever a "
                f"number THEY gave you.\n"
                f"Say ONLY the number named in YOUR NEXT MOVE, if any; do not invent, "
                f"round, or substitute a different figure.\n"
                f"ALREADY KNOWN — never ask about these again: "
                f"{json.dumps(self._slots, ensure_ascii=False) if self._slots else 'nothing yet'}\n"
                f"Anything NOT in that list is UNKNOWN. Never say or imply it is "
                f"unavailable, sold out, booked, or refused — you have not been told "
                f"that. State only what is listed above.\n"
                f"LANGUAGE: reply in {self._reply_lang}, matching the caller.\n"
                f"LENGTH: ONE spoken sentence, under 25 words. No markdown, no lists.\n"
                f"NEVER speak a placeholder like [price] or [name] — if you do not have "
                f"a value, ask for it instead. NEVER say an internal field name such as "
                f"like hasRoom or pricePerNight; use ordinary words.\n"
                f"NEVER assert something they have not told you — no 'so it's not "
                f"available', no invented price, no assumed sold-out. If you don't "
                f"know, ask.\n\n"
                f'Return ONLY JSON: {{"reply": "..."}} — "reply" is exactly what you '
                f"will speak next, nothing else."
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
                return content.strip()[:300]  # salvage — better than silence
            data = json.loads(content[a : b + 1])
        return (data.get("reply") or "").strip()

    # ── exits ───────────────────────────────────────────────────────────────

    async def _say(self, task, text: str, *, force: bool = False) -> None:
        """
        The ONLY way anything is ever spoken.

        Serialised by a lock and stamped with the current turn id. A second
        utterance for a turn that already spoke is dropped and logged, never
        queued — no matter which branch produced it or what language it is in.

        `force=True` is for the closing line only: hanging up silently is worse
        than one extra sentence, and by then the call is ending anyway.
        """
        async with self._speech_lock:
            if not force and self._spoke_turn == self._turn_id:
                logger.warning(
                    f"[{self._state.call_id}] DROPPED duplicate utterance for "
                    f"turn {self._turn_id}: {text[:70]!r}"
                )
                return
            self._spoke_turn = self._turn_id
            await task.queue_frame(TTSSpeakFrame(text))

    async def _close(self, task) -> None:
        if self._closing:
            return
        self._closing = True
        line = (
            WALKAWAY_CLOSE.get(self._reply_lang, WALKAWAY_CLOSE["en-IN"])
            if self._walked_away
            else CLOSE.get(self._reply_lang, CLOSE["en-IN"])
        )
        await self._say(task, line, force=True)
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
                # Never nudge while a reply is being composed or spoken — that
                # is how we ended up talking over someone mid-sentence.
                if (self._reply and not self._reply.done()) or (
                    self._timer and not self._timer.done()
                ):
                    self._last_activity = time.monotonic()
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
