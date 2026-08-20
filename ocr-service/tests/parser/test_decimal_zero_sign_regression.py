"""
Decimal / zero / sign regression suite — guards the exact real-world values
seen in the Real Camera OCR forensic pass (test-images.jpg and the DR300/
HANNA fixtures under ocr/test_images/), plus OCR-CHL-001.

OCR-CHL-001: proves the missing "0.1" chlorine value (docs/... forensic
report) is a Detection-stage failure, not a Parser-stage one — if the
detector had produced a "0.1" box (same shape/position as the "0.0" box in
the already-passing test_hach_dr300_chlorine_binds_via_label_and_auto_detects_profile
test), the existing parser correctly turns it into chlorine=0.1. This
isolates the defect to Detection with no ambiguity about Parser involvement.
"""

from __future__ import annotations

import unittest

from parser.normalize import extract_numbers
from parser.spatial_parser import SpatialMeasurementParser
from parser.tokens import make_tokens


# Every decimal value actually observed on a real meter photo during the
# Real Camera OCR forensic pass (test-images.jpg, 084708/084720/084725/
# 084730_original.jpg), plus 0.5/1.0/8.90 requested for extra decimal/zero
# coverage. None of these may be truncated, decimal-shifted, or sign-flipped.
REAL_EVIDENCE_VALUES = [
    ("0.0", 0.0),
    ("0.1", 0.1),
    ("0.5", 0.5),
    ("1.0", 1.0),
    ("7.29", 7.29),
    ("7.10", 7.10),
    ("8.90", 8.90),
    ("-15.0", -15.0),
    ("-4.3", -4.3),
    ("181.1", 181.1),
    ("208.3", 208.3),
    ("6.67", 6.67),
    ("89.4", 89.4),
    ("104.5", 104.5),
    ("319", 319.0),
]


