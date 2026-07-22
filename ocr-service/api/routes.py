"""
OCR Service HTTP route table.

Routes dispatch to validators + OCR service + response helpers only.
"""

from __future__ import annotations

import time
import uuid
from typing import Any
from urllib.parse import urlparse

from api import validators
from config.settings import settings
from core import response as api_response
from core.exceptions import OcrServiceError
from core.logger import get_logger
from core.metrics import metrics
from services.ocr_service import ocr_service

logger = get_logger("api.routes")


def _new_request_id() -> str:
    return uuid.uuid4().hex


def handle_request(
    method: str,
    path: str,
    body: bytes | None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
    request_id = _new_request_id()
    started = time.perf_counter()
    route = urlparse(path).path.rstrip("/") or "/"
    status = 500
    payload: dict[str, Any] = {}
    ok = False

    try:
        if method == "GET" and route in ("/health", "/"):
            health = ocr_service.health()
            status, payload = 200, api_response.success(
                data={},
                message="OCR service is running",
                request_id=request_id,
                service=health["service"],
                version=health["version"],
                phase=health["phase"],
                engine=health["engine"],
                status=health["status"],
                ready=health["ready"],
                uptime=health["uptime"],
            )
            ok = True
            return status, payload

        if method == "GET" and route == "/version":
            info = ocr_service.version_info()
            status, payload = 200, {
                **info,
                "request_id": request_id,
            }
            ok = True
            return status, payload

        if method == "GET" and route == "/metrics":
            status, payload = 200, {
                **ocr_service.metrics_info(),
                "request_id": request_id,
            }
            ok = True
            return status, payload

        if method == "POST" and route == "/ocr/read-meter":
            status, payload = _handle_read_meter(body, headers, request_id)
            ok = bool(payload.get("success"))
            return status, payload

        if method == "POST" and route == "/ocr/debug-read":
            status, payload = _handle_debug_read(body, headers, request_id)
            ok = bool(payload.get("success"))
            return status, payload

        logger.warning(
            "route not found request_id=%s method=%s path=%s",
            request_id,
            method,
            route,
        )
        status, payload = 404, api_response.failure(
            "NOT_FOUND",
            f"No route for {method} {route}",
            retry=False,
            request_id=request_id,
        )
        return status, payload

    finally:
        duration_ms = (time.perf_counter() - started) * 1000.0
        # Count API traffic for /ocr/read-meter primarily; still record all for ops visibility
        if route == "/ocr/read-meter":
            metrics.record(success=ok, duration_ms=duration_ms)
        logger.info(
            "request_id=%s endpoint=%s method=%s status=%s duration_ms=%.1f engine=%s success=%s error=%s",
            request_id,
            route,
            method,
            status,
            duration_ms,
            ocr_service.engine_name,
            ok,
            payload.get("error") if isinstance(payload, dict) else None,
        )


def _handle_read_meter(
    body: bytes | None,
    headers: dict[str, str] | None,
    request_id: str,
) -> tuple[int, dict[str, Any]]:
    try:
        validators.require_json_content_type(headers)
        payload = validators.parse_json_body(body)
        image_url, meter_type = validators.validate_read_meter_payload(payload)
        result = ocr_service.read_meter(
            image_url=image_url,
            meter_type=meter_type,
            request_id=request_id,
        )
        return 200, api_response.success(
            data=result.get("data") or {},
            message="OCR read complete",
            request_id=request_id,
            meter_type=result.get("meter_type"),
            confidence=result.get("confidence"),
        )
    except OcrServiceError as exc:
        return api_response.from_exception(exc, request_id=request_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("unexpected error request_id=%s error=%s", request_id, exc)
        return 200, api_response.failure(
            "OCR_INTERNAL_ERROR",
            "OCR engine failed internally",
            retry=True,
            request_id=request_id,
        )


def _handle_debug_read(
    body: bytes | None,
    headers: dict[str, str] | None,
    request_id: str,
) -> tuple[int, dict[str, Any]]:
    """Diagnostic-only endpoint — same input contract as /ocr/read-meter, but
    returns raw detections/preprocessing/confidence instead of just the final
    data dict. Never used by the frontend; for manual investigation only."""
    try:
        validators.require_json_content_type(headers)
        payload = validators.parse_json_body(body)
        image_url, meter_type = validators.validate_read_meter_payload(payload)
        result = ocr_service.debug_read(
            image_url=image_url,
            meter_type=meter_type,
            request_id=request_id,
        )
        return 200, api_response.success(
            data=result,
            message="OCR debug read complete",
            request_id=request_id,
        )
    except OcrServiceError as exc:
        return api_response.from_exception(exc, request_id=request_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("unexpected debug_read error request_id=%s error=%s", request_id, exc)
        return 200, api_response.failure(
            "OCR_INTERNAL_ERROR",
            "OCR engine failed internally",
            retry=True,
            request_id=request_id,
        )
