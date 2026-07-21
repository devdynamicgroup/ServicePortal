"""
Spatial measurement parser — orchestrates Stages A–F.

PaddleOCR detections
  → tokens → rows → unit normalize → bind → validate → confidence
  → MeasurementPayload
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from parser.field_binder import bind_fields
from parser.field_confidence import (
    FieldResult,
    build_auto_fill_map,
    build_data_payload,
    overall_confidence,
    validate_candidates,
)
from parser.profile_loader import get_profile
from parser.row_grouper import MeasurementRow, group_rows
from parser.tokens import OcrToken, tokens_from_detections, tokens_from_parallel_lists


@dataclass
class MeasurementPayload:
    ok: bool
    meter_type: str
    profile: str
    data: dict[str, float]
    confidence: float
    auto_fill: dict[str, bool] = field(default_factory=dict)
    fields: dict[str, dict[str, Any]] = field(default_factory=dict)
    issues: list[str] = field(default_factory=list)
    corrections: list[dict[str, Any]] = field(default_factory=list)
    rows: list[dict[str, Any]] = field(default_factory=list)
    texts: list[str] = field(default_factory=list)
    # Reader-compatible envelope
    reader_data: dict[str, Any] = field(default_factory=dict)

    def to_reader_result(self) -> dict[str, Any]:
        """Shape expected by OcrPipeline stage 4/5."""
        return {
            "data": dict(self.data),
            "texts": list(self.texts),
            "corrections": list(self.corrections),
            "spatial": {
                "ok": self.ok,
                "profile": self.profile,
                "confidence": self.confidence,
                "auto_fill": dict(self.auto_fill),
                "fields": dict(self.fields),
                "issues": list(self.issues),
                "rows": list(self.rows),
            },
        }


def _field_result_dict(r: FieldResult) -> dict[str, Any]:
    return {
        "value": r.value,
        "confidence": r.confidence,
        "rejected": r.rejected,
        "reject_reason": r.reject_reason,
        "auto_fill": r.auto_fill,
        "value_score": r.value_score,
        "unit_match_score": r.unit_match_score,
        "row_index": r.row_index,
        "value_token": r.value_token,
        "unit_token": r.unit_token,
        "unit_normalized": r.unit_normalized,
    }


def _row_dict(row: MeasurementRow) -> dict[str, Any]:
    return {
        "index": row.index,
        "cy": row.cy,
        "tokens": [t.text for t in row.tokens],
        "value": row.value_token.text if row.value_token else None,
        "label": row.label_token.text if row.label_token else None,
    }


class SpatialMeasurementParser:
    """Config-driven spatial OCR → measurement fields parser."""

    def parse_tokens(
        self,
        tokens: list[OcrToken],
        *,
        meter_type: str | None = None,
        profile_id: str | None = None,
    ) -> MeasurementPayload:
        texts = [t.text for t in tokens]
        profile = get_profile(profile_id=profile_id, meter_type=meter_type, texts=texts)
        rows = group_rows(tokens, y_threshold_ratio=profile.y_threshold_ratio)
        candidates = bind_fields(rows, profile, tokens=tokens)
        results = validate_candidates(candidates, profile)

        data = build_data_payload(results)
        conf = overall_confidence(results, profile)
        auto_fill = build_auto_fill_map(results, conf)

        issues: list[str] = []
        corrections: list[dict[str, Any]] = []
        for r in results:
            if r.rejected and r.reject_reason:
                issues.append(f"{r.reject_reason}:{r.key}")
            corrections.extend(r.corrections)

        # Required field missing?
        for fcfg in profile.fields:
            if fcfg.required and fcfg.key not in data:
                issues.append(f"missing:{fcfg.key}")

        ok = bool(data) and not any(i.startswith("missing:") for i in issues)

        fields = {r.key: _field_result_dict(r) for r in results}

        return MeasurementPayload(
            ok=ok,
            meter_type=(meter_type or "").lower() or (profile.primary_field or profile.id),
            profile=profile.id,
            data=data,
            confidence=conf,
            auto_fill=auto_fill,
            fields=fields,
            issues=issues,
            corrections=corrections,
            rows=[_row_dict(r) for r in rows],
            texts=texts,
        )

    def parse_detections(
        self,
        detections: list[dict[str, Any]],
        *,
        meter_type: str | None = None,
        profile_id: str | None = None,
    ) -> MeasurementPayload:
        tokens = tokens_from_detections(detections)
        return self.parse_tokens(tokens, meter_type=meter_type, profile_id=profile_id)

    def parse_parallel(
        self,
        texts: list[str],
        scores: list[float] | None = None,
        boxes: list[Any] | None = None,
        *,
        meter_type: str | None = None,
        profile_id: str | None = None,
    ) -> MeasurementPayload:
        tokens = tokens_from_parallel_lists(texts, scores, boxes)
        return self.parse_tokens(tokens, meter_type=meter_type, profile_id=profile_id)


def has_spatial_detections(extraction: dict[str, Any] | None) -> bool:
    """True when engine extraction includes usable detection boxes."""
    if not extraction:
        return False
    dets = extraction.get("detections")
    if isinstance(dets, list) and dets:
        # Need at least one box to be spatial
        for d in dets:
            if isinstance(d, dict) and d.get("box"):
                return True
    return False
