"""
OCR application service.

Routes call this layer only. Processing goes through the pipeline.
"""

from __future__ import annotations

from typing import Any

from config.settings import settings
from core.exceptions import EngineInternalError, EngineUnavailableError
from core.logger import get_logger
from core.metrics import metrics
from engines.factory import get_engine
from processing.pipeline import OcrPipeline
from validation.image_input import cleanup_temp_image, materialize_image_url

logger = get_logger("services.ocr")


class OcrService:
    def __init__(self) -> None:
        self._engine = get_engine(settings.ocr_engine)
        self._pipeline = OcrPipeline(self._engine, settings=settings)

    @property
    def engine_name(self) -> str:
        return self._engine.name

    def health(self) -> dict[str, Any]:
        ready = self._engine.is_available()
        return {
            "service": settings.service_name,
            "version": settings.version,
            "phase": settings.phase,
            "engine": self.engine_name,
            "status": "ok" if ready else "degraded",
            "ready": ready,
            "uptime": metrics.uptime_seconds(),
        }

    def version_info(self) -> dict[str, Any]:
        return {
            "service": settings.service_name,
            "version": settings.version,
            "engine": self.engine_name,
            "phase": settings.phase,
        }

    def metrics_info(self) -> dict[str, Any]:
        return metrics.snapshot(engine=self.engine_name)

    def read_meter(self, *, image_url: str, meter_type: str, request_id: str) -> dict[str, Any]:
        logger.info(
            "read_meter start request_id=%s meter_type=%s engine=%s",
            request_id,
            meter_type,
            self._engine.name,
        )

        if not self._engine.is_available():
            raise EngineUnavailableError("OCR engine is not available")

        # data: URLs → temp file; filesystem / virtual paths pass through unchanged.
        normalized = materialize_image_url(image_url)
        try:
            ctx = self._pipeline.run(
                request_id=request_id,
                meter_type=meter_type,
                image_path=normalized.path,
            )
            logger.info(
                "read_meter success request_id=%s meter_type=%s confidence=%s timings=%s",
                request_id,
                meter_type,
                ctx.confidence,
                ctx.timings,
            )
            return self._pipeline.to_api_result(ctx)
        except EngineUnavailableError:
            raise
        except Exception as exc:  # noqa: BLE001 — isolate engine/pipeline failures
            # ValidationError (image) is an OcrServiceError — re-raise as-is
            from core.exceptions import OcrServiceError

            if isinstance(exc, OcrServiceError):
                raise
            logger.error(
                "read_meter engine error request_id=%s error=%s",
                request_id,
                exc,
            )
            raise EngineInternalError("OCR engine failed internally") from exc
        finally:
            cleanup_temp_image(normalized.temp_path)

    def debug_read(self, *, image_url: str, meter_type: str, request_id: str) -> dict[str, Any]:
        """Full diagnostic bundle for a single image: raw OCR detections
        (text/confidence/box, before any parsing), parsed field values,
        confidence breakdown, and the preprocessing steps actually applied —
        for manually tracing exactly where a specific image's result goes
        wrong instead of guessing from the final API response alone."""
        logger.info(
            "debug_read start request_id=%s meter_type=%s engine=%s",
            request_id,
            meter_type,
            self._engine.name,
        )
        if not self._engine.is_available():
            raise EngineUnavailableError("OCR engine is not available")

        normalized = materialize_image_url(image_url)
        try:
            ctx = self._pipeline.run(
                request_id=request_id,
                meter_type=meter_type,
                image_path=normalized.path,
            )
            detections = list((ctx.raw_extraction or {}).get("detections") or [])
            return {
                "engine": ctx.engine,
                "meter_type": ctx.meter_type,
                "raw_text": list(ctx.texts or []),
                "detections": detections,
                "parsed_values": dict(ctx.parsed_data or {}),
                "confidence": dict(ctx.confidence_detail or {}),
                "validation_issues": list(ctx.validation_issues or []),
                "preprocessing": list(ctx.preprocessing_history or []),
                "processed_image_path": ctx.processed_image_path,
                "timings_ms": dict(ctx.timings or {}),
            }
        finally:
            cleanup_temp_image(normalized.temp_path)


ocr_service = OcrService()
