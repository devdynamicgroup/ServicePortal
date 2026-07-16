"""Preprocess helpers — optional, configuration-driven stages."""

from __future__ import annotations

from typing import Any, Callable

from preprocess import contrast, crop, denoise, normalize, resize, rotate, threshold


def run_preprocess_chain(
    image_path: str,
    *,
    flags: dict[str, bool],
    options: dict[str, Any] | None = None,
) -> tuple[str, list[str]]:
    """
    Run enabled preprocess steps in fixed order.
    Returns (output_path, history).
    """
    opts = options or {}
    history: list[str] = []
    current = image_path

    steps: list[tuple[str, Callable[..., str]]] = [
        ("resize", resize.apply),
        ("rotate", rotate.apply),
        ("crop", crop.apply),
        ("contrast", contrast.apply),
        ("threshold", threshold.apply),
        ("denoise", denoise.apply),
        ("normalize", normalize.apply),
    ]

    for name, fn in steps:
        if not flags.get(name, False):
            continue
        step_opts = opts.get(name) or {}
        current = fn(current, **step_opts)
        history.append(name)

    return current, history
