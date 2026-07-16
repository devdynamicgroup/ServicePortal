"""Optional binary threshold. No-op without Pillow."""

from __future__ import annotations

from pathlib import Path


def apply(image_path: str, *, cutoff: int = 140, **_kwargs) -> str:
    path = str(image_path)
    if not Path(path).is_file():
        return path
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return path

    with Image.open(path) as img:
        gray = img.convert("L")
        out = gray.point(lambda p: 255 if p > int(cutoff) else 0, mode="1")
        dest = str(Path(path).with_name(Path(path).stem + "_threshold" + Path(path).suffix))
        out.convert("L").save(dest)
        return dest
