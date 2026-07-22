"""
Meter readers: interpret OCR output into field candidates.

Supports two paths:
  1. SpatialMeasurementParser when detections (boxes) are available
  2. Conservative flat-text readers as fallback

Readers never call OCR engines or HTTP routes.
"""

from __future__ import annotations

import re
from typing import Any, Protocol

from parser.normalize import correct_texts, extract_numbers, is_unit_only_token
from parser.spatial_parser import SpatialMeasurementParser, has_spatial_detections


class MeterReader(Protocol):
    meter_type: str

    def read(self, texts: list[str]) -> dict[str, Any]:
        ...


_TEMP_UNIT_RE = re.compile(r"(?:°|º|˚|deg(?:ree)?s?)?\s*c\b", re.I)


def _meaningful_numbers(line: str) -> list[float]:
    if is_unit_only_token(line):
        return []
    return extract_numbers(line)


def _has_real_ocr_evidence(texts: list[str]) -> bool:
    return any(str(line or "").strip() for line in texts)


def _find_labeled(texts: list[str], labels: tuple[str, ...]) -> float | None:
    lowered_labels = tuple(label.lower() for label in labels)
    for line in texts:
        lower = line.lower()
        if any(label in lower for label in lowered_labels):
            nums = _meaningful_numbers(line)
            if nums:
                return nums[0]
    return None


def _first_number(texts: list[str]) -> float | None:
    for line in texts:
        nums = _meaningful_numbers(line)
        if nums:
            return nums[0]
    return None


def _find_temperature(texts: list[str]) -> float | None:
    for idx, line in enumerate(texts):
        nums = _meaningful_numbers(line)
        has_temp_label = re.search(r"\btemp(?:erature)?\b", line, re.I)
        has_temp_unit = _TEMP_UNIT_RE.search(line)

        if nums and (has_temp_label or has_temp_unit):
            plausible = [n for n in nums if 0 <= n <= 100]
            if plausible:
                return plausible[-1]

        if has_temp_unit or is_unit_only_token(line):
            neighbors: list[float] = []
            if idx > 0:
                neighbors.extend(_meaningful_numbers(texts[idx - 1]))
            if idx + 1 < len(texts):
                neighbors.extend(_meaningful_numbers(texts[idx + 1]))
            plausible = [n for n in neighbors if 0 <= n <= 100]
            if plausible:
                return plausible[-1]

    return None


class TdsReader:
    meter_type = "tds"

    def read(self, texts: list[str]) -> dict[str, Any]:
        fixed, corrections = correct_texts(texts)
        tds = _find_labeled(fixed, ("tds", "ppm"))
        ec = _find_labeled(fixed, ("ec", "us/cm", "uS", "µs", "μs"))
        temp = _find_temperature(fixed)
        if tds is None and not _has_real_ocr_evidence(fixed):
            tds = _first_number(fixed)
        data = {"tds": tds, "ec": ec, "temperature": temp}
        return {"data": {k: v for k, v in data.items() if v is not None}, "texts": fixed, "corrections": corrections}


class PhReader:
    meter_type = "ph"

    def read(self, texts: list[str]) -> dict[str, Any]:
        fixed, corrections = correct_texts(texts)
        ph = _find_labeled(fixed, ("ph",))
        mv = None
        for line in fixed:
            has_mv_label = re.search(r"m\s*v|mv", line, re.I)
            has_signed_value = re.fullmatch(r"\s*[-+]\d+(?:\.\d+)?\s*", line) is not None
            if has_mv_label or has_signed_value:
                nums = _meaningful_numbers(line)
                if nums:
                    if "ph" not in line.lower():
                        mv = nums[0]
                        break
                    if len(nums) > 1:
                        mv = nums[1]
        if ph is None and not _has_real_ocr_evidence(fixed):
            ph = _first_number(fixed)
        data = {"ph": ph, "mv": mv}
        return {"data": {k: v for k, v in data.items() if v is not None}, "texts": fixed, "corrections": corrections}


class EcReader:
    meter_type = "ec"

    def read(self, texts: list[str]) -> dict[str, Any]:
        fixed, corrections = correct_texts(texts)
        ec = _find_labeled(fixed, ("ec", "us/cm", "uS", "µs", "μs"))
        temp = _find_temperature(fixed)
        if ec is None and not _has_real_ocr_evidence(fixed):
            ec = _first_number(fixed)
        data = {"ec": ec, "temperature": temp}
        return {"data": {k: v for k, v in data.items() if v is not None}, "texts": fixed, "corrections": corrections}


class OrpReader:
    meter_type = "orp"

    def read(self, texts: list[str]) -> dict[str, Any]:
        fixed, corrections = correct_texts(texts)
        orp = _find_labeled(fixed, ("orp", "mv"))
        if orp is None and not _has_real_ocr_evidence(fixed):
            orp = _first_number(fixed)
        data = {"orp": orp}
        return {"data": {k: v for k, v in data.items() if v is not None}, "texts": fixed, "corrections": corrections}


class DoReader:
    meter_type = "do"

    def read(self, texts: list[str]) -> dict[str, Any]:
        fixed, corrections = correct_texts(texts)
        do_percent = _find_labeled(fixed, ("do", "%", "sat"))
        if do_percent is None and not _has_real_ocr_evidence(fixed):
            do_percent = _first_number(fixed)
        data = {"do_percent": do_percent}
        return {"data": {k: v for k, v in data.items() if v is not None}, "texts": fixed, "corrections": corrections}


class GenericMeterReader:
    meter_type = "generic"

    def read(self, texts: list[str]) -> dict[str, Any]:
        fixed, corrections = correct_texts(texts)
        nums = []
        for line in fixed:
            nums.extend(_meaningful_numbers(line))
        data = {"values": nums} if nums else {}
        return {"data": data, "texts": fixed, "corrections": corrections}


_READERS: dict[str, MeterReader] = {
    "tds": TdsReader(),
    "ph": PhReader(),
    "ec": EcReader(),
    "orp": OrpReader(),
    "do": DoReader(),
}

_spatial_parser = SpatialMeasurementParser()


def get_reader(meter_type: str) -> MeterReader:
    kind = (meter_type or "tds").lower()
    return _READERS.get(kind, GenericMeterReader())


def read_measurements(
    meter_type: str,
    texts: list[str],
    *,
    detections: list[dict[str, Any]] | None = None,
    extraction: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Preferred entry point for the pipeline.

    Tries spatial parsing when detections with boxes are available.
    Falls back to flat-text readers on failure or missing boxes.
    """
    kind = (meter_type or "tds").lower()
    dets = detections
    if dets is None and extraction is not None:
        raw_dets = extraction.get("detections")
        if isinstance(raw_dets, list):
            dets = raw_dets

    if has_spatial_detections({"detections": dets or []}):
        try:
            payload = _spatial_parser.parse_detections(
                list(dets or []),
                meter_type=kind,
            )
            result = payload.to_reader_result()
            result["spatial_confidence"] = payload.confidence
            result["spatial_ok"] = payload.ok
            return result
        except Exception:  # noqa: BLE001
            pass

    return get_reader(kind).read(list(texts or []))
