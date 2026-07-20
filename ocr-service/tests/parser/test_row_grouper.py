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


if __name__ == "__main__":
    unittest.main()
