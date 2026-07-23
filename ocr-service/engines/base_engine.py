"""
OCR engine interface.

Concrete engines (Paddle, EasyOCR, Vision APIs) must implement this contract.
Routes and HTTP layers must never import a concrete engine directly.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class BaseOcrEngine(ABC):
    """Common interface for all OCR backends."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Stable engine identifier (e.g. paddle, easyocr, mock)."""

    @abstractmethod
    def is_available(self) -> bool:
        """Return current readiness without triggering initialization.

        Must be a cheap, non-blocking read of cached state — callers on the
        request path (and OcrService.health()) rely on this never kicking off
        a slow/blocking model load.
        """

    def warmup(self) -> bool:
        """Eagerly initialize the engine (e.g. load models) outside the
        request path — safe to call from a background thread. Default no-op
        for engines with no expensive init; override when init is costly.
        """
        return self.is_available()

    @abstractmethod
    def extract_text(self, image_path: str, *, meter_type: str | None = None) -> dict[str, Any]:
        """
        Run OCR on a local image path.

        Returns a dict with at least:
          - texts: list[str] raw lines
          - confidence: float | None
          - raw: optional engine-specific payload

        Optional spatial fields (when the engine provides them):
          - detections: list[{text, score, box}] where box is [x1,y1,x2,y2]
        """
