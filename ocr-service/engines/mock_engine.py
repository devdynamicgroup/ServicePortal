"""
Mock OCR engine for contract testing.

No real OCR libraries.
Test hooks:
  - image_url == "__force_engine_error__" → raises RuntimeError
  - image_url starts with "__slow_Ns__" → sleeps N seconds then succeeds
"""

from __future__ import annotations

import re
import time
from typing import Any

from engines.base_engine import BaseOcrEngine


class MockOcrEngine(BaseOcrEngine):
    @property
    def name(self) -> str:
        return "mock"

    def is_available(self) -> bool:
        return True

    def extract_text(self, image_path: str, *, meter_type: str | None = None) -> dict[str, Any]:
        path = str(image_path or "")
        kind = (meter_type or "tds").lower()

        if path == "__force_engine_error__":
            raise RuntimeError("Forced MockEngine internal failure (contract test)")

        slow = re.match(r"^__slow_(\d+(?:\.\d+)?)s__$", path)
        if slow:
            time.sleep(float(slow.group(1)))

        samples = {
            "tds": ["TDS 280 ppm", "EC 400 uS/cm", "Temp 28.0 C"],
            "ph": ["pH 7.29", "-15.0 mV"],
            "ec": ["EC 400 uS/cm", "Temp 28.0 C"],
            "orp": ["208.3 mV ORP"],
            "do": ["89.4 %DO"],
        }
        texts = samples.get(kind, samples["tds"])
        return {
            "texts": texts,
            "confidence": 0.95,
            "raw": {"engine": self.name, "meter_type": kind},
        }
