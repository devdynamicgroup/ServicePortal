"""Stage C — unit normalizer tests."""

from __future__ import annotations

import unittest

from parser.unit_normalizer import normalize_unit, resolve_field_from_label, unit_match_score


class TestUnitNormalizer(unittest.TestCase):
    def test_ph_variants(self) -> None:
        for label in ("PH", "ph", "pH"):
            key, _ = normalize_unit(label)
            self.assertEqual(unit_match_score(label, ["ph"]), 1.0, label)
            self.assertIn(key, {"ph"})

    def test_mvph(self) -> None:
        self.assertGreaterEqual(unit_match_score("mVpH", ["mv", "mvph", "mv_ph"]), 0.9)

    def test_mvorp(self) -> None:
        self.assertGreaterEqual(unit_match_score("mVORP", ["orp", "mvorp"]), 0.9)

    def test_percent_00(self) -> None:
        key, corrections = normalize_unit("%00")
        self.assertEqual(key, "%do")
        self.assertTrue(corrections)
        self.assertGreaterEqual(unit_match_score("%00", ["do", "%do", "%00", "do_percent"]), 0.8)

    def test_esc_no_match(self) -> None:
        self.assertEqual(unit_match_score("ESC", ["ph", "mv", "orp"]), 0.0)

    def test_short_garbled_label_does_not_fuzzy_match_unrelated_short_alias(self) -> None:
        """Real bug (production, live photo): a HANNA HI98194 temperature
        reading's degree-symbol label ("°C") was OCR'd by PaddleOCR as "*C"
        (asterisk instead of degree glyph). Levenshtein("*c", "ec") == 1, so
        the old unconditional len<=6 fuzzy-match rule scored this an 0.8
        match against the completely unrelated "ec" alias -- tying (also
        0.8) against temperature's own "°c" alias by the same coincidence,
        and silently mis-binding the temperature VALUE as an EC reading
        depending on field iteration order. A label this short (2 chars) is
        not meaningful evidence for a fuzzy edit-distance match -- same
        floor already applied to the substring rule just above."""
        self.assertEqual(unit_match_score("*C", ["ec", "us", "uscm"]), 0.0)
        self.assertEqual(unit_match_score("*C", ["°c", "temp", "temperature"]), 0.0)

    def test_longer_garbled_label_still_fuzzy_matches(self) -> None:
        """Sanity: the length floor must not block real, useful fuzzy
        recovery for labels with enough characters to be real evidence --
        "×00" (a real HANNA %DO reading, degree-sign OCR confusion turning
        "%00" into "×00") is 3 chars, clears the new >=3 floor, and must
        still hit hanna_hi98194's own "%00" alias exactly as it does in
        production today."""
        self.assertGreaterEqual(unit_match_score("×00", ["%00", "do_percent"]), 0.8)

    def test_resolve_field(self) -> None:
        aliases = {
            "ph": ["ph"],
            "mv": ["mv", "mvph"],
            "orp": ["orp", "mvorp"],
            "do_percent": ["do", "%do", "%00"],
        }
        field, score = resolve_field_from_label("PH", aliases)
        self.assertEqual(field, "ph")
        self.assertGreaterEqual(score, 0.95)

        field, score = resolve_field_from_label("mVORP", aliases)
        self.assertEqual(field, "orp")
        self.assertGreaterEqual(score, 0.85)


if __name__ == "__main__":
    unittest.main()
