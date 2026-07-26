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
    TranscriptionFrame,
    TTSSpeakFrame,
    TTSUpdateSettingsFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.sarvam.stt import SarvamSTTService, SarvamSTTSettings
from pipecat.services.sarvam.tts import SarvamTTSService, SarvamTTSSettings
from pipecat.transcriptions.language import Language

from convex_client import ConvexClient
from conversation import ConversationDriver
from prompts import (
    BOT_ANSWER, BOW_OUT, build_system_prompt, disclosure_line, line, opening_line,
)

# ── Verified bulbul:v3 voices. `anushka` is v2 and 400s on v3. ──────────────
VOICE_BY_LANG: dict[str, str] = {
    "hi-IN": "simran", "en-IN": "anand", "bn-IN": "shreya", "gu-IN": "pooja",
    "kn-IN": "priya", "ml-IN": "rupali", "mr-IN": "neha", "od-IN": "suhani",
    "pa-IN": "tanya", "ta-IN": "kavya", "te-IN": "ishita",
}
TTS_11 = set(VOICE_BY_LANG)

# Pipecat maps a Language ENUM to Sarvam's code. Passing the raw string
# "hi-IN" silently falls through to en-IN — the call goes out in English with
# an English voice and nothing errors anywhere. Always convert.
LANG_ENUM: dict[str, Language] = {
    "hi-IN": Language.HI_IN, "en-IN": Language.EN_IN, "bn-IN": Language.BN_IN,
    "gu-IN": Language.GU_IN, "kn-IN": Language.KN_IN, "ml-IN": Language.ML_IN,
    "mr-IN": Language.MR_IN, "od-IN": Language.OR_IN, "pa-IN": Language.PA_IN,
    "ta-IN": Language.TA_IN, "te-IN": Language.TE_IN,
}

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

    def __init__(
        self,
        state: CallState,
        convex: ConvexClient,
        task_ref: dict[str, Any],
        conversation: "ConversationDriver",
    ):
        super().__init__()
        self._state = state
        self._convex = convex
        self._task_ref = task_ref  # populated after PipelineTask is constructed
        self._conversation = conversation

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
                    # Through the gate, not around it — this used to be able to
                    # land on top of a reply already in flight.
                    await self._conversation.speak_scripted(
                        task, BOW_OUT.get(st.language, BOW_OUT["en-IN"]), terminal=True
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
                    await self._conversation.speak_scripted(task, answer, terminal=True)
                self._record_agent(answer)
                return

            # ── Mid-call language switch. BUILD-SPEC §8(c).
            await self._maybe_switch_language(lang_code)

            # ── Answer them. This is the conversation loop.
            task = self._task_ref.get("task")
            if task:
                await self._conversation.on_user_text(text, task, lang_code)

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
        # A two-word reply is not evidence of a language change. Saaras happily
        # labels noisy fragments as Bengali/Gujarati; requiring some substance
        # stops one bad detection from flipping the whole call.
        if len(st.transcript) and len((st.transcript[-1].get("text") or "").split()) < 3:
            return

        st.lang_streak += 1
        if st.lang_streak < 2:
            return

        old, new = st.language, lang_code
        voice = VOICE_BY_LANG[new]
        logger.info(f"[{st.call_id}] language switch {old} -> {new} (voice {voice})")

        # Change the LANGUAGE, keep the VOICE. Swapping speaker mid-call makes
        # it sound like a different person picked up our end — the callee
        # adapting to us is exactly what we are trying to avoid.
        task = self._task_ref.get("task")
        if task:
            await task.queue_frame(
                TTSUpdateSettingsFrame(
                    settings={"language": LANG_ENUM.get(new, Language.HI_IN)}
                )
            )
        self._convex.lang_switch(st.call_id, old, new, 0.9)
        self._convex.turn(st.call_id, "system", f"Language switched {old} → {new}")
        st.language = new
        st.switched.append(new)
        st.lang_streak = 0


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
        mode=os.getenv("STT_MODE", "transcribe"),  # transcribe wins on numerals
        # Must MATCH the transport's 8000. Setting 16000 here (to halve the
        # 512-sample VAD frame) starves the VAD: audio arrives at the wrong
        # rate, speech is never detected, and the agent goes deaf while
        # everything logs clean. We keep the latency win via
        # negative_frames_count instead: 6 x 64ms = 384ms, vs 18 x 64 = 1152ms.
        sample_rate=int(os.getenv("STT_SAMPLE_RATE", "8000")),
        # NOTE: do NOT set input_audio_codec. Sarvam's raw WS documents
        # wav|pcm_s16le|pcm_l16|pcm_raw, but Pipecat's AudioData model is a
        # literal that accepts ONLY 'audio/wav'. Passing pcm_s16le makes every
        # single audio frame fail validation, so the agent talks and hears
        # nothing — a call that looks fine and is completely deaf.
        keepalive_interval=5.0,  # Sarvam closes idle sockets at 60s
        settings=SarvamSTTSettings(
            model="saaras:v3",   # belongs in settings; the ctor arg is deprecated
            language="unknown",  # ← this is what turns auto-detection ON
            # OFF. With vad_signals on, Sarvam emits START_SPEECH and the
            # Pipecat STT service turns that into a broadcast interruption,
            # which cancels in-flight TTS — even with allow_interruptions=False
            # on PipelineParams. The callee's "hello" on pickup then kills the
            # greeting and they hear pure silence. Transcripts still arrive
            # normally without these events; only barge-in is lost.
            vad_signals=False,
            high_vad_sensitivity=False,  # the demo hall is loud
            negative_frames_count=int(os.getenv("STT_NEG_FRAMES", "6")),  # default 18
            negative_frames_window=int(os.getenv("STT_NEG_WINDOW", "8")),  # default 24
            min_speech_frames=2,
            first_turn_min_speech_frames=4,  # they answer fast
            positive_speech_threshold=0.6,
            negative_speech_threshold=0.45,
            # NOTE: no `prompt=`. saaras:v3 rejects it outright with
            # "Model 'saaras:v3' does not support prompt parameter." The
            # recogniser-biasing trick only works on other Sarvam STT models.
        ),
    )

    # ── TTS ─────────────────────────────────────────────────────────────────
    tts = SarvamTTSService(
        api_key=api_key,
        voice_id=voice,
        sample_rate=8000,  # the phone leg is 8k; Pipecat resamples for us
        settings=SarvamTTSSettings(
            model="bulbul:v3",
            language=LANG_ENUM.get(language, Language.HI_IN),  # enum, NOT a string
            pace=1.0,
            enable_preprocessing=True,  # speaks prices as words, not digits
            # min_buffer_size has an undocumented VALID RANGE. Probed live:
            # 50/100/150/200 accepted; 25 and 500+ rejected with 422
            # "Input parameters has to be a valid dictionary", which kills the
            # whole config and leaves the callee in silence. Pipecat's default
            # of 50 is valid, so leave it alone — do NOT set 25 for "faster
            # first byte" as the spec originally suggested.
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
        mission_memory=brief.get("missionMemory"),
    )

    # ── We drive the conversation loop ourselves. ───────────────────────
    #
    # Pipecat's LLMContextAggregatorPair owns turn-taking, and on a real phone
    # line it would not hand us a completed turn:
    #   * default TurnAnalyzerUserTurnStopStrategy is a smart-turn MODEL that
    #     kept judging short replies ("hello", "haan", "पूछो") as unfinished,
    #     so the LLM was never invoked once across ~8 live calls;
    #   * swapping to SpeechTimeoutUserTurnStopStrategy stopped triggering at
    #     all;
    #   * the mute-strategy routes either under-fired (pipecat#3986) or muted
    #     the user permanently.
    #
    # A phone negotiation does not need adaptive turn inference. It needs:
    # they said something -> we answer. That is ~40 lines, fully deterministic,
    # and it lets US decide how to handle short answers, ramblers and people
    # who talk over us — rather than hoping a model guesses right. The callee
    # should never have to adapt to the agent.
    #
    # Pipecat keeps doing what it is genuinely good at: transport, the Twilio
    # serializer, STT and TTS streaming.
    conversation = ConversationDriver(
        state=state,
        convex=convex,
        system_prompt=system_prompt,
        api_key=api_key,
        brief=brief,   # the driver owns the objective slots and the goal machine
    )

    task_ref: dict[str, Any] = {}
    tap = TranscriptTap(state, convex, task_ref, conversation)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            tap,   # vendor side, the reflexes, language switching, and the LLM loop
            tts,
            transport.output(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=8000,
            audio_out_sample_rate=8000,
            # Deprecated in pipecat >=0.0.99 and ignored in 1.6.0. Real
            # barge-in control is the user_mute_strategies above. Left here
            # only so nobody "helpfully" adds it back.
            allow_interruptions=False,
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
        # The opener no longer asks objective #1 — it was being pasted in as raw
        # English inside a Hindi sentence, and the next turn then asked the same
        # thing again in Hindi. The state machine asks it properly, in one
        # language, on the first real turn.
        # Beat one: no AI mention, no ask — just who is calling and a check
        # that we have the right person. Beat two carries the disclosure and
        # fires as our first real turn, once they have engaged.
        greeting = opening_line(
            language,
            state.user_first_name,
            callee_name=brief.get("calleeName"),
        )
        conversation.set_disclosure(
            disclosure_line(
                language,
                ask,
                recording=os.getenv("ANNOUNCE_RECORDING", "false").lower() == "true",
            )
        )
        conversation.arm_greeting()
        conversation.seed_greeting(greeting)
        await task.queue_frame(TTSSpeakFrame(greeting))

    @transport.event_handler("on_client_disconnected")
    async def _on_disconnect(_transport, _client):
        logger.info(f"[{state.call_id}] disconnected")
        await conversation.aclose()
        await task.cancel()

    return task
