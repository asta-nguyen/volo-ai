"""Small, local-only diagnostic history for the desktop sidecar."""

from __future__ import annotations

import json
import os
import platform
import re
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MAX_EVENTS = 500
MAX_BYTES = 1_000_000
_LOCK = threading.Lock()
_SAFE_TOKEN = re.compile(r"[^A-Za-z0-9_.-]")
_WRITE_FAILED = False
_READ_FAILED = False


def _path(data_dir: Path) -> Path:
    return data_dir / "diagnostics.jsonl"


def _redact(value: str) -> str:
    home = Path.home()
    for prefix in {str(home), home.as_posix(), str(home).replace("/", "\\")}:
        if prefix and prefix != ".":
            value = value.replace(prefix, "~")
    return value[:20_000]


def _load(data_dir: Path) -> list[dict[str, Any]]:
    global _READ_FAILED
    path = _path(data_dir)
    try:
        if path.is_symlink():
            raise OSError("Diagnostic history is a symbolic link")
        with path.open("rb") as stream:
            size = path.stat().st_size
            if size > MAX_BYTES:
                _READ_FAILED = True
                stream.seek(size - MAX_BYTES)
            content = stream.read(MAX_BYTES)
    except FileNotFoundError:
        return []
    except OSError:
        _READ_FAILED = True
        return []
    try:
        decoded = content.decode("utf-8")
    except UnicodeDecodeError:
        _READ_FAILED = True
        return []
    lines = decoded.splitlines()
    if size > MAX_BYTES:
        lines = lines[1:]
    events = []
    for line in lines[-MAX_EVENTS:]:
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            _READ_FAILED = True
            continue
        if not isinstance(item, dict) or not isinstance(item.get("category"), str):
            _READ_FAILED = True
            continue
        allowed = (
            "time",
            "category",
            "operation",
            "code",
            "message",
            "traceback",
            "request_id",
            "provider",
            "stage",
            "asset",
            "error_type",
            "duration_ms",
        )
        if set(item) - set(allowed):
            _READ_FAILED = True
        event: dict[str, Any] = {"category": _token(item["category"])}
        for key in allowed:
            if key == "category":
                continue
            value = item.get(key)
            if value is None:
                continue
            if key == "duration_ms":
                if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                    _READ_FAILED = True
                    continue
                event[key] = min(value, 2**31 - 1)
                continue
            elif not isinstance(value, str):
                _READ_FAILED = True
                continue
            if key in {"operation", "code", "request_id", "provider", "error_type"}:
                event[key] = _token(value)
            elif key == "time":
                event[key] = value[:80]
            else:
                event[key] = _redact(value)[:12_000 if key == "traceback" else 500]
        events.append(event)
    return events


def record(
    data_dir: Path,
    category: str,
    *,
    operation: str | None = None,
    code: str | None = None,
    message: str | None = None,
    traceback: str | None = None,
    request_id: str | None = None,
    provider: str | None = None,
    stage: str | None = None,
    asset: str | None = None,
    error_type: str | None = None,
    duration_ms: int | None = None,
) -> None:
    """Append a bounded event; diagnostics must never fail the caller."""
    global _WRITE_FAILED
    event: dict[str, Any] = {
        "time": datetime.now(timezone.utc).isoformat(),
        "category": _token(category),
    }
    if operation:
        event["operation"] = _token(operation)
    if code:
        event["code"] = _token(code)
    if message:
        event["message"] = _redact(message)
    if traceback:
        event["traceback"] = _redact(traceback)[:12_000]
    for key, value in (
        ("request_id", request_id),
        ("provider", provider),
        ("stage", stage),
        ("asset", asset),
        ("error_type", error_type),
    ):
        if value:
            event[key] = (
                _token(value)
                if key in {"request_id", "provider", "error_type"}
                else _redact(value)[:500]
            )
    if duration_ms is not None:
        event["duration_ms"] = max(0, min(duration_ms, 2**31 - 1))
    try:
        with _LOCK:
            events = [*_load(data_dir), event]
            data_dir.mkdir(parents=True, exist_ok=True)
            content = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in events)
            while len(events) > 1 and len(content.encode("utf-8")) > MAX_BYTES:
                events.pop(0)
                content = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in events)
            fd, temporary = tempfile.mkstemp(prefix="diagnostics-", dir=data_dir)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as stream:
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, _path(data_dir))
                _WRITE_FAILED = False
            finally:
                try:
                    os.unlink(temporary)
                except FileNotFoundError:
                    pass
    except OSError:
        _WRITE_FAILED = True
        return


def _token(value: str) -> str:
    return _SAFE_TOKEN.sub("_", str(value))[:80] or "unknown"


_EVENTS_CACHE: dict[tuple, list[dict[str, Any]]] = {}
_EVENTS_CACHE_LIMIT = 8


def events(data_dir: Path) -> list[dict[str, Any]]:
    """Return sanitized events, caching the read until the file changes."""
    path = _path(data_dir)
    try:
        stat = path.stat()
        cache_key = (str(path), stat.st_mtime_ns, stat.st_size)
    except OSError:
        cache_key = (str(path), -1, -1)
    loaded = _EVENTS_CACHE.get(cache_key)
    if loaded is None:
        loaded = _load(data_dir)
        if len(_EVENTS_CACHE) >= _EVENTS_CACHE_LIMIT:
            _EVENTS_CACHE.clear()
        _EVENTS_CACHE[cache_key] = loaded
    return [
        {key: value for key, value in item.items() if key != "traceback"}
        for item in loaded
    ]


def is_complete() -> bool:
    return not _WRITE_FAILED and not _READ_FAILED


def _frontend_events(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value[-MAX_EVENTS:]:
        if not isinstance(item, dict):
            continue
        event = {}
        for key in (
            "time",
            "category",
            "operation",
            "code",
            "message",
            "traceback",
            "request_id",
            "provider",
            "stage",
            "asset",
            "error_type",
        ):
            if isinstance(item.get(key), str):
                value = item[key]
                if key in {"category", "operation", "code", "request_id", "provider", "error_type"}:
                    event[key] = _token(value)
                else:
                    event[key] = _redact(value)[:12_000 if key == "traceback" else 500]
        duration = item.get("duration_ms")
        if isinstance(duration, int) and not isinstance(duration, bool) and duration >= 0:
            event["duration_ms"] = min(duration, 2**31 - 1)
        if "category" in event:
            event["category"] = _token(event["category"])
            if "operation" in event:
                event["operation"] = _token(event["operation"])
            if "code" in event:
                event["code"] = _token(event["code"])
            result.append(event)
    return result


def report(
    data_dir: Path,
    *,
    app_version: str | None,
    runtime: dict[str, Any],
    frontend_events: Any = None,
    frontend_complete: bool = True,
) -> dict[str, Any]:
    combined = [*_load(data_dir), *_frontend_events(frontend_events)]
    combined.sort(key=lambda item: str(item.get("time", "")))
    return {
        "format": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "app_version": app_version or "unknown",
        "platform": {"os": platform.system(), "architecture": platform.machine()},
        "runtime": runtime,
        "events": combined[-MAX_EVENTS:],
        "diagnostics_complete": is_complete() and frontend_complete,
    }


def clear(data_dir: Path) -> None:
    global _READ_FAILED, _WRITE_FAILED
    try:
        with _LOCK:
            _path(data_dir).unlink(missing_ok=True)
            _READ_FAILED = False
            _WRITE_FAILED = False
    except OSError:
        _WRITE_FAILED = True
        return
