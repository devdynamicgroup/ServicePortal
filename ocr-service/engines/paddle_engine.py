"""
PaddleOCR 3.7 engine adapter.

Implements BaseOcrEngine only. Routes/services/parsers stay unchanged.

Lifecycle: INITIALIZING -> READY | FAILED, settled exactly once per process.
is_available() is a non-blocking read for health checks only. The request
path uses ensure_ready() instead, which blocks until init settles (or runs
it synchronously if nothing has yet) — a request never gets rejected just
because init is still running; only a settled FAILED state raises
EngineUnavailableError / OCR_INTERNAL_ERROR (never crashes the process).

Phase 6D: diagnostics only — step logs + full traceback on init/predict failure.

Memory stability (Render free-tier):
- Model is loaded once per process (singleton via OcrService → PaddleEngine).
- Default PP-OCRv6_medium can OOM during predict() on large phone photos because
  PaddleOCR 3.x detection does not downscale by default (see paddleocr#17955).
- Cap detection input size and prefer small models to keep RSS under instance limits.
"""

from __future__ import annotations

print("[ENGINE BUILD] small-model-fix-v1 LOADED", flush=True)

import gc
import os
import sys
import threading
import time
import traceback
from typing import Any

# Unmistakable import fingerprint — must appear in Render logs when THIS file loads.
# If boot shows [1]/[2]/[3] Load model but NOT this line, runtime is not this module.
print(
    "========== SMALL MODEL PATCH LOADED v1 ==========",
    file=sys.stderr,
    flush=True,
)
print(
    f"========== paddle_engine.py file={__file__} ==========",
    file=sys.stderr,
    flush=True,
)

from engines.base_engine import BaseOcrEngine
from core.logger import get_logger
from parser.tokens import extract_detections_from_paddle_result

# Deploy fingerprint — must appear in Render boot logs (Definition of Done Phase 1).
_BUILD_ID = "small-model-fix-v1"

logger = get_logger("engines.paddle")


def _diag(msg: str) -> None:
    """Always-visible engine diagnostics (stderr + service logger)."""
    print(msg, file=sys.stderr, flush=True)
    try:
        logger.info("%s", msg)
    except Exception:  # noqa: BLE001 — never fail init/predict on logging
        pass


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


def _env_bool(name: str, default: bool) -> bool:
    raw = _env_str(name, "1" if default else "0").lower()
    return raw in ("1", "true", "yes", "on")


def _malloc_trim() -> None:
    """Return freed heap memory to the OS (Linux/glibc only — Render is
    Linux, so this matters there; harmless no-op everywhere else). Python's
    allocator and glibc's ptmalloc don't always give freed pages back on
    their own, so RSS can stay inflated after a predict() call's temporary
    buffers are done with, even though nothing is actually using them —
    on a 512MB instance that headroom is worth reclaiming explicitly.
    """
    try:
        import ctypes

        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:  # noqa: BLE001 — best-effort only, never fail the caller
        pass


def _extract_texts(ocr_result: Any) -> list[str]:
    """Collect raw recognized text lines from PaddleOCR 3.x predict() output."""
    detections = extract_detections_from_paddle_result(ocr_result)
    return [str(d["text"]) for d in detections if d.get("text")]


