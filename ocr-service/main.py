"""
Water Motion OCR Service — Phase 3.5

Contract-ready mock OCR API. No real OCR engines.
"""

from __future__ import annotations

print("[MAIN BUILD] small-model-fix-v1", flush=True)

import json
import threading

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from api.routes import handle_request
from config.settings import settings
from core import response as api_response
from core.logger import get_logger

logger = get_logger("main")


def _warmup() -> None:
    """Runs in a background thread AFTER the HTTP server is already bound and
    listening. paddle/paddleocr are only ever imported here — Render's port
    scan must never wait on this, even if model download takes minutes.

    Engine failures land as a degraded (not fatal) state: is_available()
    stays False, requests get ENGINE_UNAVAILABLE (retryable) instead of the
    whole process refusing to start.
    """
    logger.info("[WARMUP] started engine=%s", settings.ocr_engine)
    try:
        from core.runtime_env import enforce_supported_runtime, log_runtime_diagnostics

        enforce_supported_runtime()
        log_runtime_diagnostics()
    except Exception as exc:  # noqa: BLE001 — diagnostics/version guard must never kill warmup
        logger.error("[WARMUP] runtime diagnostics failed: %r", exc)

    from services.ocr_service import ocr_service

    try:
        ready = ocr_service.warmup()
    except Exception as exc:  # noqa: BLE001 — warmup failure must never kill the process
        logger.error("[WARMUP] engine init raised: %r", exc)
        ready = False

    logger.info("[WARMUP] completed engine=%s ready=%s", ocr_service.engine_name, ready)


class OcrServiceHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _headers_dict(self) -> dict[str, str]:
        return {str(k): str(v) for k, v in self.headers.items()}

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if isinstance(payload, dict) and payload.get("request_id"):
            self.send_header("X-Request-Id", str(payload["request_id"]))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        status, payload = handle_request("GET", self.path, None, self._headers_dict())
        self._send(status, payload)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        if length < 0:
            length = 0
        if length > settings.max_body_bytes:
            request_id = __import__("uuid").uuid4().hex
            self._send(
                413,
                api_response.failure(
                    "PAYLOAD_TOO_LARGE",
                    f"Request body exceeds {settings.max_body_bytes} bytes",
                    retry=False,
                    request_id=request_id,
                ),
            )
            # Drain socket to avoid connection reset noise
            remaining = length
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
            return

        raw = self.rfile.read(length) if length > 0 else b""
        status, payload = handle_request("POST", self.path, raw, self._headers_dict())
        self._send(status, payload)

    def log_message(self, format: str, *args) -> None:
        # Access lines go through route logger with request_id; keep access quiet.
        return


def main() -> None:
    # Bind immediately — lightweight config only above this line. Render's
    # port scan must see an open port right away; paddle/paddleocr imports
    # and model init are never allowed to happen before this constructor
    # returns (ThreadingHTTPServer binds + listens in __init__).
    server = ThreadingHTTPServer((settings.host, settings.port), OcrServiceHandler)
    logger.info("[STARTUP] server bound host=%s port=%s", settings.host, settings.port)
    logger.info(
        "starting %s v%s phase=%s on http://%s:%s engine=%s",
        settings.service_name,
        settings.version,
        settings.phase,
        settings.host,
        settings.port,
        settings.ocr_engine,
    )
    logger.info("endpoints: GET /health /version /metrics | POST /ocr/read-meter")

    # Heavy engine init (paddle import + model load/download) runs here, off
    # the accept loop, so a slow/hung download degrades readiness instead of
    # the whole deploy timing out on Render's port scan.
    threading.Thread(target=_warmup, name="ocr-warmup", daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("stopped by KeyboardInterrupt")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
