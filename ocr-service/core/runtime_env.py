"""
OCR service runtime environment diagnostics and guards.

Infrastructure only — no OCR / parser / pipeline logic.
"""

from __future__ import annotations

import os
import sys

from core.logger import get_logger

logger = get_logger("runtime")

DEFAULT_PADDLE_CACHE_HOME = r"C:\paddlex_cache"

SUPPORTED_PYTHON_MINOR = 12
SUPPORTED_PADDLE_PREFIX = "3.2."


class UnsupportedRuntimeError(RuntimeError):
    """Raised when the interpreter or Paddle version is not validated."""


def enforce_supported_runtime() -> None:
    """Abort startup if the Python or Paddle version is unsupported."""
    py_ver = sys.version.split()[0]
    major, minor = sys.version_info[:2]

    if major != 3 or minor != SUPPORTED_PYTHON_MINOR:
        msg = (
            f"[FATAL] Unsupported Python {py_ver}. "
            f"OCR service requires Python 3.{SUPPORTED_PYTHON_MINOR}.x.\n"
            f"Current interpreter: {sys.executable}\n"
            f"Use: ocr-service\\.venv\\Scripts\\python.exe main.py  (or .\\run.ps1)"
        )
        logger.error(msg)
        raise UnsupportedRuntimeError(msg)

    try:
        import paddle  # noqa: E402 — runtime guard, not business logic
        paddle_ver = str(getattr(paddle, "__version__", ""))
        if not paddle_ver.startswith(SUPPORTED_PADDLE_PREFIX):
            msg = (
                f"[FATAL] Unsupported paddlepaddle {paddle_ver}. "
                f"OCR service requires paddle {SUPPORTED_PADDLE_PREFIX}x.\n"
                f"Current interpreter: {sys.executable}\n"
                f"Use: ocr-service\\.venv\\Scripts\\python.exe main.py  (or .\\run.ps1)"
            )
            logger.error(msg)
            raise UnsupportedRuntimeError(msg)
    except ImportError:
        pass  # mock-only mode; paddle not installed


def log_runtime_diagnostics() -> None:
    """Emit interpreter and dependency versions at service startup."""
    cache = os.environ.get("PADDLE_PDX_CACHE_HOME", "").strip() or "<unset>"

    logger.info("[runtime] python_executable=%s", sys.executable)
    logger.info("[runtime] python_version=%s", sys.version.replace("\n", " "))
    logger.info("[runtime] cwd=%s", os.getcwd())
    logger.info("[runtime] PADDLE_PDX_CACHE_HOME=%s", cache)

    if cache == "<unset>":
        logger.warning(
            "[runtime] WARNING: PADDLE_PDX_CACHE_HOME is unset. "
            "PaddleX may use %%USERPROFILE%%\\.paddlex (fails on some Windows profiles). "
            "Recommended: %s",
            DEFAULT_PADDLE_CACHE_HOME,
        )

    for mod_name in ("paddle", "paddleocr", "paddlex"):
        try:
            mod = __import__(mod_name)
            logger.info("[runtime] %s_version=%s", mod_name, getattr(mod, "__version__", "?"))
        except Exception as exc:  # noqa: BLE001 — diagnostic only
            logger.info("[runtime] %s_version=unavailable (%s)", mod_name, exc)
