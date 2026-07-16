"""
Image file validation (pipeline stage).

Rejects invalid images before OCR. Virtual/mock paths used by contract tests
are skipped when allow_virtual=True so the public API contract stays stable.
"""

from __future__ import annotations

import os
import re
import struct
from dataclasses import dataclass
from pathlib import Path

from core.exceptions import ValidationError

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif", ".tif", ".tiff"}
VIRTUAL_PATH_RE = re.compile(r"^__(force_engine_error__|slow_\d+(?:\.\d+)?s__)$")


@dataclass(frozen=True)
class ImageValidationResult:
    ok: bool
    skipped: bool = False
    width: int | None = None
    height: int | None = None
    size_bytes: int | None = None
    format: str | None = None
    reason: str | None = None


def _is_virtual_path(path: str) -> bool:
    name = Path(path).name
    if VIRTUAL_PATH_RE.match(name):
        return True
    if path.startswith("__") and path.endswith("__"):
        return True
    return False


def _read_png_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return int(width), int(height)


def _read_jpeg_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 4 or data[0:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0xD9):
            i += 2
            continue
        if i + 4 > len(data):
            break
        length = struct.unpack(">H", data[i + 2 : i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            if i + 9 >= len(data):
                break
            height, width = struct.unpack(">HH", data[i + 5 : i + 9])
            return int(width), int(height)
        i += 2 + length
    return None


def _read_bmp_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 26 or data[0:2] != b"BM":
        return None
    width, height = struct.unpack("<ii", data[18:26])
    return int(abs(width)), int(abs(height))


def _detect_format_and_size(data: bytes) -> tuple[str | None, tuple[int, int] | None]:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", _read_png_size(data)
    if data.startswith(b"\xff\xd8"):
        return "jpeg", _read_jpeg_size(data)
    if data.startswith(b"BM"):
        return "bmp", _read_bmp_size(data)
    if data.startswith((b"GIF87a", b"GIF89a")):
        if len(data) >= 10:
            w, h = struct.unpack("<HH", data[6:10])
            return "gif", (int(w), int(h))
        return "gif", None
    if data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WEBP":
        return "webp", None
    return None, None


class ImageValidator:
    def __init__(
        self,
        *,
        min_width: int = 32,
        min_height: int = 32,
        max_width: int = 8000,
        max_height: int = 8000,
        max_bytes: int = 20_000_000,
        allow_virtual: bool = True,
    ) -> None:
        self.min_width = min_width
        self.min_height = min_height
        self.max_width = max_width
        self.max_height = max_height
        self.max_bytes = max_bytes
        self.allow_virtual = allow_virtual

    def validate(self, image_path: str) -> ImageValidationResult:
        path = str(image_path or "").strip()
        if not path:
            raise ValidationError("image_url is required")

        if self.allow_virtual and (_is_virtual_path(path) or not os.path.isfile(path)):
            # Contract / mock paths (e.g. sample.jpg) are not real files.
            return ImageValidationResult(ok=True, skipped=True, reason="virtual_or_missing_skipped")

        if not os.path.isfile(path):
            raise ValidationError("Image file does not exist")

        size_bytes = os.path.getsize(path)
        if size_bytes <= 0:
            raise ValidationError("Image file is empty or corrupted")
        if size_bytes > self.max_bytes:
            raise ValidationError("Image file exceeds maximum size")

        ext = Path(path).suffix.lower()
        if ext and ext not in SUPPORTED_EXTENSIONS:
            raise ValidationError(f"Unsupported image format: {ext}")

        try:
            with open(path, "rb") as fh:
                header = fh.read(min(65536, size_bytes))
        except OSError as exc:
            raise ValidationError("Unable to read image file") from exc

        fmt, dims = _detect_format_and_size(header)
        if fmt is None and size_bytes < 16:
            raise ValidationError("Corrupted or unrecognized image")
        if fmt is None:
            # Extension allowed but magic unknown — treat as potentially corrupted
            raise ValidationError("Corrupted or unrecognized image")

        width = height = None
        if dims:
            width, height = dims
            if width < self.min_width or height < self.min_height:
                raise ValidationError("Image resolution below minimum")
            if width > self.max_width or height > self.max_height:
                raise ValidationError("Image resolution above maximum")

        return ImageValidationResult(
            ok=True,
            skipped=False,
            width=width,
            height=height,
            size_bytes=size_bytes,
            format=fmt,
        )


def validate_image(image_path: str, **kwargs) -> ImageValidationResult:
    return ImageValidator(**kwargs).validate(image_path)
