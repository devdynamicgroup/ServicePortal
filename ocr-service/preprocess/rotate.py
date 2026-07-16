"""Optional image rotate (EXIF / fixed degrees). No-op without Pillow."""

from __future__ import annotations

from pathlib import Path


def apply(image_path: str, *, degrees: float = 0.0, auto_exif: bool = True, **_kwargs) -> str:
    path = str(image_path)
    if not Path(path).is_file():
        return path
    try:
        from PIL import Image, ImageOps  # type: ignore
    except ImportError:
        return path

    with Image.open(path) as img:
        if auto_exif:
            img = ImageOps.exif_transpose(img)
        if degrees:
            img = img.rotate(float(degrees), expand=True)
        dest = str(Path(path).with_name(Path(path).stem + "_rotated" + Path(path).suffix))
        img.save(dest)
        return dest
