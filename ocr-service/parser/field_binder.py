"""
Stage D — Config-driven field binder.

Associates MeasurementRow value/label pairs with profile field keys.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from parser.normalize import extract_numbers
from parser.profile_loader import FieldConfig, MeterProfile
from parser.row_grouper import MeasurementRow
from parser.tokens import OcrToken
from parser.unit_normalizer import normalize_unit, unit_match_score


@dataclass
class FieldCandidate:
    key: str
    value: float
    value_token: OcrToken
    label_token: OcrToken | None
    unit_match_score: float
    row_index: int
    unit_normalized: str | None = None
    corrections: list[dict[str, Any]] = field(default_factory=list)
    used_row_hint: bool = False


def _parse_value(token: OcrToken) -> float | None:
    nums = extract_numbers(token.text_corrected)
    if nums:
        return nums[0]
    nums = extract_numbers(token.text)
    return nums[0] if nums else None


def _label_excluded(label: str, field_cfg: FieldConfig) -> bool:
    if not field_cfg.exclude_aliases:
        return False
    score = unit_match_score(label, list(field_cfg.exclude_aliases))
    return score >= 0.8


def score_row_against_field(
    row: MeasurementRow,
    field_cfg: FieldConfig,
) -> tuple[float, str | None, list[dict[str, Any]], bool]:
    """
    Returns (score, unit_normalized, corrections, used_row_hint).
    """
    label = row.label_token
    corrections: list[dict[str, Any]] = []
    unit_norm: str | None = None
    used_hint = False

    alias_score = 0.0
    if label is not None:
        unit_norm, corrections = normalize_unit(label.text)
        if _label_excluded(label.text, field_cfg):
            alias_score = 0.0
        else:
            alias_score = unit_match_score(label.text, list(field_cfg.aliases) + [field_cfg.key])

    hint_bonus = 0.0
    if field_cfg.row_hint is not None and row.index == field_cfg.row_hint:
        hint_bonus = 0.15
        used_hint = True

    # Strong unit match wins; row hint is a weak prior.
    if alias_score >= 0.70:
        return min(1.0, alias_score + hint_bonus * 0.2), unit_norm, corrections, used_hint

    # Weak / missing unit: allow row hint + value-range agreement later
    if alias_score > 0.0:
        return alias_score + hint_bonus * 0.5, unit_norm, corrections, used_hint

    if used_hint:
        return 0.55 + hint_bonus, unit_norm, corrections, used_hint

    return 0.0, unit_norm, corrections, used_hint


def _value_in_range(value: float, field_cfg: FieldConfig) -> bool:
    if field_cfg.range is None:
        return True
    lo, hi = field_cfg.range
    return lo <= value <= hi


def bind_fields(rows: list[MeasurementRow], profile: MeterProfile) -> list[FieldCandidate]:
    """
    Bind each measurement row to at most one field; each field at most once.

    Greedy: highest (row, field) score first, subject to range validity.
    """
    candidates: list[tuple[float, MeasurementRow, FieldConfig, float, str | None, list, bool, float]] = []

    for row in rows:
        if row.value_token is None:
            continue
        value = _parse_value(row.value_token)
        if value is None:
            continue
        for field_cfg in profile.fields:
            if not _value_in_range(value, field_cfg):
                # Still allow if strong unit match? No — range reject at bind time
                # soft: skip unless unit match is very strong and we'll validate later
                score, unit_norm, corrections, used_hint = score_row_against_field(row, field_cfg)
                if score < 0.90:
                    continue
            else:
                score, unit_norm, corrections, used_hint = score_row_against_field(row, field_cfg)

            if score < 0.50:
                continue
            # Prefer in-range values
            range_ok = _value_in_range(value, field_cfg)
            effective = score + (0.05 if range_ok else -0.2)
            candidates.append(
                (effective, row, field_cfg, value, unit_norm, corrections, used_hint, score)
            )

    candidates.sort(key=lambda x: x[0], reverse=True)

    used_rows: set[int] = set()
    used_fields: set[str] = set()
    bound: list[FieldCandidate] = []

    for effective, row, field_cfg, value, unit_norm, corrections, used_hint, unit_score in candidates:
        if row.index in used_rows or field_cfg.key in used_fields:
            continue
        # Special case: PH label must not steal mv row when mVpH is present
        if field_cfg.key == "ph" and row.label_token is not None:
            label_l = row.label_token.text.lower().replace(" ", "")
            if "mv" in label_l and "ph" in label_l and "orp" not in label_l:
                # mVpH → prefer mv, skip ph for this row
                continue
        if field_cfg.key == "mv" and row.label_token is not None:
            label_l = row.label_token.text.lower().replace(" ", "")
            if "orp" in label_l:
                continue

        used_rows.add(row.index)
        used_fields.add(field_cfg.key)
        bound.append(
            FieldCandidate(
                key=field_cfg.key,
                value=value,
                value_token=row.value_token,  # type: ignore[arg-type]
                label_token=row.label_token,
                unit_match_score=float(unit_score),
                row_index=row.index,
                unit_normalized=unit_norm,
                corrections=list(corrections),
                used_row_hint=used_hint,
            )
        )

    return bound
