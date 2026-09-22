"""
Contract tests for the Phase 1 shared-secret auth soft rollout
and Secret Rotation (OCR_SHARED_SECRET + OCR_SHARED_SECRET_PREVIOUS)
(services/ocrClient.js <-> api/validators.py:require_shared_secret).

Each scenario needs its own process because settings are loaded once at
process start from the environment.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tests.helpers import OcrServiceProcess, http_json  # noqa: E402

SECRET = "phase1-contract-test-secret"
SECRET_PREVIOUS = "phase1-contract-test-secret-previous"
PAYLOAD = {"image_url": "sample.jpg", "meter_type": "tds"}


def _clear_secret_env() -> None:
    os.environ.pop("OCR_SHARED_SECRET", None)
    os.environ.pop("OCR_SHARED_SECRET_PREVIOUS", None)
    os.environ.pop("OCR_AUTH_REQUIRED", None)


class SharedSecretUnconfiguredTests(unittest.TestCase):
    """No OCR_SHARED_SECRET set at all: feature must be a complete no-op."""

    @classmethod
    def setUpClass(cls):
        _clear_secret_env()
        cls.svc = OcrServiceProcess()
        cls.svc.start()
        cls.base = cls.svc.base_url

    @classmethod
    def tearDownClass(cls):
        cls.svc.stop()

    def test_no_header_accepted_when_secret_unconfigured(self):
        status, body = http_json("POST", f"{self.base}/ocr/read-meter", PAYLOAD)
        self.assertEqual(status, 200)

    def test_wrong_header_still_accepted_when_secret_unconfigured(self):
        # Feature is off entirely — even a bogus header must not matter.
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": "anything"},
        )
        self.assertEqual(status, 200)


class SharedSecretSoftRolloutTests(unittest.TestCase):
    """Secret configured, OCR_AUTH_REQUIRED=false (default): missing header
    soft-passes, wrong header is always rejected, correct header passes."""

    @classmethod
    def setUpClass(cls):
        os.environ["OCR_SHARED_SECRET"] = SECRET
        os.environ.pop("OCR_SHARED_SECRET_PREVIOUS", None)
        os.environ["OCR_AUTH_REQUIRED"] = "false"
        cls.svc = OcrServiceProcess()
        cls.svc.start()
        cls.base = cls.svc.base_url

    @classmethod
    def tearDownClass(cls):
        cls.svc.stop()
        _clear_secret_env()

    def test_missing_header_soft_passes(self):
        status, body = http_json("POST", f"{self.base}/ocr/read-meter", PAYLOAD)
        self.assertEqual(status, 200)

    def test_wrong_header_rejected_even_in_soft_rollout(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": "wrong-value"},
        )
        self.assertEqual(status, 401)
        self.assertFalse(body.get("success"))
        self.assertEqual(body.get("error"), "UNAUTHORIZED")

    def test_correct_header_accepted(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": SECRET},
        )
        self.assertEqual(status, 200)

    def test_correct_header_lowercase_name_accepted(self):
        # HTTP header names are case-insensitive on the wire; confirm the
        # validator's manual lookup (mirroring require_json_content_type)
        # actually handles that, not just the exact casing used elsewhere
        # in this test file.
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            PAYLOAD,
            headers={"x-ocr-shared-secret": SECRET},
        )
        self.assertEqual(status, 200)

    def test_debug_read_endpoint_also_enforces(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/debug-read",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": "wrong-value"},
        )
        self.assertEqual(status, 401)

    def test_previous_secret_unset_does_not_accept_foreign_value(self):
        # PREVIOUS unset: only primary is valid.
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": SECRET_PREVIOUS},
        )
        self.assertEqual(status, 401)


class SharedSecretPreviousEmptyTests(unittest.TestCase):
    """OCR_SHARED_SECRET_PREVIOUS="" must behave like unset."""

    @classmethod
    def setUpClass(cls):
        os.environ["OCR_SHARED_SECRET"] = SECRET
        os.environ["OCR_SHARED_SECRET_PREVIOUS"] = ""
        os.environ["OCR_AUTH_REQUIRED"] = "false"
        cls.svc = OcrServiceProcess()
        cls.svc.start()
        cls.base = cls.svc.base_url

    @classmethod
    def tearDownClass(cls):
        cls.svc.stop()
        _clear_secret_env()

    def test_empty_previous_rejects_non_primary(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": SECRET_PREVIOUS},
        )
        self.assertEqual(status, 401)

    def test_empty_previous_still_accepts_primary(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": SECRET},
        )
        self.assertEqual(status, 200)


class SharedSecretRotationTests(unittest.TestCase):
    """Both primary and previous configured: either may authenticate."""

    @classmethod
    def setUpClass(cls):
        os.environ["OCR_SHARED_SECRET"] = SECRET
        os.environ["OCR_SHARED_SECRET_PREVIOUS"] = SECRET_PREVIOUS
        os.environ["OCR_AUTH_REQUIRED"] = "false"
        cls.svc = OcrServiceProcess()
        cls.svc.start()
        cls.base = cls.svc.base_url

    @classmethod
    def tearDownClass(cls):
        cls.svc.stop()
        _clear_secret_env()

    def test_primary_secret_accepted(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": SECRET},
        )
        self.assertEqual(status, 200)

    def test_previous_secret_accepted(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": SECRET_PREVIOUS},
        )
        self.assertEqual(status, 200)

    def test_wrong_secret_rejected(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": "wrong-value"},
        )
        self.assertEqual(status, 401)
        self.assertEqual(body.get("error"), "UNAUTHORIZED")

    def test_missing_header_soft_passes_during_rotation(self):
        status, body = http_json("POST", f"{self.base}/ocr/read-meter", PAYLOAD)
        self.assertEqual(status, 200)

    def test_debug_read_accepts_previous_and_rejects_wrong(self):
        status_ok, _ = http_json(
            "POST",
            f"{self.base}/ocr/debug-read",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": SECRET_PREVIOUS},
        )
        self.assertEqual(status_ok, 200)
        status_bad, body = http_json(
            "POST",
            f"{self.base}/ocr/debug-read",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": "wrong-value"},
        )
        self.assertEqual(status_bad, 401)
        self.assertEqual(body.get("error"), "UNAUTHORIZED")


class SharedSecretHardRequiredTests(unittest.TestCase):
    """Secret configured, OCR_AUTH_REQUIRED=true: missing header now rejected.

    This only proves the Phase 1 code path works — OCR_AUTH_REQUIRED=true
    is NOT being set in production by this task.
    """

    @classmethod
    def setUpClass(cls):
        os.environ["OCR_SHARED_SECRET"] = SECRET
        os.environ.pop("OCR_SHARED_SECRET_PREVIOUS", None)
        os.environ["OCR_AUTH_REQUIRED"] = "true"
        cls.svc = OcrServiceProcess()
        cls.svc.start()
        cls.base = cls.svc.base_url

    @classmethod
    def tearDownClass(cls):
        cls.svc.stop()
        _clear_secret_env()

    def test_missing_header_rejected_when_required(self):
        status, body = http_json("POST", f"{self.base}/ocr/read-meter", PAYLOAD)
        self.assertEqual(status, 401)
        self.assertEqual(body.get("error"), "UNAUTHORIZED")

    def test_correct_header_still_accepted_when_required(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            PAYLOAD,
            headers={"X-OCR-Shared-Secret": SECRET},
        )
        self.assertEqual(status, 200)


class SharedSecretCompareDigestUnitTests(unittest.TestCase):
    """In-process proof that both slots use secrets.compare_digest and that
    both digests run when previous is configured (no early short-circuit)."""

    def test_both_slots_use_compare_digest_without_short_circuit(self):
        from config import settings as settings_mod
        from api import validators

        calls: list[tuple[str, str]] = []

        def tracking_compare(a: str, b: str) -> bool:
            calls.append((a, b))
            return a == b

        primary = "rotation-primary-secret-value"
        previous = "rotation-previous-secret-value"
        fake_settings = settings_mod.Settings(
            ocr_shared_secret=primary,
            ocr_shared_secret_previous=previous,
            ocr_auth_required=False,
        )

        with patch.object(validators, "settings", fake_settings), patch.object(
            validators.secrets_module, "compare_digest", side_effect=tracking_compare
        ):
            validators.require_shared_secret(
                {"X-OCR-Shared-Secret": primary},
                "unit-req-primary",
            )
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[0], (primary, primary))
            self.assertEqual(calls[1], (primary, previous))

            calls.clear()
            validators.require_shared_secret(
                {"x-ocr-shared-secret": previous},
                "unit-req-previous",
            )
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[0], (previous, primary))
            self.assertEqual(calls[1], (previous, previous))

            calls.clear()
            with self.assertRaises(Exception):
                validators.require_shared_secret(
                    {"X-OCR-Shared-Secret": "nope"},
                    "unit-req-wrong",
                )
            self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
