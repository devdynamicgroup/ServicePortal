"""
Request validation for OCR Service.

Isolated from routes — routes call these helpers only.
"""

from __future__ import annotations

import json
from typing import Any

from core.exceptions import UnsupportedMeterError, ValidationError

SUPPORTED_METER_TYPES = frozenset({"tds", "ph", "ec", "orp", "do"})

# Special test hooks (Phase 3.5 contract tests only)
FORCE_ENGINE_ERROR_URL = "__force_engine_error__"
SLOW_IMAGE_URL_PREFIX = "__slow_"


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
