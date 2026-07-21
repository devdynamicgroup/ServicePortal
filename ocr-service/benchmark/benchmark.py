"""
Phase 6B — Dataset OCR benchmark runner.

Input:  datasets/meters/   (+ expected labels in datasets/labels/)
Output: benchmark/report.json
        benchmark/report.md

Uses the existing OCR pipeline as-is. Does not modify API or pipeline.

Label formats supported:
  1) datasets/labels/<image_stem>.json
     {"meter_type":"tds","expected":{"tds":280}}
  2) datasets/labels/manifest.json
     {"sample_001.png":{"meter_type":"tds","expected":{"tds":280}}}

Usage (from ocr-service/):
  .\.venv\Scripts\python.exe -m benchmark.benchmark
  .\.venv\Scripts\python.exe -m benchmark.benchmark --engine mock
  .\.venv\Scripts\python.exe -m benchmark.benchmark --seed-demo
"""

from __future__ import annotations

import argparse
import json
import statistics
import struct
import time
import uuid
import zlib
from pathlib import Path
from typing import Any

from config.settings import load_settings
from engines.factory import get_engine
from processing.pipeline import OcrPipeline
from validation.image_validator import ImageValidator

ROOT = Path(__file__).resolve().parents[1]
METERS_DIR = ROOT / "datasets" / "meters"
LABELS_DIR = ROOT / "datasets" / "labels"
REPORT_JSON = Path(__file__).resolve().parent / "report.json"
REPORT_MD = Path(__file__).resolve().parent / "report.md"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif", ".tif", ".tiff"}

PRIMARY_KEY = {
    "tds": "tds",
    "ph": "ph",
    "ec": "ec",
    "orp": "orp",
    "do": "do_percent",
}


def _tolerance_for(key: str) -> float:
    if key in {"ph"}:
        return 0.05
    if key in {"do_percent"}:
        return 0.5
    if key in {"orp", "mv"}:
        return 2.0
    return 1.0


def _values_match(expected: Any, actual: Any, *, key: str) -> bool:
    if expected is None or actual is None:
        return False
    try:
        exp_f = float(expected)
        act_f = float(actual)
    except (TypeError, ValueError):
        return str(expected).strip() == str(actual).strip()
    return abs(exp_f - act_f) <= _tolerance_for(key)


def _accuracy(expected: dict[str, Any], actual: dict[str, Any]) -> float:
    if not expected:
        return 0.0
    hits = 0
    for key, exp in expected.items():
        if _values_match(exp, actual.get(key), key=key):
            hits += 1
    return round(hits / len(expected), 4)


