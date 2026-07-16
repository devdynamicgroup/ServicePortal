"""Optional contrast enhancement. No-op without Pillow."""

from __future__ import annotations

from pathlib import Path


def apply(image_path: str, *, factor: float = 1.4, **_kwargs) -> str:
    path = str(image_path)
    if not Path(path).is_file():
        return path
    try:
        from PIL import Image, ImageEnhance  # type: ignore
    except ImportError:
        return path

    with Image.open(path) as img:
        out = ImageEnhance.Contrast(img).enhance(float(factor))
        dest = str(Path(path).with_name(Path(path).stem + "_contrast" + Path(path).suffix))
        out.save(dest)
        return dest
