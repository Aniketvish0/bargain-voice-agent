"""
Doot — the Pipecat voice pipeline. BUILD-SPEC §6.

Every service setting in here was verified by introspecting pipecat-ai 1.6.0
directly, not from docs. The three that matter and are easy to get wrong:

  1. reasoning_effort=None on the LLM.
     Reasoning is ON by default on sarvam-30b and its tokens count toward
     max_tokens. Reproduced live: with max_tokens=60 and defaults, `content`
     came back null, all 60 tokens went to reasoning, finish_reason="length".
     On a phone call that is dead silence with no error to debug.

  2. STT at 16000 Hz, not Twilio's 8000.
     A Saaras VAD frame is 512 SAMPLES, not a duration: 64ms at 8kHz, 32ms at
     16kHz. With the default negative_frames_count=18 that is 1152ms of silence
     before end-of-speech is even admitted. Upsampling halves the frame for
     free and Pipecat resamples for us. Combined with count=6 this saves
     ~960ms on EVERY turn.

  3. The VAD knobs live on SarvamSTTSettings, NOT on InputParams.
     InputParams only carries language/prompt/mode/vad_signals/high_vad_sensitivity.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import (
    EndFrame,
    Frame,
    LLMFullResponseEndFrame,
    LLMRunFrame,
    LLMTextFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    TTSUpdateSettingsFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.sarvam.llm import SarvamLLMService, SarvamLLMSettings
from pipecat.services.sarvam.stt import SarvamSTTService, SarvamSTTSettings
from pipecat.services.sarvam.tts import SarvamTTSService, SarvamTTSSettings

from convex_client import ConvexClient
from prompts import BOT_ANSWER, BOW_OUT, build_system_prompt, line, opening_line

# ── Verified bulbul:v3 voices. `anushka` is v2 and 400s on v3. ──────────────
VOICE_BY_LANG: dict[str, str] = {
    "hi-IN": "simran", "en-IN": "anand", "bn-IN": "shreya", "gu-IN": "pooja",
    "kn-IN": "priya", "ml-IN": "rupali", "mr-IN": "neha", "od-IN": "suhani",
    "pa-IN": "tanya", "ta-IN": "kavya", "te-IN": "ishita",
}
TTS_11 = set(VOICE_BY_LANG)

# Fires BEFORE the LLM sees the turn. See BowOutDetector.
import re

BOW_OUT_RE = re.compile(
    r"don'?t call|stop calling|remove my number|not interested|who is this|"
    r"is this a robot|कॉल मत|फ़?ोन मत|परेशान|नंबर हटा",
    re.IGNORECASE,
)
BOT_QUESTION_RE = re.compile(
    r"\b(are you a (bot|robot|machine|human)|is this a (bot|robot|recording)|"
    r"aap robot|tum robot|मशीन|रोबोट)\b",
    re.IGNORECASE,
)


@dataclass
class CallState:
    call_id: str
    phone: str
    language: str
    user_first_name: str
    lang_streak: int = 0
    switched: list[str] = field(default_factory=list)
    turn_seq: int = 0
    bowed_out: bool = False
    # Shared list object, also held by server.TRANSCRIPTS, so the post-call
    # extractor can read the conversation without a round trip to Convex.
    transcript: list[dict[str, Any]] = field(default_factory=list)


class TranscriptTap(FrameProcessor):
    """
    Mirrors every final transcript into Convex and handles the two reflexes
    that must fire before the LLM sees the text.

    Sits directly after the STT service so it sees vendor speech first.
    """

    def __init__(self, state: CallState, convex: ConvexClient, task_ref: dict[str, Any]):
        super().__init__()
        self._state = state
        self._convex = convex
        self._task_ref = task_ref  # populated after PipelineTask is constructed

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            st = self._state
            text = frame.text.strip()
            lang_code = getattr(frame, "language", None)
            lang_code = str(lang_code) if lang_code else None

            self._convex.turn(
                st.call_id, "vendor", text, final=True, lang_code=lang_code
            )
            st.transcript.append(
                {"seq": st.turn_seq, "role": "vendor", "text": text, "lang": lang_code}
            )
            st.turn_seq += 1

            # ── Reflex 1: they want out. Hang up within 2s, blacklist forever.
            if BOW_OUT_RE.search(text) and not st.bowed_out:
                st.bowed_out = True
                logger.warning(f"[{st.call_id}] bow-out triggered by: {text!r}")
                self._convex.dnc(st.phone, f"Callee said: {text[:120]}", st.call_id)
                self._convex.turn(st.call_id, "system", "BOW_OUT — hanging up, number blacklisted")
                task = self._task_ref.get("task")
                if task:
                    await task.queue_frames(
                        [TTSSpeakFrame(BOW_OUT.get(st.language, BOW_OUT["en-IN"]))]
                    )
                    await task.queue_frame(EndFrame())
                return  # never forward to the LLM

            # ── Reflex 2: "are you a bot?" — scripted, never generated.
            if BOT_QUESTION_RE.search(text):
                answer = BOT_ANSWER.get(st.language, BOT_ANSWER["en-IN"]).format(
                    name=st.user_first_name
                )
                task = self._task_ref.get("task")
                if task:
                    await task.queue_frame(TTSSpeakFrame(answer))
                self._record_agent(answer)
                return

            # ── Mid-call language switch. BUILD-SPEC §8(c).
            await self._maybe_switch_language(lang_code)

        await self.push_frame(frame, direction)

    def _record_agent(self, text: str) -> None:
        st = self._state
        self._convex.turn(st.call_id, "agent", text)
        st.transcript.append({"seq": st.turn_seq, "role": "agent", "text": text})
        st.turn_seq += 1

    async def _maybe_switch_language(self, lang_code: str | None) -> None:
        """
        Hysteresis matters: without it this flaps every turn and the voice
        stutters. Two consecutive confident finals in the same new language.
        """
        st = self._state
        if not lang_code or lang_code == st.language or lang_code not in TTS_11:
            st.lang_streak = 0
            return

        st.lang_streak += 1
        if st.lang_streak < 2:
            return

        old, new = st.language, lang_code
        voice = VOICE_BY_LANG[new]
        logger.info(f"[{st.call_id}] language switch {old} -> {new} (voice {voice})")

        task = self._task_ref.get("task")
        if task:
            await task.queue_frame(
                TTSUpdateSettingsFrame(settings={"language": new, "voice": voice})
            )
        self._convex.lang_switch(st.call_id, old, new, 0.9)
        self._convex.turn(st.call_id, "system", f"Language switched {old} → {new}")
        st.language = new
        st.switched.append(new)
        st.lang_streak = 0


class AgentTap(FrameProcessor):
    """
    Captures what the agent actually says.

    Sits after the LLM and accumulates LLMTextFrame chunks, flushing one
    complete utterance per LLMFullResponseEndFrame. Per-chunk would write a
    Convex row per token; reading from TTS would miss anything TTS dropped.
    """

    def __init__(self, state: CallState, convex: ConvexClient):
        super().__init__()
        self._state = state
        self._convex = convex
        self._buf: list[str] = []

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMTextFrame) and frame.text:
            self._buf.append(frame.text)
        elif isinstance(frame, LLMFullResponseEndFrame):
            text = "".join(self._buf).strip()
            self._buf.clear()
            if text:
                st = self._state
                self._convex.turn(st.call_id, "agent", text)
                st.transcript.append({"seq": st.turn_seq, "role": "agent", "text": text})
                st.turn_seq += 1

        await self.push_frame(frame, direction)


def build_pipeline(
    *,
    brief: dict[str, Any],
    state: CallState,
    convex: ConvexClient,
    transport,
) -> PipelineTask:
    api_key = os.environ["SARVAM_API_KEY"]
    language = state.language
    voice = VOICE_BY_LANG.get(language, "simran")

    category = brief.get("brief", {}).get("category", "")
    must_haves = " ".join(brief.get("brief", {}).get("constraints", [])[:3])

    # ── STT ─────────────────────────────────────────────────────────────────
    stt = SarvamSTTService(
        api_key=api_key,
        model="saaras:v3",
        mode=os.getenv("STT_MODE", "transcribe"),  # transcribe wins on numerals
        sample_rate=int(os.getenv("STT_SAMPLE_RATE", "16000")),  # NOT 8000 — see header
        input_audio_codec="pcm_s16le",
        keepalive_interval=5.0,  # Sarvam closes idle sockets at 60s
        settings=SarvamSTTSettings(
            language="unknown",  # ← this is what turns auto-detection ON
            vad_signals=True,
            high_vad_sensitivity=False,  # the demo hall is loud
            negative_frames_count=int(os.getenv("STT_NEG_FRAMES", "6")),  # default 18
            negative_frames_window=int(os.getenv("STT_NEG_WINDOW", "8")),  # default 24
            min_speech_frames=2,
            first_turn_min_speech_frames=4,  # they answer fast
            positive_speech_threshold=0.6,
            negative_speech_threshold=0.45,
            # Bias the recogniser toward the words we cannot afford to lose.
            prompt=f"hazaar lakh rupaye GST delivery warranty {category} {must_haves}".strip(),
        ),
    )

    # ── LLM ─────────────────────────────────────────────────────────────────
    llm = SarvamLLMService(
        api_key=api_key,
        settings=SarvamLLMSettings(
            model=os.getenv("LLM_MODEL", "sarvam-30b"),
            max_tokens=int(os.getenv("LLM_MAX_TOKENS", "100")),
            temperature=0.4,
            reasoning_effort=None,  # ← MANDATORY. See the header. Never remove.
        ),
    )

    # ── TTS ─────────────────────────────────────────────────────────────────
    tts = SarvamTTSService(
        api_key=api_key,
        model="bulbul:v3",
        voice_id=voice,
        sample_rate=8000,  # the phone leg is 8k; Pipecat resamples for us
        settings=SarvamTTSSettings(
            language=language,
            pace=1.0,
            enable_preprocessing=True,  # speaks prices as words, not digits
            min_buffer_size=int(os.getenv("TTS_MIN_BUFFER", "25")),  # faster first byte
        ),
    )

    system_prompt = build_system_prompt(
        mission_type=brief.get("missionType", "negotiate"),
        language=language,
        user_first_name=state.user_first_name,
        category=category,
        locality=brief.get("brief", {}).get("locality", ""),
        constraints=brief.get("brief", {}).get("constraints", []),
        objectives=brief.get("brief", {}).get("objectives", []),
        target_price_inr=brief.get("brief", {}).get("targetPriceInr"),
        walk_away_inr=brief.get("brief", {}).get("walkAwayInr"),
        prior_quotes=brief.get("priorQuotes", []),
        learned_prefs=brief.get("learnedPrefs", []),
    )

    context = LLMContext([{"role": "system", "content": system_prompt}])
    aggregators = LLMContextAggregatorPair(context)

    task_ref: dict[str, Any] = {}
    tap = TranscriptTap(state, convex, task_ref)
    agent_tap = AgentTap(state, convex)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            tap,           # vendor side + the two reflexes + language switching
            aggregators.user(),
            llm,
            agent_tap,     # agent side
            tts,
            transport.output(),
            aggregators.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=8000,
            audio_out_sample_rate=8000,
            allow_interruptions=os.getenv("ALLOW_INTERRUPTIONS", "true").lower() == "true",
        ),
    )
    task_ref["task"] = task

    @transport.event_handler("on_client_connected")
    async def _on_connect(_transport, _client):
        """
        The agent speaks FIRST. The opening line carries the AI disclosure and
        the recording notice inside the first four seconds — that is both the
        ethical floor and, on stage, the answer to "isn't this spam?".
        """
        logger.info(f"[{state.call_id}] connected — speaking disclosure")
        ask = category + (
            f" in {brief.get('brief', {}).get('locality', '')}"
            if brief.get("brief", {}).get("locality")
            else ""
        )
        greeting = opening_line(language, state.user_first_name, ask)
        convex.consent(
            call_id=state.call_id,
            phone=state.phone,
            language=language,
            disclosure_text=greeting,
        )
        convex.turn(state.call_id, "agent", greeting)
        state.transcript.append({"seq": state.turn_seq, "role": "agent", "text": greeting})
        state.turn_seq += 1
        await task.queue_frame(TTSSpeakFrame(greeting))

    @transport.event_handler("on_client_disconnected")
    async def _on_disconnect(_transport, _client):
        logger.info(f"[{state.call_id}] disconnected")
        await task.cancel()

    return task
