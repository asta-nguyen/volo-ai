"""Split and validate the optional Linux CUDA desktop sidecar assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


TARGET = "x86_64-unknown-linux-gnu"
MAX_PART_SIZE = 1_900_000_000
MAX_ASSET_SIZE = 2_000_000_000
MAX_PAYLOAD_SIZE = 20_000_000_000
MAX_PARTS = 12
COPY_CHUNK_SIZE = 8 * 1024 * 1024
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


def split_payload(
    payload: Path,
    output_dir: Path,
    version: str,
    *,
    max_part_size: int = MAX_PART_SIZE,
) -> Path:
    manifest_name, prefix = _names(version)
    if (
        not payload.is_file()
        or payload.stat().st_size <= 0
        or payload.stat().st_size > MAX_PAYLOAD_SIZE
    ):
        raise ValueError("CUDA sidecar payload must be a non-empty file")
    if max_part_size <= 0 or max_part_size >= MAX_ASSET_SIZE:
        raise ValueError("Part size must be positive and below the GitHub asset limit")

    output_dir.mkdir(parents=True, exist_ok=True)
    whole = hashlib.sha256()
    parts: list[dict[str, Any]] = []
    payload_size = 0
    with payload.open("rb") as source:
        index = 1
        while True:
            name = f"{prefix}.part-{index:03d}"
            destination = output_dir / name
            part_hash = hashlib.sha256()
            part_size = 0
            with destination.open("wb") as output:
                while part_size < max_part_size:
                    block = source.read(min(COPY_CHUNK_SIZE, max_part_size - part_size))
                    if not block:
                        break
                    output.write(block)
                    part_hash.update(block)
                    whole.update(block)
                    part_size += len(block)
            if part_size == 0:
                destination.unlink(missing_ok=True)
                break
            payload_size += part_size
            parts.append({"name": name, "size": part_size, "sha256": part_hash.hexdigest()})
            index += 1

    manifest = {
        "format": 1,
        "version": version,
        "target": TARGET,
        "payload": {"size": payload_size, "sha256": whole.hexdigest()},
        "parts": parts,
    }
    manifest_path = output_dir / manifest_name
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest_path


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
        "payload",
        "parts",
    }:
        raise ValueError("CUDA manifest fields do not match the supported format")
    if (
        isinstance(manifest["format"], bool)
        or not isinstance(manifest["format"], int)
        or manifest["format"] != 1
        or manifest["version"] != version
        or manifest["target"] != TARGET
    ):
        raise ValueError("CUDA manifest version or target does not match the release")
    payload = manifest["payload"]
    parts = manifest["parts"]
    if (
        not isinstance(payload, dict)
        or set(payload) != {"size", "sha256"}
        or isinstance(payload.get("size"), bool)
        or not isinstance(payload.get("size"), int)
        or payload["size"] <= 0
        or payload["size"] > MAX_PAYLOAD_SIZE
        or not re.fullmatch(r"[0-9a-f]{64}", str(payload.get("sha256", "")))
        or not isinstance(parts, list)
        or not parts
        or len(parts) > MAX_PARTS
    ):
        raise ValueError("CUDA manifest payload metadata is invalid")

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
        raise ValueError("CUDA payload size or checksum does not match its manifest")
    actual_parts = sorted(
        path.name for path in assets_dir.glob(f"{prefix}.part-*") if path.is_file()
    )
    if actual_parts != sorted(expected_names):
        raise ValueError("Unexpected CUDA payload parts are present")
    return [manifest_path, *(assets_dir / name for name in expected_names)]


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
