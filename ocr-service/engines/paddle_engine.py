"""
PaddleOCR 3.7 engine adapter.

Implements BaseOcrEngine only. Routes/services/parsers stay unchanged.
Lazy init: if PaddleOCR fails to load (common on some Windows/Python builds),
is_available() is False and extract_text raises — service maps that to
EngineUnavailableError / OCR_INTERNAL_ERROR without crashing the process.

Phase 6D: diagnostics only — step logs + full traceback on init/predict failure.

Memory stability (Render free-tier):
- Model is loaded once per process (singleton via OcrService → PaddleEngine).
- Default PP-OCRv6_medium can OOM during predict() on large phone photos because
  PaddleOCR 3.x detection does not downscale by default (see paddleocr#17955).
- Cap detection input size and prefer small models to keep RSS under instance limits.
"""

from __future__ import annotations

import gc
import os
import sys
import threading
import traceback
from typing import Any

from engines.base_engine import BaseOcrEngine
from parser.tokens import extract_detections_from_paddle_result


def _diag(msg: str) -> None:
    """Debug-only log to stderr (never suppresses traceback)."""
    print(msg, file=sys.stderr, flush=True)


def _rss_mb() -> float | None:
    """Best-effort process RSS in MiB (Linux /proc; optional psutil)."""
    try:
        with open("/proc/self/status", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("VmRSS:"):
                    # VmRSS:   123456 kB
                    parts = line.split()
                    if len(parts) >= 2:
                        return round(int(parts[1]) / 1024.0, 1)
    except OSError:
        pass
    try:
        import resource  # noqa: PLC0415 — Unix only

        # ru_maxrss is KiB on Linux
        return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 1)
    except Exception:  # noqa: BLE001
        return None


def _env_str(name: str, default: str) -> str:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    return str(raw).strip()


def _env_int(name: str, default: int) -> int:
    raw = _env_str(name, str(default))
    try:
        return int(raw)
    except ValueError:
        return default


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
        # Prefer small models on constrained hosts (override via env).
        self._det_model = _env_str("OCR_PADDLE_DET_MODEL", "PP-OCRv6_small_det")
        self._rec_model = _env_str("OCR_PADDLE_REC_MODEL", "PP-OCRv6_small_rec")
        self._det_limit_type = _env_str("OCR_PADDLE_DET_LIMIT_TYPE", "max")
        self._det_limit_side_len = _env_int("OCR_PADDLE_DET_LIMIT_SIDE_LEN", 960)

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
                _diag(
                    "[3] Load model "
                    f"det={self._det_model} rec={self._rec_model} "
                    f"rss_mb={_rss_mb()}"
                )
                self._ocr = PaddleOCR(
                    lang="en",
                    text_detection_model_name=self._det_model,
                    text_recognition_model_name=self._rec_model,
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                )
                self._available = True
                self._init_error = None
                self._init_error_trace = None
                _diag(f"[4] Ready rss_mb={_rss_mb()}")
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

        rss_before = _rss_mb()
        _diag(
            f"[5] Run predict() image={path} "
            f"det_limit={self._det_limit_type}:{self._det_limit_side_len} "
            f"rss_mb_before={rss_before}"
        )
        result = None
        try:
            # Cap detection resolution — without this, large phone JPEGs can spike
            # RSS to tens of GB and get OOM-killed (Render restarts python main.py).
            result = self._ocr.predict(
                path,
                text_det_limit_type=self._det_limit_type,
                text_det_limit_side_len=self._det_limit_side_len,
            )
            rss_after = _rss_mb()
            _diag(f"[5b] predict() done rss_mb_after={rss_after}")

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
        except Exception as exc:
            _diag(f"[paddle-engine] PREDICT FAILED: {exc!r} rss_mb={_rss_mb()}")
            _diag(traceback.format_exc())
            raise
        finally:
            # Drop large intermediate tensors ASAP so the next request does not
            # inherit a high-water memory mark on small instances.
            try:
                del result
            except Exception:  # noqa: BLE001
                pass
            gc.collect()
            _diag(f"[5c] cleanup done rss_mb={_rss_mb()}")
