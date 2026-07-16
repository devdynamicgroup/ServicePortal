"""
Meter readers — interpret corrected OCR lines into field candidates.

Readers never call OCR engines or HTTP routes.
"""

from __future__ import annotations

import re
from typing import Any, Protocol

from parser.normalize import correct_texts, extract_numbers


class MeterReader(Protocol):
    meter_type: str

    def read(self, texts: list[str]) -> dict[str, Any]:
        ...


def _find_labeled(texts: list[str], labels: tuple[str, ...]) -> float | None:
    for line in texts:
        lower = line.lower()
        if any(label in lower for label in labels):
            nums = extract_numbers(line)
            if nums:
                return nums[0]
    return None


def _first_number(texts: list[str]) -> float | None:
    for line in texts:
        nums = extract_numbers(line)
        if nums:
            return nums[0]
    return None


class TdsReader:
    meter_type = "tds"

    def read(self, texts: list[str]) -> dict[str, Any]:
        fixed, corrections = correct_texts(texts)
        tds = _find_labeled(fixed, ("tds", "ppm"))
        ec = _find_labeled(fixed, ("ec", "us/cm", "µs", "uS"))
        temp = _find_labeled(fixed, ("temp", "°c", " c"))
        if tds is None:
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
            if re.search(r"m\s*v|mv", line, re.I) or "-" in line:
                nums = extract_numbers(line)
                if nums:
                    # Prefer signed / non-ph looking values for mV
                    if "ph" not in line.lower():
                        mv = nums[0]
                        break
                    if len(nums) > 1:
                        mv = nums[1]
        if ph is None:
            ph = _first_number(fixed)
        data = {"ph": ph, "mv": mv}
        return {"data": {k: v for k, v in data.items() if v is not None}, "texts": fixed, "corrections": corrections}


class EcReader:
    meter_type = "ec"

    def read(self, texts: list[str]) -> dict[str, Any]:
        fixed, corrections = correct_texts(texts)
        ec = _find_labeled(fixed, ("ec", "us/cm", "µs", "uS"))
        temp = _find_labeled(fixed, ("temp", "°c", " c"))
        if ec is None:
            ec = _first_number(fixed)
        data = {"ec": ec, "temperature": temp}
        return {"data": {k: v for k, v in data.items() if v is not None}, "texts": fixed, "corrections": corrections}


class OrpReader:
    meter_type = "orp"

    def read(self, texts: list[str]) -> dict[str, Any]:
        fixed, corrections = correct_texts(texts)
        orp = _find_labeled(fixed, ("orp", "mv"))
        if orp is None:
            orp = _first_number(fixed)
        data = {"orp": orp}
        return {"data": {k: v for k, v in data.items() if v is not None}, "texts": fixed, "corrections": corrections}


class DoReader:
    meter_type = "do"

    def read(self, texts: list[str]) -> dict[str, Any]:
        fixed, corrections = correct_texts(texts)
        do_percent = _find_labeled(fixed, ("do", "%", "sat"))
        if do_percent is None:
            do_percent = _first_number(fixed)
        data = {"do_percent": do_percent}
        return {"data": {k: v for k, v in data.items() if v is not None}, "texts": fixed, "corrections": corrections}


class GenericMeterReader:
    meter_type = "generic"

    def read(self, texts: list[str]) -> dict[str, Any]:
        fixed, corrections = correct_texts(texts)
        nums = []
        for line in fixed:
            nums.extend(extract_numbers(line))
        data = {"values": nums} if nums else {}
        return {"data": data, "texts": fixed, "corrections": corrections}


_READERS: dict[str, MeterReader] = {
    "tds": TdsReader(),
    "ph": PhReader(),
    "ec": EcReader(),
    "orp": OrpReader(),
    "do": DoReader(),
}


def get_reader(meter_type: str) -> MeterReader:
    kind = (meter_type or "tds").lower()
    return _READERS.get(kind, GenericMeterReader())
