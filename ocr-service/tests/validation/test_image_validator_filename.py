"""Image validator must accept arbitrary filenames; format from content only."""

from __future__ import annotations

import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from core.exceptions import ValidationError
from validation.image_validator import ImageValidator


def _minimal_png(width: int = 64, height: int = 64) -> bytes:
    raw = b"".join(b"\x00" + (b"\x20\x20\x20" * width) for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


class TestImageValidatorFilenameIndependent(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = ImageValidator(allow_virtual=False)
        self.png = _minimal_png()

    def _write(self, directory: Path, name: str) -> Path:
        path = directory / name
        path.write_bytes(self.png)
        return path

    def test_arbitrary_camera_filenames_accepted(self) -> None:
        names = [
            "IMG_20260720_083245.jpg",
            "DSC00182.JPG",
            "2026-07-18.png",
            "A8F1C2B9-4D1E.jpeg",
            "scan.bin",  # wrong extension — content is PNG
            "meter_photo",  # no extension
            "photo.TXT",
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in names:
                path = self._write(root, name)
                result = self.validator.validate(str(path))
                self.assertTrue(result.ok, name)
                self.assertEqual(result.format, "png", name)
                self.assertFalse(result.skipped, name)

    def test_filename_does_not_infer_meter_or_reject_valid_content(self) -> None:
        # Names that look like meter types / device IDs must not affect validation.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ("ph.jpg", "tds_reading.png", "HANNA_HI98194.JPG"):
                path = self._write(root, name)
                result = self.validator.validate(str(path))
                self.assertTrue(result.ok, name)
                self.assertEqual(result.format, "png", name)

    def test_non_image_content_rejected_regardless_of_extension(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "looks_like_image.jpg"
            path.write_bytes(b"not an image at all")
            with self.assertRaises(ValidationError):
                self.validator.validate(str(path))


if __name__ == "__main__":
    unittest.main()
