"""
Request validation for OCR Service.

Isolated from routes — routes call these helpers only.
"""

from __future__ import annotations

import json
import secrets as secrets_module
from typing import Any

from config.settings import settings
from core.exceptions import AuthenticationError, UnsupportedMeterError, ValidationError
from core.logger import get_logger

logger = get_logger("api.validators")

SUPPORTED_METER_TYPES = frozenset({"tds", "ph", "ec", "orp", "do", "chlorine", "turbidity", "multi"})

# Special test hooks (Phase 3.5 contract tests only)
FORCE_ENGINE_ERROR_URL = "__force_engine_error__"
SLOW_IMAGE_URL_PREFIX = "__slow_"

SHARED_SECRET_HEADER = "x-ocr-shared-secret"


def require_json_content_type(headers: dict[str, str] | None) -> None:
    if not headers:
        raise ValidationError("Content-Type must be application/json")
    # Header keys may be mixed-case depending on server
    content_type = ""
    for key, value in headers.items():
        if key.lower() == "content-type":
            content_type = str(value or "")
            break
    if "application/json" not in content_type.lower():
        raise ValidationError("Content-Type must be application/json")


def require_shared_secret(headers: dict[str, str] | None, request_id: str) -> None:
    """Phase 1 soft rollout + rotation window for application-level shared-secret
    auth (callers that can't obtain a Cloud Run ID token, e.g. Render).

    This is independent of Cloud Run IAM / Google ID-token validation,
    which is enforced entirely at the platform layer and never reaches
    this application code.

    - No primary secret configured: feature is off, always passes (lets this
      ship safely before OCR_SHARED_SECRET is set anywhere).
    - Header missing: soft-passed unless OCR_AUTH_REQUIRED=true.
    - Header present but matches neither primary nor previous: ALWAYS
      rejected (401), never soft-passed — soft rollout only tolerates a
      missing credential, never a wrong one.
    - Header present and equals primary: passes (secret_slot=primary).
    - Header present and equals previous (when configured): passes
      (secret_slot=previous) for zero-downtime rotation.
    """
    primary = settings.ocr_shared_secret
    if not primary:
        return

    received = None
    if headers:
        for key, value in headers.items():
            if key.lower() == SHARED_SECRET_HEADER:
                received = str(value or "")
                break

    if received is None:
        if settings.ocr_auth_required:
            logger.warning(
                "request_id=%s auth_result=rejected reason=missing_header",
                request_id,
            )
            raise AuthenticationError("Missing authentication header")
        logger.info(
            "request_id=%s auth_result=missing",
            request_id,
        )
        return

    # Always compare against primary. When a previous secret is configured,
    # also compare against it before deciding — do not short-circuit the
    # second compare_digest (constant-time contract).
    primary_ok = secrets_module.compare_digest(received, primary)
    previous = settings.ocr_shared_secret_previous
    previous_ok = False
    if previous:
        previous_ok = secrets_module.compare_digest(received, previous)

    if primary_ok:
        logger.info(
            "request_id=%s auth_result=accepted secret_slot=primary",
            request_id,
        )
        return

    if previous_ok:
        logger.info(
            "request_id=%s auth_result=accepted secret_slot=previous",
            request_id,
        )
        return

    logger.warning(
        "request_id=%s auth_result=rejected reason=invalid_secret",
        request_id,
    )
    raise AuthenticationError("Invalid authentication header")


def parse_json_body(body: bytes | None) -> dict[str, Any]:
    if body is None or len(body) == 0:
        raise ValidationError("Request body must be JSON: { image_url, meter_type }")
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValidationError("Request body must be valid UTF-8 JSON") from exc
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValidationError("Malformed JSON body") from exc
    if not isinstance(payload, dict) or isinstance(payload, list):
        raise ValidationError("JSON body must be an object")
    return payload


def validate_read_meter_payload(payload: dict[str, Any]) -> tuple[str, str]:
    if "image_url" not in payload or payload.get("image_url") is None or str(payload.get("image_url")).strip() == "":
        raise ValidationError("image_url is required")
    if "meter_type" not in payload or payload.get("meter_type") is None or str(payload.get("meter_type")).strip() == "":
        raise ValidationError("meter_type is required")

    image_url = str(payload["image_url"]).strip()
    meter_type = str(payload["meter_type"]).strip().lower()

    if meter_type not in SUPPORTED_METER_TYPES:
        raise UnsupportedMeterError(f"Unsupported meter type: {meter_type}")

    return image_url, meter_type
