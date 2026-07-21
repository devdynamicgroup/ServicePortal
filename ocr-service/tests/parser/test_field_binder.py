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

    def test_binds_mvph_when_unit_on_separate_row(self) -> None:
        """Value and mVpH split across OCR clusters still bind as mv."""
        from parser.field_confidence import build_data_payload, validate_candidates

        detections = [
            {"text": "HANNA", "score": 0.99, "box": [100, 40, 300, 90]},
            {"text": "-19.2", "score": 0.999, "box": [120, 200, 320, 280]},
            # Unit below/beside value enough to form its own non-numeric cluster
            {"text": "mVpH", "score": 0.98, "box": [340, 310, 460, 360]},
            {"text": "HI98194", "score": 0.99, "box": [80, 500, 220, 540]},
            {"text": "1", "score": 0.99, "box": [100, 700, 130, 740]},
            {"text": "2 abc", "score": 0.99, "box": [200, 700, 280, 740]},
        ]
        tokens = tokens_from_detections(detections)
        profile = get_profile(profile_id="hanna_hi98194")

        rows_plain = group_rows(tokens, y_threshold_ratio=profile.y_threshold_ratio)
        self.assertTrue(any(r.value_token and r.value_token.text == "-19.2" for r in rows_plain))
        data_plain = build_data_payload(validate_candidates(bind_fields(rows_plain, profile), profile))
        self.assertNotIn("mv", data_plain)

        rows = group_rows(tokens, y_threshold_ratio=profile.y_threshold_ratio)
        bound = bind_fields(rows, profile, tokens=tokens)
        by_key = {c.key: c for c in bound}
        self.assertIn("mv", by_key)
        self.assertEqual(by_key["mv"].value, -19.2)
        self.assertIsNotNone(by_key["mv"].label_token)
        self.assertEqual(by_key["mv"].label_token.text, "mVpH")
        self.assertGreaterEqual(by_key["mv"].unit_match_score, 0.70)

        data = build_data_payload(validate_candidates(bound, profile))
        self.assertEqual(data.get("mv"), -19.2)
        self.assertNotEqual(data.get("ph"), -19.2)

    def test_does_not_bind_keypad_number_without_unit(self) -> None:
        from parser.field_confidence import build_data_payload, validate_candidates

        detections = [
            {"text": "HANNA", "score": 0.99, "box": [100, 40, 300, 90]},
            {"text": "6", "score": 0.99, "box": [200, 200, 240, 250]},
            {"text": "Menu", "score": 0.99, "box": [300, 210, 380, 250]},
            {"text": "2 abc", "score": 0.99, "box": [200, 700, 280, 740]},
        ]
        tokens = tokens_from_detections(detections)
        profile = get_profile(profile_id="hanna_hi98194")
        rows = group_rows(tokens)
        bound = bind_fields(rows, profile, tokens=tokens)
        data = build_data_payload(validate_candidates(bound, profile))
        # Keypad/chrome must not become accepted measurement fields
        self.assertEqual(data, {})


if __name__ == "__main__":
    unittest.main()
