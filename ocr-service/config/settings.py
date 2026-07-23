"""
OCR Service configuration.

All runtime settings come from environment variables with safe defaults.
Optionally loads `ocr-service/.env` for local development (does not override
variables already set in the process environment).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Load KEY=VALUE pairs from a .env file into os.environ if not already set."""
    if not path.is_file():
        return
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ[key] = value


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    if value is None or str(value).strip() == "":
        return default
    return str(value).strip()


def _env_int(name: str, default: int) -> int:
    raw = _env(name, str(default))
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = _env(name, str(default))
    try:
        return float(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name, "1" if default else "0").lower()
    return raw in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    service_name: str = "ocr-service"
    version: str = "0.1.0"
    phase: str = "3.5"

    host: str = "0.0.0.0"
    port: int = 5055

    # 30s default was too tight for a real phone photo at full resolution on
    # Render free-tier CPU — a stuck/abandoned predict() also risked colliding
    # with the next queued request on the single persistent engine worker
    # thread (see OcrPipeline._engine_executor). 60s + the resize above gives
    # real predict() calls room to finish instead of hitting this ceiling.
    request_timeout_seconds: float = 60.0
    # Enough for browser data URLs (base64 ≈ 4/3 of decoded image) + JSON wrapper.
    # Decoded image cap remains image_max_bytes (20 MiB).
    max_body_bytes: int = 28_000_000

    # Engine selection: empty/mock → MockOcrEngine
    ocr_engine: str = "mock"

    log_dir: str = "logs"
    log_level: str = "INFO"

    # Image validation
    image_min_width: int = 32
    image_min_height: int = 32
    image_max_width: int = 8000
    image_max_height: int = 8000
    image_max_bytes: int = 20_000_000
    allow_virtual_images: bool = True

    # Optional preprocess steps.
    # Resize is on by default — real phone photos (3000x4000+) otherwise hit
    # PaddleOCR predict() at full resolution and can exceed request_timeout_seconds
    # on constrained CPU (Render free tier). Downscaling before predict() is the
    # single biggest lever on wall-clock time; det_limit_side_len (paddle_engine.py)
    # still caps detection internally, but recognition crops + image decode/preprocess
    # all benefit from a smaller source image too.
    preprocess_resize: bool = True
    preprocess_resize_max_side: int = 1280
    preprocess_rotate: bool = False
    preprocess_crop: bool = False
    preprocess_contrast: bool = False
    preprocess_threshold: bool = False
    preprocess_denoise: bool = False
    preprocess_normalize: bool = False


def load_settings() -> Settings:
    # Local overrides (gitignored). Existing process env wins (tests set OCR_ENGINE=mock).
    _load_dotenv(Path(__file__).resolve().parents[1] / ".env")

    engine_raw = _env("OCR_ENGINE", "mock").lower()
    if engine_raw in ("", "none", "null"):
        engine = "mock"
    else:
        engine = engine_raw

    return Settings(
        service_name=_env("OCR_SERVICE_NAME", "ocr-service"),
        version=_env("OCR_SERVICE_VERSION", "0.1.0"),
        phase=_env("OCR_SERVICE_PHASE", "3.5"),
        host=_env("OCR_HOST", "0.0.0.0"),
        port=_env_int("OCR_PORT", 5055),
        request_timeout_seconds=_env_float("OCR_REQUEST_TIMEOUT", 60.0),
        max_body_bytes=_env_int("OCR_MAX_BODY_BYTES", 28_000_000),
        ocr_engine=engine,
        log_dir=_env("OCR_LOG_DIR", "logs"),
        log_level=_env("OCR_LOG_LEVEL", "INFO").upper(),
        image_min_width=_env_int("OCR_IMAGE_MIN_WIDTH", 32),
        image_min_height=_env_int("OCR_IMAGE_MIN_HEIGHT", 32),
        image_max_width=_env_int("OCR_IMAGE_MAX_WIDTH", 8000),
        image_max_height=_env_int("OCR_IMAGE_MAX_HEIGHT", 8000),
        image_max_bytes=_env_int("OCR_IMAGE_MAX_BYTES", 20_000_000),
        allow_virtual_images=_env_bool("OCR_ALLOW_VIRTUAL_IMAGES", True),
        preprocess_resize=_env_bool("OCR_PREPROCESS_RESIZE", True),
        preprocess_resize_max_side=_env_int("OCR_PREPROCESS_RESIZE_MAX_SIDE", 1280),
        preprocess_rotate=_env_bool("OCR_PREPROCESS_ROTATE", False),
        preprocess_crop=_env_bool("OCR_PREPROCESS_CROP", False),
        preprocess_contrast=_env_bool("OCR_PREPROCESS_CONTRAST", False),
        preprocess_threshold=_env_bool("OCR_PREPROCESS_THRESHOLD", False),
        preprocess_denoise=_env_bool("OCR_PREPROCESS_DENOISE", False),
        preprocess_normalize=_env_bool("OCR_PREPROCESS_NORMALIZE", False),
    )


settings = load_settings()
