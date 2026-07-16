"""Legacy enhance stub — prefer contrast/denoise/normalize modules."""

from __future__ import annotations

from preprocess import contrast


def apply(image_path: str, **kwargs) -> str:
    return contrast.apply(image_path, **kwargs)
