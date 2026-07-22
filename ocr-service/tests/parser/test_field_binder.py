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

    def test_do_ec_conductivity_screen_binds_do_and_ec(self) -> None:
        from parser.field_confidence import build_data_payload, validate_candidates
        from parser.spatial_parser import SpatialMeasurementParser

        detections = [
            {"text": "HANNA", "score": 0.99, "box": [300, 60, 500, 120]},
            {"text": "6.67", "score": 0.99, "box": [300, 200, 420, 260]},
            {"text": "FFmDO", "score": 0.88, "box": [430, 205, 520, 250]},
            {"text": "319", "score": 0.99, "box": [300, 270, 420, 330]},
            {"text": "μsem", "score": 0.70, "box": [430, 275, 520, 320]},
            {"text": "329", "score": 0.99, "box": [300, 340, 420, 400]},
            {"text": "μSema", "score": 0.60, "box": [430, 345, 520, 390]},
            {"text": "0.0031", "score": 0.90, "box": [250, 410, 420, 470]},
            {"text": "MO.cm", "score": 0.85, "box": [430, 415, 520, 460]},
            {"text": "HI98194", "score": 0.99, "box": [150, 500, 320, 540]},
        ]
        payload = SpatialMeasurementParser().parse_detections(
            detections, meter_type="ph", profile_id="hanna_hi98194"
        )
        self.assertEqual(payload.data.get("do"), 6.67)
        self.assertEqual(payload.data.get("ec"), 319.0)
        self.assertNotIn("orp", payload.data)
        self.assertNotIn("do_percent", payload.data)
        self.assertNotIn("missing:ph", payload.issues)

    def test_clean_do_label_binds_to_do_not_excluded_by_itself(self) -> None:
        """Regression: bare 'DO' normalizes to the same UNIT_SYNONYMS canonical
        field as '%do' (both -> do_percent), which previously made the do
        field's own exclude_aliases (['%do', ...]) fuzzy-match and reject its
        own literal label. A field must never be able to exclude its own key."""
        from parser.spatial_parser import SpatialMeasurementParser

        detections = [
            {"text": "6.5", "score": 0.99, "box": [100, 200, 220, 260]},
            {"text": "DO", "score": 0.95, "box": [240, 205, 300, 250]},
        ]
        payload = SpatialMeasurementParser().parse_detections(
            detections, meter_type="ph", profile_id="hanna_hi98194"
        )
        self.assertEqual(payload.data.get("do"), 6.5)
        self.assertNotIn("do_percent", payload.data)

    def test_percent_do_still_binds_to_do_percent_not_do(self) -> None:
        """Regression guard alongside the fix above: '%DO' must still route to
        do_percent, not the mg/L do field."""
        from parser.spatial_parser import SpatialMeasurementParser

        detections = [
            {"text": "89.4", "score": 0.99, "box": [100, 200, 220, 260]},
            {"text": "%DO", "score": 0.95, "box": [240, 205, 300, 250]},
        ]
        payload = SpatialMeasurementParser().parse_detections(
            detections, meter_type="ph", profile_id="hanna_hi98194"
        )
        self.assertEqual(payload.data.get("do_percent"), 89.4)
        self.assertNotIn("do", payload.data)

    def test_label_based_matching_ignores_unit_notation_differences(self) -> None:
        """Fields must be identified by label text, not by the specific unit
        notation an instrument model happens to display. Different real-world
        label spellings for the same measurement must all resolve to the same
        canonical field key, and the raw numeric value must be preserved
        exactly — no unit-based rejection or conversion."""
        from parser.spatial_parser import SpatialMeasurementParser

        cases = [
            ("Cond.", "369", "ec", 369.0),
            ("Conductivity", "369", "ec", 369.0),
            ("EC", "369", "ec", 369.0),
            ("Temp", "28.4", "temperature", 28.4),
            ("Temperature", "28.4", "temperature", 28.4),
            ("Sat.", "89.4", "do_percent", 89.4),
            ("%DO", "89.4", "do_percent", 89.4),
            ("D.O.", "6.5", "do", 6.5),
            ("mVpH", "-15.0", "mv", -15.0),
            ("mV ORP", "208.3", "orp", 208.3),
        ]
        parser = SpatialMeasurementParser()
        for label, value, expected_key, expected_value in cases:
            detections = [
                {"text": value, "score": 0.99, "box": [100, 200, 220, 260]},
                {"text": label, "score": 0.95, "box": [240, 205, 360, 250]},
            ]
            payload = parser.parse_detections(
                detections, meter_type="ph", profile_id="hanna_hi98194"
            )
            self.assertEqual(
                payload.data.get(expected_key), expected_value,
                f"label={label!r} should bind to {expected_key!r}, got {payload.data}",
            )

    def test_do_and_do_percent_never_cross_bind_by_label(self) -> None:
        from parser.spatial_parser import SpatialMeasurementParser

        parser = SpatialMeasurementParser()
        do_payload = parser.parse_detections(
            [
                {"text": "6.5", "score": 0.99, "box": [100, 200, 220, 260]},
                {"text": "D.O.", "score": 0.95, "box": [240, 205, 360, 250]},
            ],
            meter_type="ph", profile_id="hanna_hi98194",
        )
        self.assertNotIn("do_percent", do_payload.data)

        pct_payload = parser.parse_detections(
            [
                {"text": "89.4", "score": 0.99, "box": [100, 200, 220, 260]},
                {"text": "Sat.", "score": 0.95, "box": [240, 205, 360, 250]},
            ],
            meter_type="ph", profile_id="hanna_hi98194",
        )
        self.assertNotIn("do", pct_payload.data)

    def test_resistivity_noise_still_ignored_after_temperature_field_added(self) -> None:
        """Regression guard: adding the temperature field/aliases must not make
        'MO.cm' (resistivity, an ignored token) reattach as a false unit label."""
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
        self.assertNotIn("temperature", payload.data)

    def test_ph_only_mv_page_does_not_require_ph(self) -> None:
        from parser.spatial_parser import SpatialMeasurementParser

        detections = [
            {"text": "HANNA", "score": 0.99, "box": [100, 40, 300, 90]},
            {"text": "-19.2", "score": 0.999, "box": [120, 200, 320, 280]},
            {"text": "mVpH", "score": 0.98, "box": [340, 220, 460, 270]},
            {"text": "HI98194", "score": 0.99, "box": [80, 500, 220, 540]},
        ]
        payload = SpatialMeasurementParser().parse_detections(
            detections, meter_type="ph", profile_id="hanna_hi98194"
        )
        self.assertEqual(payload.data.get("mv"), -19.2)
        self.assertNotIn("missing:ph", payload.issues)
        self.assertTrue(payload.ok)


if __name__ == "__main__":
    unittest.main()
