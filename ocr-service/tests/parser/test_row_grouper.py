"""Stage B — spatial row grouper tests (HANNA golden fixture)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from parser.row_grouper import group_rows
from parser.tokens import tokens_from_detections

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "hanna_hi98194.json"


class TestRowGrouper(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
        cls.tokens = tokens_from_detections(data["detections"])

    def test_four_measurement_rows(self) -> None:
        rows = group_rows(self.tokens)
        self.assertGreaterEqual(len(rows), 4)
        # First four measurement rows must be the LCD values
        expected = [
            ("-15.0", "mVpH"),
            ("7.29", "PH"),
            ("208.3", "mVORP"),
            ("89.4", "%00"),
        ]
        for i, (value, label) in enumerate(expected):
            self.assertEqual(rows[i].value_token.text, value, f"row {i} value")
            self.assertIsNotNone(rows[i].label_token, f"row {i} label")
            assert rows[i].label_token is not None
            self.assertEqual(rows[i].label_token.text, label, f"row {i} label")

    def test_tokens_sorted_left_to_right(self) -> None:
        rows = group_rows(self.tokens)
        for row in rows[:4]:
            cxs = [t.cx for t in row.tokens]
            self.assertEqual(cxs, sorted(cxs))

    def test_ui_tokens_excluded(self) -> None:
        rows = group_rows(self.tokens)
        all_texts = [t.text for row in rows for t in row.tokens]
        for ui in ("ESC", "HELP", "MENU", "Log", "LOG"):
            self.assertNotIn(ui, all_texts)


class TestProfileIgnoreTokens(unittest.TestCase):
    """profile.ignore_tokens (JSON) must actually reach row formation, not
    just sit unused on the MeterProfile dataclass."""

    def test_extra_ignore_tokens_removed_before_row_formation(self) -> None:
        from parser.tokens import tokens_from_detections

        detections = [
            {"text": "0.0031", "score": 0.90, "box": [250, 410, 420, 470]},
            {"text": "MO.cm", "score": 0.85, "box": [430, 415, 520, 460]},
        ]
        tokens = tokens_from_detections(detections)

        rows_unfiltered = group_rows(tokens)
        self.assertTrue(any(r.label_token and r.label_token.text == "MO.cm" for r in rows_unfiltered))

        rows_filtered = group_rows(tokens, extra_ignore_tokens=["MO.cm", "resistivity"])
        all_texts = [t.text for row in rows_filtered for t in row.tokens]
        self.assertNotIn("MO.cm", all_texts)

    def test_hanna_profile_ignore_tokens_wired_through_spatial_parser(self) -> None:
        """Resistivity readout on the DO/EC screen must never surface as a row token
        when parsed through the real hanna_hi98194 profile (end-to-end wiring check)."""
        from parser.spatial_parser import SpatialMeasurementParser

        detections = [
            {"text": "HANNA", "score": 0.99, "box": [300, 60, 500, 120]},
            {"text": "6.67", "score": 0.99, "box": [300, 200, 420, 260]},
            {"text": "FFmDO", "score": 0.88, "box": [430, 205, 520, 250]},
            {"text": "319", "score": 0.99, "box": [300, 270, 420, 330]},
            {"text": "μsem", "score": 0.70, "box": [430, 275, 520, 320]},
            {"text": "0.0031", "score": 0.90, "box": [250, 410, 420, 470]},
            {"text": "MO.cm", "score": 0.85, "box": [430, 415, 520, 460]},
            {"text": "HI98194", "score": 0.99, "box": [150, 500, 320, 540]},
        ]
        payload = SpatialMeasurementParser().parse_detections(
            detections, meter_type="ph", profile_id="hanna_hi98194"
        )
        row_texts = [t for row in payload.rows for t in row["tokens"]]
        self.assertNotIn("MO.cm", row_texts)
        self.assertEqual(payload.data.get("do"), 6.67)
        self.assertEqual(payload.data.get("ec"), 319.0)


if __name__ == "__main__":
    unittest.main()
