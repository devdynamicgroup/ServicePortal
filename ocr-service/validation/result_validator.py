"""
Result validation after parser (pipeline stage).

Checks ranges, missing values, impossible values, and duplicates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


RANGES: dict[str, tuple[float, float]] = {
    "tds": (0.0, 5000.0),
    "ec": (0.0, 10000.0),
    "temperature": (0.0, 100.0),
    "temperature_f": (-40.0, 300.0),
    "ph": (0.0, 14.0),
    "mv": (-2000.0, 2000.0),
    "orp": (-2000.0, 2000.0),
    "do_percent": (0.0, 200.0),
}


@dataclass
class ResultValidationOutcome:
    ok: bool
    score: float
    issues: list[str] = field(default_factory=list)
    data: dict[str, Any] = field(default_factory=dict)


class ResultValidator:
    def validate(self, meter_type: str, data: dict[str, Any] | None) -> ResultValidationOutcome:
        kind = (meter_type or "").lower()
        payload = dict(data or {})
        issues: list[str] = []

        if not payload:
            issues.append("missing_values")
            return ResultValidationOutcome(ok=False, score=0.0, issues=issues, data=payload)

        # Duplicate values across distinct keys (suspicious)
        seen: dict[Any, str] = {}
        for key, value in payload.items():
            if value in seen and seen[value] != key:
                issues.append(f"duplicate_value:{seen[value]}={key}")
            else:
                seen[value] = key

        for key, value in list(payload.items()):
            if value is None:
                issues.append(f"missing:{key}")
                continue
            try:
                num = float(value)
            except (TypeError, ValueError):
                issues.append(f"non_numeric:{key}")
                continue
            if key in RANGES:
                lo, hi = RANGES[key]
                if num < lo or num > hi:
                    issues.append(f"out_of_range:{key}")
            # Impossible NaN / inf
            if num != num or num in (float("inf"), float("-inf")):
                issues.append(f"impossible:{key}")

        # Meter-specific required keys
        required = {
            "tds": ("tds",),
            "ph": ("ph",),
            "ec": ("ec",),
            "orp": ("orp",),
            "do": ("do_percent",),
        }.get(kind, ())
        for key in required:
            if key not in payload or payload.get(key) is None:
                issues.append(f"missing:{key}")

        penalty = min(0.85, 0.15 * len(issues))
        score = max(0.0, 1.0 - penalty)
        ok = not any(
            i.startswith("missing:") or i.startswith("out_of_range:") or i.startswith("impossible:")
            for i in issues
        ) and "missing_values" not in issues

        # Soft-fail: still return data; score reflects quality
        return ResultValidationOutcome(ok=ok or score >= 0.5, score=score, issues=issues, data=payload)


def validate_result(meter_type: str, data: dict[str, Any] | None) -> ResultValidationOutcome:
    return ResultValidator().validate(meter_type, data)
