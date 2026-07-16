"""Optional denoise (median filter). No-op without Pillow."""

from __future__ import annotations

from pathlib import Path


def apply(image_path: str, *, size: int = 3, **_kwargs) -> str:
    path = str(image_path)
    if not Path(path).is_file():
        return path
    try:
        from PIL import Image, ImageFilter  # type: ignore
    except ImportError:
        return path

    with Image.open(path) as img:
        out = img.filter(ImageFilter.MedianFilter(size=max(3, int(size) | 1)))
        dest = str(Path(path).with_name(Path(path).stem + "_denoise" + Path(path).suffix))
        out.save(dest)
        return dest
