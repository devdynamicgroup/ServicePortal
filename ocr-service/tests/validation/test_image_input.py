"""Unit tests for data-URL image materialization."""

from __future__ import annotations

import base64
import os
import unittest

from core.exceptions import ValidationError
from validation.image_input import (
    cleanup_temp_image,
    is_data_url,
    materialize_image_url,
)

# Minimal 1x1 PNG
_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class ImageInputTests(unittest.TestCase):
    def test_filesystem_path_passthrough(self):
        path = r"D:\Service Portal\ocr\test_images\sample.jpg"
        normalized = materialize_image_url(path)
        self.assertEqual(normalized.path, path)
        self.assertIsNone(normalized.temp_path)

    def test_virtual_path_passthrough(self):
        normalized = materialize_image_url("__force_engine_error__")
        self.assertEqual(normalized.path, "__force_engine_error__")
        self.assertIsNone(normalized.temp_path)

    def test_data_url_writes_temp_and_cleans_up(self):
        data_url = "data:image/png;base64," + base64.b64encode(_PNG_BYTES).decode("ascii")
        self.assertTrue(is_data_url(data_url))

        normalized = materialize_image_url(data_url)
        self.assertIsNotNone(normalized.temp_path)
        self.assertEqual(normalized.path, normalized.temp_path)
        self.assertTrue(os.path.isfile(normalized.path))
        with open(normalized.path, "rb") as fh:
            self.assertEqual(fh.read(), _PNG_BYTES)

        cleanup_temp_image(normalized.temp_path)
        self.assertFalse(os.path.exists(normalized.temp_path))

    def test_invalid_data_url_raises(self):
        with self.assertRaises(ValidationError):
            materialize_image_url("data:image/png;base64,!!!not-base64!!!")

    def test_empty_data_url_raises(self):
        with self.assertRaises(ValidationError):
            materialize_image_url("data:image/jpeg;base64,")


if __name__ == "__main__":
    unittest.main()
