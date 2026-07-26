"""
Doot — the bridge. BUILD-SPEC §4, Contract 1.

WHY THIS PROCESS EXISTS AT ALL
------------------------------
Convex httpAction handlers take a Request and return a Response. There is no
socket-upgrade API, so Convex structurally cannot terminate a Twilio media
stream. Vercel serverless has the same shape. This process holds the long-lived
WebSocket that everything else depends on. Do not try to fold it into Convex —
it is not a preference, it is a capability the platform does not have.

Run:
    uv run uvicorn server:app --host 0.0.0.0 --port 7860
    ngrok http 7860        # the URL goes in BRIDGE_URL and NGROK_HOST
"""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse, PlainTextResponse
from loguru import logger
from twilio.rest import Client as TwilioClient

from pipecat.pipeline.runner import PipelineRunner
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

from bot import CallState, build_pipeline
from convex_client import ConvexClient
from summariser import extract_outcome

load_dotenv(override=True)

MAX_CALL_SECONDS = int(os.getenv("MAX_CALL_DURATION_SEC", "240"))

# Briefs handed over by Convex, keyed by callId, consumed when Twilio dials in.
PENDING: dict[str, dict[str, Any]] = {}
# Live transcripts, kept in memory so we can extract when the call ends.
TRANSCRIPTS: dict[str, list[dict[str, Any]]] = {}

convex = ConvexClient()
twilio: TwilioClient | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global twilio
    await convex.start()

    sid = os.getenv("TWILIO_ACCOUNT_SID")
    token = os.getenv("TWILIO_AUTH_TOKEN")
    if sid and token:
        twilio = TwilioClient(sid, token)
        logger.info(f"twilio ready, from={os.getenv('TWILIO_FROM_NUMBER')}")
    else:
        logger.warning("TWILIO_* not set — /call will refuse to dial")

    # Fail loudly at boot rather than mysteriously at 16:00.
    health = await convex.health()
    if health:
        logger.info(f"convex ok: {json.dumps(health)}")
        if not health.get("hasSarvamKey"):
            logger.error("Convex has no SARVAM_API_KEY set — run: npx convex env set")
    else:
        logger.warning(f"convex health check failed for {convex.site_url!r}")

    if not os.getenv("SARVAM_API_KEY"):
        logger.error("SARVAM_API_KEY missing from bridge/.env — calls will fail")

    yield
    await convex.close()


app = FastAPI(title="doot-bridge", lifespan=lifespan)


def _require_secret(header: str | None) -> None:
    expected = os.getenv("BRIDGE_SECRET")
    if not expected or header != expected:
        raise HTTPException(status_code=403, detail="bad bridge secret")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "doot-bridge",
        "hasSarvam": bool(os.getenv("SARVAM_API_KEY")),
        "hasTwilio": twilio is not None,
        "from": os.getenv("TWILIO_FROM_NUMBER"),
        "ngrok": os.getenv("NGROK_HOST"),
        "pending": list(PENDING),
    }


