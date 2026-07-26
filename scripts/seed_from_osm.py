#!/usr/bin/env python3
"""
orydl — seed the `leads` table from OpenStreetMap.

No API key, no billing, no signup. This is the demo floor: it guarantees the
product has real, dialable +91 numbers even if Google Places billing never
comes up.

    uv run --with phonenumbers --with httpx python scripts/seed_from_osm.py
    npx convex import --table leads --format jsonLines --append scripts/leads.jsonl

MEASURED COVERAGE (26 Jul 2026) — pick demo categories by data, not vibes:
    Goa hotels ................ ~82 numbers  ✅ lead with this
    HSR Layout restaurants .... ~32 numbers  ✅
    Karol Bagh appliances ..... ~3  numbers  ❌ needs Places or hand-curation

⚠️ overpass-api.de was returning HTTP 504 on every request during development.
   The mirror list below rotates; do not collapse it to one host.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

import httpx
import phonenumbers

# Rotated in order. kumi.systems was the only reliable one on the day.
MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
]

# (category, city, locality, bbox south,west,north,east, osm selectors)
TARGETS: list[tuple[str, str, str, tuple[float, float, float, float], list[str]]] = [
    ("hotel", "Goa", "North Goa", (15.45, 73.70, 15.72, 73.90),
     ['["tourism"="hotel"]', '["tourism"="guest_house"]', '["tourism"="resort"]']),
    ("hotel", "Goa", "South Goa", (15.00, 73.90, 15.40, 74.10),
     ['["tourism"="hotel"]', '["tourism"="guest_house"]']),
    ("restaurant", "Bangalore", "HSR Layout", (12.89, 77.62, 12.93, 77.67),
     ['["amenity"="restaurant"]', '["amenity"="cafe"]']),
    ("restaurant", "Bangalore", "Koramangala", (12.92, 77.60, 12.95, 77.64),
     ['["amenity"="restaurant"]']),
    ("pharmacy", "Bangalore", "HSR Layout", (12.89, 77.62, 12.93, 77.67),
     ['["amenity"="pharmacy"]', '["healthcare"="pharmacy"]']),
    ("hotel", "Delhi", "Karol Bagh", (28.63, 77.17, 28.67, 77.21),
     ['["tourism"="hotel"]', '["tourism"="guest_house"]']),
    ("electronics", "Delhi", "Karol Bagh", (28.63, 77.17, 28.67, 77.21),
     ['["shop"="electronics"]', '["shop"="appliance"]', '["shop"="hardware"]']),
    ("hotel", "Jaipur", "Jaipur", (26.85, 75.75, 26.96, 75.85),
     ['["tourism"="hotel"]', '["tourism"="guest_house"]']),
]


def build_query(bbox: tuple[float, float, float, float], selectors: list[str]) -> str:
    s, w, n, e = bbox
    box = f"({s},{w},{n},{e})"
    parts = []
    for sel in selectors:
        # Indian POIs use `phone` and `contact:phone` interchangeably.
        # Reading only one of them roughly halves the yield.
        for tag in ("phone", "contact:phone"):
            parts.append(f'  node{sel}["{tag}"]{box};')
            parts.append(f'  way{sel}["{tag}"]{box};')
    return "[out:json][timeout:60];\n(\n" + "\n".join(parts) + "\n);\nout center tags;"


def fetch(query: str) -> list[dict[str, Any]]:
    for mirror in MIRRORS:
        try:
            r = httpx.post(mirror, data={"data": query}, timeout=90.0)
            if r.status_code == 200:
                return r.json().get("elements", [])
            print(f"    {mirror.split('/')[2]} -> HTTP {r.status_code}", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            print(f"    {mirror.split('/')[2]} -> {type(exc).__name__}", file=sys.stderr)
        time.sleep(1)
    return []


def to_e164(raw: str) -> str | None:
    """
    libphonenumber, deliberately not a regex.

    Tested against 298 real Indian phone strings, a hand-rolled regex INVENTED
    valid-looking numbers out of corrupt input. Here that means dialling a
    stranger, so this is a safety boundary.
    """
    # OSM frequently packs several numbers into one tag.
    for candidate in raw.replace(";", ",").split(","):
        candidate = candidate.strip()
        if not candidate:
            continue
        try:
            n = phonenumbers.parse(candidate, "IN")
        except phonenumbers.NumberParseException:
            continue
        if phonenumbers.is_valid_number(n):
            return phonenumbers.format_number(n, phonenumbers.PhoneNumberFormat.E164)
    return None


def main() -> int:
    out_path = Path(__file__).parent / "leads.jsonl"
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()

    for category, city, locality, bbox, selectors in TARGETS:
        print(f"→ {category:12} {locality:16} ", end="", flush=True)
        elements = fetch(build_query(bbox, selectors))
        kept = 0
        for el in elements:
            tags = el.get("tags", {})
            name = (tags.get("name") or "").strip()
            raw = tags.get("phone") or tags.get("contact:phone") or ""
            if not name or not raw:
                continue
            e164 = to_e164(raw)
            if not e164 or e164 in seen:
                continue
            seen.add(e164)
            addr = ", ".join(
                filter(None, [tags.get("addr:street"), tags.get("addr:suburb"), tags.get("addr:city")])
            )
            rows.append({
                "category": category,
                "locality": locality,
                "city": city,
                "name": name[:80],
                "phoneE164": e164,
                "address": addr or None,
                "sourceUrl": f"https://www.openstreetmap.org/{el.get('type')}/{el.get('id')}",
                "source": "osm",
                # NOT consented. The compliance gate still applies, and the demo
                # should use numbers you have actually spoken to. See §15.
                "consentObtained": False,
            })
            kept += 1
        print(f"{kept:4d} with valid numbers   (from {len(elements)} elements)")
        time.sleep(1)  # be polite to a free public API

    out_path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")

    print(f"\n✓ {len(rows)} leads → {out_path}")
    by_cat: dict[str, int] = {}
    for r in rows:
        by_cat[f"{r['category']} / {r['locality']}"] = by_cat.get(f"{r['category']} / {r['locality']}", 0) + 1
    for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1]):
        print(f"    {v:4d}  {k}")
    print(f"\nNext:\n  npx convex import --table leads --format jsonLines --append {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
