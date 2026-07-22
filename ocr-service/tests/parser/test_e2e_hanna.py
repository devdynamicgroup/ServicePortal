"""End-to-end HANNA HI98194 spatial parser golden test."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from parser.spatial_parser import SpatialMeasurementParser
from readers.meter_reader import PhReader, read_measurements

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "hanna_hi98194.json"


class TestE2EHanna(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        cls.detections = cls.fixture["detections"]
        cls.expected = cls.fixture["expected"]
        cls.texts = [d["text"] for d in cls.detections]

    def test_spatial_parser_values(self) -> None:
        payload = SpatialMeasurementParser().parse_detections(
            self.detections,
            meter_type="ph",
            profile_id="hanna_hi98194",
        )
        self.assertEqual(payload.data.get("ph"), 7.29)
        self.assertEqual(payload.data.get("mv"), -15.0)
        self.assertEqual(payload.data.get("orp"), 208.3)
        self.assertEqual(payload.data.get("do_percent"), 89.4)
        self.assertNotEqual(payload.data.get("ph"), -15.0)
        self.assertGreaterEqual(payload.confidence, 0.80)

    def test_regression_ph_never_neg15(self) -> None:
        payload = SpatialMeasurementParser().parse_detections(
            self.detections,
            meter_type="ph",
        )
        self.assertNotEqual(payload.data.get("ph"), -15.0)

    def test_read_measurements_uses_spatial(self) -> None:
        result = read_measurements(
            "ph",
            self.texts,
            detections=self.detections,
        )
        data = result["data"]
        self.assertEqual(data.get("ph"), 7.29)
        self.assertEqual(data.get("mv"), -15.0)
        self.assertEqual(data.get("orp"), 208.3)
        self.assertEqual(data.get("do_percent"), 89.4)
        self.assertIn("spatial", result)

    def test_legacy_flat_text_still_wrong_without_boxes(self) -> None:
        """Keep legacy available while spatial parsing owns boxed OCR."""
        legacy = PhReader().read(self.texts)
        spatial = read_measurements("ph", self.texts, detections=self.detections)
        self.assertEqual(spatial["data"]["ph"], 7.29)
        self.assertNotEqual(spatial["data"]["ph"], -15.0)
        self.assertIn("data", legacy)

    def test_flat_text_rejects_dates_as_mv(self) -> None:
        legacy = PhReader().read(["HI98194", "2026-07-15"])
        self.assertEqual(legacy["data"], {})

    def test_flat_text_temperature_from_degree_unit(self) -> None:
        result = read_measurements("tds", ["28.4", "\u00b0C"])
        self.assertEqual(result["data"], {"temperature": 28.4})

    def test_four_lcd_rows_in_payload(self) -> None:
        payload = SpatialMeasurementParser().parse_detections(self.detections)
        self.assertGreaterEqual(len(payload.rows), 4)
        self.assertEqual(payload.rows[0]["tokens"][:2], ["-15.0", "mVpH"])
        self.assertEqual(payload.rows[1]["tokens"][:2], ["7.29", "PH"])


if __name__ == "__main__":
    unittest.main()
