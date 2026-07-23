"""
OCR processing pipeline.

Orchestrates: image validate → preprocess → engine → reader → parser →
result validate → confidence. No HTTP/route logic here.
"""

from __future__ import annotations

import concurrent.futures
import time
from typing import Any

from confidence.confidence_service import ConfidenceService
from config.settings import Settings, settings as default_settings
from core.exceptions import EngineUnavailableError, OcrTimeoutError
from core.logger import get_logger
from engines.base_engine import BaseOcrEngine
from parser.normalize import merge_with_fallback
from preprocess import run_preprocess_chain
from processing.context import PipelineContext
from readers.meter_reader import read_measurements
from validation.image_validator import ImageValidator
from validation.result_validator import ResultValidator

logger = get_logger("processing.pipeline")


def _ms_since(started: float) -> float:
    return round((time.perf_counter() - started) * 1000.0, 3)


class OcrPipeline:
    def __init__(
        self,
        engine: BaseOcrEngine,
        *,
        settings: Settings | None = None,
        image_validator: ImageValidator | None = None,
        result_validator: ResultValidator | None = None,
        confidence_service: ConfidenceService | None = None,
    ) -> None:
        self.engine = engine
        self.settings = settings or default_settings
        self.image_validator = image_validator or ImageValidator(
            min_width=self.settings.image_min_width,
            min_height=self.settings.image_min_height,
            max_width=self.settings.image_max_width,
            max_height=self.settings.image_max_height,
            max_bytes=self.settings.image_max_bytes,
            allow_virtual=self.settings.allow_virtual_images,
        )
        self.result_validator = result_validator or ResultValidator()
        self.confidence_service = confidence_service or ConfidenceService()
        # Single persistent worker thread for every OCR call, reused for the
        # pipeline's lifetime. PaddleOCR's native inference runtime is NOT
        # safe to invoke from a fresh thread on every request — confirmed by
        # reproduction: spawning a new ThreadPoolExecutor per call reliably
        # broke the predictor after ~8-9 calls (RuntimeError: Unknown
        # exception from paddle_static/runner.py, sometimes a hard segfault).
        # Running every predict() on the same single worker thread instead
        # eliminates the crash entirely (verified against all real test
        # images). Still bounds a stuck call via future.result(timeout=...).
        self._engine_executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="ocr-engine"
        )

    def run(self, *, request_id: str, meter_type: str, image_path: str) -> PipelineContext:
        ctx = PipelineContext(
            request_id=request_id,
            meter_type=(meter_type or "").lower(),
            image_path=image_path,
            engine=self.engine.name,
        )

        # 1) Image validation
        t0 = time.perf_counter()
        img_result = self.image_validator.validate(image_path)
        ctx.timings["image_validate_ms"] = _ms_since(t0)
        ctx.meta["image_validation"] = {
            "skipped": img_result.skipped,
            "format": img_result.format,
            "width": img_result.width,
            "height": img_result.height,
        }

        # 2) Preprocess (optional steps)
        t0 = time.perf_counter()
        flags = {
            "resize": self.settings.preprocess_resize,
            "rotate": self.settings.preprocess_rotate,
            "crop": self.settings.preprocess_crop,
            "contrast": self.settings.preprocess_contrast,
            "threshold": self.settings.preprocess_threshold,
            "denoise": self.settings.preprocess_denoise,
            "normalize": self.settings.preprocess_normalize,
        }
        options = {"resize": {"max_side": self.settings.preprocess_resize_max_side}}
        processed, history = run_preprocess_chain(image_path, flags=flags, options=options)
        ctx.processed_image_path = processed
        ctx.preprocessing_history = history
        ctx.timings["preprocess_ms"] = _ms_since(t0)
        logger.debug(
            "request_id=%s image_dims=%sx%s format=%s preprocessing=%s",
            request_id,
            ctx.meta["image_validation"].get("width"),
            ctx.meta["image_validation"].get("height"),
            ctx.meta["image_validation"].get("format"),
            history,
        )

        # 3) OCR engine
        if not self.engine.is_available():
            raise EngineUnavailableError("OCR engine is not available")

        t0 = time.perf_counter()
        # Bounded wait: a single stuck predict() must fail this request, not
        # hang the caller. Reuses the one persistent worker thread created in
        # __init__ — never spawn a new thread per call (see comment there).
        future = self._engine_executor.submit(
            self.engine.extract_text, ctx.active_image_path, meter_type=ctx.meter_type
        )
        try:
            extraction = future.result(timeout=self.settings.request_timeout_seconds)
        except concurrent.futures.TimeoutError as exc:
            logger.error(
                "request_id=%s OCR prediction exceeded %.1fs timeout — aborting request",
                request_id,
                self.settings.request_timeout_seconds,
            )
            raise OcrTimeoutError(
                f"OCR prediction exceeded {self.settings.request_timeout_seconds}s timeout"
            ) from exc
        ctx.timings["ocr_ms"] = _ms_since(t0)
        ctx.raw_extraction = dict(extraction or {})
        ctx.texts = list(extraction.get("texts") or [])
        conf = extraction.get("confidence")
        ctx.ocr_confidence = float(conf) if conf is not None else None

        # Raw OCR evidence — before any parsing/field-binding touches it.
        raw_detections = list(extraction.get("detections") or [])
        logger.info(
            "request_id=%s RAW OCR RESULT: %s",
            request_id,
            [
                {
                    "text": d.get("text"),
                    "confidence": d.get("score"),
                    "box": d.get("box"),
                }
                for d in raw_detections
            ],
        )

        # 4) Reader — spatial parser when detections present, else legacy
        t0 = time.perf_counter()
        reader_result = read_measurements(
            ctx.meter_type,
            ctx.texts,
            extraction=ctx.raw_extraction,
        )
        ctx.reader_result = reader_result
        ctx.timings["reader_ms"] = _ms_since(t0)

        # Prefer spatial field confidence when available
        spatial_conf = reader_result.get("spatial_confidence")
        if spatial_conf is not None:
            try:
                ctx.ocr_confidence = float(spatial_conf)
            except (TypeError, ValueError):
                pass

        # 5) Parser (merge reader fields + contract fallbacks)
        t0 = time.perf_counter()
        corrections = list(reader_result.get("corrections") or [])
        reader_data = dict(reader_result.get("data") or {})
        ctx.texts = list(reader_result.get("texts") or ctx.texts)
        ctx.corrections = corrections
        # Demo fallbacks are for contract/mock empty extraction only. If a real
        # OCR run returned text but parsing is unsure, return no fields instead
        # of inventing readings from demo constants.
        allow_demo = "spatial_ok" not in reader_result and not ctx.texts
        ctx.parsed_data = merge_with_fallback(
            ctx.meter_type,
            reader_data,
            allow_demo_fallback=allow_demo,
        )
        # Prefer numeric types that match prior contract (ints for whole numbers where sensible)
        ctx.parsed_data = _canonicalize_numbers(ctx.parsed_data)
        ctx.timings["parser_ms"] = _ms_since(t0)

        # 6) Result validator
        t0 = time.perf_counter()
        outcome = self.result_validator.validate(ctx.meter_type, ctx.parsed_data)
        ctx.validation_score = outcome.score
        ctx.validation_issues = list(outcome.issues)
        ctx.timings["validator_ms"] = _ms_since(t0)

        # 7) Confidence
        t0 = time.perf_counter()
        primary_key = {
            "tds": "tds",
            "ph": "ph",
            "ec": "ec",
            "orp": "orp",
            "do": "do_percent",
        }.get(ctx.meter_type)
        conf_out = self.confidence_service.calculate(
            ocr_confidence=ctx.ocr_confidence,
            corrections=ctx.corrections,
            validation_score=ctx.validation_score,
            data=ctx.parsed_data,
            primary_key=primary_key,
        )
        ctx.confidence = float(conf_out["confidence"])
        ctx.confidence_detail = dict(conf_out)
        ctx.timings["confidence_ms"] = _ms_since(t0)

        return ctx

    def to_api_result(self, ctx: PipelineContext) -> dict[str, Any]:
        """Stable public payload shape (API contract)."""
        return {
            "ok": True,
            "meter_type": ctx.meter_type,
            "data": ctx.parsed_data,
            "confidence": ctx.confidence,
        }


def _canonicalize_numbers(data: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in data.items():
        if isinstance(value, float) and value.is_integer() and key in {"tds", "ec", "temperature"}:
            out[key] = int(value)
        else:
            out[key] = value
    return out


def run_pipeline(
    engine: BaseOcrEngine,
    *,
    request_id: str,
    meter_type: str,
    image_path: str,
    settings: Settings | None = None,
) -> PipelineContext:
    return OcrPipeline(engine, settings=settings).run(
        request_id=request_id,
        meter_type=meter_type,
        image_path=image_path,
    )
