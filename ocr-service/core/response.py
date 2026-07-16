"""
Standard API response builders.

Routes must use these helpers — never assemble response dicts ad hoc.
"""

from __future__ import annotations

from typing import Any

from core.exceptions import OcrServiceError


def success(
    data: dict[str, Any] | None = None,
    message: str = "",
    *,
    request_id: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "success": True,
        "data": data if data is not None else {},
        "message": message or "",
    }
    if request_id:
        payload["request_id"] = request_id
    payload.update(extra)
    return payload


def failure(
    error: str,
    message: str = "",
    *,
    retry: bool | None = None,
    request_id: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "success": False,
        "error": error or "UNKNOWN_ERROR",
        "message": message or "",
    }
    if retry is not None:
        payload["retry"] = bool(retry)
    if request_id:
        payload["request_id"] = request_id
    payload.update(extra)
    return payload


def from_exception(exc: OcrServiceError, *, request_id: str | None = None) -> tuple[int, dict[str, Any]]:
    return exc.http_status, failure(
        exc.error_code,
        exc.message,
        retry=exc.retry,
        request_id=request_id,
    )
