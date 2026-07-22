"""
Stage B — Spatial row grouper.

Clusters OCR tokens into screen rows using bounding-box centers.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from statistics import median
from typing import Sequence

from core.logger import get_logger
from parser.tokens import OcrToken

logger = get_logger("parser.row_grouper")


@dataclass
class MeasurementRow:
    index: int
    cy: float
    tokens: list[OcrToken] = field(default_factory=list)
    value_token: OcrToken | None = None
    label_token: OcrToken | None = None


def _token_height(token: OcrToken) -> float:
    return max(1.0, float(token.box[3] - token.box[1]))


def _normalize_ignore_key(text: str) -> str:
    """Same normalization tokens.py._classify_ignore uses, so profile
    ignore_tokens (JSON) match the same way the hardcoded IGNORE_TOKENS do."""
    return re.sub(r"[^a-z0-9%]", "", str(text or "").lower())


def _is_profile_ignored(token: OcrToken, extra_ignore: frozenset[str]) -> bool:
    if not extra_ignore:
        return False
    return _normalize_ignore_key(token.text) in extra_ignore


def _y_threshold(tokens: Sequence[OcrToken], *, ratio: float = 0.55) -> float:
    heights = [_token_height(t) for t in tokens]
    if not heights:
        return 40.0
    return max(12.0, float(median(heights)) * float(ratio))


def _match_labels_to_values(
    tokens: Sequence[OcrToken],
) -> list[tuple[OcrToken, OcrToken | None]]:
    """
    Pair every label token in a row-cluster with the nearest valid value
    token, instead of assuming a single value/label per detected row.

    Matching rules (spatial, never relies on OCR array order):
      - Candidates are ranked by (same-line already guaranteed by the
        caller's cy clustering, side, horizontal distance): a value to the
        RIGHT of a label always outranks a value to its left, and within the
        same side the nearest one wins.
      - Matching is resolved greedily across the whole row: the globally
        closest label/value pair is assigned first, so a tight pair is never
        stolen by a farther-away label later in the same row.
      - If a label has no candidate to its right at all, the nearest
        available value on either side is used as a fallback (logged).
      - Numeric tokens left over with no label are still returned
        (label=None) so callers relying on positional/row hints keep working;
        labels left over with no available value are dropped (nothing to
        bind them to).
    """
    bindable = [t for t in tokens if not t.ignored and not t.debug_only]
    numerics = [t for t in bindable if t.is_numeric]
    labels = [t for t in bindable if not t.is_numeric]

    if not numerics:
        return []
    if not labels:
        return [(v, None) for v in numerics]

    candidates: list[tuple[tuple[int, float], OcrToken, OcrToken, str, float]] = []
    for label in labels:
        for value in numerics:
            dx = float(value.cx) - float(label.cx)
            is_right = dx >= 0
            reason = "right_of_label" if is_right else "nearest_fallback_left_of_label"
            rank = (0 if is_right else 1, abs(dx))
            candidates.append((rank, label, value, reason, dx))

    candidates.sort(key=lambda c: c[0])

    used_labels: set[int] = set()
    used_values: set[int] = set()
    pairs: list[tuple[OcrToken, OcrToken | None]] = []
    for _rank, label, value, reason, dx in candidates:
        if id(label) in used_labels or id(value) in used_values:
            continue
        used_labels.add(id(label))
        used_values.add(id(value))
        logger.debug(
            "label=%r box=%s matched value=%r box=%s dx=%.1f reason=%s",
            label.text, label.box, value.text, value.box, dx, reason,
        )
        pairs.append((value, label))

    for value in numerics:
        if id(value) not in used_values:
            logger.debug(
                "value=%r box=%s left unmatched: no label candidate available in this row",
                value.text, value.box,
            )
            pairs.append((value, None))

    return pairs


def group_rows(
    tokens: Sequence[OcrToken],
    *,
    y_threshold_ratio: float = 0.55,
    y_threshold: float | None = None,
    include_debug: bool = False,
    extra_ignore_tokens: Sequence[str] = (),
) -> list[MeasurementRow]:
    """
    Cluster tokens into rows by cy proximity, then sort each row by cx.

    Tokens marked ignored (ESC/HELP/...) are excluded from measurement rows
    unless they somehow sit alone — they never become value/label.

    ``extra_ignore_tokens`` is profile-specific (e.g. resistivity units like
    "MO.cm" that a given meter's screen shows but that should never become a
    label/value candidate), matched with the same normalization as the
    built-in IGNORE_TOKENS set in tokens.py.
    """
    extra_ignore = frozenset(_normalize_ignore_key(t) for t in extra_ignore_tokens if t)
    usable = [
        t
        for t in tokens
        if not t.ignored
        and (include_debug or not t.debug_only)
        and not _is_profile_ignored(t, extra_ignore)
    ]
    # Always keep numeric + unit-like tokens; drop pure brand/debug unless include_debug.
    # Multiparameter model strings may appear as debug_only — exclude from rows.
    if not usable:
        return []

    threshold = y_threshold if y_threshold is not None else _y_threshold(usable, ratio=y_threshold_ratio)
    ordered = sorted(usable, key=lambda t: (t.cy, t.cx))

    clusters: list[list[OcrToken]] = []
    for token in ordered:
        if not clusters:
            clusters.append([token])
            continue
        current = clusters[-1]
        mean_cy = sum(t.cy for t in current) / len(current)
        if abs(token.cy - mean_cy) <= threshold:
            current.append(token)
        else:
            clusters.append([token])

    rows: list[MeasurementRow] = []
    row_index = 0
    for cluster in clusters:
        # Skip clusters with no numeric token (brand/title lines without values).
        if not any(t.is_numeric for t in cluster):
            continue
        sorted_tokens = sorted(cluster, key=lambda t: t.cx)
        mean_cy = sum(t.cy for t in sorted_tokens) / len(sorted_tokens)
        pairs = _match_labels_to_values(sorted_tokens)
        # A single OCR row-cluster can contain more than one label/value pair
        # (e.g. two readings printed on the same physical line). Emit one
        # MeasurementRow per pair so the field binder can bind each label to
        # its own field instead of merging them into a single value/label.
        for value, label in pairs:
            rows.append(
                MeasurementRow(
                    index=row_index,
                    cy=mean_cy,
                    tokens=sorted_tokens,
                    value_token=value,
                    label_token=label,
                )
            )
            row_index += 1
    return rows
