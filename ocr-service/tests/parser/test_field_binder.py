"""Stage D — field binder tests."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from parser.field_binder import bind_fields
from parser.profile_loader import get_profile
from parser.row_grouper import group_rows
from parser.tokens import tokens_from_detections

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "hanna_hi98194.json"


class TestFieldBinder(unittest.TestCase):
    def test_hanna_binding(self) -> None:
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
        tokens = tokens_from_detections(data["detections"])
        profile = get_profile(profile_id="hanna_hi98194")
        rows = group_rows(tokens, y_threshold_ratio=profile.y_threshold_ratio)
        bound = bind_fields(rows, profile)
        by_key = {c.key: c.value for c in bound}

        self.assertEqual(by_key.get("ph"), 7.29)
        self.assertEqual(by_key.get("mv"), -15.0)
        self.assertEqual(by_key.get("orp"), 208.3)
        self.assertEqual(by_key.get("do_percent"), 89.4)

    def test_never_assigns_ph_to_neg15(self) -> None:
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
        tokens = tokens_from_detections(data["detections"])
        profile = get_profile(profile_id="hanna_hi98194")
        rows = group_rows(tokens)
        bound = bind_fields(rows, profile)
        by_key = {c.key: c.value for c in bound}
        self.assertNotEqual(by_key.get("ph"), -15.0)


if __name__ == "__main__":
    unittest.main()
