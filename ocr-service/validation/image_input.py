"""
Normalize OCR image_url inputs for the pipeline.

Supports:
  - Existing filesystem paths / virtual mock URLs (unchanged)
  - Browser data URLs (data:image/...;base64,...) → temporary file
"""

from __future__ import annotations

import base64
import binascii
import os
import re
import tempfile
from typing import NamedTuple

from core.exceptions import ValidationError
from core.logger import get_logger

logger = get_logger("validation.image_input")

_DATA_URL_RE = re.compile(
    r"^data:(image/[a-z0-9.+-]+);base64,(.+)$",
    re.IGNORECASE | re.DOTALL,
)

_MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/pjpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/x-ms-bmp": ".bmp",
}


class NormalizedImage(NamedTuple):
    """Path the OCR pipeline should open, plus optional temp file to delete."""

    path: str
    temp_path: str | None


def is_data_url(image_url: str) -> bool:
    value = str(image_url or "").strip()
    return value.lower().startswith("data:image/") and ";base64," in value.lower()


def _extension_for_mime(mime: str) -> str:
    key = str(mime or "").strip().lower()
    return _MIME_TO_EXT.get(key, ".bin")


def materialize_image_url(image_url: str) -> NormalizedImage:
    """
    Resolve image_url to a filesystem path the pipeline can open.

    Data URLs are decoded into a temporary file. Callers must delete
    ``temp_path`` when non-None (use ``cleanup_temp_image``).
    """
    raw = str(image_url or "").strip()
    if not raw:
        raise ValidationError("image_url is required")

    if not is_data_url(raw):
        return NormalizedImage(path=raw, temp_path=None)

    match = _DATA_URL_RE.match(raw)
    if not match:
        raise ValidationError("Invalid data URL image_url")

    mime = match.group(1)
    b64 = re.sub(r"\s+", "", match.group(2) or "")
    if not b64:
        raise ValidationError("Invalid data URL image_url")

    try:
        padded = b64 + ("=" * ((4 - len(b64) % 4) % 4))
        binary = base64.b64decode(padded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValidationError("Invalid data URL image_url") from exc

    if not binary:
        raise ValidationError("Invalid data URL image_url")

    suffix = _extension_for_mime(mime)
    fd, temp_path = tempfile.mkstemp(prefix="ocr_upload_", suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(binary)
    except OSError as exc:
        cleanup_temp_image(temp_path)
        raise ValidationError("Unable to materialize image_url") from exc

    logger.info(
        "materialized data URL image_url bytes=%s temp=%s mime=%s",
        len(binary),
        temp_path,
        mime.lower(),
    )
    return NormalizedImage(path=temp_path, temp_path=temp_path)


def cleanup_temp_image(temp_path: str | None) -> None:
    """Best-effort delete of a temporary image created by materialize_image_url."""
    if not temp_path:
        return
    try:
        os.remove(temp_path)
    except FileNotFoundError:
        return
    except OSError as exc:
        logger.warning("failed to delete temp image path=%s error=%s", temp_path, exc)
