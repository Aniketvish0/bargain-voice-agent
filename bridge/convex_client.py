"""
Doot — fire-and-forget writer to Convex. BUILD-SPEC Contract 2.

THE ONE RULE: nothing in here is ever awaited on the audio thread.

A live phone call has a ~1.5s dead-air budget for the entire turn. A 200ms
HTTP round-trip to Convex spent inline is 200ms the vendor hears as silence.
Every method schedules a task and returns immediately; failures are logged and
dropped, because a missing dashboard row is survivable and a stuttering call
is not.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx
from loguru import logger


class ConvexClient:
    def __init__(self, site_url: str | None = None, secret: str | None = None):
        self.site_url = (site_url or os.getenv("CONVEX_SITE_URL", "")).rstrip("/")
        self.secret = secret or os.getenv("BRIDGE_SECRET", "")
        self._client: httpx.AsyncClient | None = None
        self._tasks: set[asyncio.Task] = set()

        if not self.site_url:
            logger.warning("CONVEX_SITE_URL not set — transcript writes will be dropped")
        elif ".convex.cloud" in self.site_url:
            # A genuinely easy mistake that produces silent 404s on every write.
            logger.error(
                "CONVEX_SITE_URL points at .convex.cloud — httpActions live at "
                ".convex.site. Every ingest write will 404."
            )

    async def start(self) -> None:
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0))

    async def close(self) -> None:
        # Give in-flight writes a moment, then stop caring.
        if self._tasks:
            await asyncio.wait(self._tasks, timeout=3.0)
        if self._client:
            await self._client.aclose()

    def _post(self, path: str, payload: dict[str, Any]) -> None:
        """Schedule a write. Never awaited by the caller."""
        if not self.site_url or not self._client:
            return

        async def _run() -> None:
            try:
                r = await self._client.post(  # type: ignore[union-attr]
                    f"{self.site_url}{path}",
                    json=payload,
                    headers={"x-bridge-secret": self.secret},
                )
                if r.status_code >= 400:
                    logger.warning(f"convex {path} -> {r.status_code} {r.text[:160]}")
            except Exception as e:  # noqa: BLE001 — never let this reach the audio thread
                logger.warning(f"convex {path} failed: {e}")

        task = asyncio.create_task(_run())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # ── Contract 2 ──────────────────────────────────────────────────────────

    def turn(
        self,
        call_id: str,
        role: str,
        text: str,
        *,
        final: bool = True,
        lang_code: str | None = None,
        lang_probability: float | None = None,
        sarvam_request_id: str | None = None,
        ts_ms: int | None = None,
    ) -> None:
        self._post(
            "/ingest/turn",
            {
                "callId": call_id,
                "role": role,
                "text": text,
                "final": final,
                "langCode": lang_code,
                "langProbability": lang_probability,
                "sarvamRequestId": sarvam_request_id,
                "tsMs": ts_ms,
            },
        )

    def lang_switch(
        self, call_id: str, from_lang: str, to_lang: str, confidence: float
    ) -> None:
        self._post(
            "/ingest/langswitch",
            {
                "callId": call_id,
                "fromLang": from_lang,
                "toLang": to_lang,
                "confidence": confidence,
            },
        )

    def outcome(self, call_id: str, data: dict[str, Any]) -> None:
        self._post("/ingest/outcome", {"callId": call_id, **data})

    def dnc(self, phone: str, reason: str, call_id: str | None = None) -> None:
        self._post("/ingest/dnc", {"phone": phone, "reason": reason, "callId": call_id})

    def consent(
        self,
        *,
        call_id: str | None,
        phone: str,
        language: str,
        disclosure_text: str,
        consent_given: bool = True,
        callee_response: str | None = None,
    ) -> None:
        self._post(
            "/ingest/consent",
            {
                "callId": call_id,
                "phone": phone,
                "language": language,
                "channel": "on_call",
                "disclosureText": disclosure_text,
                "consentGiven": consent_given,
                "calleeResponse": callee_response,
            },
        )

    async def health(self) -> dict[str, Any] | None:
        """Checked on boot so a misconfigured deployment fails loudly, not at 16:00."""
        if not self.site_url or not self._client:
            return None
        try:
            r = await self._client.get(f"{self.site_url}/health")
            return r.json() if r.status_code == 200 else None
        except Exception as e:  # noqa: BLE001
            logger.warning(f"convex health check failed: {e}")
            return None
