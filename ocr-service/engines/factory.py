"""
Engine factory — selects implementation from settings.
"""

from __future__ import annotations

from engines.base_engine import BaseOcrEngine
from engines.mock_engine import MockOcrEngine


def get_engine(engine_name: str | None) -> BaseOcrEngine:
    key = (engine_name or "mock").strip().lower()
    if key in ("mock", "none", "null", ""):
        return MockOcrEngine()
    if key in ("paddle", "paddleocr"):
        from engines.paddle_engine import PaddleEngine

        return PaddleEngine()
    if key in ("easyocr", "easy"):
        from engines.easyocr_engine import EasyOcrEngine

        return EasyOcrEngine()
    # Unknown name → safe contract-compatible default
    return MockOcrEngine()
