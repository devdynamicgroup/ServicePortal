"""
Confidence calculator (pipeline stage).
"""

from __future__ import annotations

from typing import Any


def calculate_confidence(
    *,
    ocr_confidence: float | None,
    correction_count: int,
    validation_score: float,
    field_count: int = 1,
) -> dict[str, Any]:
    """
    Blend OCR confidence, parser corrections, and validation score.
    Returns {"value": <primary hint unused>, "confidence": float} plus detail.
    """
    base = 0.85 if ocr_confidence is None else max(0.0, min(1.0, float(ocr_confidence)))
    # Each correction slightly reduces trust, but correcting glyphs is still better than raw OCR
    correction_penalty = min(0.2, 0.03 * max(0, int(correction_count)))
    validation = max(0.0, min(1.0, float(validation_score)))
    field_boost = 0.02 * max(0, min(3, int(field_count) - 1))

    score = (0.55 * base) + (0.35 * validation) + (0.10 * (1.0 - correction_penalty)) + field_boost
    score = max(0.0, min(0.99, score))

    return {
        "confidence": round(score, 4),
        "detail": {
            "ocr_confidence": base,
            "validation_score": validation,
            "correction_count": correction_count,
            "correction_penalty": round(correction_penalty, 4),
        },
    }


class ConfidenceService:
    def calculate(
        self,
        *,
        ocr_confidence: float | None,
        corrections: list | None,
        validation_score: float,
        data: dict[str, Any] | None = None,
        primary_key: str | None = None,
    ) -> dict[str, Any]:
        payload = data or {}
        primary_value = None
        if primary_key and primary_key in payload:
            primary_value = payload.get(primary_key)
        elif payload:
            primary_value = next(iter(payload.values()))

        result = calculate_confidence(
            ocr_confidence=ocr_confidence,
            correction_count=len(corrections or []),
            validation_score=validation_score,
            field_count=len(payload),
        )
        return {
            "value": primary_value,
            "confidence": result["confidence"],
            "detail": result["detail"],
        }
