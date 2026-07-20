"""
Stages E + F — field validation and confidence aggregation for spatial parsing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from parser.field_binder import FieldCandidate
from parser.profile_loader import FieldConfig, MeterProfile

FIELD_ACCEPT_THRESHOLD = 0.75
OVERALL_AUTO_FILL_THRESHOLD = 0.80

# Absolute physical ranges (fallback when profile omits range)
DEFAULT_RANGES: dict[str, tuple[float, float]] = {
    "ph": (0.0, 14.0),
    "temperature": (0.0, 100.0),
    "tds": (0.0, 5000.0),
    "ec": (0.0, 10000.0),
    "mv": (-2000.0, 2000.0),
    "orp": (-2000.0, 2000.0),
    "do_percent": (0.0, 200.0),
}


@dataclass
class FieldResult:
    key: str
    value: float | None
    confidence: float
    rejected: bool = False
    reject_reason: str | None = None
    auto_fill: bool = False
    value_score: float = 0.0
    unit_match_score: float = 0.0
    row_index: int | None = None
    value_token: str | None = None
    unit_token: str | None = None
    unit_normalized: str | None = None
    corrections: list[dict[str, Any]] = field(default_factory=list)


def _range_for(key: str, field_cfg: FieldConfig | None) -> tuple[float, float] | None:
    if field_cfg and field_cfg.range is not None:
        return field_cfg.range
    return DEFAULT_RANGES.get(key)


def field_confidence(candidate: FieldCandidate) -> float:
    """
    field_confidence = min(value_score, unit_match_score)
    with penalties for OCR corrections and weak unit matches.
    """
    value_score = float(candidate.value_token.score)
    unit_score = float(candidate.unit_match_score)
    # If no label, use row-hint floor already baked into unit_match_score
    conf = min(value_score, unit_score if unit_score > 0 else value_score)

    # Glyph correction on the value token
    if candidate.value_token.text != candidate.value_token.text_corrected:
        conf *= 0.97
    # Unit corrections / weak unit match
    if candidate.corrections:
        conf *= 0.97
    if unit_score < 0.80:
        conf *= 0.90

    return max(0.0, min(1.0, conf))


def validate_candidates(
    candidates: list[FieldCandidate],
    profile: MeterProfile,
) -> list[FieldResult]:
    field_map = profile.field_map()
    results: list[FieldResult] = []
    seen_values: dict[float, str] = {}

    for cand in candidates:
        cfg = field_map.get(cand.key)
        conf = field_confidence(cand)
        value: float | None = float(cand.value)
        rejected = False
        reason: str | None = None

        # NaN / inf
        if value != value or value in (float("inf"), float("-inf")):
            rejected = True
            reason = "impossible"
            value = None

        # Range
        if value is not None:
            rng = _range_for(cand.key, cfg)
            if rng is not None:
                lo, hi = rng
                if value < lo or value > hi:
                    rejected = True
                    reason = "out_of_range"
                    value = None

        # Confidence gate
        if not rejected and conf < FIELD_ACCEPT_THRESHOLD:
            rejected = True
            reason = "low_confidence"
            value = None

        # Duplicate values across fields
        if not rejected and value is not None:
            if value in seen_values and seen_values[value] != cand.key:
                rejected = True
                reason = "duplicate_value"
                value = None
            else:
                seen_values[value] = cand.key

        auto_fill = (not rejected) and value is not None and conf >= FIELD_ACCEPT_THRESHOLD

        results.append(
            FieldResult(
                key=cand.key,
                value=value,
                confidence=round(conf, 4),
                rejected=rejected,
                reject_reason=reason,
                auto_fill=auto_fill,
                value_score=float(cand.value_token.score),
                unit_match_score=float(cand.unit_match_score),
                row_index=cand.row_index,
                value_token=cand.value_token.text,
                unit_token=cand.label_token.text if cand.label_token else None,
                unit_normalized=cand.unit_normalized,
                corrections=list(cand.corrections),
            )
        )

    return results


def overall_confidence(results: list[FieldResult], profile: MeterProfile) -> float:
    accepted = [r for r in results if not r.rejected and r.value is not None]
    if not accepted:
        return 0.0

    required_keys = {f.key for f in profile.fields if f.required}
    required_confs = [r.confidence for r in accepted if r.key in required_keys]
    all_confs = [r.confidence for r in accepted]

    # Validation score: 1.0 if no rejects among required; else penalize
    required_rejected = any(
        r.rejected for r in results if r.key in required_keys
    )
    validation = 0.4 if required_rejected else 1.0
    if any(r.rejected for r in results):
        validation = min(validation, 0.85)

    req_mean = sum(required_confs) / len(required_confs) if required_confs else (
        sum(all_confs) / len(all_confs)
    )
    all_mean = sum(all_confs) / len(all_confs)

    score = (0.50 * req_mean) + (0.30 * validation) + (0.20 * all_mean)
    return round(max(0.0, min(0.99, score)), 4)


def build_data_payload(results: list[FieldResult]) -> dict[str, float]:
    data: dict[str, float] = {}
    for r in results:
        if not r.rejected and r.value is not None:
            data[r.key] = r.value
    return data


def build_auto_fill_map(results: list[FieldResult], overall: float) -> dict[str, bool]:
    allow_overall = overall >= OVERALL_AUTO_FILL_THRESHOLD
    return {
        r.key: bool(r.auto_fill and allow_overall and r.value is not None)
        for r in results
        if not r.rejected or r.key  # include rejected as False
    }
