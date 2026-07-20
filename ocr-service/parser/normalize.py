"""
OCR text correction and structured meter payload building.

Never imports or calls OCR engines.
"""

from __future__ import annotations

import re
from typing import Any

# Common OCR glyph confusions on 7-segment / LCD meters
_CHAR_MAP = str.maketrans(
    {
        "O": "0",
        "o": "0",
        "Q": "0",
        "D": "0",
        "I": "1",
        "l": "1",
        "|": "1",
        "S": "5",
        "s": "5",
        "B": "8",
        "Z": "2",
        ",": ".",
    }
)

_NUMBER_RE = re.compile(r"[-+]?\d+(?:\.\d+)?")


def correct_ocr_token(token: str) -> tuple[str, bool]:
    """
    Correct a single OCR token (e.g. '28O' → '280', '7.O' → '7.0').
    Returns (corrected, was_changed).
    """
    raw = str(token or "")
    if not raw:
        return raw, False

    # Model / serial codes (e.g. 2100Q, HI98194) — never glyph-correct into numbers.
    if re.search(r"\d{3,}[A-Za-z]|[A-Za-z]\d{3,}", raw):
        return raw, False

    # Only map letters that sit inside mostly-numeric tokens
    if re.search(r"\d", raw) or re.fullmatch(r"[OoIlSsBQDZ.,+\-]+", raw):
        corrected = raw.translate(_CHAR_MAP)
        # Collapse multiple dots carefully: keep first decimal
        if corrected.count(".") > 1:
            head, *rest = corrected.split(".")
            corrected = head + "." + "".join(rest).replace(".", "")
        return corrected, corrected != raw
    return raw, False


def correct_ocr_text(text: str) -> tuple[str, list[dict[str, Any]]]:
    corrections: list[dict[str, Any]] = []
    parts = re.split(r"(\s+)", str(text or ""))
    out: list[str] = []
    for part in parts:
        if not part or part.isspace():
            out.append(part)
            continue
        fixed, changed = correct_ocr_token(part)
        if changed:
            corrections.append({"from": part, "to": fixed})
        out.append(fixed)
    return "".join(out), corrections


def correct_texts(texts: list[str]) -> tuple[list[str], list[dict[str, Any]]]:
    fixed_lines: list[str] = []
    all_corrections: list[dict[str, Any]] = []
    for line in texts or []:
        fixed, corr = correct_ocr_text(line)
        fixed_lines.append(fixed)
        all_corrections.extend(corr)
    return fixed_lines, all_corrections


def extract_numbers(text: str) -> list[float]:
    corrected, _ = correct_ocr_text(text)
    values: list[float] = []
    for match in _NUMBER_RE.finditer(corrected):
        try:
            values.append(float(match.group(0)))
        except ValueError:
            continue
    return values


# Stable fallbacks matching Phase 2/3.5 mock API contract (empty extraction only).
_FALLBACK_DATA: dict[str, dict[str, Any]] = {
    "tds": {"tds": 280, "ec": 400, "temperature": 28},
    "ph": {"ph": 7.29, "mv": -15.0},
    "ec": {"ec": 400, "temperature": 28},
    "orp": {"orp": 208.3},
    "do": {"do_percent": 89.4},
}


def merge_with_fallback(
    meter_type: str,
    data: dict[str, Any] | None,
    *,
    allow_demo_fallback: bool = True,
) -> dict[str, Any]:
    """
    When OCR/parser returned fields, trust them — do not invent demo values
    for missing keys (that caused false ph=7.29 on real paddle runs).

    Demo constants apply only when extraction produced no usable data AND
    allow_demo_fallback is True (legacy mock / no spatial detections).
    After a spatial parse that rejected all candidates, pass allow_demo_fallback=False.
    """
    kind = (meter_type or "tds").lower()
    if data:
        return {k: v for k, v in data.items() if v is not None}
    if allow_demo_fallback:
        return dict(_FALLBACK_DATA.get(kind, _FALLBACK_DATA["tds"]))
    return {}


def normalize_meter_payload(meter_type: str, extraction: dict[str, Any]) -> dict[str, Any]:
    """
    Backward-compatible entry used by older call sites.
    Prefer the full pipeline for new code.
    """
    kind = (meter_type or "tds").lower()
    confidence = extraction.get("confidence")
    if confidence is None:
        confidence = 0.0

    texts = list(extraction.get("texts") or [])
    fixed, corrections = correct_texts(texts)

    # Prefer reader-supplied structured data when present
    data = extraction.get("data")
    if not isinstance(data, dict) or not data:
        data = merge_with_fallback(kind, None)

    return {
        "data": data,
        "confidence": float(confidence),
        "texts": fixed,
        "corrections": corrections,
    }
