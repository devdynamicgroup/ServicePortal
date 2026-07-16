"""Optional center crop. No-op without Pillow."""

from __future__ import annotations

from pathlib import Path


def apply(
    image_path: str,
    *,
    left: float = 0.0,
    top: float = 0.0,
    right: float = 1.0,
    bottom: float = 1.0,
    **_kwargs,
) -> str:
    path = str(image_path)
    if not Path(path).is_file():
        return path
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return path

    with Image.open(path) as img:
        w, h = img.size
        box = (
            int(max(0.0, min(1.0, left)) * w),
            int(max(0.0, min(1.0, top)) * h),
            int(max(0.0, min(1.0, right)) * w),
            int(max(0.0, min(1.0, bottom)) * h),
        )
        if box[2] <= box[0] or box[3] <= box[1]:
            return path
        cropped = img.crop(box)
        dest = str(Path(path).with_name(Path(path).stem + "_cropped" + Path(path).suffix))
        cropped.save(dest)
        return dest
