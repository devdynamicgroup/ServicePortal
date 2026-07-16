"""
Performance-oriented contract checks (concurrency).
"""

from __future__ import annotations

import sys
import unittest
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tests.helpers import OcrServiceProcess, http_json  # noqa: E402


class ConcurrentPerformanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.svc = OcrServiceProcess()
        cls.svc.start()

    @classmethod
    def tearDownClass(cls):
        cls.svc.stop()

    def test_20_parallel_reads(self):
        def one(i):
            status, body = http_json(
                "POST",
                f"{self.svc.base_url}/ocr/read-meter",
                {"image_url": f"sample-{i}.jpg", "meter_type": "tds"},
            )
            return status, body

        results = []
        with ThreadPoolExecutor(max_workers=20) as pool:
            futs = [pool.submit(one, i) for i in range(20)]
            for fut in as_completed(futs):
                results.append(fut.result())

        self.assertEqual(len(results), 20)
        for status, body in results:
            self.assertEqual(status, 200)
            self.assertTrue(body.get("success"))
            self.assertIn("request_id", body)


if __name__ == "__main__":
    unittest.main()
