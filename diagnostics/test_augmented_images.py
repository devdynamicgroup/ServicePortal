"""
Validate every image under D:\\pathlib\\output against the running OCR Service.

Uses the real HTTP endpoint only (POST /ocr/read-meter).
Does not import MockEngine, engines, or OCR service internals.
Does not modify OCR Service code.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ENDPOINT = "http://127.0.0.1:5055/ocr/read-meter"
IMAGES_DIR = Path(r"D:\pathlib\output")
REPORT_PATH = Path(__file__).resolve().parent / "augmented_test_report.json"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}
DEFAULT_METER_TYPE = "ph"
HTTP_TIMEOUT_S = 120.0


def discover_images(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(
        p
        for p in directory.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )


def post_read_meter(image_path: Path, meter_type: str) -> tuple[int | None, Any, str | None]:
    """
    Call the OCR service. Returns (http_status, body_or_none, error_message).
    Never raises.
    """
    payload = {
        "image_url": str(image_path.resolve()),
        "meter_type": meter_type,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
            raw = resp.read()
            status = int(resp.status)
    except urllib.error.HTTPError as exc:
        try:
            raw = exc.read()
        except Exception:  # noqa: BLE001
            raw = b""
        status = int(exc.code)
        if not raw:
            return status, None, f"HTTPError: {exc.code} {exc.reason}"
        try:
            return status, json.loads(raw.decode("utf-8")), None
        except Exception as parse_exc:  # noqa: BLE001
            return status, None, f"HTTPError: {exc.code}; JSONDecodeError: {parse_exc}"
    except Exception as exc:  # noqa: BLE001
        return None, None, f"{type(exc).__name__}: {exc}"

    try:
        parsed = json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        return status, None, f"JSONDecodeError: {exc}"

    return status, parsed, None


def classify_result(
    http_status: int | None,
    response: Any,
    transport_error: str | None,
) -> str:
    if transport_error and http_status is None:
        return "ERROR"
    if http_status is None or http_status != 200:
        return "ERROR"
    if not isinstance(response, dict):
        return "INVALID RESPONSE"
    if transport_error and response is None:
        return "INVALID RESPONSE"

    # Valid HTTP envelope expected from the service
    if "data" not in response and "success" not in response:
        return "INVALID RESPONSE"

    if response.get("success") is False:
        return "ERROR"

    data = response.get("data")
    if not isinstance(data, dict):
        return "INVALID RESPONSE"
    if not data:
        return "NO DATA"
    return "PASS"


def extract_ocr_result(response: Any) -> dict[str, Any] | Any:
    if isinstance(response, dict) and isinstance(response.get("data"), dict):
        return response["data"]
    return response


def print_image_report(
    filename: str,
    http_status: int | None,
    status: str,
    response: Any,
) -> None:
    http_line = f"{http_status} OK" if http_status == 200 else (
        str(http_status) if http_status is not None else "N/A"
    )
    ocr_result = extract_ocr_result(response)
    try:
        ocr_text = json.dumps(ocr_result, indent=2, ensure_ascii=False)
    except Exception:  # noqa: BLE001
        ocr_text = repr(ocr_result)

    print("--------------------------------------------------")
    print("Image:")
    print(filename)
    print()
    print("HTTP:")
    print(http_line)
    print()
    print("OCR Result:")
    print(ocr_text)
    print()
    print("Status:")
    print(status)
    print("--------------------------------------------------")
    print()


def print_summary(counts: dict[str, int], total: int) -> None:
    passed = counts.get("PASS", 0)
    rate = (passed / total * 100.0) if total else 0.0
    print("=====================================")
    print("Total images:")
    print(total)
    print()
    print("PASS:")
    print(passed)
    print()
    print("NO DATA:")
    print(counts.get("NO DATA", 0))
    print()
    print("ERROR:")
    print(counts.get("ERROR", 0))
    print()
    print("INVALID RESPONSE:")
    print(counts.get("INVALID RESPONSE", 0))
    print()
    print("Success Rate:")
    print(f"{rate:.2f} %")
    print("=====================================")


def main() -> int:
    meter_type = (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_METER_TYPE).strip().lower()
    images = discover_images(IMAGES_DIR)

    print(f"Images dir: {IMAGES_DIR}")
    print(f"Endpoint:   {ENDPOINT}")
    print(f"Meter type: {meter_type}")
    print(f"Found:      {len(images)} image(s)")
    print()

    if not images:
        print(f"No images found under {IMAGES_DIR}")
        report = {
            "endpoint": ENDPOINT,
            "images_dir": str(IMAGES_DIR),
            "meter_type": meter_type,
            "total": 0,
            "PASS": 0,
            "NO DATA": 0,
            "ERROR": 0,
            "INVALID RESPONSE": 0,
            "success_rate_percent": 0.0,
            "results": [],
        }
        REPORT_PATH.write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {REPORT_PATH}")
        return 1

    results: list[dict[str, Any]] = []
    counts = {"PASS": 0, "NO DATA": 0, "ERROR": 0, "INVALID RESPONSE": 0}

    for image_path in images:
        entry: dict[str, Any] = {
            "filename": image_path.name,
            "status": "ERROR",
            "http_status": None,
            "response": None,
            "elapsed_ms": None,
        }
        t0 = time.perf_counter()
        try:
            http_status, response, err = post_read_meter(image_path, meter_type)
            entry["http_status"] = http_status

            if response is None:
                # Transport / HTTP failure → ERROR; HTTP 200 but bad body → INVALID RESPONSE
                if http_status == 200:
                    status = "INVALID RESPONSE"
                else:
                    status = "ERROR"
                entry["response"] = {"error": err} if err else None
            else:
                status = classify_result(http_status, response, err)
                entry["response"] = response

            entry["status"] = status
        except Exception as exc:  # noqa: BLE001 — never stop on exceptions
            entry["status"] = "ERROR"
            entry["response"] = {"error": f"{type(exc).__name__}: {exc}"}
        entry["elapsed_ms"] = round((time.perf_counter() - t0) * 1000.0, 1)

        counts[entry["status"]] = counts.get(entry["status"], 0) + 1
        results.append(entry)
        print_image_report(
            entry["filename"],
            entry["http_status"],
            entry["status"],
            entry["response"],
        )

    total = len(results)
    success_rate = (counts.get("PASS", 0) / total * 100.0) if total else 0.0
    report = {
        "endpoint": ENDPOINT,
        "images_dir": str(IMAGES_DIR),
        "meter_type": meter_type,
        "total": total,
        "PASS": counts.get("PASS", 0),
        "NO DATA": counts.get("NO DATA", 0),
        "ERROR": counts.get("ERROR", 0),
        "INVALID RESPONSE": counts.get("INVALID RESPONSE", 0),
        "success_rate_percent": round(success_rate, 2),
        "results": results,
    }
    try:
        REPORT_PATH.write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {REPORT_PATH}")
        print()
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to write report: {exc}")
        print()

    print_summary(counts, total)
    return 0 if counts.get("ERROR", 0) == 0 and counts.get("INVALID RESPONSE", 0) == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
