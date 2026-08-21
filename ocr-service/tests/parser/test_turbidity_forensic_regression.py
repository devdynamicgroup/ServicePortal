"""
Turbidity forensic implementation & certification regression suite.

Real evidence: PP-OCRv6_small_det/rec run live against
ocr/test_images/line_oa_chat_260720_084735_original.jpg (HACH 2100Q
turbidimeter) — 11 detections captured live, embedded below verbatim.
Expected value (0.41 NTU) is read directly off that real detection list
(the "0.41"/"NTU" tokens), not asserted from a screenshot description.

P0 SAFETY FINDING this suite backs (see profile_loader.py get_profile()):
before the routing fix, this exact real photo — parsed with the ONLY
meter_type the client could send for it at the time (no dedicated turbidity
capture existed) — silently bound turbidity=0.41 as chlorine=0.41, because
match_hints matched the generic "HACH" brand text and picked hach_dr300 (a
chlorine profile) regardless of the requested meter_type. Fixed generically:
match_hints auto-detection is now restricted to profiles compatible with
the requested meter_type (declare that exact field) whenever that's known.
Proven below with the real detections, not a synthetic reproduction.

Everything past REAL_084735_DETECTIONS in the "synthetic" tests is
explicitly labeled SYNTHETIC — used only to prove decimal/zero/missing
parser behavior across values the one real fixture doesn't itself cover.
"""

from __future__ import annotations

import unittest

from parser.profile_loader import get_profile
from parser.spatial_parser import SpatialMeasurementParser

REAL_084735_DETECTIONS = [
    {"text": "HACH", "score": 0.9999465942382812, "box": [351.0, 211.0, 469.0, 244.0]},
    {"text": "2100Q", "score": 0.9999651908874512, "box": [470.0, 298.0, 629.0, 347.0]},
    {"text": "OK", "score": 0.9995423555374146, "box": [249.0, 358.0, 297.0, 388.0]},
    {"text": "Turbidity", "score": 0.9998685121536255, "box": [355.0, 358.0, 463.0, 391.0]},
    {"text": "0.41", "score": 0.9999830722808838, "box": [321.0, 387.0, 529.0, 483.0]},
    {"text": "NTU", "score": 0.9999380111694336, "box": [539.0, 394.0, 604.0, 426.0]},
    {"text": "15:43:52", "score": 0.9999729990959167, "box": [525.0, 534.0, 621.0, 560.0]},
    {"text": "2026-07-15", "score": 0.9999843835830688, "box": [499.0, 568.0, 621.0, 596.0]},
    {"text": "Verify Cal", "score": 0.8977408409118652, "box": [217.0, 604.0, 326.0, 634.0]},
    {"text": "Options", "score": 0.9993025660514832, "box": [361.0, 604.0, 453.0, 634.0]},
    {"text": "Read", "score": 0.9999460577964783, "box": [517.0, 606.0, 584.0, 637.0]},
]

# Real fixtures for the already-certified parameters, embedded verbatim from
# live PaddleOCR runs during the pH/Chlorine/TDS forensic passes — reused
# here (TURB-007) to prove turbidity support introduces no leakage into
# their binding.
REAL_PH_ORP_DO_EC_DETECTIONS = [
    {"text": "HANNA", "score": 0.9998092651367188, "box": [237.0, 45.0, 415.0, 97.0]},
    {"text": "6.67", "score": 0.9938479065895081, "box": [252.0, 159.0, 336.0, 194.0]},
    {"text": "FFmDO", "score": 0.7813734412193298, "box": [329.0, 158.0, 406.0, 191.0]},
    {"text": "319", "score": 0.999893844127655, "box": [255.0, 190.0, 328.0, 227.0]},
    {"text": "μSem", "score": 0.8655194640159607, "box": [334.0, 193.0, 397.0, 221.0]},
    {"text": "HI98194", "score": 0.9866820573806763, "box": [129.0, 325.0, 230.0, 352.0]},
    {"text": "pH/EC/DO Multiparameter", "score": 0.9979845285415649, "box": [124.0, 351.0, 384.0, 382.0]},
]
REAL_CHLORINE_DETECTIONS = [
    {"text": "HACH", "score": 1.0, "box": [274.0, 167.0, 416.0, 204.0]},
    {"text": "DR300", "score": 1.0, "box": [378.0, 454.0, 496.0, 489.0]},
    {"text": "Chlorine", "score": 1.0, "box": [313.0, 490.0, 412.0, 517.0]},
    {"text": "LR", "score": 1.0, "box": [253.0, 510.0, 283.0, 531.0]},
    {"text": "mg/L Cl_2", "score": 0.897, "box": [322.0, 511.0, 400.0, 536.0]},
    {"text": "HR", "score": 1.0, "box": [441.0, 515.0, 473.0, 537.0]},
    {"text": "0.0", "score": 0.999, "box": [355.0, 568.0, 483.0, 665.0]},
]


