"""Split and validate the optional Linux CUDA desktop sidecar assets."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import posixpath
import re
import stat
import tarfile
from pathlib import Path
from typing import Any


TARGET = "x86_64-unknown-linux-gnu"
MAX_PART_SIZE = 1_900_000_000
MAX_ASSET_SIZE = 2_000_000_000
MAX_PAYLOAD_SIZE = 20_000_000_000
MAX_PARTS = 12
MAX_MEMBERS = 100_000
MAX_PAX_HEADER_SIZE = 64 * 1024
MAX_TOTAL_PAX_SIZE = 64 * 1024 * 1024
COPY_CHUNK_SIZE = 8 * 1024 * 1024
ENTRYPOINT = "runtime/tts-sidecar-cuda"
INSTALLER_EXTENSIONS = (
    ".app.tar.gz",
    ".msixbundle",
    ".appimage",
    ".appx",
    ".msix",
    ".snap",
    ".dmg",
    ".msi",
    ".deb",
    ".rpm",
    ".exe",
    ".tar.gz",
    ".zip",
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _names(version: str) -> tuple[str, str]:
    if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
        raise ValueError(f"Invalid app version: {version}")
    prefix = f"volo-ai_v{version}_linux_x64_cuda"
    return f"{prefix}.json", prefix


class _SplitWriter:
    def __init__(self, output_dir: Path, prefix: str, limit: int) -> None:
        self.output_dir = output_dir
        self.prefix = prefix
        self.limit = limit
        self.total = 0
        self.whole = hashlib.sha256()
        self.parts: list[dict[str, Any]] = []
        self.paths: list[Path] = []
        self.stream = None
        self.part_hash = None
        self.part_size = 0
        self.closed = False

    def _open_part(self) -> None:
        if len(self.parts) >= MAX_PARTS:
            raise ValueError("CUDA archive exceeds the supported number of release parts")
        name = f"{self.prefix}.part-{len(self.parts) + 1:03d}"
        path = self.output_dir / name
        if path.exists() or path.is_symlink():
            raise FileExistsError(f"CUDA release part already exists: {path}")
        self.stream = path.open("xb")
        self.paths.append(path)
        self.part_hash = hashlib.sha256()
        self.part_size = 0

    def _finish_part(self) -> None:
        if self.stream is None:
            return
        self.stream.flush()
        self.stream.close()
        self.parts.append(
            {
                "name": self.paths[-1].name,
                "size": self.part_size,
                "sha256": self.part_hash.hexdigest(),
            }
        )
        self.stream = None
        self.part_hash = None
        self.part_size = 0

    def write(self, data: bytes) -> int:
        if self.closed:
            raise ValueError("write to closed CUDA archive stream")
        view = memoryview(data)
        written = len(view)
        while view:
            if self.stream is None:
                self._open_part()
            capacity = self.limit - self.part_size
            block = view[:capacity]
            count = self.stream.write(block)
            if count != len(block):
                raise OSError("short write while splitting the CUDA archive")
            self.part_hash.update(block)
            self.whole.update(block)
            self.part_size += count
            self.total += count
            view = view[count:]
            if self.part_size == self.limit:
                self._finish_part()
        return written

    def tell(self) -> int:
        return self.total

    def flush(self) -> None:
        if self.stream is not None:
            self.stream.flush()

    def writable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return False

    def close(self) -> None:
        if not self.closed:
            self._finish_part()
            self.closed = True

    def abort(self) -> None:
        if self.stream is not None:
            self.stream.close()
            self.stream = None
        for path in self.paths:
            path.unlink(missing_ok=True)
        self.closed = True


def _member_name(name: str, *, directory: bool = False) -> str:
    if (
        not isinstance(name, str)
        or not name
        or name.startswith("/")
        or "\\" in name
        or "\0" in name
    ):
        raise ValueError("CUDA archive contains an invalid member path")
    parts = name.split("/")
    if directory and parts[-1] == "":
        parts.pop()
    if not parts or any(part in {"", ".", ".."} for part in parts) or parts[0] != "runtime":
        raise ValueError(f"CUDA archive member escapes its runtime root: {name}")
    return "/".join(parts)


def _safe_link(name: str, target: str) -> str:
    if not target or target.startswith("/") or "\\" in target or "\0" in target:
        raise ValueError(f"CUDA archive has an unsafe symlink target: {name}")
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
    if resolved != "runtime" and not resolved.startswith("runtime/"):
        raise ValueError(f"CUDA archive symlink escapes its runtime root: {name}")
    return target


def _source_mode(mode: int) -> int:
    return stat.S_IMODE(mode) & 0o777


def _add_tree(archive: tarfile.TarFile, root: Path) -> int:
    expanded = 0
    count = 0

    def add(path: Path, archive_name: str) -> None:
        nonlocal count, expanded
        count += 1
        if count > MAX_MEMBERS:
            raise ValueError("CUDA runtime contains too many files")
        source_stat = path.lstat()
        archive_name = _member_name(archive_name, directory=stat.S_ISDIR(source_stat.st_mode))
        info = tarfile.TarInfo(archive_name)
        info.uid = info.gid = info.mtime = 0
        info.uname = info.gname = ""
        info.mode = _source_mode(source_stat.st_mode)
        if stat.S_ISDIR(source_stat.st_mode):
            info.type = tarfile.DIRTYPE
            archive.addfile(info)
            for child in sorted(path.iterdir(), key=lambda item: item.name.encode("utf-8")):
                add(child, f"{archive_name}/{child.name}")
        elif stat.S_ISREG(source_stat.st_mode):
            info.type = tarfile.REGTYPE
            info.size = source_stat.st_size
            expanded += info.size
            if expanded > MAX_PAYLOAD_SIZE:
                raise ValueError("Expanded CUDA runtime exceeds the configured size limit")
            with path.open("rb") as source:
                archive.addfile(info, source)
        elif stat.S_ISLNK(source_stat.st_mode):
            info.type = tarfile.SYMTYPE
            info.mode = 0o777
            info.linkname = _safe_link(archive_name, os.readlink(path))
            archive.addfile(info)
        else:
            raise ValueError(f"CUDA runtime contains an unsupported file: {path}")

    add(root, "runtime")
    return expanded


def split_payload(
    payload: Path,
    output_dir: Path,
    version: str,
    *,
    max_part_size: int = MAX_PART_SIZE,
) -> Path:
    manifest_name, prefix = _names(version)
    executable = payload / "tts-sidecar-cuda"
    if (
        payload.is_symlink()
        or not payload.is_dir()
        or executable.is_symlink()
        or not executable.is_file()
    ):
        raise ValueError("CUDA sidecar payload must be an onedir directory with its executable")
    if not executable.stat().st_mode & 0o100:
        raise ValueError("CUDA sidecar entrypoint is not executable")
    if max_part_size <= 0 or max_part_size > MAX_PART_SIZE:
        raise ValueError("Part size must be positive and within the CUDA part limit")

    output_dir.mkdir(parents=True, exist_ok=True)
    writer = _SplitWriter(output_dir, prefix, max_part_size)
    try:
        with gzip.GzipFile(fileobj=writer, mode="wb", compresslevel=1) as compressed:
            with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as archive:
                expanded_size = _add_tree(archive, payload)
        writer.close()
        if writer.total <= 0 or writer.total > MAX_PAYLOAD_SIZE:
            raise ValueError("CUDA archive is empty or exceeds the configured asset limit")
    except Exception:
        writer.abort()
        raise

    manifest = {
        "format": 2,
        "version": version,
        "target": TARGET,
        "archive": {"size": writer.total, "sha256": writer.whole.hexdigest()},
        "expanded_size": expanded_size,
        "entrypoint": ENTRYPOINT,
        "parts": writer.parts,
    }
    manifest_path = output_dir / manifest_name
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest_path


class _PartsReader:
    def __init__(self, paths: list[Path]) -> None:
        self.paths = iter(paths)
        self.stream = None

    def read(self, size: int = -1) -> bytes:
        result = bytearray()
        while size < 0 or len(result) < size:
            if self.stream is None:
                try:
                    self.stream = next(self.paths).open("rb")
                except StopIteration:
                    break
            amount = COPY_CHUNK_SIZE if size < 0 else min(size - len(result), COPY_CHUNK_SIZE)
            block = self.stream.read(amount)
            if block:
                result.extend(block)
            else:
                self.stream.close()
                self.stream = None
        return bytes(result)

    def close(self) -> None:
        if self.stream is not None:
            self.stream.close()
            self.stream = None


class _BoundedReader:
    def __init__(self, stream: Any, limit: int) -> None:
        self.stream = stream
        self.limit = limit
        self.read_size = 0

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = self.limit - self.read_size + 1
        else:
            size = min(size, self.limit - self.read_size + 1)
        block = self.stream.read(size)
        self.read_size += len(block)
        if self.read_size > self.limit:
            raise ValueError("CUDA tar archive exceeds the expanded stream limit")
        return block


class _SafeTarInfo(tarfile.TarInfo):
    def _proc_member(self, archive: tarfile.TarFile) -> tarfile.TarInfo:
        if self.type == tarfile.XHDTYPE:
            if self.size > MAX_PAX_HEADER_SIZE:
                raise tarfile.ReadError("PAX metadata exceeds the size limit")
            headers = getattr(archive, "_volo_pax_headers", 0) + 1
            if headers > MAX_MEMBERS:
                raise tarfile.ReadError("CUDA archive contains too many PAX headers")
            archive._volo_pax_headers = headers
            total = getattr(archive, "_volo_pax_size", 0) + self.size
            if total > MAX_TOTAL_PAX_SIZE:
                raise tarfile.ReadError("CUDA PAX metadata exceeds the total size limit")
            archive._volo_pax_size = total
        elif self.type not in {
            tarfile.REGTYPE,
            tarfile.AREGTYPE,
            tarfile.DIRTYPE,
            tarfile.SYMTYPE,
        }:
            raise tarfile.ReadError("CUDA archive contains an unsupported member type")
        return super()._proc_member(archive)


def _inspect_archive(
    archive: tarfile.TarFile,
    expected_expanded_size: int,
) -> int:
    seen: set[str] = set()
    implicit_dirs = {"runtime"}
    blocked: set[str] = set()
    expanded = 0
    members = 0
    root_seen = False
    entrypoint_seen = False

    for member in archive:
        members += 1
        if members > MAX_MEMBERS:
            raise ValueError("CUDA archive contains too many members")
        if member.isdir():
            kind = "directory"
        elif member.type in {tarfile.REGTYPE, tarfile.AREGTYPE}:
            kind = "file"
        elif member.issym():
            kind = "symlink"
        else:
            raise ValueError("CUDA archive contains an unsupported member type")
        name = _member_name(member.name, directory=kind == "directory")
        if name in seen:
            raise ValueError(f"CUDA archive contains a duplicate member: {name}")
        parents = name.split("/")[:-1]
        if any(parent in blocked for parent in parents):
            raise ValueError(f"CUDA archive member is nested under a non-directory: {name}")
        if kind != "directory" and name in implicit_dirs:
            raise ValueError(f"CUDA archive member collides with a directory: {name}")
        if kind == "directory" and name in blocked:
            raise ValueError(f"CUDA archive directory collides with a file: {name}")
        for index in range(1, len(name.split("/"))):
            implicit_dirs.add("/".join(name.split("/")[:index]))
        seen.add(name)

        if name == "runtime":
            if kind != "directory":
                raise ValueError("CUDA archive runtime root is not a directory")
            root_seen = True
        if kind != "directory":
            blocked.add(name)
        if kind == "symlink":
            _safe_link(name, member.linkname)
            if member.size != 0:
                raise ValueError("CUDA archive symlink has an invalid size")
        if kind == "directory" and member.size != 0:
            raise ValueError("CUDA archive directory has an invalid size")
        if kind == "file":
            if member.sparse is not None or member.size < 0:
                raise ValueError("CUDA archive contains an unsupported sparse file")
            expanded += member.size
            if expanded > MAX_PAYLOAD_SIZE:
                raise ValueError("Expanded CUDA runtime exceeds the configured size limit")
            if name == ENTRYPOINT:
                if not member.mode & 0o100:
                    raise ValueError("CUDA runtime entrypoint is not executable")
                entrypoint_seen = True

    if not root_seen or not entrypoint_seen:
        raise ValueError("CUDA archive is missing its runtime root or executable entrypoint")
    if expanded != expected_expanded_size:
        raise ValueError("CUDA archive expanded size does not match its manifest")
    return expanded


def _validate_archive(parts: list[Path], manifest: dict[str, Any]) -> None:
    expanded_size = manifest["expanded_size"]
    max_stream_size = expanded_size + MAX_MEMBERS * 1024 + MAX_TOTAL_PAX_SIZE + 1_000_000
    reader = _PartsReader(parts)
    try:
        with gzip.GzipFile(fileobj=reader, mode="rb") as compressed:
            bounded = _BoundedReader(compressed, max_stream_size)
            with tarfile.open(fileobj=bounded, mode="r|", tarinfo=_SafeTarInfo) as archive:
                _inspect_archive(archive, expanded_size)
                while block := archive.fileobj.read(COPY_CHUNK_SIZE):
                    if any(block):
                        raise ValueError("CUDA archive contains data after its tar end marker")
    except (tarfile.TarError, EOFError, gzip.BadGzipFile, OSError) as exc:
        raise ValueError("CUDA archive is malformed or truncated") from exc
    finally:
        reader.close()


def _validate_manifest(assets_dir: Path, version: str) -> list[Path]:
    manifest_name, prefix = _names(version)
    manifest_path = assets_dir / manifest_name
    if (
        not manifest_path.is_file()
        or manifest_path.is_symlink()
        or manifest_path.stat().st_size > 1_000_000
    ):
        raise ValueError(f"Missing or oversized CUDA manifest: {manifest_name}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Invalid CUDA manifest: {manifest_name}") from exc
    if not isinstance(manifest, dict) or set(manifest) != {
        "format",
        "version",
        "target",
        "archive",
        "expanded_size",
        "entrypoint",
        "parts",
    }:
        raise ValueError("CUDA manifest fields do not match the supported format")
    if (
        isinstance(manifest["format"], bool)
        or not isinstance(manifest["format"], int)
        or manifest["format"] != 2
        or manifest["version"] != version
        or manifest["target"] != TARGET
        or manifest["entrypoint"] != ENTRYPOINT
    ):
        raise ValueError("CUDA manifest version, target, or entrypoint does not match the release")
    payload = manifest["archive"]
    parts = manifest["parts"]
    if (
        not isinstance(payload, dict)
        or set(payload) != {"size", "sha256"}
        or isinstance(payload.get("size"), bool)
        or not isinstance(payload.get("size"), int)
        or payload["size"] <= 0
        or payload["size"] > MAX_PAYLOAD_SIZE
        or not re.fullmatch(r"[0-9a-f]{64}", str(payload.get("sha256", "")))
        or isinstance(manifest["expanded_size"], bool)
        or not isinstance(manifest["expanded_size"], int)
        or manifest["expanded_size"] <= 0
        or manifest["expanded_size"] > MAX_PAYLOAD_SIZE
        or not isinstance(parts, list)
        or not parts
        or len(parts) > MAX_PARTS
    ):
        raise ValueError("CUDA manifest archive metadata is invalid")

    expected_names = []
    total = 0
    digest = hashlib.sha256()
    for index, part in enumerate(parts, start=1):
        if (
            not isinstance(part, dict)
            or set(part) != {"name", "size", "sha256"}
            or part.get("name") != f"{prefix}.part-{index:03d}"
            or isinstance(part.get("size"), bool)
            or not isinstance(part.get("size"), int)
            or part["size"] <= 0
            or part["size"] > MAX_PART_SIZE
            or not re.fullmatch(r"[0-9a-f]{64}", str(part.get("sha256", "")))
        ):
            raise ValueError(f"CUDA manifest has invalid part metadata at index {index}")
        path = assets_dir / part["name"]
        if not path.is_file() or path.is_symlink() or path.stat().st_size != part["size"]:
            raise ValueError(f"Missing or invalid CUDA payload part: {part['name']}")
        if _sha256(path) != part["sha256"]:
            raise ValueError(f"CUDA payload checksum mismatch: {part['name']}")
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        total += part["size"]
        expected_names.append(part["name"])
    if total != payload["size"] or digest.hexdigest() != payload["sha256"]:
        raise ValueError("CUDA archive size or checksum does not match its manifest")
    actual_parts = sorted(
        path.name for path in assets_dir.glob(f"{prefix}.part-*") if path.is_file()
    )
    if actual_parts != sorted(expected_names):
        raise ValueError("Unexpected CUDA payload parts are present")
    part_paths = [assets_dir / name for name in expected_names]
    _validate_archive(part_paths, manifest)
    return [manifest_path, *part_paths]


def verify_release_assets(assets_dir: Path, version: str) -> list[Path]:
    _names(version)
    if not assets_dir.is_dir():
        raise ValueError(f"Release assets directory does not exist: {assets_dir}")
    entries = list(assets_dir.iterdir())
    if any(path.is_symlink() or not path.is_file() for path in entries):
        raise ValueError("Release asset directory contains a non-file or symbolic link")
    assets = sorted(entries)
    if not assets:
        raise ValueError("No release assets were staged")
    expected_targets = {("macos", "arm64"), ("windows", "x64"), ("linux", "x64")}
    seen_targets: set[tuple[str, str]] = set()
    linux_extensions: set[str] = set()
    prefix = f"volo-ai_v{version}_"
    for asset in assets:
        size = asset.stat().st_size
        if size <= 0 or size >= MAX_ASSET_SIZE:
            raise ValueError(f"Empty or oversized release asset: {asset.name}")
        if asset.name.startswith(prefix) and any(
            asset.name.endswith(extension) for extension in INSTALLER_EXTENSIONS
        ):
            platform_arch = asset.name[len(prefix) :].rsplit(".", 1)[0]
            for extension in INSTALLER_EXTENSIONS:
                if asset.name.endswith(extension):
                    platform_arch = asset.name[len(prefix) : -len(extension)]
                    break
            try:
                platform, arch = platform_arch.split("_", 1)
            except ValueError as exc:
                raise ValueError(f"Invalid installer asset name: {asset.name}") from exc
            if (platform, arch) not in expected_targets:
                raise ValueError(f"Unexpected installer target in {asset.name}")
            seen_targets.add((platform, arch))
            if (platform, arch) == ("linux", "x64"):
                linux_extensions.add(
                    next(ext for ext in INSTALLER_EXTENSIONS if asset.name.endswith(ext))
                )

    missing = expected_targets - seen_targets
    if missing:
        raise ValueError(
            "Missing installer targets: "
            + ", ".join(f"{os}/{arch}" for os, arch in sorted(missing))
        )
    missing_linux_formats = {".deb", ".rpm", ".appimage"} - linux_extensions
    if missing_linux_formats:
        raise ValueError(
            "Missing Linux installer formats: " + ", ".join(sorted(missing_linux_formats))
        )
    cuda_files = _validate_manifest(assets_dir, version)
    recognized = {path.name for path in cuda_files}
    installer_names = {
        path.name
        for path in assets
        if path.name.startswith(prefix)
        and any(path.name.endswith(extension) for extension in INSTALLER_EXTENSIONS)
    }
    unknown = {path.name for path in assets} - recognized - installer_names
    if unknown:
        raise ValueError("Unexpected release asset(s): " + ", ".join(sorted(unknown)))
    return assets


def verify_cuda_assets(assets_dir: Path, version: str) -> list[Path]:
    if not assets_dir.is_dir():
        raise ValueError(f"CUDA assets directory does not exist: {assets_dir}")
    if any(path.is_symlink() or not path.is_file() for path in assets_dir.iterdir()):
        raise ValueError("CUDA asset directory contains a non-file or symbolic link")
    files = _validate_manifest(assets_dir, version)
    for asset in files:
        if asset.stat().st_size <= 0 or asset.stat().st_size >= MAX_ASSET_SIZE:
            raise ValueError(f"Empty or oversized CUDA asset: {asset.name}")
    if {path.name for path in assets_dir.iterdir() if path.is_file()} != {
        path.name for path in files
    }:
        raise ValueError("Unexpected files are present alongside the CUDA manifest and parts")
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    split_parser = commands.add_parser("split")
    split_parser.add_argument("payload", type=Path)
    split_parser.add_argument("output_dir", type=Path)
    split_parser.add_argument("version")
    verify_parser = commands.add_parser("verify")
    verify_parser.add_argument("assets_dir", type=Path)
    verify_parser.add_argument("version")
    cuda_parser = commands.add_parser("verify-cuda")
    cuda_parser.add_argument("assets_dir", type=Path)
    cuda_parser.add_argument("version")
    args = parser.parse_args()
    try:
        if args.command == "split":
            manifest = split_payload(args.payload, args.output_dir, args.version)
            print(manifest)
        elif args.command == "verify-cuda":
            assets = verify_cuda_assets(args.assets_dir, args.version)
            print(f"Verified {len(assets)} CUDA runtime asset(s)")
        else:
            assets = verify_release_assets(args.assets_dir, args.version)
            print(f"Verified {len(assets)} release asset(s), including all CUDA parts")
    except (OSError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
