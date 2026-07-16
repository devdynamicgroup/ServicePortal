"""Optional pixel normalize (autocontrast). No-op without Pillow."""

from __future__ import annotations

from pathlib import Path


def apply(image_path: str, **_kwargs) -> str:
    path = str(image_path)
    if not Path(path).is_file():
        return path
    try:
        from PIL import Image, ImageOps  # type: ignore
    except ImportError:
        return path

    with Image.open(path) as img:
        out = ImageOps.autocontrast(img.convert("RGB"))
        dest = str(Path(path).with_name(Path(path).stem + "_normalize" + Path(path).suffix))
        out.save(dest)
        return dest
