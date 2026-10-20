"""Download and select the optional, version-matched Linux CUDA sidecar."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

REPOSITORY = "asta-nguyen/volo-ai"
TARGET = "x86_64-unknown-linux-gnu"
MAX_MANIFEST_SIZE = 1_000_000
MAX_PART_SIZE = 1_900_000_000
MAX_PAYLOAD_SIZE = 20_000_000_000
MAX_PARTS = 12
CHUNK_SIZE = 1024 * 1024
VERSION_PATTERN = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
SHA_PATTERN = re.compile(r"[0-9a-f]{64}")


class RuntimeDownloadCancelled(Exception):
    """Raised when the user cancels an optional runtime download."""


def supported_platform() -> bool:
    return sys_platform_linux() and platform.machine().lower() in {"x86_64", "amd64"}


def sys_platform_linux() -> bool:
    return os.name == "posix" and platform.system() == "Linux"


def _version(value: str | None) -> str:
    if not isinstance(value, str) or VERSION_PATTERN.fullmatch(value) is None:
        raise ValueError("The desktop app version is unavailable or invalid")
    return value


def _runtime_dir(data_dir: Path) -> Path:
    return data_dir / "nvidia-runtime"


def _state_path(data_dir: Path) -> Path:
    return _runtime_dir(data_dir) / "current.json"


def _ensure_runtime_dir(data_dir: Path, *, create: bool = False) -> Path:
    directory = _runtime_dir(data_dir)
    if create:
        directory.mkdir(parents=True, exist_ok=True)
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("NVIDIA runtime directory is not a regular app-data directory")
    if directory.resolve().parent != data_dir.resolve():
        raise ValueError("NVIDIA runtime directory escaped app data")
    return directory


def _release_names(version: str) -> tuple[str, str]:
    prefix = f"volo-ai_v{version}_linux_x64_cuda"
    return f"{prefix}.json", prefix


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK_SIZE), b""):
            digest.update(block)
    return digest.hexdigest()


def _validate_manifest(value: Any, version: str) -> dict[str, Any]:
    _, prefix = _release_names(_version(version))
    if not isinstance(value, dict) or set(value) != {
        "format",
        "version",
        "target",
        "payload",
        "parts",
    }:
        raise ValueError("CUDA runtime manifest has unsupported fields")
    if (
        isinstance(value["format"], bool)
        or not isinstance(value["format"], int)
        or value["format"] != 1
        or value["version"] != version
        or value["target"] != TARGET
    ):
        raise ValueError("CUDA runtime manifest version or target does not match this app")
    payload = value["payload"]
    parts = value["parts"]
    if (
        not isinstance(payload, dict)
        or set(payload) != {"size", "sha256"}
        or isinstance(payload.get("size"), bool)
        or not isinstance(payload.get("size"), int)
        or payload["size"] <= 0
        or payload["size"] > MAX_PAYLOAD_SIZE
        or not isinstance(payload.get("sha256"), str)
        or SHA_PATTERN.fullmatch(payload["sha256"]) is None
        or not isinstance(parts, list)
        or not parts
        or len(parts) > MAX_PARTS
    ):
        raise ValueError("CUDA runtime manifest payload metadata is invalid")

    total = 0
    for index, part in enumerate(parts, start=1):
        if (
            not isinstance(part, dict)
            or set(part) != {"name", "size", "sha256"}
            or part.get("name") != f"{prefix}.part-{index:03d}"
            or isinstance(part.get("size"), bool)
            or not isinstance(part.get("size"), int)
            or part["size"] <= 0
            or part["size"] > MAX_PART_SIZE
            or not isinstance(part.get("sha256"), str)
            or SHA_PATTERN.fullmatch(part["sha256"]) is None
        ):
            raise ValueError(f"CUDA runtime manifest part {index} is invalid")
        total += part["size"]
    if total != payload["size"]:
        raise ValueError("CUDA runtime manifest part sizes do not match the payload")
    return value


def _read_installed(data_dir: Path) -> tuple[dict[str, Any] | None, Path | None]:
    state_path = _state_path(data_dir)
    try:
        directory = _ensure_runtime_dir(data_dir)
        if state_path.is_symlink():
            return None, None
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(state, dict) or set(state) != {"version", "size", "sha256"}:
            return None, None
        version = _version(state["version"])
        if (
            isinstance(state["size"], bool)
            or not isinstance(state["size"], int)
            or state["size"] <= 0
            or not isinstance(state["sha256"], str)
            or SHA_PATTERN.fullmatch(state["sha256"]) is None
        ):
            return None, None
        runtime_path = directory / f"{state['sha256']}.bin"
        if runtime_path.parent != directory or runtime_path.is_symlink():
            return None, None
        if not runtime_path.is_file() or runtime_path.stat().st_size != state["size"]:
            return None, None
        return {"version": version, "size": state["size"], "sha256": state["sha256"]}, runtime_path
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None, None


def status(data_dir: Path, app_version: str | None, *, active: str | None = None) -> dict[str, Any]:
    installed, runtime_path = _read_installed(data_dir)
    version = app_version if isinstance(app_version, str) else None
    return {
        "supported": supported_platform(),
        "installed": installed is not None,
        "installed_version": installed["version"] if installed else None,
        "needs_update": bool(installed and version and installed["version"] != version),
        "active": active == "cuda" and installed is not None and installed["version"] == version,
        "size": installed["size"] if installed else None,
        "available": bool(runtime_path),
    }


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(
        url, headers={"User-Agent": "Volo-AI-Desktop", "Accept": "application/octet-stream"}
    )


def _read_manifest(version: str) -> dict[str, Any]:
    filename, _ = _release_names(version)
    url = f"https://github.com/{REPOSITORY}/releases/download/v{version}/{filename}"
    try:
        with urllib.request.urlopen(_request(url), timeout=30) as response:
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_MANIFEST_SIZE:
                raise ValueError("CUDA runtime manifest exceeds the size limit")
            body = response.read(MAX_MANIFEST_SIZE + 1)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError("Could not download the NVIDIA runtime manifest") from exc
    if len(body) > MAX_MANIFEST_SIZE:
        raise ValueError("CUDA runtime manifest exceeds the size limit")
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("NVIDIA runtime manifest is not valid JSON") from exc
    return _validate_manifest(value, version)


def _emit(
    emit: Callable[[dict[str, Any]], None] | None, request_id: str, value: int, total: int
) -> None:
    if emit:
        emit(
            {
                "id": request_id,
                "event": "progress",
                "phase": "nvidia_runtime",
                "progress": value / total,
                "current": value,
                "total": total,
                "message": "Downloading NVIDIA runtime",
            }
        )


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    fd, temporary_name = tempfile.mkstemp(prefix="runtime-state-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def install(
    data_dir: Path,
    app_version: str | None,
    request_id: str,
    *,
    should_cancel: Callable[[], bool] = lambda: False,
    emit: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    if not supported_platform():
        raise RuntimeError("NVIDIA runtime installation is supported only on Linux x64")
    version = _version(app_version)
    manifest = _read_manifest(version)
    runtime_dir = _ensure_runtime_dir(data_dir, create=True)
    required = manifest["payload"]["size"]
    if shutil.disk_usage(runtime_dir).free < required + min(required // 20, 1_000_000_000):
        raise RuntimeError("Not enough free disk space to install the NVIDIA runtime")

    fd, temporary_name = tempfile.mkstemp(prefix="download-", suffix=".part", dir=runtime_dir)
    temporary = Path(temporary_name)
    whole = hashlib.sha256()
    downloaded = 0
    previous, _ = _read_installed(data_dir)
    try:
        with os.fdopen(fd, "wb") as output:
            for part in manifest["parts"]:
                if should_cancel():
                    raise RuntimeDownloadCancelled("NVIDIA runtime download cancelled")
                url = f"https://github.com/{REPOSITORY}/releases/download/v{version}/{part['name']}"
                part_hash = hashlib.sha256()
                part_size = 0
                with urllib.request.urlopen(_request(url), timeout=30) as response:
                    content_length = response.headers.get("Content-Length")
                    if content_length and int(content_length) != part["size"]:
                        raise ValueError(f"NVIDIA runtime part size mismatch: {part['name']}")
                    while True:
                        if should_cancel():
                            raise RuntimeDownloadCancelled("NVIDIA runtime download cancelled")
                        block = response.read(CHUNK_SIZE)
                        if not block:
                            break
                        part_size += len(block)
                        downloaded += len(block)
                        if part_size > part["size"] or downloaded > required:
                            raise ValueError("NVIDIA runtime download exceeded its manifest size")
                        output.write(block)
                        part_hash.update(block)
                        whole.update(block)
                        _emit(emit, request_id, downloaded, required)
                if part_size != part["size"] or part_hash.hexdigest() != part["sha256"]:
                    raise ValueError(f"NVIDIA runtime checksum mismatch: {part['name']}")
            output.flush()
            os.fsync(output.fileno())
        if downloaded != required or whole.hexdigest() != manifest["payload"]["sha256"]:
            raise ValueError("NVIDIA runtime payload checksum or size does not match its manifest")

        digest = whole.hexdigest()
        runtime_path = runtime_dir / f"{digest}.bin"
        existing_valid = False
        if runtime_path.is_file() and not runtime_path.is_symlink():
            try:
                existing_valid = _sha256_file(runtime_path) == digest
            except OSError:
                pass
        if existing_valid:
            temporary.unlink()
        elif runtime_path.exists() and not runtime_path.is_file() and not runtime_path.is_symlink():
            raise RuntimeError("Existing NVIDIA runtime path is not a regular file")
        else:
            temporary.chmod(0o755)
            os.replace(temporary, runtime_path)
        _atomic_json(
            _state_path(data_dir),
            {"version": version, "size": required, "sha256": digest},
        )
        if previous and previous["sha256"] != digest:
            (_runtime_dir(data_dir) / f"{previous['sha256']}.bin").unlink(missing_ok=True)
        _emit(emit, request_id, required, required)
        return {"installed": True, "version": version, "size": required}
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            "A required NVIDIA runtime asset is unavailable for this app version"
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError("The NVIDIA runtime download failed") from exc
    finally:
        temporary.unlink(missing_ok=True)


def remove(data_dir: Path) -> bool:
    runtime_dir = _runtime_dir(data_dir)
    if not runtime_dir.exists() or runtime_dir.is_symlink():
        return False
    try:
        _ensure_runtime_dir(data_dir)
    except (OSError, ValueError):
        return False
    removed = False
    for item in runtime_dir.iterdir():
        if item.name == "current.json" or re.fullmatch(r"[0-9a-f]{64}\.bin", item.name):
            item.unlink(missing_ok=True)
            removed = True
    return removed


def select(data_dir: Path, app_version: str | None) -> tuple[Path | None, str | None]:
    if os.environ.get("TTS_MCP_ACTIVE_RUNTIME") == "cuda":
        return None, None
    try:
        version = _version(app_version)
    except ValueError as exc:
        return None, str(exc)
    installed, runtime_path = _read_installed(data_dir)
    if installed is None or runtime_path is None:
        state_path = _state_path(data_dir)
        if not state_path.exists() and not state_path.is_symlink():
            return None, None
        return None, "Installed NVIDIA runtime metadata or payload failed its file check"
    if installed["version"] != version:
        return None, "Installed NVIDIA runtime targets a different app version"
    try:
        if _sha256_file(runtime_path) != installed["sha256"]:
            return None, "Installed NVIDIA runtime checksum does not match"
    except OSError:
        return None, "Installed NVIDIA runtime could not be read"
    try:
        result = subprocess.run(
            [str(runtime_path), "--runtime-check"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            timeout=45,
            env={**os.environ, "TTS_MCP_APP_VERSION": version, "TTS_MCP_ACTIVE_RUNTIME": "cuda"},
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, f"NVIDIA CUDA health check could not run: {type(exc).__name__}"
    if result.returncode != 0:
        reason = result.stderr.strip()[:500] or "CUDA health check failed"
        return None, reason
    return runtime_path, None


def emit_runtime_status(data_dir: Path, app_version: str | None) -> dict[str, Any]:
    return status(data_dir, app_version, active=os.environ.get("TTS_MCP_ACTIVE_RUNTIME"))
