"""
Stage D — Config-driven field binder.

Associates MeasurementRow value/label pairs with profile field keys.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Sequence

from core.logger import get_logger
from parser.normalize import extract_numbers
from parser.profile_loader import FieldConfig, MeterProfile
from parser.row_grouper import MeasurementRow
from parser.tokens import OcrToken
from parser.unit_normalizer import normalize_unit, unit_match_score

logger = get_logger("parser.field_binder")


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


def _is_keypad_digit_token(token: OcrToken | None) -> bool:
    """True for bare keypad digits (0-9) — never a real LCD measurement alone."""
    if token is None:
        return False
    text = str(token.text or "").strip()
    return bool(re.fullmatch(r"[0-9]", text))


def _label_excluded(label: str, field_cfg: FieldConfig) -> bool:
    if not field_cfg.exclude_aliases:
        return False
    # A field's own key/alias can never be self-excluding. Bare "do" fuzzy-matches
    # the do field's own exclude_aliases entry "%do" (both resolve to the same
    # UNIT_SYNONYMS canonical field), which would otherwise make the "do" field
    # reject its own literal label.
    normalized_label, _ = normalize_unit(label)
    if normalized_label == field_cfg.key or normalized_label in field_cfg.aliases:
        return False
    score = unit_match_score(label, list(field_cfg.exclude_aliases))
    return score >= 0.8


def _token_height(token: OcrToken) -> float:
    return max(1.0, float(token.box[3] - token.box[1]))


def _profile_alias_lists(profile: MeterProfile) -> list[list[str]]:
    return [list(f.aliases) + [f.key] for f in profile.fields]


def _looks_like_unit_token(token: OcrToken, profile: MeterProfile) -> bool:
    """Only attach tokens that match a profile unit/alias (never keypad/chrome)."""
    text = str(token.text or "").strip()
    if not text or len(text) > 16:
        return False
    for aliases in _profile_alias_lists(profile):
        if unit_match_score(text, aliases) >= 0.70:
            return True
    return False


def attach_nearby_unit_labels(
    rows: list[MeasurementRow],
    tokens: Sequence[OcrToken],
    profile: MeterProfile,
) -> list[MeasurementRow]:
    """
    When a value row has no label (unit-only OCR cluster was dropped), attach a
    nearby orphan unit token that matches a profile alias (e.g. -19.2 + mVpH).

    Does not invent values; only restores spatially adjacent unit labels.
    """
    if not rows or not tokens:
        return rows

    used = {id(t) for row in rows for t in row.tokens}
    orphans = [
        t
        for t in tokens
        if id(t) not in used
        and not t.is_numeric
        and not t.ignored
        and not t.debug_only
        and _looks_like_unit_token(t, profile)
    ]
    if not orphans:
        return rows

    for row in rows:
        if row.value_token is None or row.label_token is not None:
            continue

        value = row.value_token
        max_dy = max(_token_height(value) * 1.25, 48.0)
        ranked: list[tuple[float, float, OcrToken]] = []
        for orphan in orphans:
            dy = abs(float(orphan.cy) - float(value.cy))
            if dy > max_dy:
                continue
            # Prefer labels to the right of the value (HANNA LCD layout).
            if float(orphan.cx) < float(value.cx) - _token_height(value):
                continue
            dx = abs(float(orphan.cx) - float(value.cx))
            right_penalty = 0.0 if float(orphan.cx) >= float(value.cx) else 50.0
            ranked.append((dy + right_penalty, dx, orphan))

        if not ranked:
            continue

        ranked.sort(key=lambda item: (item[0], item[1]))
        best = ranked[0][2]
        row.label_token = best
        if best not in row.tokens:
            row.tokens = sorted([*row.tokens, best], key=lambda t: t.cx)
        orphans = [t for t in orphans if id(t) != id(best)]

    return rows


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
    # Row hint only applies when the row has no label at all — a row with a
    # *different* label (e.g. "D.O.") must never be stolen by another
    # field's row_hint fallback; it means this row belongs to that label's
    # field, not an unlabeled one.
    if field_cfg.row_hint is not None and row.index == field_cfg.row_hint and label is None:
        # 0.55 base + 0.25 = 0.80 clears both FIELD_ACCEPT_THRESHOLD (0.75)
        # and the <0.80 weak-unit penalty in field_confidence() — a
        # label-less single-value screen (e.g. Hanna "Info" page showing only
        # temperature) can still bind via row position + in-range value alone.
        hint_bonus = 0.25
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


def bind_fields(
    rows: list[MeasurementRow],
    profile: MeterProfile,
    tokens: Sequence[OcrToken] | None = None,
) -> list[FieldCandidate]:
    """
    Bind each measurement row to at most one field; each field at most once.

    Greedy: highest (row, field) score first, subject to range validity.
    When ``tokens`` is provided, nearby orphan unit labels may be attached to
    value rows that were split across OCR clusters (e.g. -19.2 / mVpH).
    """
    if tokens:
        rows = attach_nearby_unit_labels(rows, tokens, profile)

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
            # Bare keypad digits (0-9) need a strong unit label — otherwise they
            # become false meter readings (especially "0" at the bottom of Hanna LCDs).
            if _is_keypad_digit_token(row.value_token) and score < 0.90:
                continue
            # Prefer in-range values; break ties toward upper LCD rows + clearer unit OCR.
            range_ok = _value_in_range(value, field_cfg)
            label_ocr = float(row.label_token.score) if row.label_token is not None else 0.0
            effective = (
                score
                + (0.05 if range_ok else -0.2)
                + (0.01 * label_ocr)
                - (0.02 * float(row.index))
            )
            logger.debug(
                "candidate field=%s value=%s label=%r unit_score=%.3f value_conf=%.3f "
                "effective_score=%.3f row=%s",
                field_cfg.key, value,
                row.label_token.text if row.label_token else None,
                score, float(row.value_token.score), effective, row.index,
            )
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
        logger.info(
            "WINNER field=%s value=%s label=%r unit_score=%.3f effective_score=%.3f row=%s",
            field_cfg.key, value,
            row.label_token.text if row.label_token else None,
            unit_score, effective, row.index,
        )
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
