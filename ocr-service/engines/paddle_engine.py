"""
PaddleOCR 3.7 engine adapter.

Implements BaseOcrEngine only. Routes/services/parsers stay unchanged.
Lazy init: if PaddleOCR fails to load (common on some Windows/Python builds),
is_available() is False and extract_text raises — service maps that to
EngineUnavailableError / OCR_INTERNAL_ERROR without crashing the process.

Phase 6D: diagnostics only — step logs + full traceback on init/predict failure.
"""

from __future__ import annotations

import sys
import threading
import traceback
from typing import Any

from engines.base_engine import BaseOcrEngine
from parser.tokens import extract_detections_from_paddle_result


def _diag(msg: str) -> None:
    """Debug-only log to stderr (never suppresses traceback)."""
    print(msg, file=sys.stderr, flush=True)


def _extract_texts(ocr_result: Any) -> list[str]:
    """Collect raw recognized text lines from PaddleOCR 3.x predict() output."""
    detections = extract_detections_from_paddle_result(ocr_result)
    return [str(d["text"]) for d in detections if d.get("text")]


def _average_confidence_from_detections(detections: list[dict[str, Any]]) -> float | None:
    scores: list[float] = []
    for det in detections:
        try:
            scores.append(float(det.get("score", 0.0)))
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
        self._init_error_trace: str | None = None

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
                _diag("[1] Import paddleocr")
                from paddleocr import PaddleOCR

                _diag("[2] Create PaddleOCR")
                # Official PaddleOCR 3.7 API (no show_log / use_angle_cls)
                # [3] Load model — happens inside PaddleOCR() constructor
                _diag("[3] Load model")
                self._ocr = PaddleOCR(
                    lang="en",
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                )
                self._available = True
                self._init_error = None
                self._init_error_trace = None
                _diag("[4] Ready")
            except Exception as exc:  # noqa: BLE001 — engine must never crash the service
                self._ocr = None
                self._available = False
                self._init_error = str(exc)
                self._init_error_trace = traceback.format_exc()
                _diag(f"[paddle-engine] INIT FAILED: {exc!r}")
                _diag(self._init_error_trace)

    def extract_text(self, image_path: str, *, meter_type: str | None = None) -> dict[str, Any]:
        self._ensure_init()
        if not self._available or self._ocr is None:
            _diag(f"[paddle-engine] engine unavailable: {self._init_error or 'PaddleOCR engine is not available'}")
            if self._init_error_trace:
                _diag(self._init_error_trace)
            raise RuntimeError(self._init_error or "PaddleOCR engine is not available")

        path = str(image_path or "").strip()
        if not path:
            raise ValueError("image_path is required")

        _diag(f"[5] Run predict() image={path}")
        try:
            result = self._ocr.predict(path)
        except Exception as exc:
            _diag(f"[paddle-engine] PREDICT FAILED: {exc!r}")
            _diag(traceback.format_exc())
            raise

        detections = extract_detections_from_paddle_result(result)
        texts = [str(d["text"]) for d in detections if d.get("text")]
        _diag(f"[6] OCR text: {texts}")
        _diag(f"[6b] OCR detections: {len(detections)} tokens with boxes")

        confidence = _average_confidence_from_detections(detections)
        if confidence is None:
            confidence = 0.0

        return {
            "texts": texts,
            "confidence": float(confidence),
            # Spatial payload for measurement parser (boxes + per-token scores)
            "detections": detections,
            "raw": {
                "engine": self.name,
                "meter_type": (meter_type or "").lower() or None,
                "detection_count": len(detections),
            },
        }
