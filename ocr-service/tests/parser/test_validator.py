"""Stage E — validator tests."""

from __future__ import annotations

import unittest

from parser.field_binder import FieldCandidate
from parser.field_confidence import validate_candidates
from parser.profile_loader import get_profile
from parser.tokens import make_token


def _cand(key: str, value: float, *, score: float = 0.99, unit_score: float = 0.95) -> FieldCandidate:
    vt = make_token(str(value), score=score, box=[0, 0, 10, 10])
    lt = make_token(key, score=0.9, box=[20, 0, 30, 10])
    return FieldCandidate(
        key=key,
        value=value,
        value_token=vt,
        label_token=lt,
        unit_match_score=unit_score,
        row_index=0,
    )


class TestValidator(unittest.TestCase):
    def test_accepts_valid_ph(self) -> None:
        profile = get_profile(profile_id="hanna_hi98194")
        results = validate_candidates([_cand("ph", 7.29)], profile)
        self.assertEqual(len(results), 1)
        self.assertFalse(results[0].rejected)
        self.assertEqual(results[0].value, 7.29)

    def test_rejects_out_of_range_ph(self) -> None:
        profile = get_profile(profile_id="hanna_hi98194")
        results = validate_candidates([_cand("ph", 15.0)], profile)
        self.assertTrue(results[0].rejected)
        self.assertEqual(results[0].reject_reason, "out_of_range")
        self.assertIsNone(results[0].value)

    def test_rejects_do_over_200(self) -> None:
        profile = get_profile(profile_id="hanna_hi98194")
        results = validate_candidates([_cand("do_percent", 250.0)], profile)
        self.assertTrue(results[0].rejected)
        self.assertEqual(results[0].reject_reason, "out_of_range")

    def test_partial_reject_keeps_valid(self) -> None:
        profile = get_profile(profile_id="hanna_hi98194")
        results = validate_candidates(
            [_cand("ph", 7.29), _cand("do_percent", 250.0)],
            profile,
        )
        by_key = {r.key: r for r in results}
        self.assertFalse(by_key["ph"].rejected)
        self.assertTrue(by_key["do_percent"].rejected)


if __name__ == "__main__":
    unittest.main()
