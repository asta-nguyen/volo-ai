"""Loopback JSON REST API mirroring the MCP tool surface.

The desktop sidecar owns one ApiServer instance. It binds only to
127.0.0.1:8765, starts on demand from Settings > MCP, and dispatches to the
existing MCP tool functions.
"""

from __future__ import annotations

import errno
import inspect
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import unquote, urlsplit

from tts_mcp import server as mcp_server
from tts_mcp.engine import Engine

API_HOST = "127.0.0.1"
API_PORT = 8765
API_BASE_URL = f"http://{API_HOST}:{API_PORT}"
MAX_BODY_BYTES = 1024 * 1024  # 1 MiB
_MAX_ERROR_MESSAGE = 500
_REQUEST_TIMEOUT_SECONDS = 30

_ALLOWED_HOSTS = {"127.0.0.1", "localhost"}

_POST_ROUTES = {
    "/api/v1/prepare_model": "prepare_model",
    "/api/v1/speak": "speak",
    "/api/v1/clone": "clone",
    "/api/v1/design": "design",
    "/api/v1/voices": "save_voice",
}
_ALLOWED_METHODS = {
    "/api/v1/status": {"GET"},
    "/api/v1/prepare_model": {"POST"},
    "/api/v1/speak": {"POST"},
    "/api/v1/clone": {"POST"},
    "/api/v1/design": {"POST"},
    "/api/v1/voices": {"GET", "POST"},
}
_VOICE_ROUTE_PREFIX = "/api/v1/voices/"


class ApiError(Exception):
    """HTTP error returned to the caller as a structured JSON body."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class ApiStartError(RuntimeError):
    """Raised when the loopback listener cannot be started."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _bounded_message(exc: BaseException) -> str:
    message = str(exc).replace("\n", " ").strip()
    return message[:_MAX_ERROR_MESSAGE] or type(exc).__name__


_TOOL_PARAMETERS = {
    name: inspect.signature(getattr(mcp_server, name)).parameters
    for name in ("prepare_model", "speak", "clone", "design", "save_voice", "delete_voice")
}


def _tool_arguments(name: str, body: dict[str, Any]) -> dict[str, Any]:
    parameters = _TOOL_PARAMETERS[name]
    unknown = sorted(key for key in body if key not in parameters)
    if unknown:
        raise ApiError(400, "invalid_arguments", f"Unsupported arguments: {', '.join(unknown)}")
    missing = sorted(
        key
        for key, parameter in parameters.items()
        if parameter.default is inspect.Parameter.empty
        and parameter.kind
        in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
        and key not in body
    )
    if missing:
        raise ApiError(400, "invalid_arguments", f"Missing arguments: {', '.join(missing)}")
    return body


def _call_tool(name: str, body: dict[str, Any]) -> Any:
    func: Callable[..., Any] = getattr(mcp_server, name)
    try:
        return func(**_tool_arguments(name, body))
    except FileNotFoundError as exc:
        raise ApiError(404, "not_found", _bounded_message(exc)) from exc
    except KeyError as exc:
        raise ApiError(400, "invalid_input", f"Missing field: {exc.args[0]}") from exc
    except (TypeError, ValueError) as exc:
        raise ApiError(400, "invalid_input", _bounded_message(exc)) from exc
    except RuntimeError as exc:
        raise ApiError(500, "operation_failed", _bounded_message(exc)) from exc
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(500, "internal_error", "The local TTS operation failed") from exc


