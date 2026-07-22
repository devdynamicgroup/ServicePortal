"""
Stage B — Spatial row grouper.

Clusters OCR tokens into screen rows using bounding-box centers.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from statistics import median
from typing import Sequence

from parser.tokens import OcrToken


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


def _pick_value_and_label(tokens: Sequence[OcrToken]) -> tuple[OcrToken | None, OcrToken | None]:
    """
    Within a left-to-right row:
      value = leftmost numeric (non-ignored) token
      label = rightmost non-numeric binding token (or nearest right of value)
    """
    bindable = [t for t in tokens if not t.ignored and not t.debug_only]
    numerics = [t for t in bindable if t.is_numeric]
    labels = [t for t in bindable if not t.is_numeric]

    value = numerics[0] if numerics else None
    if not value:
        return None, None

    # Prefer label to the right of the value.
    right_labels = [t for t in labels if t.cx >= value.cx]
    if right_labels:
        return value, right_labels[-1]  # rightmost among right-side labels
    if labels:
        return value, labels[-1]
    return value, None


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
        value, label = _pick_value_and_label(sorted_tokens)
        mean_cy = sum(t.cy for t in sorted_tokens) / len(sorted_tokens)
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