class EngineState:
    """Explicit lifecycle states — engine starts INITIALIZING and settles
    into READY or FAILED exactly once (single init attempt per process)."""

    INITIALIZING = "initializing"
    READY = "ready"
    FAILED = "failed"


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
        self._state = EngineState.INITIALIZING
        self._init_error: str | None = None
        self._init_error_trace: str | None = None
        # Prefer small models on constrained hosts (override via env).
        self._det_model = _env_str("OCR_PADDLE_DET_MODEL", "PP-OCRv6_small_det")
        self._rec_model = _env_str("OCR_PADDLE_REC_MODEL", "PP-OCRv6_small_rec")
        self._det_limit_type = _env_str("OCR_PADDLE_DET_LIMIT_TYPE", "max")
        self._det_limit_side_len = _env_int("OCR_PADDLE_DET_LIMIT_SIDE_LEN", 960)
        # Memory, not CPU, is the binding constraint on Render free tier
        # (512MB total; model load alone was measured at ~503MB RSS with
        # PaddleOCR's own defaults — cpu_threads=10, mkldnn_cache_capacity=10).
        # 10 worker threads is pure overhead on a 0.1 vCPU instance anyway —
        # no real parallelism to gain, just per-thread buffer cost. Verified
        # locally: cpu_threads=1 + mkldnn_cache_capacity=1 cut predict()'s
        # memory growth by ~24% with no accuracy change. Still trades some
        # inference speed for memory headroom — that's the right tradeoff
        # here since OOM is a hard crash and slow-but-alive is not.
        self._cpu_threads = _env_int("OCR_PADDLE_CPU_THREADS", 1)
        self._mkldnn_cache_capacity = _env_int("OCR_PADDLE_MKLDNN_CACHE_CAPACITY", 1)
        # mkldnn_cache_capacity=1 alone was not enough headroom — a real
        # request still OOM-killed the instance (Render Events: "Ran out of
        # memory (used over 512MB)" during predict()). MKL-DNN's optimized
        # kernel workspace itself costs memory beyond just its result cache;
        # disabling it entirely trades some predict() speed for that memory
        # back — worth it here since a crash returns nothing at all while
        # slow-but-alive still returns a real result.
        self._enable_mkldnn = _env_bool("OCR_PADDLE_ENABLE_MKLDNN", False)

    @property
    def name(self) -> str:
        return "paddle"

    def is_available(self) -> bool:
        """Cheap, non-blocking read of cached readiness — never triggers or
        waits on model init. For health checks only; the request path must
        use ensure_ready() so it waits instead of failing fast mid-init.
        """
        return self._state == EngineState.READY

    def warmup(self) -> bool:
        """Eagerly load PaddleOCR — call from a background thread after the
        HTTP server is already listening. Blocks the calling thread only
        (never the request path) until model load/download completes.
        Unbounded: no HTTP response is riding on this call.
        """
        return self.ensure_ready()

    def ensure_ready(self, timeout: float | None = None) -> bool:
        """Block the calling thread until initialization finishes, running
        it synchronously here if nothing else has started it yet. Concurrent
        callers (background warmup + one or more requests) all funnel
        through the same lock in _ensure_init() — only one thread ever runs
        the real init; everyone else just waits on it.

        timeout (seconds): request-path callers must pass a bound (see
        Settings.engine_wait_timeout_seconds) so a slow cold-start model
        download can't hold the HTTP response open longer than an upstream
        edge/proxy timeout allows — past that point the edge kills the
        connection and returns its own non-JSON error page instead of ours.
        Timing out here just means "still initializing", not failure: state
        stays INITIALIZING and a later request will pick up where this one
        left off (or find it already READY/FAILED by then).
        """
        self._ensure_init(timeout=timeout)
        return self._state == EngineState.READY

    def _ensure_init(self, timeout: float | None = None) -> None:
        # Fast path: already settled (READY/FAILED) — no lock needed.
        if self._state != EngineState.INITIALIZING:
            return
        # Lock.acquire's own sentinel for "wait forever" is -1, not None.
        acquired = self._lock.acquire(timeout=-1 if timeout is None else timeout)
        if not acquired:
            _diag(
                f"[ENGINE STATE] ensure_ready timed out after {timeout}s waiting "
                "for init — still INITIALIZING, not failed"
            )
            return
        try:
            # Re-check now that we hold the lock: if another thread finished
            # (or is still running) while we were waiting to acquire it, the
            # state has either settled (nothing left to do) by the time we
            # get here, or we are that other thread's very first caller and
            # must do the real work ourselves. Either way, state — not a
            # separate "attempted" flag — is the single source of truth, so
            # a caller that arrives mid-init blocks on the lock for the
            # *entire* duration instead of seeing a stale "not ready yet"
            # and bailing.
            if self._state != EngineState.INITIALIZING:
                return
            _diag("[ENGINE STATE] ENGINE_INITIALIZING")
            logger.info("[ENGINE STATE] ENGINE_INITIALIZING")
            try:
                _diag("[1] Import paddleocr")
                from paddleocr import PaddleOCR

                try:
                    import paddleocr as _paddleocr_mod  # noqa: PLC0415

                    paddleocr_ver = getattr(_paddleocr_mod, "__version__", "unknown")
                    paddleocr_file = getattr(_paddleocr_mod, "__file__", "unknown")
                except Exception:  # noqa: BLE001
                    paddleocr_ver = "unknown"
                    paddleocr_file = "unknown"

                # Phase 1 — prove runtime build + resolved models (DoD fingerprint).
                logger.info(
                    "[ENGINE BUILD] %s det=%s rec=%s engine_file=%s paddleocr=%s",
                    _BUILD_ID,
                    self._det_model,
                    self._rec_model,
                    __file__,
                    paddleocr_ver,
                )
                _diag(
                    f"[ENGINE BUILD] {_BUILD_ID} det={self._det_model} "
                    f"rec={self._rec_model} paddleocr={paddleocr_ver} "
                    f"paddleocr_file={paddleocr_file}"
                )

                kwargs = {
                    "lang": "en",
                    "text_detection_model_name": self._det_model,
                    "text_recognition_model_name": self._rec_model,
                    "use_doc_orientation_classify": False,
                    "use_doc_unwarping": False,
                    "use_textline_orientation": False,
                    "cpu_threads": self._cpu_threads,
                    "enable_mkldnn": self._enable_mkldnn,
                    "mkldnn_cache_capacity": self._mkldnn_cache_capacity,
                }
                logger.info("[ENGINE KWARGS] %s", kwargs)
                _diag(f"[ENGINE KWARGS] {kwargs!r} rss_mb={_rss_mb()}")

                _diag("[2] Create PaddleOCR")
                # Official PaddleOCR 3.7 API — if both model names are None,
                # PaddleOCR falls back to PP-OCRv6_medium_* (see _get_ocr_model_names).
                _diag(
                    "[3] Load model "
                    f"det={self._det_model} rec={self._rec_model} "
                    f"rss_mb={_rss_mb()}"
                )
                self._ocr = PaddleOCR(**kwargs)
                try:
                    kept = getattr(self._ocr, "_params", None) or {}
                    logger.info(
                        "[ENGINE CREATED] text_detection_model_name=%s text_recognition_model_name=%s",
                        kept.get("text_detection_model_name"),
                        kept.get("text_recognition_model_name"),
                    )
                    _diag(
                        "[ENGINE CREATED] "
                        f"text_detection_model_name={kept.get('text_detection_model_name')!r} "
                        f"text_recognition_model_name={kept.get('text_recognition_model_name')!r}"
                    )
                except Exception as probe_exc:  # noqa: BLE001 — diagnostic only
                    _diag(f"[ENGINE CREATED] _params probe failed: {probe_exc!r}")
                self._init_error = None
                self._init_error_trace = None
                self._state = EngineState.READY
                # Give back any transient load-time memory before we report
                # readiness — every MB matters at ~500MB RSS on a 512MB cap.
                gc.collect()
                _malloc_trim()
                _diag(f"[4] Ready rss_mb={_rss_mb()}")
                _diag("[ENGINE STATE] ENGINE_READY")
                logger.info("[ENGINE STATE] ENGINE_READY")
            except Exception as exc:  # noqa: BLE001 — engine must never crash the service
                self._ocr = None
                self._init_error = str(exc)
                self._init_error_trace = traceback.format_exc()
                self._state = EngineState.FAILED
                _diag(f"[paddle-engine] INIT FAILED: {exc!r}")
                _diag(self._init_error_trace)
                _diag("[ENGINE STATE] ENGINE_FAILED")
                logger.error("[ENGINE STATE] ENGINE_FAILED error=%r", exc)
        finally:
            self._lock.release()

    def extract_text(self, image_path: str, *, meter_type: str | None = None) -> dict[str, Any]:
        self._ensure_init()
        if self._state != EngineState.READY or self._ocr is None:
            _diag(f"[paddle-engine] engine unavailable: {self._init_error or 'PaddleOCR engine is not available'}")
            if self._init_error_trace:
                _diag(self._init_error_trace)
            raise RuntimeError(self._init_error or "PaddleOCR engine is not available")

        path = str(image_path or "").strip()
        if not path:
            raise ValueError("image_path is required")

        # Squeeze the baseline as low as possible right before the single
        # most memory-critical moment — predict() itself. Cheap insurance on
        # a 512MB instance where idle RSS can already sit within ~5MB of the
        # request that's about to run.
        gc.collect()
        _malloc_trim()
        rss_before = _rss_mb()
        t_predict = time.perf_counter()
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
            duration_ms = (time.perf_counter() - t_predict) * 1000.0
            rss_after = _rss_mb()
            _diag(
                f"[5b] predict done duration_ms={duration_ms:.1f} "
                f"rss_mb={rss_after}"
            )

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
            _malloc_trim()
            _diag(f"[5c] cleanup done rss_mb={_rss_mb()}")
