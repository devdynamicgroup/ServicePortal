"""
Decimal / zero / sign regression suite — guards the exact real-world values
seen in the Real Camera OCR forensic pass (test-images.jpg and the DR300/
HANNA fixtures under ocr/test_images/), plus OCR-CHL-001.

OCR-CHL-001 update (second forensic pass, real PaddleOCR against
ocr/test_images/line_oa_chat_260720_084725_original.jpg): the original
"100% Detection-stage" framing below was correct for the small detection
model (PP-OCRv6_small_det produces zero boxes for the LCD digit region on
this photo) but incomplete. Re-run with a larger detection/recognition pair
(PP-OCRv6_medium_det/rec, wired up as the bounded second-pass fallback —
see processing/pipeline.py) DOES produce boxes for the digits: two of them,
"0." and "1", split at the decimal point instead of one "0.1" box (contrast
this with the same device's "0.0" reading, ocr/test_images/
line_oa_chat_260720_084730_original.jpg, where detection emits one unified
box). Both fragments are individually recognized correctly — this is not a
recognition error either. The remaining defect was Parser-stage after all:
row_grouper.group_rows() skipped the "0." fragment (fails the strict
^\\d+(\\.\\d+)?$ numeric grammar with nothing after the decimal point) and
would have let the bare "1" fragment bind alone as a wrong, 10x-shifted
value. Fixed generically in parser/row_grouper.py
(_merge_split_decimal_tokens): reassembles a trailing-dot token immediately
adjacent to a bare-digit token in the same row into one decimal token,
before the numeric-skip / label-value pairing runs. Never invents a digit
that wasn't itself recognized, never touches two genuinely separate numbers
(neither ends in a bare "."), and the merged confidence is the lower of the
two fragments' own scores.
"""

from __future__ import annotations

import unittest

from parser.normalize import extract_numbers
from parser.row_grouper import _merge_split_decimal_tokens
from parser.spatial_parser import SpatialMeasurementParser
from parser.tokens import make_token, make_tokens


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
            detections, meter_type="chlorine", profile_id=None
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
            detections, meter_type="chlorine", profile_id=None
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
                    detections, meter_type="chlorine", profile_id=None
                )
                self.assertEqual(payload.data.get("chlorine"), expected)