def _load_manifest() -> dict[str, Any]:
    path = LABELS_DIR / "manifest.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _load_label(image_name: str, manifest: dict[str, Any]) -> dict[str, Any] | None:
    if image_name in manifest:
        entry = manifest[image_name]
        if isinstance(entry, dict):
            return entry

    stem = Path(image_name).stem
    for candidate in (LABELS_DIR / f"{stem}.json", LABELS_DIR / f"{image_name}.json"):
        if candidate.is_file():
            try:
                data = json.loads(candidate.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return None
            return data if isinstance(data, dict) else None
    return None


def _list_images() -> list[Path]:
    if not METERS_DIR.is_dir():
        return []
    images = [
        p
        for p in sorted(METERS_DIR.iterdir())
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS and not p.name.startswith(".")
    ]
    return images


def _write_minimal_png(path: Path, *, width: int = 64, height: int = 64) -> None:
    raw = b"".join(b"\x00" + (b"\x20\x20\x20" * width) for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def seed_demo_dataset() -> list[Path]:
    """Create non-production demo images + labels for a local dry-run."""
    METERS_DIR.mkdir(parents=True, exist_ok=True)
    LABELS_DIR.mkdir(parents=True, exist_ok=True)

    samples = [
        ("demo_tds_001.png", "tds", {"tds": 280, "ec": 400, "temperature": 28}),
        ("demo_ph_001.png", "ph", {"ph": 7.29, "mv": -15.0}),
    ]
    paths: list[Path] = []
    manifest: dict[str, Any] = {}
    for name, meter_type, expected in samples:
        img = METERS_DIR / name
        _write_minimal_png(img)
        label = {"meter_type": meter_type, "expected": expected}
        (LABELS_DIR / f"{Path(name).stem}.json").write_text(
            json.dumps(label, indent=2) + "\n",
            encoding="utf-8",
        )
        manifest[name] = label
        paths.append(img)

    (LABELS_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return paths


def run_dataset_benchmark(*, engine_name: str | None = None) -> dict[str, Any]:
    settings = load_settings()
    engine = get_engine(engine_name or settings.ocr_engine)
    pipeline = OcrPipeline(
        engine,
        settings=settings,
        image_validator=ImageValidator(
            min_width=settings.image_min_width,
            min_height=settings.image_min_height,
            max_width=settings.image_max_width,
            max_height=settings.image_max_height,
            max_bytes=settings.image_max_bytes,
            allow_virtual=False,
        ),
    )

    manifest = _load_manifest()
    images = _list_images()
    results: list[dict[str, Any]] = []

    for image_path in images:
        label = _load_label(image_path.name, manifest)
        meter_type = str((label or {}).get("meter_type") or "tds").lower()
        expected = dict((label or {}).get("expected") or {})
        primary = PRIMARY_KEY.get(meter_type, meter_type)

        row: dict[str, Any] = {
            "image": image_path.name,
            "path": str(image_path),
            "meter_type": meter_type,
            "expected_value": expected.get(primary, expected),
            "expected": expected,
            "ocr_value": None,
            "ocr_data": {},
            "accuracy": 0.0,
            "confidence": 0.0,
            "processing_time_ms": 0.0,
            "engine": engine.name,
            "success": False,
            "error": None,
            "ocr_text": [],
        }

        if label is None:
            row["error"] = "missing_label"
            results.append(row)
            continue

        if not engine.is_available():
            row["error"] = "engine_unavailable"
            results.append(row)
            continue

        started = time.perf_counter()
        try:
            ctx = pipeline.run(
                request_id=uuid.uuid4().hex,
                meter_type=meter_type,
                image_path=str(image_path),
            )
            elapsed = round((time.perf_counter() - started) * 1000.0, 3)
            data = dict(ctx.parsed_data or {})
            accuracy = _accuracy(expected, data)
            row.update(
                {
                    "ocr_value": data.get(primary, data),
                    "ocr_data": data,
                    "accuracy": accuracy,
                    "confidence": float(ctx.confidence),
                    "processing_time_ms": elapsed,
                    "engine": ctx.engine,
                    "success": True,
                    "ocr_text": list(ctx.texts or []),
                    "stage_timings": dict(ctx.timings),
                }
            )
        except Exception as exc:  # noqa: BLE001 — benchmark must continue
            row["processing_time_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
            row["error"] = str(exc)
            row["success"] = False

        results.append(row)

    return _build_report(results, engine_name=engine.name)


def _build_report(results: list[dict[str, Any]], *, engine_name: str) -> dict[str, Any]:
    total = len(results)
    scored = [r for r in results if r.get("error") != "missing_label"]
    successes = [r for r in results if r.get("success")]
    failures = [r for r in results if not r.get("success")]

    accuracies = [float(r["accuracy"]) for r in successes]
    latencies = [float(r["processing_time_ms"]) for r in results if r.get("processing_time_ms") is not None]

    avg_accuracy = round(statistics.mean(accuracies), 4) if accuracies else 0.0
    avg_latency = round(statistics.mean(latencies), 3) if latencies else 0.0
    failure_rate = round(len(failures) / total, 4) if total else 0.0

    # Rank by accuracy then confidence (best = high accuracy; worst = low)
    ranked = sorted(
        successes,
        key=lambda r: (float(r["accuracy"]), float(r["confidence"])),
    )
    worst = ranked[:5]  # lowest accuracy first
    best = list(reversed(ranked[-5:])) if ranked else []

    worst_images = [
        {
            "image": r["image"],
            "accuracy": r["accuracy"],
            "confidence": r["confidence"],
            "processing_time_ms": r["processing_time_ms"],
            "expected_value": r["expected_value"],
            "ocr_value": r["ocr_value"],
            "error": r.get("error"),
        }
        for r in worst
    ]
    # Include hard failures in worst list
    for r in failures:
        worst_images.append(
            {
                "image": r["image"],
                "accuracy": r["accuracy"],
                "confidence": r["confidence"],
                "processing_time_ms": r["processing_time_ms"],
                "expected_value": r["expected_value"],
                "ocr_value": r["ocr_value"],
                "error": r.get("error"),
            }
        )
    worst_images = worst_images[:5]

    best_images = [
        {
            "image": r["image"],
            "accuracy": r["accuracy"],
            "confidence": r["confidence"],
            "processing_time_ms": r["processing_time_ms"],
            "expected_value": r["expected_value"],
            "ocr_value": r["ocr_value"],
        }
        for r in best
    ]

    return {
        "engine": engine_name,
        "dataset": str(METERS_DIR.as_posix()),
        "total_images": total,
        "labeled_images": len(scored),
        "summary": {
            "average_accuracy": avg_accuracy,
            "average_latency_ms": avg_latency,
            "failure_rate": failure_rate,
            "success_count": len(successes),
            "failure_count": len(failures),
        },
        "worst_images": worst_images,
        "best_images": best_images,
        "results": results,
    }


def write_reports(report: dict[str, Any]) -> None:
    REPORT_JSON.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    REPORT_MD.write_text(_to_markdown(report), encoding="utf-8")


def _to_markdown(report: dict[str, Any]) -> str:
    summary = report.get("summary") or {}
    lines = [
        "# OCR Benchmark Report",
        "",
        f"- Engine: `{report.get('engine')}`",
        f"- Dataset: `{report.get('dataset')}`",
        f"- Total images: **{report.get('total_images', 0)}**",
        f"- Labeled images: **{report.get('labeled_images', 0)}**",
        "",
        "## Summary",
        "",
        f"- Average accuracy: **{summary.get('average_accuracy', 0)}**",
        f"- Average latency: **{summary.get('average_latency_ms', 0)} ms**",
        f"- Failure rate: **{summary.get('failure_rate', 0)}**",
        f"- Successes: {summary.get('success_count', 0)}",
        f"- Failures: {summary.get('failure_count', 0)}",
        "",
        "## Worst images",
        "",
    ]
    worst = report.get("worst_images") or []
    if not worst:
        lines.append("_None_")
    else:
        lines.append("| Image | Accuracy | Confidence | Latency ms | Expected | OCR | Error |")
        lines.append("|---|---:|---:|---:|---|---|---|")
        for row in worst:
            lines.append(
                "| {image} | {accuracy} | {confidence} | {latency} | {expected} | {ocr} | {error} |".format(
                    image=row.get("image"),
                    accuracy=row.get("accuracy"),
                    confidence=row.get("confidence"),
                    latency=row.get("processing_time_ms"),
                    expected=json.dumps(row.get("expected_value"), ensure_ascii=False),
                    ocr=json.dumps(row.get("ocr_value"), ensure_ascii=False),
                    error=row.get("error") or "",
                )
            )

    lines.extend(["", "## Best images", ""])
    best = report.get("best_images") or []
    if not best:
        lines.append("_None_")
    else:
        lines.append("| Image | Accuracy | Confidence | Latency ms | Expected | OCR |")
        lines.append("|---|---:|---:|---:|---|---|")
        for row in best:
            lines.append(
                "| {image} | {accuracy} | {confidence} | {latency} | {expected} | {ocr} |".format(
                    image=row.get("image"),
                    accuracy=row.get("accuracy"),
                    confidence=row.get("confidence"),
                    latency=row.get("processing_time_ms"),
                    expected=json.dumps(row.get("expected_value"), ensure_ascii=False),
                    ocr=json.dumps(row.get("ocr_value"), ensure_ascii=False),
                )
            )

    lines.extend(["", "## Per-image results", ""])
    lines.append("| Image | Meter | Expected | OCR | Accuracy | Confidence | Latency ms | OK |")
    lines.append("|---|---|---|---|---:|---:|---:|:---:|")
    for row in report.get("results") or []:
        lines.append(
            "| {image} | {meter} | {expected} | {ocr} | {accuracy} | {confidence} | {latency} | {ok} |".format(
                image=row.get("image"),
                meter=row.get("meter_type"),
                expected=json.dumps(row.get("expected_value"), ensure_ascii=False),
                ocr=json.dumps(row.get("ocr_value"), ensure_ascii=False),
                accuracy=row.get("accuracy"),
                confidence=row.get("confidence"),
                latency=row.get("processing_time_ms"),
                ok="yes" if row.get("success") else "no",
            )
        )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 6B dataset OCR benchmark")
    parser.add_argument("--engine", default=None, help="Engine id (mock|paddle|easyocr)")
    parser.add_argument(
        "--seed-demo",
        action="store_true",
        help="Create non-production demo images/labels under datasets/",
    )
    args = parser.parse_args()

    if args.seed_demo or not _list_images():
        if args.seed_demo:
            seed_demo_dataset()
        elif not _list_images():
            print("No images in datasets/meters/ — seeding demo fixtures.")
            seed_demo_dataset()

    report = run_dataset_benchmark(engine_name=args.engine)
    write_reports(report)
    print(json.dumps(report["summary"], indent=2))
    print(f"Wrote {REPORT_JSON}")
    print(f"Wrote {REPORT_MD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
