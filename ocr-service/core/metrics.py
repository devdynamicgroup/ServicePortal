"""
In-memory OCR Service metrics (Phase 3.5).
"""

from __future__ import annotations

import threading
import time
from typing import Any


class MetricsStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.total_requests = 0
        self.successful_requests = 0
        self.failed_requests = 0
        self._total_duration_ms = 0.0
        self.started_at = time.time()

    def record(self, *, success: bool, duration_ms: float) -> None:
        with self._lock:
            self.total_requests += 1
            if success:
                self.successful_requests += 1
            else:
                self.failed_requests += 1
            self._total_duration_ms += max(0.0, float(duration_ms))

    def snapshot(self, *, engine: str) -> dict[str, Any]:
        with self._lock:
            total = self.total_requests
            avg = (self._total_duration_ms / total) if total else 0.0
            return {
                "total_requests": total,
                "successful_requests": self.successful_requests,
                "failed_requests": self.failed_requests,
                "average_duration_ms": round(avg, 2),
                "engine": engine,
            }

    def uptime_seconds(self) -> int:
        return int(max(0, time.time() - self.started_at))


metrics = MetricsStore()
