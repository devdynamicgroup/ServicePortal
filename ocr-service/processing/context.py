"""
Shared pipeline context passed through every OCR processing stage.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class PipelineContext:
    request_id: str
    meter_type: str
    image_path: str
    engine: str

    # Working image path (may change after preprocess)
    processed_image_path: str | None = None

    # OCR engine output
    texts: list[str] = field(default_factory=list)
    ocr_confidence: float | None = None
    raw_extraction: dict[str, Any] = field(default_factory=dict)

    # Reader / parser
    reader_result: dict[str, Any] = field(default_factory=dict)
    parsed_data: dict[str, Any] = field(default_factory=dict)
    corrections: list[dict[str, Any]] = field(default_factory=list)

    # Validation / confidence
    validation_score: float = 1.0
    validation_issues: list[str] = field(default_factory=list)
    confidence: float = 0.0
    confidence_detail: dict[str, Any] = field(default_factory=dict)

    # Observability
    timings: dict[str, float] = field(default_factory=dict)
    preprocessing_history: list[str] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def active_image_path(self) -> str:
        return self.processed_image_path or self.image_path
