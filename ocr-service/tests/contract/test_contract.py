"""
Contract tests against the OCR Service HTTP API (MockEngine).
"""

from __future__ import annotations

import json
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tests.helpers import OcrServiceProcess, http_json  # noqa: E402


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.svc = OcrServiceProcess()
        cls.svc.start()
        cls.base = cls.svc.base_url

    @classmethod
    def tearDownClass(cls):
        cls.svc.stop()

    def test_01_healthy_service(self):
        status, body = http_json("GET", f"{self.base}/health")
        self.assertEqual(status, 200)
        self.assertTrue(body.get("success"))
        self.assertEqual(body.get("service"), "ocr-service")
        self.assertEqual(body.get("engine"), "mock")
        self.assertEqual(str(body.get("phase")), "3.5")
        self.assertTrue(body.get("ready"))
        self.assertIn("uptime", body)
        self.assertIn("request_id", body)

    def test_04_missing_image_url(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            {"meter_type": "tds"},
        )
        self.assertEqual(status, 400)
        self.assertFalse(body.get("success"))
        self.assertIn(body.get("error"), {"VALIDATION_ERROR", "INVALID_REQUEST"})

    def test_05_missing_meter_type(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            {"image_url": "sample.jpg"},
        )
        self.assertEqual(status, 400)
        self.assertFalse(body.get("success"))

    def test_06_unsupported_meter(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            {"image_url": "sample.jpg", "meter_type": "banana"},
        )
        self.assertEqual(status, 200)
        self.assertFalse(body.get("success"))
        self.assertEqual(body.get("error"), "UNSUPPORTED_METER")

    def test_07_malformed_json(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            "{not-json",
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(status, 400)
        self.assertNotEqual(status, 500)
        self.assertFalse(body.get("success"))

    def test_08_internal_engine_exception(self):
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            {"image_url": "__force_engine_error__", "meter_type": "tds"},
        )
        self.assertEqual(status, 200)
        self.assertFalse(body.get("success"))
        self.assertEqual(body.get("error"), "OCR_INTERNAL_ERROR")

    def test_09_concurrent_requests(self):
        def one(_i):
            return http_json(
                "POST",
                f"{self.base}/ocr/read-meter",
                {"image_url": "sample.jpg", "meter_type": "tds"},
            )

        results = []
        with ThreadPoolExecutor(max_workers=20) as pool:
            futures = [pool.submit(one, i) for i in range(20)]
            for fut in as_completed(futures):
                results.append(fut.result())

        self.assertEqual(len(results), 20)
        for status, body in results:
            self.assertIsNotNone(status)
            self.assertIsInstance(body, dict)
            self.assertIn("success", body)
            self.assertIn("request_id", body)

    def test_10_large_payload(self):
        huge = {"image_url": "x" * (300 * 1024), "meter_type": "tds"}
        raw = json.dumps(huge).encode("utf-8")
        status, body = http_json(
            "POST",
            f"{self.base}/ocr/read-meter",
            raw,
            headers={"Content-Type": "application/json"},
            timeout=10.0,
        )
        self.assertIn(status, (400, 413))
        if isinstance(body, dict):
            self.assertFalse(body.get("success", True))

    def test_version_endpoint(self):
        status, body = http_json("GET", f"{self.base}/version")
        self.assertEqual(status, 200)
        self.assertEqual(body.get("service"), "ocr-service")
        self.assertEqual(body.get("version"), "0.1.0")
        self.assertEqual(body.get("engine"), "mock")
        self.assertEqual(str(body.get("phase")), "3.5")

    def test_metrics_endpoint(self):
        status, body = http_json("GET", f"{self.base}/metrics")
        self.assertEqual(status, 200)
        self.assertIn("total_requests", body)
        self.assertIn("successful_requests", body)
        self.assertIn("failed_requests", body)
        self.assertIn("average_duration_ms", body)
        self.assertEqual(body.get("engine"), "mock")


if __name__ == "__main__":
    unittest.main()
