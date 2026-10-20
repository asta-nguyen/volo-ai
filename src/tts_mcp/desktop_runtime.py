"""Download and select the optional, version-matched Linux CUDA sidecar."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import platform
import posixpath
import re
import shutil
import stat
import subprocess
import tempfile
import tarfile
import urllib.error
import urllib.request
import zlib
from pathlib import Path, PurePosixPath
from typing import Any, Callable

REPOSITORY = "az-forge/volo-ai"
TARGET = "x86_64-unknown-linux-gnu"
MAX_MANIFEST_SIZE = 1_000_000
MAX_PART_SIZE = 1_900_000_000
MAX_PAYLOAD_SIZE = 20_000_000_000
MAX_PARTS = 12
MAX_MEMBERS = 100_000
MAX_PAX_HEADER_SIZE = 64 * 1024
MAX_TOTAL_PAX_SIZE = 64 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
ENTRYPOINT = "runtime/tts-sidecar-cuda"
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


def _validate_manifest(value: Any, version: str) -> dict[str, Any]:
    _, prefix = _release_names(_version(version))
    if not isinstance(value, dict) or set(value) != {
        "format",
        "version",
        "target",
        "archive",
        "expanded_size",
        "entrypoint",
        "parts",
    }:
        raise ValueError("CUDA runtime manifest has unsupported fields")
    if (
        isinstance(value["format"], bool)
        or not isinstance(value["format"], int)
        or value["format"] != 2
        or value["version"] != version
        or value["target"] != TARGET
        or value["entrypoint"] != ENTRYPOINT
    ):
        raise ValueError(
            "CUDA runtime manifest version, target, or entrypoint does not match this app"
        )
    archive = value["archive"]
    parts = value["parts"]
    if (
        not isinstance(archive, dict)
        or set(archive) != {"size", "sha256"}
        or isinstance(archive.get("size"), bool)
        or not isinstance(archive.get("size"), int)
        or archive["size"] <= 0
        or archive["size"] > MAX_PAYLOAD_SIZE
        or not isinstance(archive.get("sha256"), str)
        or SHA_PATTERN.fullmatch(archive["sha256"]) is None
        or isinstance(value["expanded_size"], bool)
        or not isinstance(value["expanded_size"], int)
        or value["expanded_size"] <= 0
        or value["expanded_size"] > MAX_PAYLOAD_SIZE
        or not isinstance(parts, list)
        or not parts
        or len(parts) > MAX_PARTS
    ):
        raise ValueError("CUDA runtime manifest archive metadata is invalid")

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
    if total != archive["size"]:
        raise ValueError("CUDA runtime manifest part sizes do not match the archive")
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
        runtime_root = directory / state["sha256"]
        entrypoint = runtime_root.joinpath(*PurePosixPath(ENTRYPOINT).parts)
        if (
            runtime_root.parent != directory
            or runtime_root.is_symlink()
            or not runtime_root.is_dir()
        ):
            return None, None
        runtime_dir = runtime_root / "runtime"
        if runtime_dir.is_symlink() or not runtime_dir.is_dir() or entrypoint.is_symlink():
            return None, None
        try:
            entry_stat = entrypoint.lstat()
        except OSError:
            return None, None
        if not stat.S_ISREG(entry_stat.st_mode) or not entry_stat.st_mode & 0o100:
            return None, None
        return {"version": version, "size": state["size"], "sha256": state["sha256"]}, entrypoint
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
                "message": "Installing NVIDIA runtime",
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
        try:
            _sync_directory(path.parent)
        except OSError:
            pass  # The state pointer was already atomically replaced.
    finally:
        temporary.unlink(missing_ok=True)


def _sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _archive_member_name(name: str, *, directory: bool = False) -> str:
    if (
        not isinstance(name, str)
        or not name
        or name.startswith("/")
        or "\\" in name
        or "\0" in name
    ):
        raise ValueError("NVIDIA archive contains an invalid member path")
    parts = name.split("/")
    if directory and parts[-1] == "":
        parts.pop()
    if not parts or any(part in {"", ".", ".."} for part in parts) or parts[0] != "runtime":
        raise ValueError(f"NVIDIA archive member escapes its runtime root: {name}")
    return "/".join(parts)


def _safe_link_target(name: str, target: str) -> str:
    if not target or target.startswith("/") or "\\" in target or "\0" in target:
        raise ValueError(f"NVIDIA archive has an unsafe symlink target: {name}")
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
    if resolved != "runtime" and not resolved.startswith("runtime/"):
        raise ValueError(f"NVIDIA archive symlink escapes its runtime root: {name}")
    return target


class _DownloadArchiveReader:
    def __init__(
        self,
        manifest: dict[str, Any],
        version: str,
        request_id: str,
        should_cancel: Callable[[], bool],
        emit: Callable[[dict[str, Any]], None] | None,
    ) -> None:
        self.manifest = manifest
        self.version = version
        self.request_id = request_id
        self.should_cancel = should_cancel
        self.emit = emit
        self.index = 0
        self.response = None
        self.remaining = 0
        self.part_hash = None
        self.downloaded = 0
        self.expanded = 0
        self.whole = hashlib.sha256()
        self.total = manifest["archive"]["size"] + manifest["expanded_size"]

    def report(self) -> None:
        current = min(self.downloaded + self.expanded, self.total)
        _emit(self.emit, self.request_id, current, self.total)

    def add_extracted(self, size: int) -> None:
        self.expanded += size
        self.report()

    def _open_part(self) -> bool:
        if self.index >= len(self.manifest["parts"]):
            return False
        if self.should_cancel():
            raise RuntimeDownloadCancelled("NVIDIA runtime installation cancelled")
        part = self.manifest["parts"][self.index]
        url = f"https://github.com/{REPOSITORY}/releases/download/v{self.version}/{part['name']}"
        response = urllib.request.urlopen(_request(url), timeout=30)
        content_length = response.headers.get("Content-Length")
        try:
            if content_length and int(content_length) != part["size"]:
                raise ValueError(f"NVIDIA runtime part size mismatch: {part['name']}")
        except (TypeError, ValueError):
            response.close()
            raise
        self.response = response
        self.remaining = part["size"]
        self.part_hash = hashlib.sha256()
        return True

    def _finish_part(self) -> None:
        part = self.manifest["parts"][self.index]
        extra = self.response.read(1)
        self.response.close()
        self.response = None
        if extra:
            raise ValueError(f"NVIDIA runtime part exceeded its manifest size: {part['name']}")
        if self.part_hash.hexdigest() != part["sha256"]:
            raise ValueError(f"NVIDIA runtime checksum mismatch: {part['name']}")
        self.index += 1
        self.part_hash = None

    def read(self, size: int = -1) -> bytes:
        if size == 0:
            return b""
        target = CHUNK_SIZE if size < 0 else size
        result = bytearray()
        while len(result) < target:
            if self.response is None and not self._open_part():
                break
            if self.should_cancel():
                raise RuntimeDownloadCancelled("NVIDIA runtime installation cancelled")
            block = self.response.read(min(target - len(result), self.remaining))
            if not block:
                raise ValueError("NVIDIA runtime part ended before its manifest size")
            if len(block) > self.remaining:
                raise ValueError("NVIDIA runtime part exceeded its manifest size")
            result.extend(block)
            self.remaining -= len(block)
            self.downloaded += len(block)
            self.part_hash.update(block)
            self.whole.update(block)
            self.report()
            if self.remaining == 0:
                self._finish_part()
        return bytes(result)

    def close(self) -> None:
        if self.response is not None:
            self.response.close()
            self.response = None


class _BoundedReader:
    def __init__(self, stream: Any, limit: int) -> None:
        self.stream = stream
        self.limit = limit
        self.read_size = 0

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = CHUNK_SIZE
        size = min(size, self.limit - self.read_size + 1)
        block = self.stream.read(size)
        self.read_size += len(block)
        if self.read_size > self.limit:
            raise ValueError("NVIDIA runtime archive exceeds the expanded stream limit")
        return block


class _SafeTarInfo(tarfile.TarInfo):
    def _proc_member(self, archive: tarfile.TarFile) -> tarfile.TarInfo:
        if self.type == tarfile.XHDTYPE:
            if self.size > MAX_PAX_HEADER_SIZE:
                raise tarfile.ReadError("PAX metadata exceeds the size limit")
            headers = getattr(archive, "_volo_pax_headers", 0) + 1
            if headers > MAX_MEMBERS:
                raise tarfile.ReadError("NVIDIA archive contains too many PAX headers")
            archive._volo_pax_headers = headers
            total = getattr(archive, "_volo_pax_size", 0) + self.size
            if total > MAX_TOTAL_PAX_SIZE:
                raise tarfile.ReadError("NVIDIA PAX metadata exceeds the total size limit")
            archive._volo_pax_size = total
        elif self.type not in {
            tarfile.REGTYPE,
            tarfile.AREGTYPE,
            tarfile.DIRTYPE,
            tarfile.SYMTYPE,
        }:
            raise tarfile.ReadError("NVIDIA archive contains an unsupported member type")
        return super()._proc_member(archive)


def _ensure_stage_parent(stage: Path, path: Path, directory_modes: dict[Path, int]) -> None:
    parents = list(reversed(path.parents))
    for parent in parents:
        if parent == stage or not parent.is_relative_to(stage):
            continue
        if parent.exists():
            if parent.is_symlink() or not parent.is_dir():
                raise ValueError("NVIDIA archive member collides with a non-directory")
        else:
            parent.mkdir(mode=0o700)
        directory_modes.setdefault(parent, 0o755)


def _extract_archive(
    archive: tarfile.TarFile,
    stage: Path,
    expected_size: int,
    reader: _DownloadArchiveReader,
) -> None:
    seen: set[str] = set()
    implicit_dirs = {"runtime"}
    blocked: set[str] = set()
    directories: dict[Path, int] = {}
    symlinks: list[tuple[Path, str]] = []
    expanded = 0
    members = 0
    root_seen = False
    entrypoint_seen = False

    for member in archive:
        if reader.should_cancel():
            raise RuntimeDownloadCancelled("NVIDIA runtime installation cancelled")
        members += 1
        if members > MAX_MEMBERS:
            raise ValueError("NVIDIA archive contains too many members")
        if member.isdir():
            kind = "directory"
        elif member.type in {tarfile.REGTYPE, tarfile.AREGTYPE}:
            kind = "file"
        elif member.issym():
            kind = "symlink"
        else:
            raise ValueError("NVIDIA archive contains an unsupported member type")
        name = _archive_member_name(member.name, directory=kind == "directory")
        if name in seen:
            raise ValueError(f"NVIDIA archive contains a duplicate member: {name}")
        parts = name.split("/")
        parents = ["/".join(parts[:index]) for index in range(1, len(parts))]
        if any(parent in blocked for parent in parents):
            raise ValueError(f"NVIDIA archive member is nested under a non-directory: {name}")
        if kind != "directory" and name in implicit_dirs:
            raise ValueError(f"NVIDIA archive member collides with a directory: {name}")
        if kind == "directory" and name in blocked:
            raise ValueError(f"NVIDIA archive directory collides with a file: {name}")
        for parent in parents:
            implicit_dirs.add(parent)
        seen.add(name)
        destination = stage.joinpath(*PurePosixPath(name).parts)

        if name == "runtime":
            if kind != "directory":
                raise ValueError("NVIDIA archive runtime root is not a directory")
            root_seen = True
        if kind != "directory":
            blocked.add(name)

        if kind == "directory":
            if member.size != 0:
                raise ValueError("NVIDIA archive directory has an invalid size")
            _ensure_stage_parent(stage, destination, directories)
            if destination.exists():
                if destination.is_symlink() or not destination.is_dir():
                    raise ValueError(f"NVIDIA archive directory collides with a file: {name}")
            else:
                destination.mkdir(mode=0o700)
            directories[destination] = (member.mode & 0o755) | 0o700
            reader.report()
        elif kind == "symlink":
            target = _safe_link_target(name, member.linkname)
            if member.size != 0:
                raise ValueError("NVIDIA archive symlink has an invalid size")
            _ensure_stage_parent(stage, destination, directories)
            if destination.exists() or destination.is_symlink():
                raise ValueError(f"NVIDIA archive member collides with a path: {name}")
            symlinks.append((destination, target))
            if name == ENTRYPOINT:
                raise ValueError("NVIDIA runtime entrypoint must be a regular executable")
            reader.report()
        else:
            if member.sparse is not None or member.size < 0:
                raise ValueError("NVIDIA archive contains an unsupported sparse file")
            expanded += member.size
            if expanded > expected_size or expanded > MAX_PAYLOAD_SIZE:
                raise ValueError("NVIDIA runtime exceeds its declared expanded size")
            if name == ENTRYPOINT:
                if not member.mode & 0o100:
                    raise ValueError("NVIDIA runtime entrypoint is not executable")
                entrypoint_seen = True
            _ensure_stage_parent(stage, destination, directories)
            source = archive.extractfile(member)
            if source is None:
                raise ValueError(f"NVIDIA archive file cannot be read: {name}")
            with destination.open("xb") as output:
                remaining = member.size
                while remaining:
                    if reader.should_cancel():
                        raise RuntimeDownloadCancelled("NVIDIA runtime installation cancelled")
                    block = source.read(min(CHUNK_SIZE, remaining))
                    if not block:
                        raise ValueError(f"NVIDIA archive file is truncated: {name}")
                    output.write(block)
                    remaining -= len(block)
                    reader.add_extracted(len(block))
                output.flush()
                os.fsync(output.fileno())
            destination.chmod((member.mode & 0o755) | 0o400)

    if not root_seen or not entrypoint_seen:
        raise ValueError("NVIDIA archive is missing its runtime root or executable entrypoint")
    if expanded != expected_size:
        raise ValueError("NVIDIA runtime expanded size does not match its manifest")

    for destination, target in symlinks:
        if reader.should_cancel():
            raise RuntimeDownloadCancelled("NVIDIA runtime installation cancelled")
        _ensure_stage_parent(stage, destination, directories)
        if destination.exists() or destination.is_symlink():
            raise ValueError("NVIDIA archive symlink collides with an existing path")
        destination.symlink_to(target)
    for directory, mode in sorted(
        directories.items(), key=lambda item: len(item[0].parts), reverse=True
    ):
        directory.chmod(mode)
        _sync_directory(directory)
    _sync_directory(stage)
    reader.report()


def _drain_archive(archive: tarfile.TarFile, reader: _DownloadArchiveReader) -> None:
    while block := archive.fileobj.read(CHUNK_SIZE):
        if reader.should_cancel():
            raise RuntimeDownloadCancelled("NVIDIA runtime installation cancelled")
        if any(block):
            raise ValueError("NVIDIA archive contains data after its tar end marker")


def _tree_digest(root: Path) -> tuple[str, int]:
    entries: list[Path] = []
    pending = [root]
    while pending:
        directory = pending.pop()
        for path in directory.iterdir():
            entries.append(path)
            info = path.lstat()
            if stat.S_ISDIR(info.st_mode):
                pending.append(path)
    entries.sort(
        key=lambda path: path.relative_to(root).as_posix().encode("utf-8", "surrogateescape")
    )
    digest = hashlib.sha256()
    total = 0

    def add_field(value: bytes) -> None:
        digest.update(len(value).to_bytes(8, "big"))
        digest.update(value)

    for path in entries:
        relative = path.relative_to(root).as_posix().encode("utf-8", "surrogateescape")
        info = path.lstat()
        mode = stat.S_IMODE(info.st_mode) & 0o777
        add_field(relative)
        digest.update(mode.to_bytes(4, "big"))
        if stat.S_ISDIR(info.st_mode):
            digest.update(b"d")
        elif stat.S_ISREG(info.st_mode):
            digest.update(b"f")
            digest.update(info.st_size.to_bytes(8, "big"))
            count = 0
            with path.open("rb") as stream:
                for block in iter(lambda: stream.read(CHUNK_SIZE), b""):
                    digest.update(block)
                    count += len(block)
            if count != info.st_size:
                raise OSError("NVIDIA runtime file changed while it was being verified")
            total += count
        elif stat.S_ISLNK(info.st_mode):
            digest.update(b"l")
            target = _safe_link_target(
                relative.decode("utf-8", "surrogateescape"), os.readlink(path)
            )
            add_field(target.encode("utf-8", "surrogateescape"))
        else:
            raise ValueError("Installed NVIDIA runtime contains an unsupported file type")
    return digest.hexdigest(), total


def _state_digest(runtime_dir: Path) -> str | None:
    state_path = runtime_dir / "current.json"
    try:
        if state_path.is_symlink() or not state_path.is_file():
            return None
        state = json.loads(state_path.read_text(encoding="utf-8"))
        digest = state.get("sha256") if isinstance(state, dict) else None
        return digest if isinstance(digest, str) and SHA_PATTERN.fullmatch(digest) else None
    except (OSError, json.JSONDecodeError):
        return None


def _cleanup_staging(runtime_dir: Path) -> None:
    for item in runtime_dir.iterdir():
        if item.name.startswith(".runtime-stage-") and item.is_dir() and not item.is_symlink():
            shutil.rmtree(item, ignore_errors=True)


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
    _cleanup_staging(runtime_dir)
    required = manifest["expanded_size"]
    if shutil.disk_usage(runtime_dir).free < required + min(required // 20, 1_000_000_000):
        raise RuntimeError("Not enough free disk space to install the NVIDIA runtime")
    previous_digest = _state_digest(runtime_dir)
    staging = Path(tempfile.mkdtemp(prefix=".runtime-stage-", dir=runtime_dir))
    reader = _DownloadArchiveReader(manifest, version, request_id, should_cancel, emit)
    candidate: Path | None = None
    created_candidate = False
    try:
        max_tar_size = required + MAX_MEMBERS * 1024 + MAX_TOTAL_PAX_SIZE + 1_000_000
        with gzip.GzipFile(fileobj=reader, mode="rb") as compressed:
            bounded = _BoundedReader(compressed, max_tar_size)
            with tarfile.open(fileobj=bounded, mode="r|", tarinfo=_SafeTarInfo) as archive:
                _extract_archive(archive, staging, required, reader)
                _drain_archive(archive, reader)
        archive_meta = manifest["archive"]
        if (
            reader.downloaded != archive_meta["size"]
            or reader.whole.hexdigest() != archive_meta["sha256"]
        ):
            raise ValueError("NVIDIA runtime archive checksum or size does not match its manifest")

        digest, expanded = _tree_digest(staging)
        if expanded != required:
            raise ValueError("Extracted NVIDIA runtime size does not match its manifest")
        candidate = runtime_dir / digest
        if candidate.exists() or candidate.is_symlink():
            if candidate.is_symlink() or not candidate.is_dir():
                raise RuntimeError("Existing NVIDIA runtime path is not a regular directory")
            try:
                existing_digest, existing_size = _tree_digest(candidate)
                existing_valid = existing_digest == digest and existing_size == expanded
            except (OSError, ValueError):
                existing_valid = False
            if existing_valid:
                shutil.rmtree(staging)
            else:
                shutil.rmtree(candidate)
                os.replace(staging, candidate)
                created_candidate = True
        else:
            os.replace(staging, candidate)
            created_candidate = True
        try:
            _sync_directory(runtime_dir)
        except OSError:
            if created_candidate:
                shutil.rmtree(candidate, ignore_errors=True)
            raise
        try:
            _atomic_json(
                _state_path(data_dir),
                {"version": version, "size": expanded, "sha256": digest},
            )
        except Exception:
            if created_candidate:
                shutil.rmtree(candidate, ignore_errors=True)
            raise
        if previous_digest and previous_digest != digest:
            previous_tree = runtime_dir / previous_digest
            previous_file = runtime_dir / f"{previous_digest}.bin"
            if previous_tree.is_dir() and not previous_tree.is_symlink():
                shutil.rmtree(previous_tree, ignore_errors=True)
            if previous_file.is_file() and not previous_file.is_symlink():
                previous_file.unlink(missing_ok=True)
        _emit(emit, request_id, reader.total, reader.total)
        return {"installed": True, "version": version, "size": required}
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            "A required NVIDIA runtime asset is unavailable for this app version"
        ) from exc
    except tarfile.TarError as exc:
        raise ValueError(f"NVIDIA runtime archive is invalid: {exc}") from exc
    except (gzip.BadGzipFile, EOFError, zlib.error) as exc:
        raise ValueError("NVIDIA runtime archive is malformed or truncated") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError("The NVIDIA runtime download failed") from exc
    finally:
        reader.close()
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def remove(data_dir: Path) -> bool:
    runtime_dir = _runtime_dir(data_dir)
    if not runtime_dir.exists() or runtime_dir.is_symlink():
        return False
    try:
        _ensure_runtime_dir(data_dir)
    except (OSError, ValueError):
        return False
    _cleanup_staging(runtime_dir)
    removed = False
    for item in runtime_dir.iterdir():
        if item.name == "current.json":
            item.unlink(missing_ok=True)
            removed = True
        elif re.fullmatch(r"[0-9a-f]{64}", item.name) and item.is_dir() and not item.is_symlink():
            shutil.rmtree(item)
            removed = True
        elif (
            re.fullmatch(r"[0-9a-f]{64}\.bin", item.name)
            and item.is_file()
            and not item.is_symlink()
        ):
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
        tree_digest, tree_size = _tree_digest(runtime_path.parents[1])
        if tree_digest != installed["sha256"] or tree_size != installed["size"]:
            return None, "Installed NVIDIA runtime tree checksum does not match"
    except (OSError, ValueError):
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
