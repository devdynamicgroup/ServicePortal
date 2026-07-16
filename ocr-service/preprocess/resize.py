"""Optional image resize (no-op without Pillow or when disabled by caller)."""

from __future__ import annotations

from pathlib import Path


def apply(image_path: str, *, max_side: int = 1600, **_kwargs) -> str:
    path = str(image_path)
    if not Path(path).is_file():
        return path
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return path

    with Image.open(path) as img:
        w, h = img.size
        longest = max(w, h)
        if longest <= max_side:
            return path
        scale = max_side / float(longest)
        new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
        out = img.resize(new_size)
        dest = str(Path(path).with_name(Path(path).stem + "_resized" + Path(path).suffix))
        out.save(dest)
        return dest
