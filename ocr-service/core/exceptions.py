"""
OCR Service domain exceptions.

Routes convert these via core.response helpers — do not build error JSON by hand.
"""

from __future__ import annotations


class OcrServiceError(Exception):
    """Base OCR service error."""

    error_code = "OCR_ERROR"
    http_status = 500
    retry = False
    default_message = "OCR service error"

    def __init__(self, message: str | None = None):
        super().__init__(message or self.default_message)
        self.message = message or self.default_message


class ValidationError(OcrServiceError):
    error_code = "VALIDATION_ERROR"
    http_status = 400
    retry = False
    default_message = "Invalid request"


class UnsupportedMeterError(OcrServiceError):
    error_code = "UNSUPPORTED_METER"
    http_status = 200
    retry = False
    default_message = "Unsupported meter type"


class OcrTimeoutError(OcrServiceError):
    error_code = "OCR_TIMEOUT"
    http_status = 200
    retry = True
    default_message = "OCR service unavailable"


class EngineUnavailableError(OcrServiceError):
    error_code = "ENGINE_UNAVAILABLE"
    http_status = 200
    retry = True
    default_message = "OCR engine is not available"


class EngineInternalError(OcrServiceError):
    error_code = "OCR_INTERNAL_ERROR"
    http_status = 200
    retry = True
    default_message = "OCR engine failed internally"