class TestSplitDecimalTokenMerge(unittest.TestCase):
    """OCR-CHL-001 continuation: the Parser-stage half of the "0.1" defect —
    row_grouper._merge_split_decimal_tokens reassembling a detector-split
    decimal ("0." + "1" -> "0.1") before numeric classification runs."""

    def test_real_evidence_084725_chlorine_0_1_via_full_pipeline(self) -> None:
        """Exact detection boxes captured from a real PaddleOCR
        (PP-OCRv6_medium_det/rec) run against
        ocr/test_images/line_oa_chat_260720_084725_original.jpg — the
        detector splits "0.1" into two adjacent boxes at the decimal point.
        End-to-end through the real (unmodified) SpatialMeasurementParser,
        this must resolve to chlorine=0.1 — never 1, never missing."""
        detections = [
            {"text": "HACH", "score": 1.0, "box": [289.0, 156.0, 415.0, 186.0]},
            {"text": "DR300", "score": 1.0, "box": [385.0, 417.0, 496.0, 450.0]},
            {"text": "Chlorine", "score": 1.0, "box": [326.0, 450.0, 416.0, 474.0]},
            {"text": "LR", "score": 1.0, "box": [269.0, 466.0, 298.0, 487.0]},
            {"text": "mg/L Cl2", "score": 0.953, "box": [333.0, 469.0, 404.0, 492.0]},
            {"text": "HR", "score": 1.0, "box": [442.0, 475.0, 471.0, 494.0]},
            {"text": "0.", "score": 0.956, "box": [363.0, 527.0, 429.0, 607.0]},
            {"text": "1", "score": 0.937, "box": [440.0, 544.0, 472.0, 599.0]},
        ]
        payload = SpatialMeasurementParser().parse_detections(detections, meter_type="chlorine")
        self.assertEqual(payload.data.get("chlorine"), 0.1)
        self.assertNotEqual(payload.data.get("chlorine"), 1)
        self.assertNotEqual(payload.data.get("chlorine"), 1.0)
        self.assertIn("chlorine", payload.data)

    def test_real_evidence_084730_chlorine_0_0_unaffected(self) -> None:
        """Same device, "0.0" reading — detector emits ONE unified box here
        (no split), captured from a real PaddleOCR run against
        ocr/test_images/line_oa_chat_260720_084730_original.jpg. Must still
        resolve correctly with the split-decimal merge active — proves the
        merge does not regress the already-working case."""
        detections = [
            {"text": "HACH", "score": 1.0, "box": [276.0, 171.0, 416.0, 204.0]},
            {"text": "DR300", "score": 1.0, "box": [378.0, 454.0, 496.0, 489.0]},
            {"text": "Chlorine", "score": 1.0, "box": [313.0, 490.0, 412.0, 517.0]},
            {"text": "LR", "score": 1.0, "box": [253.0, 510.0, 283.0, 531.0]},
            {"text": "mg/L Cl_2", "score": 0.897, "box": [322.0, 511.0, 400.0, 536.0]},
            {"text": "HR", "score": 1.0, "box": [441.0, 515.0, 473.0, 537.0]},
            {"text": "0.0", "score": 0.999, "box": [355.0, 568.0, 483.0, 665.0]},
        ]
        payload = SpatialMeasurementParser().parse_detections(detections, meter_type="chlorine")
        self.assertEqual(payload.data.get("chlorine"), 0.0)

    def test_merge_function_joins_adjacent_split_decimal(self) -> None:
        cur = make_token("0.", score=0.956, box=[363.0, 527.0, 429.0, 607.0])
        nxt = make_token("1", score=0.937, box=[440.0, 544.0, 472.0, 599.0])
        merged = _merge_split_decimal_tokens([cur, nxt])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].text, "0.1")
        self.assertTrue(merged[0].is_numeric)
        # Never invent confidence — merged score is the lower of the two.
        self.assertAlmostEqual(merged[0].score, 0.937, places=3)

    def test_merge_function_preserves_sign(self) -> None:
        cur = make_token("-3.", score=0.9, box=[100.0, 100.0, 140.0, 140.0])
        nxt = make_token("2", score=0.9, box=[143.0, 100.0, 160.0, 140.0])
        merged = _merge_split_decimal_tokens([cur, nxt])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].text, "-3.2")

    def test_merge_function_does_not_touch_two_unrelated_complete_numbers(self) -> None:
        """"20" and "35" are two complete, independent readings on the same
        row — neither ends in a bare decimal point, so the merge guard must
        never fuse them into one fabricated value."""
        a = make_token("20", score=0.9, box=[100.0, 100.0, 140.0, 140.0])
        b = make_token("35", score=0.9, box=[150.0, 100.0, 190.0, 140.0])
        merged = _merge_split_decimal_tokens([a, b])
        self.assertEqual(len(merged), 2)
        self.assertEqual({t.text for t in merged}, {"20", "35"})

    def test_merge_function_requires_small_gap(self) -> None:
        """A trailing-dot token followed by bare digits far away on the same
        row is two unrelated tokens, not a split decimal — must not merge."""
        cur = make_token("0.", score=0.9, box=[100.0, 100.0, 140.0, 140.0])
        nxt = make_token("1", score=0.9, box=[400.0, 100.0, 420.0, 140.0])
        merged = _merge_split_decimal_tokens([cur, nxt])
        self.assertEqual(len(merged), 2)

    def test_merge_function_leaves_lone_trailing_dot_token_alone(self) -> None:
        """No adjacent bare-digit token to merge with — "0." alone must stay
        non-numeric (and therefore be dropped as missing downstream), never
        silently coerced to 0."""
        cur = make_token("0.", score=0.9, box=[100.0, 100.0, 140.0, 140.0])
        merged = _merge_split_decimal_tokens([cur])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].text, "0.")
        self.assertFalse(merged[0].is_numeric)

    def test_merge_function_leaves_lone_bare_digit_alone(self) -> None:
        """A bare "1" with no preceding trailing-dot token is just the
        number 1 — must never be reinterpreted as part of some other value."""
        nxt = make_token("1", score=0.9, box=[100.0, 100.0, 140.0, 140.0])
        merged = _merge_split_decimal_tokens([nxt])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].text, "1")
        self.assertTrue(merged[0].is_numeric)

    def test_leading_dot_fragment_alone_stays_non_numeric(self) -> None:
        """".1" (leading dot, no leading digit) is never produced by the
        merge (it only assembles digit+dot+digit), and on its own must stay
        non-numeric — missing, not silently coerced into a value."""
        tok = make_token(".1", score=0.9, box=[100.0, 100.0, 140.0, 140.0])
        self.assertFalse(tok.is_numeric)

    def test_missing_digit_box_still_reports_missing_not_zero(self) -> None:
        """No digit boxes detected at all (the real, observed small-model
        failure mode on 084725) — chlorine must stay absent, never 0."""
        detections = [
            {"text": "HACH", "score": 1.0, "box": [285.0, 150.0, 415.0, 187.0]},
            {"text": "DR300", "score": 1.0, "box": [385.0, 416.0, 495.0, 451.0]},
            {"text": "Chlorine", "score": 1.0, "box": [325.0, 448.0, 416.0, 475.0]},
            {"text": "LR", "score": 1.0, "box": [272.0, 468.0, 297.0, 485.0]},
            {"text": "mg/L Cl2", "score": 0.857, "box": [333.0, 471.0, 403.0, 491.0]},
            {"text": "HR", "score": 1.0, "box": [440.0, 472.0, 471.0, 493.0]},
        ]
        payload = SpatialMeasurementParser().parse_detections(detections, meter_type="chlorine")
        self.assertNotIn("chlorine", payload.data)
        self.assertNotEqual(payload.data.get("chlorine"), 0)
        self.assertNotEqual(payload.data.get("chlorine"), 0.0)


if __name__ == "__main__":
    unittest.main()