class TestDecimalZeroSignRegression(unittest.TestCase):
    def test_extract_numbers_preserves_every_real_evidence_value(self) -> None:
        for raw, expected in REAL_EVIDENCE_VALUES:
            with self.subTest(raw=raw):
                nums = extract_numbers(raw)
                self.assertEqual(nums, [expected], f"{raw!r} -> {nums!r}, expected [{expected}]")

    def test_extract_numbers_never_drops_the_sign(self) -> None:
        self.assertEqual(extract_numbers("-15.0"), [-15.0])
        self.assertEqual(extract_numbers("-15.0")[0], -15.0)
        self.assertNotEqual(extract_numbers("-15.0")[0], 15.0)

    def test_extract_numbers_never_shifts_the_decimal(self) -> None:
        self.assertNotEqual(extract_numbers("0.1"), [1.0])
        self.assertNotEqual(extract_numbers("7.29"), [729.0])
        self.assertNotEqual(extract_numbers("6.67"), [667.0])

    def test_fused_value_label_tokens_preserve_decimal_and_sign(self) -> None:
        """Regression for the make_tokens() fused-token split fix: splitting
        "7.29 PH" / "-15.0MVPH" into value+label tokens must never touch the
        numeric substring itself."""
        cases = [
            ("7.29 PH", "7.29"),
            ("-15.0MVPH", "-15.0"),
        ]
        for raw, expected_value_text in cases:
            with self.subTest(raw=raw):
                tokens = make_tokens(raw, score=0.99, box=[0, 0, 100, 20])
                self.assertEqual(len(tokens), 2, f"{raw!r} should split into value+label")
                value_tok = tokens[0]
                self.assertTrue(value_tok.is_numeric)
                self.assertEqual(value_tok.text, expected_value_text)

    def test_fused_split_guard_requires_uppercase_label(self) -> None:
        """'208.3 mVORP' was never actually observed fused (ORP always came as
        two separate real detections) — its label is mixed-case ('mVORP'),
        which the split guard deliberately excludes. Documents that the guard
        stays narrow rather than assuming every number+word combo is fused."""
        tokens = make_tokens("208.3 mVORP", score=0.99, box=[0, 0, 100, 20])
        self.assertEqual(len(tokens), 1)
        self.assertFalse(tokens[0].is_numeric)

    def test_fused_split_never_touches_bare_keypad_digits(self) -> None:
        """'2 abc' (a HANNA keypad button, not a decimal reading) must stay a
        single non-numeric token — the fused-split guard requires a decimal
        point, which bare keypad integers never have."""
        tokens = make_tokens("2 abc", score=0.99, box=[0, 0, 100, 20])
        self.assertEqual(len(tokens), 1)
        self.assertFalse(tokens[0].is_numeric)

    def test_ocr_chl_001_parser_correctly_carries_0_1_when_detected(self) -> None:
        """OCR-CHL-001: if the detector ever produces a '0.1' box in this
        position (same layout as the real, passing '0.0' fixture), the
        parser must yield chlorine=0.1 exactly — never 1, never missing,
        never a stale/previous/synthetic value. This proves the defect
        documented in the forensic report is 100% Detection-stage: the
        parser has no fault here."""
        detections = [
            {"text": "HACH", "score": 0.99, "box": [401, 247, 600, 295]},
            {"text": "Cert No.: STCR-2412052-1", "score": 0.98, "box": [333, 390, 564, 410]},
            {"text": "DR300", "score": 0.99, "box": [547, 659, 715, 705]},
            {"text": "Chlorine", "score": 0.99, "box": [454, 708, 593, 744]},
            {"text": "LR", "score": 0.99, "box": [368, 737, 406, 766]},
            {"text": "mg/L Cl_2", "score": 0.89, "box": [466, 738, 576, 774]},
            {"text": "HR", "score": 0.99, "box": [637, 746, 681, 773]},
            {"text": "0.1", "score": 0.87, "box": [512, 816, 698, 962]},
        ]
        payload = SpatialMeasurementParser().parse_detections(
            detections, meter_type="ph", profile_id=None
        )
        self.assertEqual(payload.data.get("chlorine"), 0.1)
        self.assertNotEqual(payload.data.get("chlorine"), 1)
        self.assertNotEqual(payload.data.get("chlorine"), 1.0)

    def test_ocr_chl_001_missing_when_detector_produces_no_digit_box(self) -> None:
        """The real, observed failure mode: the detector produces every OTHER
        box on the DR300 photo but none for the LCD digits at all. The
        parser must report chlorine as simply absent — never fabricate 0,
        never fabricate 0.1, never resurrect a previous reading."""
        detections = [
            {"text": "HACH", "score": 0.9999, "box": [409, 218, 598, 270]},
            {"text": "Cert No.: STCR-2412052-1", "score": 0.9855, "box": [357, 352, 571, 376]},
            {"text": "DR300", "score": 0.9989, "box": [555, 600, 713, 648]},
            {"text": "Chlorine", "score": 1.0, "box": [468, 646, 602, 685]},
            {"text": "LR", "score": 0.9999, "box": [392, 675, 428, 700]},
            {"text": "mg/L Cl2", "score": 0.8474, "box": [480, 677, 583, 708]},
            {"text": "HR", "score": 0.9998, "box": [635, 682, 681, 711]},
        ]
        payload = SpatialMeasurementParser().parse_detections(
            detections, meter_type="ph", profile_id=None
        )
        self.assertNotIn("chlorine", payload.data)

    def test_zero_and_nonzero_chlorine_both_parse_correctly_from_real_layouts(self) -> None:
        """0.0 and 0.1 at the identical real screen position must resolve to
        their own distinct, correct values — neither collapses to the other
        nor to a fabricated default."""
        base = [
            {"text": "HACH", "score": 0.99, "box": [401, 247, 600, 295]},
            {"text": "DR300", "score": 0.99, "box": [547, 659, 715, 705]},
            {"text": "Chlorine", "score": 0.99, "box": [454, 708, 593, 744]},
            {"text": "LR", "score": 0.99, "box": [368, 737, 406, 766]},
            {"text": "mg/L Cl_2", "score": 0.89, "box": [466, 738, 576, 774]},
            {"text": "HR", "score": 0.99, "box": [637, 746, 681, 773]},
        ]
        for digit_text, expected in (("0.0", 0.0), ("0.1", 0.1)):
            with self.subTest(digit_text=digit_text):
                detections = base + [
                    {"text": digit_text, "score": 0.9, "box": [512, 816, 698, 962]}
                ]
                payload = SpatialMeasurementParser().parse_detections(
                    detections, meter_type="ph", profile_id=None
                )
                self.assertEqual(payload.data.get("chlorine"), expected)


if __name__ == "__main__":
    unittest.main()
