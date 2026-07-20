"""
One-off validation: run all ocr/test_images through Paddle OCR pipeline.
Does not modify production code. Writes JSON report to diagnostics/.
"""

from __future__ import annotations

import json
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OCR_SERVICE = ROOT / "ocr-service"
sys.path.insert(0, str(OCR_SERVICE))

from config.settings import load_settings  # noqa: E402
from engines.factory import get_engine  # noqa: E402
from parser.spatial_parser import SpatialMeasurementParser, has_spatial_detections  # noqa: E402
from processing.pipeline import OcrPipeline  # noqa: E402

IMAGES_DIR = ROOT / "ocr" / "test_images"
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
OUT = ROOT / "diagnostics" / "test_images_paddle_report.json"


def main() -> int:
    settings = load_settings()
    print(f"settings.ocr_engine={settings.ocr_engine}")
    engine = get_engine("paddle")
    print(f"engine.name={engine.name} available={engine.is_available()}")
    if engine.name != "paddle" or not engine.is_available():
        print("FAIL: paddle engine not available")
        return 1

    pipeline = OcrPipeline(engine, settings=settings)
    spatial = SpatialMeasurementParser()

    images = sorted(
        p for p in IMAGES_DIR.iterdir() if p.is_file() and p.suffix.lower() in EXTS
    )
    results = []

    for img in images:
        row: dict = {
            "filename": img.name,
            "path": str(img),
            "image_loaded": False,
            "ocr_texts": [],
            "ocr_scores": [],
            "bounding_boxes": [],
            "detections_count": 0,
            "spatial": None,
            "measurement_payload": None,
            "api_style_data": None,
            "confidence": None,
            "validation_issues": [],
            "timings_ms": {},
            "errors": [],
            "status": "fail",
        }
        t0 = time.perf_counter()
        try:
            if not img.is_file() or img.stat().st_size <= 0:
                row["errors"].append("image_load_error")
                results.append(row)
                continue
            row["image_loaded"] = True

            ctx = pipeline.run(
                request_id=uuid.uuid4().hex,
                meter_type="ph",
                image_path=str(img),
            )
            row["timings_ms"] = dict(ctx.timings)
            row["confidence"] = ctx.confidence
            row["api_style_data"] = dict(ctx.parsed_data or {})
            row["validation_issues"] = list(ctx.validation_issues or [])
            row["ocr_texts"] = list(ctx.texts or [])

            extraction = dict(ctx.raw_extraction or {})
            detections = extraction.get("detections") or []
            row["detections_count"] = len(detections)
            row["ocr_scores"] = [d.get("score") for d in detections if isinstance(d, dict)]
            row["bounding_boxes"] = [d.get("box") for d in detections if isinstance(d, dict)]

            if has_spatial_detections(extraction):
                payload = spatial.parse_detections(detections, meter_type="ph")
                row["spatial"] = {
                    "ok": payload.ok,
                    "profile": payload.profile,
                    "data": payload.data,
                    "confidence": payload.confidence,
                    "auto_fill": payload.auto_fill,
                    "fields": payload.fields,
                    "issues": payload.issues,
                    "rows": payload.rows,
                    "corrections": payload.corrections,
                }
                row["measurement_payload"] = {
                    "ok": payload.ok,
                    "data": payload.data,
                    "confidence": payload.confidence,
                    "auto_fill": payload.auto_fill,
                    "issues": payload.issues,
                }
            else:
                row["errors"].append("no_spatial_detections")
                row["measurement_payload"] = {
                    "ok": False,
                    "data": dict(ctx.parsed_data or {}),
                    "confidence": ctx.confidence,
                    "issues": ["no_spatial_detections"],
                }

            if row["api_style_data"] and not row["errors"]:
                row["status"] = "ok"
            elif row["api_style_data"]:
                row["status"] = "partial"
            else:
                row["status"] = "fail"
                row["errors"].append("empty_measurement_data")

        except Exception as exc:  # noqa: BLE001
            row["errors"].append(f"{type(exc).__name__}: {exc}")
            row["status"] = "fail"
        row["elapsed_s"] = round(time.perf_counter() - t0, 3)
        results.append(row)
        print(
            f"[{row['status']}] {row['filename']} "
            f"data={row.get('api_style_data')} conf={row.get('confidence')} "
            f"errs={row.get('errors')} t={row['elapsed_s']}s"
        )

    report = {
        "engine": engine.name,
        "images_dir": str(IMAGES_DIR),
        "total": len(results),
        "ok": sum(1 for r in results if r["status"] == "ok"),
        "partial": sum(1 for r in results if r["status"] == "partial"),
        "fail": sum(1 for r in results if r["status"] == "fail"),
        "results": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}")
    print(json.dumps({k: report[k] for k in ("total", "ok", "partial", "fail")}, indent=2))
    return 0 if report["fail"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
