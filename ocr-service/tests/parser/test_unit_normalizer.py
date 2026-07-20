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
