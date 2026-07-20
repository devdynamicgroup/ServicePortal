"""Stage F — confidence tests."""

from __future__ import annotations

import unittest

from parser.field_binder import FieldCandidate
from parser.field_confidence import FIELD_ACCEPT_THRESHOLD, field_confidence, validate_candidates
from parser.profile_loader import get_profile
from parser.tokens import make_token


class TestConfidence(unittest.TestCase):
    def test_min_of_value_and_unit(self) -> None:
        vt = make_token("7.29", score=1.0, box=[0, 0, 10, 10])
        lt = make_token("PH", score=0.9, box=[20, 0, 30, 10])
        cand = FieldCandidate(
            key="ph",
            value=7.29,
            value_token=vt,
            label_token=lt,
            unit_match_score=0.8,
            row_index=1,
        )
        conf = field_confidence(cand)
        # min(1.0, 0.8) = 0.8, no weak-unit penalty at exactly 0.8
        self.assertAlmostEqual(conf, 0.8, places=3)

    def test_weak_unit_penalty(self) -> None:
        vt = make_token("89.4", score=1.0, box=[0, 0, 10, 10])
        lt = make_token("%00", score=0.9, box=[20, 0, 30, 10])
        cand = FieldCandidate(
            key="do_percent",
            value=89.4,
            value_token=vt,
            label_token=lt,
            unit_match_score=0.7,
            row_index=3,
            corrections=[{"from": "%00", "to": "%do"}],
        )
        conf = field_confidence(cand)
        # min(1.0, 0.7)=0.7 * 0.97 (correction) * 0.90 (weak unit) ≈ 0.611
        self.assertLess(conf, FIELD_ACCEPT_THRESHOLD)

    def test_low_value_score_rejected(self) -> None:
        profile = get_profile(profile_id="hanna_hi98194")
        vt = make_token("7.29", score=0.50, box=[0, 0, 10, 10])
        lt = make_token("PH", score=0.9, box=[20, 0, 30, 10])
        cand = FieldCandidate(
            key="ph",
            value=7.29,
            value_token=vt,
            label_token=lt,
            unit_match_score=1.0,
            row_index=1,
        )
        results = validate_candidates([cand], profile)
        self.assertTrue(results[0].rejected)
        self.assertEqual(results[0].reject_reason, "low_confidence")


if __name__ == "__main__":
    unittest.main()
