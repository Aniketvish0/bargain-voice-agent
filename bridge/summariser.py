"""
Doot — post-call structured extraction, bridge side.

Runs the moment the call ends, while the transcript is still in memory, so the
dashboard fills in seconds rather than waiting for Convex's safety-net pass.

Two-stage by design (BUILD-SPEC §13): the model returns both a number and the
verbatim words it read it from, and Convex re-parses the verbatim
deterministically. If they disagree by more than 2% the slot's confidence drops
to "low" and the dashboard greys it. The LLM stays primary; the parser is only
a cross-check.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
from loguru import logger

from convex_client import ConvexClient

SARVAM_CHAT = "https://api.sarvam.ai/v1/chat/completions"

EXTRACT_SYSTEM = """\
You read a transcript of a phone call between an AI buying assistant (role "agent")
and an Indian business (role "vendor"), and return structured JSON.
The transcript is code-mixed Hindi/English. Prices are usually spoken as words.

Return ONLY JSON:
{
  "slots":[{"key":"<objective key>","value":<boolean|number|string>,"valueVerbatim":"<exact words>","confidence":"high|medium|low","turnSeq":<int>}],
  "openingQuoteInr": <first price the vendor named, or null>,
  "finalQuoteInr": <last/best price the vendor agreed to, or null>,
  "priceVerbatim": "<exact words the final price was spoken in>",
  "deliveryChargeInr": <number or null>,
  "taxIncluded": <true|false|null>,
  "quoteTurnSeq": <seq of the turn with the final price, or null>,
  "terms": "<what's included, short, or null>",
  "contactName": "<person's name, or null>",
  "holdUntil": "<how long the price holds, verbatim, or null>",
  "closed": <true if a concrete outcome was reached>
}

RULES:
- One slot per objective. If an objective was never answered, OMIT it. Never guess.
- "valueVerbatim" and "priceVerbatim" must be literal substrings of the transcript.
  They are cross-checked against a deterministic parser, so do not paraphrase.
- Indian number words: "pachees hazaar"=25000, "saade chaubees hazaar"=24500,
  "chaar hazaar"=4000, "sawa lakh"=125000, "dedh lakh"=150000.
  "saade X"=X+0.5, "sawa X"=X*1.25, "paune X"=X*0.75, "dedh"=1.5.
- Integers in rupees. NEVER invent a price that was not spoken — null is correct.
- The agent reads the whole deal back near the end of the call. THAT LINE IS THE
  MOST RELIABLE SOURCE — prefer it over anything earlier in the transcript."""


async def extract_outcome(
    call_id: str, brief: dict[str, Any], convex: ConvexClient
) -> None:
    """Extract and POST /ingest/outcome. Best-effort: Convex re-runs if this fails."""
    turns = _collect_turns(call_id)
    if len(turns) < 2:
        logger.info(f"[{call_id}] too few turns to extract ({len(turns)})")
        return

    objectives = brief.get("brief", {}).get("objectives", [])
    obj_text = "\n".join(
        f"- {o.get('key')} ({o.get('type')}): {o.get('ask')}" for o in objectives
    ) or "(none)"

    transcript = "\n".join(
        f"[{t['seq']}] {t['role']}: {t['text']}" for t in turns
    )[:12000]

    api_key = os.environ["SARVAM_API_KEY"]
    async with httpx.AsyncClient(timeout=45.0) as client:
        r = await client.post(
            SARVAM_CHAT,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": os.getenv("EXTRACT_MODEL", "sarvam-105b"),
                "max_tokens": 4096,
                "temperature": 0.1,
                "reasoning_effort": None,  # its tokens would eat the budget
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": EXTRACT_SYSTEM},
                    {
                        "role": "user",
                        "content": f"OBJECTIVES:\n{obj_text}\n\nTRANSCRIPT:\n{transcript}",
                    },
                ],
            },
        )
    if r.status_code >= 400:
        logger.warning(f"[{call_id}] extract HTTP {r.status_code}: {r.text[:200]}")
        return

    content = (r.json().get("choices") or [{}])[0].get("message", {}).get("content")
    if not content:
        logger.warning(f"[{call_id}] extract returned empty content")
        return

    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        start, end = content.find("{"), content.rfind("}")
        if start < 0 or end < 0:
            logger.warning(f"[{call_id}] extract returned non-JSON: {content[:160]}")
            return
        data = json.loads(content[start : end + 1])

    payload = {
        "slots": [
            {
                "key": s.get("key"),
                "value": s.get("value"),
                "valueVerbatim": s.get("valueVerbatim"),
                "confidence": s.get("confidence") or "medium",
                "turnSeq": s.get("turnSeq"),
            }
            for s in (data.get("slots") or [])
            if isinstance(s, dict) and s.get("key")
        ],
        "openingQuoteInr": data.get("openingQuoteInr"),
        "finalQuoteInr": data.get("finalQuoteInr"),
        "priceVerbatim": data.get("priceVerbatim"),
        "deliveryChargeInr": data.get("deliveryChargeInr"),
        "taxIncluded": data.get("taxIncluded"),
        "quoteTurnSeq": data.get("quoteTurnSeq"),
        "terms": data.get("terms"),
        "contactName": data.get("contactName"),
        "holdUntil": data.get("holdUntil"),
        "closed": data.get("closed"),
    }
    logger.info(
        f"[{call_id}] extracted: final={payload['finalQuoteInr']} "
        f"slots={len(payload['slots'])} closed={payload['closed']}"
    )
    convex.outcome(call_id, payload)


def _collect_turns(call_id: str) -> list[dict[str, Any]]:
    from server import TRANSCRIPTS  # late import: avoids a circular import at module load

    return TRANSCRIPTS.get(call_id, [])