class TestTurbidityRealEvidence(unittest.TestCase):
    def test_turb_001_real_image_yields_turbidity_0_41(self) -> None:
        payload = SpatialMeasurementParser().parse_detections(
            REAL_084735_DETECTIONS, meter_type="turbidity"
        )
        self.assertEqual(payload.profile, "hach_2100q")
        self.assertEqual(payload.data.get("turbidity"), 0.41)

    def test_turb_002_unit_ntu_binds_turbidity(self) -> None:
        payload = SpatialMeasurementParser().parse_detections(
            REAL_084735_DETECTIONS, meter_type="turbidity"
        )
        field = payload.fields.get("turbidity") or {}
        self.assertFalse(field.get("rejected"))
        self.assertEqual(field.get("value"), 0.41)

    def test_turb_003_never_binds_as_a_different_parameter(self) -> None:
        """The real turbidity reading must never appear under any other
        parameter's key, regardless of which compatible-profile path binds
        it (parser correctness, independent of routing)."""
        payload = SpatialMeasurementParser().parse_detections(
            REAL_084735_DETECTIONS, meter_type="turbidity"
        )
        for other_key in ("chlorine", "tds", "ec", "orp", "do", "ph"):
            self.assertNotIn(other_key, payload.data)

    def test_turb_p0_explicit_turbidity_request_no_longer_mis_binds_as_chlorine(self) -> None:
        """THE bug this whole pass exists to fix, proven with the real
        detections: before the routing fix, meter_type='turbidity' on this
        exact real photo (parsed under whatever meter_type the client could
        send before a dedicated turbidity capture existed) resolved to
        hach_dr300 and produced chlorine=0.41. Now it must resolve to the
        turbidity-compatible profile and produce turbidity=0.41, never
        chlorine at all."""
        profile = get_profile(
            meter_type="turbidity", texts=[d["text"] for d in REAL_084735_DETECTIONS]
        )
        self.assertEqual(profile.id, "hach_2100q")
        payload = SpatialMeasurementParser().parse_detections(
            REAL_084735_DETECTIONS, meter_type="turbidity"
        )
        self.assertNotIn("chlorine", payload.data)
        self.assertEqual(payload.data.get("turbidity"), 0.41)

    def test_turb_008_profile_mismatch_chlorine_photo_under_turbidity_request(self) -> None:
        """meter_type='turbidity' requested against a real CHLORINE photo
        (084730_original.jpg detections) must not fabricate a turbidity
        value from the chlorine reading — missing is correct, not a
        cross-parameter guess."""
        payload = SpatialMeasurementParser().parse_detections(
            REAL_CHLORINE_DETECTIONS, meter_type="turbidity"
        )
        self.assertNotIn("turbidity", payload.data)


class TestTurbidityParameterIsolation(unittest.TestCase):
    """TURB-007: real fixtures for every already-certified parameter must
    show zero turbidity leakage from the new profile/routing."""

    def test_hanna_ph_orp_do_ec_fixture_has_no_turbidity(self) -> None:
        payload = SpatialMeasurementParser().parse_detections(
            REAL_PH_ORP_DO_EC_DETECTIONS, meter_type="ph"
        )
        self.assertEqual(payload.profile, "hanna_hi98194")
        self.assertNotIn("turbidity", payload.data)

    def test_chlorine_fixture_has_no_turbidity(self) -> None:
        payload = SpatialMeasurementParser().parse_detections(
            REAL_CHLORINE_DETECTIONS, meter_type="chlorine"
        )
        self.assertEqual(payload.profile, "hach_dr300")
        self.assertEqual(payload.data.get("chlorine"), 0.0)
        self.assertNotIn("turbidity", payload.data)


class TestTurbiditySyntheticSafety(unittest.TestCase):
    """SYNTHETIC — proves parser decimal/zero/missing behavior across values
    the one real fixture (0.41) doesn't itself cover. Same real device
    layout (label="Turbidity", unit="NTU", HACH 2100Q), synthetic value
    only."""

    def _detections_with_value(self, value_text: str) -> list[dict]:
        return [
            {"text": "2100Q", "score": 0.99, "box": [470.0, 298.0, 629.0, 347.0]},
            {"text": "Turbidity", "score": 0.99, "box": [355.0, 358.0, 463.0, 391.0]},
            {"text": value_text, "score": 0.99, "box": [321.0, 387.0, 529.0, 483.0]},
            {"text": "NTU", "score": 0.99, "box": [539.0, 394.0, 604.0, 426.0]},
        ]

    def test_turb_004_missing_when_no_numeric_detection(self) -> None:
        detections = [d for d in self._detections_with_value("0.41") if d["text"] != "0.41"]
        payload = SpatialMeasurementParser().parse_detections(detections, meter_type="turbidity")
        self.assertNotIn("turbidity", payload.data)

    def test_turb_005_zero_is_preserved_not_treated_as_missing(self) -> None:
        payload = SpatialMeasurementParser().parse_detections(
            self._detections_with_value("0.00"), meter_type="turbidity"
        )
        self.assertIn("turbidity", payload.data)
        self.assertEqual(payload.data.get("turbidity"), 0.0)

    def test_turb_006_decimal_preservation(self) -> None:
        cases = [
            ("0.01", 0.01),
            ("0.1", 0.1),
            ("0.41", 0.41),
            ("1.00", 1.0),
            ("10.5", 10.5),
        ]
        for value_text, expected in cases:
            with self.subTest(value_text=value_text):
                payload = SpatialMeasurementParser().parse_detections(
                    self._detections_with_value(value_text), meter_type="turbidity"
                )
                self.assertEqual(payload.data.get("turbidity"), expected)


if __name__ == "__main__":
    unittest.main()
