"""EasyOCR engine adapter — Phase 4 (not connected)."""

from __future__ import annotations

from typing import Any

from engines.base_engine import BaseOcrEngine


class EasyOcrEngine(BaseOcrEngine):
    @property
    def name(self) -> str:
        return "easyocr"

    def is_available(self) -> bool:
        return False

    def extract_text(self, image_path: str, *, meter_type: str | None = None) -> dict[str, Any]:
        raise NotImplementedError("EasyOCR engine is not connected yet (Phase 4).")
