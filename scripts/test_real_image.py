"""
Phase 6A — Real OCR validation against the existing pipeline.

Usage (from repo root):
  python scripts/test_real_image.py path/to/meter.jpg
  python scripts/test_real_image.py path/to/meter.jpg --meter-type tds
  python scripts/test_real_image.py path/to/meter.jpg --engine paddle

Uses ocr-service processing pipeline only. No HTTP / frontend / API changes.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OCR_SERVICE_ROOT = REPO_ROOT / "ocr-service"

if str(OCR_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(OCR_SERVICE_ROOT))

from config.settings import load_settings  # noqa: E402
from engines.factory import get_engine  # noqa: E402
from processing.pipeline import OcrPipeline  # noqa: E402
from validation.image_validator import ImageValidator  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a real image through the OCR pipeline")
    parser.add_argument("image_path", help="Path to a local meter image")
    parser.add_argument(
        "--meter-type",
        default="tds",
        choices=("tds", "ph", "ec", "orp", "do"),
        help="Meter type (default: tds)",
    )
    parser.add_argument(
        "--engine",
        default=None,
        help="Engine override (mock|paddle|easyocr). Default: OCR_ENGINE env / settings",
    )
    args = parser.parse_args()

    image_path = Path(args.image_path).expanduser().resolve()
    if not image_path.is_file():
        print(f"ERROR: image not found: {image_path}", file=sys.stderr)
        return 1

    settings = load_settings()
    engine_name = (args.engine or settings.ocr_engine or "mock").strip().lower()
    engine = get_engine(engine_name)

    # Real-file mode: do not skip missing/virtual paths
    image_validator = ImageValidator(
        min_width=settings.image_min_width,
        min_height=settings.image_min_height,
        max_width=settings.image_max_width,
        max_height=settings.image_max_height,
        max_bytes=settings.image_max_bytes,
        allow_virtual=False,
    )
    pipeline = OcrPipeline(engine, settings=settings, image_validator=image_validator)

    if not engine.is_available():
        print(f"ERROR: engine '{engine.name}' is not available", file=sys.stderr)
        return 2

    request_id = uuid.uuid4().hex
    started = time.perf_counter()
    ctx = pipeline.run(
        request_id=request_id,
        meter_type=args.meter_type,
        image_path=str(image_path),
    )
    total_ms = round((time.perf_counter() - started) * 1000.0, 3)

    print("---------------------")
    print("Real OCR Validation")
    print("---------------------")
    print(f"image:       {image_path}")
    print(f"meter_type:  {args.meter_type}")
    print(f"engine:      {ctx.engine}")
    print(f"request_id:  {request_id}")
    print()
    print("OCR text:")
    if ctx.texts:
        for line in ctx.texts:
            print(f"  - {line}")
    else:
        print("  (none)")
    print()
    print("Parsed values:")
    print(json.dumps(ctx.parsed_data, indent=2, ensure_ascii=False))
    print()
    print(f"confidence:       {ctx.confidence}")
    print(f"processing_time:  {total_ms} ms")
    print(f"stage_timings:    {json.dumps(ctx.timings, ensure_ascii=False)}")
    if ctx.corrections:
        print(f"corrections:      {json.dumps(ctx.corrections, ensure_ascii=False)}")
    if ctx.validation_issues:
        print(f"validation:       {json.dumps(ctx.validation_issues, ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
