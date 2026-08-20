"""
Stage A — OCR token normalizer.

Converts PaddleOCR rec_texts / rec_scores / rec_boxes into OcrToken objects.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from parser.normalize import correct_ocr_token, is_unit_only_token

_NUMBER_RE = re.compile(r"^[-+]?\d+(?:\.\d+)?$")

# UI chrome — never bind measurement fields from these.
IGNORE_TOKENS = frozenset(
    {
        "esc",
        "help",
        "menu",
        "log",
        "ok",
        "on",
        "off",
        "set",
        "cal",
        "mode",
        "hold",
    }
)

# Kept for debug / profile auto-detect; never used as field values.
DEBUG_ONLY_TOKENS = frozenset(
    {
        "hanna",
        "hi98194",
    }
)


@dataclass(frozen=True)
class OcrToken:
    text: str
    text_corrected: str
    score: float
    box: tuple[float, float, float, float]  # x1, y1, x2, y2
    cx: float
    cy: float
    is_numeric: bool
    ignored: bool = False  # UI chrome
    debug_only: bool = False  # brand / model labels


def _as_box(raw: Any) -> tuple[float, float, float, float] | None:
    """Normalize box-like payloads to (x1, y1, x2, y2)."""
    if raw is None:
        return None
    try:
        if hasattr(raw, "tolist"):
            raw = raw.tolist()
        vals = list(raw)
    except (TypeError, ValueError):
        return None

    # Polygon [[x,y], ...] → axis-aligned box
    if vals and isinstance(vals[0], (list, tuple)) and len(vals[0]) >= 2:
        xs = [float(p[0]) for p in vals]
        ys = [float(p[1]) for p in vals]
        return (min(xs), min(ys), max(xs), max(ys))

    if len(vals) >= 4:
        return (float(vals[0]), float(vals[1]), float(vals[2]), float(vals[3]))
    return None


def _is_numeric(text: str) -> bool:
    return bool(_NUMBER_RE.fullmatch(str(text or "").strip()))


def _classify_ignore(text: str) -> tuple[bool, bool]:
    key = re.sub(r"[^a-z0-9%]", "", str(text or "").lower())
    if key in IGNORE_TOKENS:
        return True, False
    if key in DEBUG_ONLY_TOKENS:
        return False, True
    # Model strings like HI98194
    if re.fullmatch(r"hi\d+", key):
        return False, True
    return False, False


# A single OCR detection sometimes fuses a decimal value and its uppercase
# unit/label together with no usable gap ("7.29 PH", "-15.0MVPH") instead of
# the two ending up as separate detections ("7.29" / "PH"). make_token()'s
# whole-string _is_numeric() check then classifies the entire fused string as
# a non-numeric label, so the value is silently dropped by the row grouper
# (no numeric token left in that row to pair with anything) — proven against
# a real Paddle run on ocr/test_images/test-images.jpg, where "orp"/"do_percent"
# (delivered as separate detections) bound correctly but "ph"/"mv" (fused)
# did not, despite the raw OCR text being correct.
#
# Deliberately narrow to the proven pattern only:
#   - decimal number required (matches the two proven cases; excludes bare
#     integers like "2" so keypad-button OCR like "2 abc" is never touched)
#   - label must be uppercase-only (+ %, °, µ, /, .) — real meter unit labels
#     ("PH", "MVPH", "MVORP", "%00") are never lowercase; excludes prose like
#     keypad "abc" or "Cert No.: ..." by construction, not by a blocklist
#   - number must come first (the only order actually observed)
_FUSED_VALUE_LABEL_RE = re.compile(r"^([+-]?\d+\.\d+)\s*([A-Z%°µ/.]{1,10})$")


def _split_fused_value_label(raw: str) -> tuple[str, str] | None:
    match = _FUSED_VALUE_LABEL_RE.match(raw.strip())
    if not match:
        return None
    return match.group(1), match.group(2)


def _split_box(box: Sequence[float] | None, frac: float) -> tuple[Any, Any]:
    parsed = _as_box(box)
    if parsed is None:
        return box, box
    x1, y1, x2, y2 = parsed
    split_x = x1 + (x2 - x1) * frac
    return (x1, y1, split_x, y2), (split_x, y1, x2, y2)


def make_tokens(
    text: str,
    *,
    score: float = 1.0,
    box: Sequence[float] | None = None,
) -> list[OcrToken]:
    """Like make_token(), but may return two tokens when a single OCR
    detection fused a decimal value with its unit/label (see
    _split_fused_value_label). Callers that ingest raw detections
    (tokens_from_detections / tokens_from_parallel_lists) should use this;
    make_token() itself stays a strict one-token function — its contract is
    covered by tests that assume exactly that.
    """
    raw = str(text or "").strip()
    plain = make_token(raw, score=score, box=box)
    if plain.is_numeric or plain.ignored or plain.debug_only:
        return [plain]

    split = _split_fused_value_label(raw)
    if split is None:
        return [plain]
    number_text, label_text = split
    number_box, label_box = _split_box(box, len(number_text) / len(raw))
    return [
        make_token(number_text, score=score, box=number_box),
        make_token(label_text, score=score, box=label_box),
    ]


def make_token(
    text: str,
    *,
    score: float = 1.0,
    box: Sequence[float] | None = None,
) -> OcrToken:
    raw = str(text or "").strip()
    corrected, _ = correct_ocr_token(raw)
    if is_unit_only_token(raw):
        corrected = raw
    # Prefer corrected form for numeric classification when token is mostly digits.
    numeric_candidate = corrected if _is_numeric(corrected) else raw
    if not _is_numeric(numeric_candidate) and _is_numeric(corrected):
        numeric_candidate = corrected

    # Apply digit glyph correction only for classification / values;
    # keep corrected string always.
    text_corrected = corrected if corrected else raw
    ignored, debug_only = _classify_ignore(raw)

    if box is None:
        x1 = y1 = x2 = y2 = 0.0
    else:
        parsed = _as_box(box)
        if parsed is None:
            x1 = y1 = x2 = y2 = 0.0
        else:
            x1, y1, x2, y2 = parsed

    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0
    return OcrToken(
        text=raw,
        text_corrected=text_corrected,
        score=max(0.0, min(1.0, float(score))),
        box=(x1, y1, x2, y2),
        cx=cx,
        cy=cy,
        is_numeric=(not is_unit_only_token(raw) and _is_numeric(text_corrected)),
        ignored=ignored,
        debug_only=debug_only,
    )


def tokens_from_parallel_lists(
    texts: Sequence[str],
    scores: Sequence[float] | None = None,
    boxes: Sequence[Any] | None = None,
) -> list[OcrToken]:
    """Build tokens from parallel OCR arrays."""
    out: list[OcrToken] = []
    n = len(texts)
    for i in range(n):
        text = str(texts[i] if texts[i] is not None else "").strip()
        if not text:
            continue
        score = 1.0
        if scores is not None and i < len(scores):
            try:
                score = float(scores[i])
            except (TypeError, ValueError):
                score = 1.0
        box = None
        if boxes is not None and i < len(boxes):
            box = boxes[i]
        out.extend(make_tokens(text, score=score, box=box))
    return out


def tokens_from_detections(detections: Iterable[dict[str, Any]]) -> list[OcrToken]:
    """Build tokens from engine detection dicts: {text, score, box}."""
    out: list[OcrToken] = []
    for det in detections or []:
        if not isinstance(det, dict):
            continue
        text = str(det.get("text") or "").strip()
        if not text:
            continue
        try:
            score = float(det.get("score", 1.0))
        except (TypeError, ValueError):
            score = 1.0
        out.extend(make_tokens(text, score=score, box=det.get("box")))
    return out


def extract_detections_from_paddle_result(ocr_result: Any) -> list[dict[str, Any]]:
    """
    Pull parallel rec_texts / rec_scores / rec_boxes from PaddleOCR 3.x predict().
    Returns list of {text, score, box} dicts (JSON-serializable).
    """
    detections: list[dict[str, Any]] = []
    if not ocr_result:
        return detections

    for item in ocr_result:
        if item is None:
            continue

        rec_texts = None
        rec_scores = None
        rec_boxes = None

        if hasattr(item, "keys") and "rec_texts" in item:
            rec_texts = item["rec_texts"]
            rec_scores = item["rec_scores"] if "rec_scores" in item else None
            rec_boxes = item["rec_boxes"] if "rec_boxes" in item else None
        elif hasattr(item, "get"):
            rec_texts = item.get("rec_texts")
            rec_scores = item.get("rec_scores")
            rec_boxes = item.get("rec_boxes")
            if rec_texts is None and "res" in item:
                nested = item["res"]
                if hasattr(nested, "get"):
                    rec_texts = nested.get("rec_texts")
                    rec_scores = nested.get("rec_scores")
                    rec_boxes = nested.get("rec_boxes")
        else:
            rec_texts = getattr(item, "rec_texts", None)
            rec_scores = getattr(item, "rec_scores", None)
            rec_boxes = getattr(item, "rec_boxes", None)

        if not rec_texts:
            continue

        if hasattr(rec_boxes, "tolist"):
            rec_boxes = rec_boxes.tolist()

        for i, text in enumerate(rec_texts):
            text = str(text or "").strip()
            if not text:
                continue
            score = 1.0
            if rec_scores is not None and i < len(rec_scores):
                try:
                    score = float(rec_scores[i])
                except (TypeError, ValueError):
                    score = 1.0
            box = None
            if rec_boxes is not None and i < len(rec_boxes):
                parsed = _as_box(rec_boxes[i])
                if parsed is not None:
                    box = list(parsed)
            detections.append({"text": text, "score": score, "box": box})

    return detections
