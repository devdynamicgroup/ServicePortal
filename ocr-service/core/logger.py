"""
Central logging for OCR Service.

All modules should use get_logger(__name__) instead of print().
"""

from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

_CONFIGURED = False


def _ensure_configured() -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return

    # Late import to avoid circular dependency at package load
    from config.settings import settings

    log_dir = Path(settings.log_dir)
    if not log_dir.is_absolute():
        # Resolve relative to ocr-service root (parent of config/)
        service_root = Path(__file__).resolve().parent.parent
        log_dir = service_root / log_dir
    os.makedirs(log_dir, exist_ok=True)

    level = getattr(logging, settings.log_level, logging.INFO)
    root = logging.getLogger("ocr-service")
    root.setLevel(level)
    root.handlers.clear()

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    console = logging.StreamHandler()
    console.setLevel(level)
    console.setFormatter(formatter)
    root.addHandler(console)

    for filename in ("ocr-success.log", "ocr-error.log", "ocr-service.log"):
        handler = RotatingFileHandler(
            log_dir / filename,
            maxBytes=2_000_000,
            backupCount=3,
            encoding="utf-8",
        )
        handler.setLevel(level)
        handler.setFormatter(formatter)
        # success/error files filter by level via dedicated loggers later
        if filename == "ocr-success.log":
            handler.addFilter(lambda record: record.levelno == logging.INFO and "success" in record.getMessage().lower())
        elif filename == "ocr-error.log":
            handler.setLevel(logging.WARNING)
        root.addHandler(handler)

    _CONFIGURED = True


def get_logger(name: str | None = None) -> logging.Logger:
    _ensure_configured()
    if name:
        return logging.getLogger(f"ocr-service.{name}")
    return logging.getLogger("ocr-service")