class _ApiHandler(BaseHTTPRequestHandler):
    """Serves one JSON request per connection; no CORS headers are emitted."""

    server_version = "VoloLocalAPI/0.1"
    protocol_version = "HTTP/1.1"

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(_REQUEST_TIMEOUT_SECONDS)

    def log_message(self, _format: str, *_args: Any) -> None:
        """Keep request paths out of sidecar diagnostics."""

    def __getattr__(self, name: str) -> Any:
        """Serve unimplemented do_<METHOD> requests as structured JSON errors."""
        if name.startswith("do_"):
            return lambda: self._handle(name[3:])
        raise AttributeError(name)

    def do_GET(self) -> None:
        self._handle("GET")

    def do_POST(self) -> None:
        self._handle("POST")

    def do_DELETE(self) -> None:
        self._handle("DELETE")

    def do_HEAD(self) -> None:
        self._handle("HEAD")

    def do_OPTIONS(self) -> None:
        self._handle("OPTIONS")

    def do_PUT(self) -> None:
        self._handle("PUT")

    def do_PATCH(self) -> None:
        self._handle("PATCH")

    def _handle(self, method: str) -> None:
        try:
            self._enforce_trust_boundary()
            status, body = 200, self._encode({"result": self._dispatch(method)})
        except ApiError as exc:
            status = exc.status
            body = self._encode({"error": {"code": exc.code, "message": exc.message}})
        except Exception:
            status = 500
            body = self._encode(
                {
                    "error": {
                        "code": "internal_error",
                        "message": "The local TTS operation failed",
                    }
                }
            )
        self._respond(status, body)

    @staticmethod
    def _encode(payload: dict[str, Any]) -> bytes:
        return json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def _enforce_trust_boundary(self) -> None:
        host = (self.headers.get("Host") or "").strip()
        name, separator, port = host.rpartition(":")
        if not separator:
            name, port = host, ""
        if (
            name.strip().lower() not in _ALLOWED_HOSTS
            or (separator and not port.isdigit())
            or (port and port != str(self.server.server_address[1]))
        ):
            raise ApiError(
                403,
                "forbidden_host",
                "The local API only accepts requests addressed to 127.0.0.1",
            )
        if self.headers.get("Origin") is not None:
            raise ApiError(
                403,
                "origin_not_allowed",
                "Requests carrying an Origin header are not accepted",
            )

    def _dispatch(self, method: str) -> Any:
        path = urlsplit(self.path).path
        if path.startswith(_VOICE_ROUTE_PREFIX):
            name = unquote(path[len(_VOICE_ROUTE_PREFIX) :])
            if not name or "/" in name:
                raise ApiError(404, "not_found", "Unknown route")
            if method != "DELETE":
                raise ApiError(
                    405, "method_not_allowed", f"Method {method} is not supported here"
                )
            return _call_tool("delete_voice", {"name": name})
        methods = _ALLOWED_METHODS.get(path)
        if methods is None:
            raise ApiError(404, "not_found", "Unknown route")
        if method not in methods:
            raise ApiError(405, "method_not_allowed", f"Method {method} is not supported here")
        if method == "GET":
            if path == "/api/v1/status":
                return mcp_server.status()
            return {"voices": Engine.list_voices()}
        body = self._read_json_body()
        return _call_tool(_POST_ROUTES[path], body)

    def _read_json_body(self) -> dict[str, Any]:
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type != "application/json":
            raise ApiError(
                415,
                "unsupported_media_type",
                "Request body must use Content-Type: application/json",
            )
        declared = self.headers.get("Content-Length")
        if declared is None:
            raise ApiError(400, "invalid_request", "A JSON request body is required")
        try:
            declared_length = int(declared)
        except ValueError as exc:
            raise ApiError(400, "invalid_request", "Content-Length must be an integer") from exc
        if declared_length < 0 or declared_length > MAX_BODY_BYTES:
            raise ApiError(
                413,
                "payload_too_large",
                f"Request body must be at most {MAX_BODY_BYTES} bytes",
            )
        body = self.rfile.read(declared_length)
        if len(body) > MAX_BODY_BYTES:
            raise ApiError(
                413,
                "payload_too_large",
                f"Request body must be at most {MAX_BODY_BYTES} bytes",
            )
        try:
            parsed = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ApiError(400, "invalid_json", "Request body must be valid JSON") from exc
        if not isinstance(parsed, dict):
            raise ApiError(400, "invalid_arguments", "Request body must be a JSON object")
        return parsed

    def _respond(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        if self.command != "HEAD":
            self.wfile.write(body)


class ApiServer:
    """Owns the threaded loopback HTTP listener for the local REST API."""

    def __init__(self, host: str = API_HOST, port: int = API_PORT):
        self._host = host
        self._port = port
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    @property
    def running(self) -> bool:
        return self._server is not None

    def state(self) -> dict[str, Any]:
        server = self._server
        host, port = (
            server.server_address[:2] if server is not None else (self._host, self._port)
        )
        return {
            "running": server is not None,
            "url": f"http://{host}:{port}",
            "host": host,
            "port": port,
        }

    def start(self) -> dict[str, Any]:
        with self._lock:
            if self._server is not None:
                return self.state()
            try:
                server = ThreadingHTTPServer((self._host, self._port), _ApiHandler)
            except OSError as exc:
                if exc.errno == errno.EADDRINUSE:
                    raise ApiStartError(
                        "port_in_use",
                        f"{self._host}:{self._port} is already in use. "
                        "Stop the other process using the port, then try again.",
                    ) from exc
                raise ApiStartError(
                    "api_start_failed", f"The local API could not start: {_bounded_message(exc)}"
                ) from exc
            self._server = server
            self._thread = threading.Thread(
                target=server.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True
            )
            self._thread.start()
            return self.state()

    def stop(self) -> dict[str, Any]:
        with self._lock:
            server, thread = self._server, self._thread
            if server is not None:
                server.shutdown()
                server.server_close()
                self._server = None
            if thread is not None:
                thread.join(timeout=5)
                self._thread = None
            return self.state()
