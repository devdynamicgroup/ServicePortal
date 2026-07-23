"""
Stage C — Unit / label normalizer.

Maps noisy OCR unit tokens onto canonical measurement unit keys.
"""

from __future__ import annotations

import re
from typing import Any

# Hard synonym table: normalized key → field key candidates
# Primary mapping used by the binder.
UNIT_SYNONYMS: dict[str, str] = {
    # pH
    "ph": "ph",
    "phvalue": "ph",
    # electrode mV (often shown as mVpH)
    "mv": "mv",
    "mvph": "mv",
    "mv_ph": "mv",
    "mvp": "mv",
    # ORP
    "orp": "orp",
    "mvorp": "orp",
    "orp_mv": "orp",
    "orpmv": "orp",
    "mv_orp": "orp",
    # DO
    "do": "do_percent",
    "do_percent": "do_percent",
    "%do": "do_percent",
    "%00": "do_percent",
    "%o0": "do_percent",
    "%0o": "do_percent",
    "dosat": "do_percent",
    "sat": "do_percent",
    # TDS / EC / Temp
    "tds": "tds",
    "ppm": "tds",
    "ec": "ec",
    "us": "ec",
    "uscm": "ec",
    "us/cm": "ec",
    "usem": "ec",
    "usema": "ec",
    # Paddle often drops the µ glyph → "?sem" / "?Sema"
    "?sem": "ec",
    "?sema": "ec",
    "?s/cm": "ec",
    "sem": "ec",
    "sema": "ec",
    "µs": "ec",
    "µscm": "ec",
    "temp": "temperature",
    "temperature": "temperature",
    "c": "temperature",
    "°c": "temperature",
}


def _strip_label(label: str) -> str:
    text = str(label or "").strip().lower()
    # Keep % and / for unit meaning; drop other punctuation.
    # Normalize both micro-sign variants (µ U+00B5 and μ U+03BC) to ASCII "u".
    text = text.replace("µ", "u").replace("μ", "u").replace("?", "u")
    text = re.sub(r"\s+", "", text)
    return text


def _character_correct_unit(label: str) -> tuple[str, list[dict[str, Any]]]:
    """
    Unit-specific glyph fixes (distinct from numeric correct_ocr_token).
    Example: %00 → %do  (D misread as 0/O).
    """
    corrections: list[dict[str, Any]] = []
    raw = _strip_label(label)

    # Explicit known OCR corruptions for DO units
    if raw in {"%00", "%o0", "%0o", "%0", "00", "%dd"}:
        corrected = "%do"
        corrections.append({"from": label, "to": corrected, "stage": "unit_normalize"})
        return corrected, corrections

    # µ / μ often becomes "?" on Windows/Paddle pipelines → "?sem"
    if raw.startswith("?") and re.match(r"^\?s", raw):
        corrected = "u" + raw[1:]
        corrections.append({"from": label, "to": corrected, "stage": "unit_normalize"})
        return corrected, corrections

    # mVpH / mVORP often arrive already correct; normalize casing only
    if raw.replace("_", "") in UNIT_SYNONYMS:
        return raw.replace("_", ""), corrections

    # Soft: trailing zeros in %-units → treat as O
    if raw.startswith("%") and re.fullmatch(r"%[0o]+", raw):
        corrected = "%do"
        corrections.append({"from": label, "to": corrected, "stage": "unit_normalize"})
        return corrected, corrections

    return raw, corrections


def normalize_unit(label: str) -> tuple[str, list[dict[str, Any]]]:
    """
    Normalize a raw OCR label/unit token.

    Returns (normalized_key, corrections).
    normalized_key is a synonym-table key when known, else cleaned lowercase string.
    """
    corrected, corrections = _character_correct_unit(label)
    cleaned = _strip_label(corrected)
    cleaned = cleaned.replace("_", "")

    if cleaned in UNIT_SYNONYMS:
        return cleaned, corrections

    # Composite tokens: keep as-is for synonym lookup of substrings later
    return cleaned, corrections


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i]
        for j, cb in enumerate(b, start=1):
            ins = cur[j - 1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (0 if ca == cb else 1)
            cur.append(min(ins, delete, sub))
        prev = cur
    return prev[-1]


def unit_match_score(label: str, aliases: list[str]) -> float:
    """
    Score how well a label matches a field's alias list.

    Priority:
      1.0 exact synonym / alias
      0.9 alias is substring of label, or label is a substring of a longer
          alias (only when the label itself is >=3 chars — a short garbled
          OCR fragment like "tu" is not meaningful evidence just because it
          happens to appear inside a long word like "temperature")
      0.8 Levenshtein ≤ 1 for short tokens
      0.0 no match
    """
    normalized, _ = normalize_unit(label)
    alias_set = {_strip_label(a).replace("_", "") for a in aliases}

    # Synonym table expansion: if normalized maps to a field key, also accept aliases
    # that equal that field or map to it.
    if normalized in UNIT_SYNONYMS:
        mapped_field = UNIT_SYNONYMS[normalized]
        # Exact if any alias maps to same field or equals normalized
        for a in alias_set:
            if a == normalized:
                return 1.0
            if UNIT_SYNONYMS.get(a) == mapped_field:
                return 1.0
            if a == mapped_field:
                return 1.0

    for a in alias_set:
        if not a:
            continue
        if normalized == a:
            return 1.0
        if a in normalized:
            return 0.9
        if normalized in a and len(normalized) >= 3:
            return 0.9
        if len(normalized) <= 6 and len(a) <= 6 and _levenshtein(normalized, a) <= 1:
            return 0.8

    # Synonym-driven: normalized token maps to field that appears in aliases
    if normalized in UNIT_SYNONYMS:
        field = UNIT_SYNONYMS[normalized]
        if field in alias_set or any(UNIT_SYNONYMS.get(a) == field for a in alias_set):
            return 0.95

    return 0.0


def resolve_field_from_label(label: str, field_aliases: dict[str, list[str]]) -> tuple[str | None, float]:
    """
    Pick the best field key for a label given profile field→aliases map.

    Returns (field_key, score) or (None, 0.0).
    """
    best_key: str | None = None
    best_score = 0.0
    for field_key, aliases in field_aliases.items():
        score = unit_match_score(label, list(aliases) + [field_key])
        if score > best_score:
            best_score = score
            best_key = field_key
    if best_score <= 0.0:
        return None, 0.0
    return best_key, best_score
