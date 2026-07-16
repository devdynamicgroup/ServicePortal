"""
Integration tests: Node ocrClient ↔ OCR Service contract.
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import sys

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tests.helpers import OcrServiceProcess, REPO_ROOT  # noqa: E402


def _node_read_meter(service_url: str, timeout_ms: int, payload: dict) -> dict:
    script = (
        f"process.env.OCR_SERVICE_URL={json.dumps(service_url)};"
        f"process.env.OCR_TIMEOUT={json.dumps(str(timeout_ms))};"
        "const { readMeter } = require('./services/ocrClient');"
        "(async () => {"
        f"  const result = await readMeter({json.dumps(payload)});"
        "  process.stdout.write(JSON.stringify(result));"
        "})().catch((err) => {"
        "  process.stdout.write(JSON.stringify({"
        "    success:false,error:'TEST_HARNESS',"
        "    message:String(err && err.message || err)"
        "  }));"
        "  process.exit(1);"
        "});"
    )
    completed = subprocess.run(
        ["node", "-e", script],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=30,
    )
    out = (completed.stdout or "").strip()
    if not out:
        raise AssertionError(
            f"node produced no stdout rc={completed.returncode} stderr={completed.stderr!r}"
        )
    # Prefer last JSON object line (ignore any accidental stdout noise)
    json_line = out
    for line in reversed(out.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            json_line = line
            break
    return json.loads(json_line)


class BackendClientIntegrationTests(unittest.TestCase):
    def test_01_healthy_via_client(self):
        svc = OcrServiceProcess()
        svc.start()
        try:
            result = _node_read_meter(
                svc.base_url,
                10000,
                {"image_url": "https://example.com/meter.jpg", "meter_type": "tds"},
            )
            self.assertTrue(result.get("success"))
            self.assertEqual(result.get("meter_type"), "tds")
            self.assertIn("data", result)
        finally:
            svc.stop()

    def test_02_ocr_service_offline(self):
        result = _node_read_meter(
            "http://127.0.0.1:59999",
            800,
            {"image_url": "sample.jpg", "meter_type": "tds"},
        )
        self.assertFalse(result.get("success"))
        self.assertEqual(result.get("error"), "OCR_OFFLINE")
        self.assertTrue(result.get("retry"))

    def test_03_timeout(self):
        svc = OcrServiceProcess()
        svc.start()
        try:
            result = _node_read_meter(
                svc.base_url,
                500,
                {"image_url": "__slow_3s__", "meter_type": "tds"},
            )
            self.assertFalse(result.get("success"))
            self.assertEqual(result.get("error"), "OCR_TIMEOUT")
        finally:
            svc.stop()


if __name__ == "__main__":
    unittest.main()
