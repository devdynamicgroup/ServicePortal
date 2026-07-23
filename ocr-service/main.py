"""
Water Motion OCR Service — Phase 3.5

Contract-ready mock OCR API. No real OCR engines.
"""

from __future__ import annotations

print("[MAIN BUILD] small-model-fix-v1", flush=True)

import json

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from api.routes import handle_request
from config.settings import settings
from core import response as api_response
from core.logger import get_logger
from core.runtime_env import enforce_supported_runtime, log_runtime_diagnostics

logger = get_logger("main")


def _fail_if_paddle_expected_but_unavailable() -> None:
    """Refuse to start serving traffic if OCR_ENGINE=paddle was configured but
    the PaddleOCR engine cannot actually initialize (missing paddle/paddleocr/
    paddlex, model load failure, etc). Never silently serve a degraded engine
    labeled "paddle" — that behaves like a black-box mock to callers, only
    worse (results depend on undiagnosed partial state).
    """
    if settings.ocr_engine.strip().lower() not in ("paddle", "paddleocr"):
        return

    from services.ocr_service import ocr_service

    if not ocr_service.health()["ready"]:
        msg = (
            "[FATAL] OCR_ENGINE=paddle is configured but the PaddleOCR engine "
            "failed to initialize (paddle/paddleocr/paddlex not importable, or "
            "model load failed — see [runtime] *_version log lines above and "
            "[paddle-engine] INIT FAILED trace). Refusing to start rather than "
            "silently serving a non-functional engine."
        )
        logger.error(msg)
        raise RuntimeError(msg)


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
    enforce_supported_runtime()
    log_runtime_diagnostics()
    _fail_if_paddle_expected_but_unavailable()
    server = ThreadingHTTPServer((settings.host, settings.port), OcrServiceHandler)
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
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("stopped by KeyboardInterrupt")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