@app.post("/call")
async def place_call(
    req: Request, x_bridge_secret: str | None = Header(default=None)
) -> JSONResponse:
    """
    Contract 1. Convex hands us one call; we dial it and stash the brief for
    the WebSocket that Twilio is about to open.
    """
    _require_secret(x_bridge_secret)
    brief = await req.json()

    call_id = brief.get("callId")
    phone = brief.get("phoneE164")
    if not call_id or not phone:
        raise HTTPException(status_code=400, detail="callId and phoneE164 required")
    if twilio is None:
        raise HTTPException(status_code=503, detail="twilio not configured")

    ngrok = os.getenv("NGROK_HOST", "").replace("https://", "").replace("http://", "").rstrip("/")
    if not ngrok:
        raise HTTPException(status_code=503, detail="NGROK_HOST not set")

    from_number = os.getenv("TWILIO_FROM_NUMBER")
    if not from_number:
        raise HTTPException(status_code=503, detail="TWILIO_FROM_NUMBER not set")

    PENDING[call_id] = brief
    TRANSCRIPTS[call_id] = []

    # <Parameter> is how the callId survives the round trip into the WebSocket.
    twiml = (
        f'<Response><Connect><Stream url="wss://{ngrok}/ws">'
        f'<Parameter name="callId" value="{call_id}"/>'
        f"</Stream></Connect></Response>"
    )

    status_cb = f"{convex.site_url}/ingest/status" if convex.site_url else None

    try:
        call = twilio.calls.create(
            to=phone,
            from_=from_number,
            twiml=twiml,
            record=True,  # free, and it is your demo fallback footage
            timeout=12,  # ring budget, then move on to the next vendor
            **(
                {
                    "status_callback": status_cb,
                    "status_callback_event": ["initiated", "ringing", "answered", "completed"],
                    "status_callback_method": "POST",
                }
                if status_cb
                else {}
            ),
            # NOTE: deliberately NO machine_detection. Synchronous AMD holds the
            # callee in silence for seconds before the TwiML runs and CAUSES the
            # hangups it is meant to prevent.
        )
    except Exception as e:  # noqa: BLE001
        PENDING.pop(call_id, None)
        logger.error(f"twilio dial failed for {phone}: {e}")
        raise HTTPException(status_code=502, detail=f"twilio: {e}") from e

    logger.info(f"[{call_id}] dialing {phone} sid={call.sid}")
    return JSONResponse({"twilioCallSid": call.sid}, status_code=202)


@app.post("/twiml")
async def twiml_fallback() -> PlainTextResponse:
    """Only used if a number is configured with a webhook rather than inline TwiML."""
    ngrok = os.getenv("NGROK_HOST", "").replace("https://", "").rstrip("/")
    return PlainTextResponse(
        f'<Response><Connect><Stream url="wss://{ngrok}/ws"/></Connect></Response>',
        media_type="application/xml",
    )


@app.websocket("/ws")
async def media_stream(ws: WebSocket) -> None:
    """
    Twilio's media stream. Audio is mulaw/8000; TwilioFrameSerializer handles
    both conversions (Sarvam's STT socket does not accept mulaw inbound).
    """
    await ws.accept()

    # Twilio sends "connected" then "start"; the start frame carries our params.
    try:
        first = json.loads(await ws.receive_text())
        if first.get("event") == "connected":
            first = json.loads(await ws.receive_text())
    except Exception as e:  # noqa: BLE001
        logger.error(f"ws handshake failed: {e}")
        await ws.close()
        return

    start = first.get("start", {})
    stream_sid = start.get("streamSid")
    call_sid = start.get("callSid")
    call_id = (start.get("customParameters") or {}).get("callId")

    logger.info(f"ws start callId={call_id} sid={call_sid} stream={stream_sid}")

    brief = PENDING.pop(call_id, None) if call_id else None
    if brief is None:
        logger.error(f"no pending brief for callId={call_id} — closing")
        await ws.close()
        return

    state = CallState(
        call_id=call_id,
        phone=brief.get("phoneE164", ""),
        language=brief.get("language", "hi-IN"),
        user_first_name=brief.get("userFirstName", "our customer"),
        # Same list object the extractor reads via TRANSCRIPTS.
        transcript=TRANSCRIPTS.setdefault(call_id, []),
    )

    serializer = TwilioFrameSerializer(
        stream_sid=stream_sid,
        call_sid=call_sid,
        account_sid=os.getenv("TWILIO_ACCOUNT_SID"),
        auth_token=os.getenv("TWILIO_AUTH_TOKEN"),
    )

    transport = FastAPIWebsocketTransport(
        websocket=ws,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=serializer,
            session_timeout=MAX_CALL_SECONDS,
        ),
    )

    task = build_pipeline(brief=brief, state=state, convex=convex, transport=transport)

    try:
        runner = PipelineRunner(handle_sigint=False)
        await runner.run(task)
    except Exception as e:  # noqa: BLE001
        logger.exception(f"[{call_id}] pipeline crashed: {e}")
    finally:
        logger.info(f"[{call_id}] call ended, extracting outcome")
        try:
            await extract_outcome(call_id, brief, convex)
        except Exception as e:  # noqa: BLE001
            # Convex re-runs extraction from the stored turns as a safety net.
            logger.warning(f"[{call_id}] outcome extraction failed: {e}")
        TRANSCRIPTS.pop(call_id, None)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "7860")))
