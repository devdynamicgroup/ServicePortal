"""
PaddleOCR 3.7 engine adapter.

Implements BaseOcrEngine only. Routes/services/parsers stay unchanged.
Lazy init: if PaddleOCR fails to load (common on some Windows/Python builds),
is_available() is False and extract_text raises — service maps that to
EngineUnavailableError / OCR_INTERNAL_ERROR without crashing the process.
"""

from __future__ import annotations

import threading
import time
import traceback
import sys
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
                self._init_error_trace = None
            except Exception as exc:  # noqa: BLE001 — engine must never crash the service
                # Preserve original exception message and full traceback for diagnostics.
                self._ocr = None
                self._available = False
                self._init_error = str(exc)
                self._init_error_trace = traceback.format_exc()
                try:
                    # Print original exception and full traceback to stderr for debugging.
                    print("[paddle-engine] init exception:", repr(exc), file=sys.stderr)
                    print(self._init_error_trace, file=sys.stderr)
                    # Additional diagnostics: environment variables and model cache inspection
                    try:
                        import os
                        from pathlib import Path

                        env_keys = [k for k in os.environ.keys() if 'PADDLE' in k.upper() or 'PADDLEX' in k.upper()]
                        env_snapshot = {k: (os.environ.get(k)[:100] + '...') if len(os.environ.get(k) or '') > 100 else os.environ.get(k) for k in env_keys}
                        print('[paddle-engine] paddle-related env keys:', env_snapshot, file=sys.stderr)

                        home = Path.home()
                        paddlex_cache = home.joinpath('.paddlex', 'official_models')
                        print('[paddle-engine] paddlex cache exists:', paddlex_cache.exists(), file=sys.stderr)
                        if paddlex_cache.exists():
                            # list top-level model dirs and first few filenames
                            try:
                                entries = []
                                for child in sorted(paddlex_cache.iterdir()):
                                    if child.is_dir():
                                        files = [p.name for p in sorted(child.glob('*'))][:10]
                                        entries.append({ 'model': child.name, 'files_sample': files })
                                print('[paddle-engine] paddlex cache contents sample:', entries, file=sys.stderr)
                            except Exception:
                                pass
                    except Exception:
                        pass
                except Exception:
                    pass

    def extract_text(self, image_path: str, *, meter_type: str | None = None) -> dict[str, Any]:
        self._ensure_init()
        if not self._available or self._ocr is None:
            # When unavailable, surface the original init error and traceback to stderr
            try:
                print("[paddle-engine] engine unavailable:", self._init_error or "PaddleOCR engine is not available", file=sys.stderr)
                if hasattr(self, '_init_error_trace') and self._init_error_trace:
                    print(self._init_error_trace, file=sys.stderr)
            except Exception:
                pass
            raise RuntimeError(self._init_error or "PaddleOCR engine is not available")

        path = str(image_path or "").strip()
        if not path:
            raise ValueError("image_path is required")

        start = time.perf_counter()
        # Run OCR predict and capture raw result
        try:
            result = self._ocr.predict(path)
        except Exception as exc:
            # If predict itself fails, print traceback then re-raise
            tb = traceback.format_exc()
            try:
                print('[paddle-engine] predict exception:', repr(exc), file=sys.stderr)
                print(tb, file=sys.stderr)
            except Exception:
                pass
            raise

        elapsed = (time.perf_counter() - start) * 1000.0

        # Diagnostics: print raw OCR output before parsing
        try:
            print('[paddle-engine] RAW OCR RESULT:', repr(result))
        except Exception:
            pass

        texts = _extract_texts(result)
        confidence = _average_confidence(result)
        if confidence is None:
            confidence = 0.0

        # Also print parsed diagnostics (raw text, parsed result, confidence, elapsed time)
        try:
            print('[paddle-engine] PARSED TEXTS:', texts)
            print('[paddle-engine] CONFIDENCE:', float(confidence))
            print('[paddle-engine] ELAPSED_MS:', round(elapsed, 2))
        except Exception:
            pass

        return {
            "texts": texts,
            "confidence": float(confidence),
            "raw": {
                "engine": self.name,
                "meter_type": (meter_type or "").lower() or None,
            },
        }
