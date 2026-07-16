"""
PaddleOCR 3.7 engine adapter.

Implements BaseOcrEngine only. Routes/services/parsers stay unchanged.
Lazy init: if PaddleOCR fails to load (common on some Windows/Python builds),
is_available() is False and extract_text raises — service maps that to
EngineUnavailableError / OCR_INTERNAL_ERROR without crashing the process.
"""

from __future__ import annotations

import threading
from typing import Any

from engines.base_engine import BaseOcrEngine


def _extract_texts(ocr_result: Any) -> list[str]:
    """Collect raw recognized text lines from PaddleOCR 3.x predict() output."""
    lines: list[str] = []
    if not ocr_result:
        return lines

    for item in ocr_result:
        if item is None:
            continue

        rec_texts = None

        if hasattr(item, "keys") and "rec_texts" in item:
            rec_texts = item["rec_texts"]
        elif hasattr(item, "get"):
            rec_texts = item.get("rec_texts")
            if rec_texts is None and "res" in item:
                nested = item["res"]
                if hasattr(nested, "get"):
                    rec_texts = nested.get("rec_texts")
                elif isinstance(nested, dict):
                    rec_texts = nested.get("rec_texts")
        elif hasattr(item, "rec_texts"):
            rec_texts = item.rec_texts

        if not rec_texts:
            continue

        for text in rec_texts:
            text = str(text).strip()
            if text:
                lines.append(text)

    return lines


def _average_confidence(ocr_result: Any) -> float | None:
    scores: list[float] = []
    if not ocr_result:
        return None

    for item in ocr_result:
        if item is None:
            continue
        rec_scores = None
        if hasattr(item, "keys") and "rec_scores" in item:
            rec_scores = item["rec_scores"]
        elif hasattr(item, "get"):
            rec_scores = item.get("rec_scores")
        elif hasattr(item, "rec_scores"):
            rec_scores = item.rec_scores
        if not rec_scores:
            continue
        for score in rec_scores:
            try:
                scores.append(float(score))
            except (TypeError, ValueError):
                continue

    if not scores:
        return None
    return sum(scores) / len(scores)


class PaddleEngine(BaseOcrEngine):
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ocr: Any = None
        self._init_attempted = False
        self._available = False
        self._init_error: str | None = None

    @property
    def name(self) -> str:
        return "paddle"

    def is_available(self) -> bool:
        self._ensure_init()
        return self._available

    def _ensure_init(self) -> None:
        if self._init_attempted:
            return
        with self._lock:
            if self._init_attempted:
                return
            self._init_attempted = True
            try:
                from paddleocr import PaddleOCR

                # Official PaddleOCR 3.7 API (no show_log / use_angle_cls)
                self._ocr = PaddleOCR(
                    lang="en",
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                )
                self._available = True
                self._init_error = None
            except Exception as exc:  # noqa: BLE001 — engine must never crash the service
                self._ocr = None
                self._available = False
                self._init_error = str(exc)

    def extract_text(self, image_path: str, *, meter_type: str | None = None) -> dict[str, Any]:
        self._ensure_init()
        if not self._available or self._ocr is None:
            raise RuntimeError(
                self._init_error or "PaddleOCR engine is not available"
            )

        path = str(image_path or "").strip()
        if not path:
            raise ValueError("image_path is required")

        result = self._ocr.predict(path)
        texts = _extract_texts(result)
        confidence = _average_confidence(result)
        if confidence is None:
            confidence = 0.0

        return {
            "texts": texts,
            "confidence": float(confidence),
            "raw": {
                "engine": self.name,
                "meter_type": (meter_type or "").lower() or None,
            },
        }
