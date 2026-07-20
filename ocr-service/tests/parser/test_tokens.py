"""Stage A — token normalizer tests."""

from __future__ import annotations

import unittest

from parser.tokens import make_token, tokens_from_detections, tokens_from_parallel_lists


class TestTokens(unittest.TestCase):
    def test_numeric_detection(self) -> None:
        for text in ("-15.0", "7.29", "208.3", "89.4", "0", "+1.5"):
            tok = make_token(text, score=0.99, box=[0, 0, 10, 10])
            self.assertTrue(tok.is_numeric, text)

    def test_non_numeric(self) -> None:
        for text in ("PH", "mVpH", "%00", "HANNA", "ESC"):
            tok = make_token(text, score=0.99, box=[0, 0, 10, 10])
            self.assertFalse(tok.is_numeric, text)

    def test_glyph_correction_before_numeric(self) -> None:
        tok = make_token("7.O", score=1.0, box=[0, 0, 10, 10])
        self.assertEqual(tok.text_corrected, "7.0")
        self.assertTrue(tok.is_numeric)

    def test_ignore_ui_tokens(self) -> None:
        for text in ("ESC", "HELP", "MENU", "LOG"):
            tok = make_token(text, box=[0, 0, 10, 10])
            self.assertTrue(tok.ignored, text)

    def test_debug_only_brand(self) -> None:
        tok = make_token("HANNA", box=[0, 0, 10, 10])
        self.assertTrue(tok.debug_only)
        self.assertFalse(tok.ignored)

    def test_center_from_box(self) -> None:
        tok = make_token("7.29", box=[100, 200, 200, 300])
        self.assertEqual(tok.cx, 150.0)
        self.assertEqual(tok.cy, 250.0)

    def test_parallel_lists(self) -> None:
        tokens = tokens_from_parallel_lists(
            ["7.29", "PH"],
            [0.99, 0.98],
            [[0, 0, 10, 10], [20, 0, 30, 10]],
        )
        self.assertEqual(len(tokens), 2)
        self.assertTrue(tokens[0].is_numeric)
        self.assertFalse(tokens[1].is_numeric)

    def test_detections(self) -> None:
        tokens = tokens_from_detections(
            [{"text": "-15.0", "score": 0.99, "box": [1, 2, 3, 4]}]
        )
        self.assertEqual(len(tokens), 1)
        self.assertTrue(tokens[0].is_numeric)


if __name__ == "__main__":
    unittest.main()
