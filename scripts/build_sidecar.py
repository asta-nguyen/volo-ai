"""Build the Python desktop worker as a PyInstaller onedir sidecar folder."""

from __future__ import annotations

import argparse
import importlib.metadata
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from packaging.requirements import Requirement


ROOT = Path(__file__).resolve().parents[1]
SIDECAR_DIR = ROOT / "apps" / "desktop" / "src-tauri" / "sidecar"
BUILD_EXTRAS = ("mp3", "desktop-vieneu")


def host_triple() -> str:
    output = subprocess.check_output(["rustc", "-vV"], text=True)
    for line in output.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError("Could not determine the Rust host target triple")


def _check_build_environment() -> list[str]:
    """Return declared dependency mismatches in the sidecar build environment."""
    try:
        declared = importlib.metadata.requires("tts-mcp")
    except importlib.metadata.PackageNotFoundError:
        return ["tts-mcp is not installed in this environment"]
    problems = []
    for entry in declared or []:
        requirement = Requirement(entry)
        if requirement.marker is not None and not any(
            requirement.marker.evaluate({"extra": extra}) for extra in BUILD_EXTRAS
        ):
            continue
        try:
            installed = importlib.metadata.version(requirement.name)
        except importlib.metadata.PackageNotFoundError:
            problems.append(f"{requirement.name} is not installed")
            continue
        if not requirement.specifier.contains(installed, prereleases=True):
            problems.append(f"{requirement.name} {installed} does not satisfy {requirement}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", required=True, type=Path, help="FFmpeg executable to bundle")
    parser.add_argument(
        "--audiocpp",
        type=Path,
        help="audio.cpp audiocpp_cli executable to bundle beside the sidecar",
    )
    parser.add_argument(
        "--target", default=None, help="Rust target triple; defaults to the current host"
    )
    parser.add_argument("--sidecar-name", default="tts-sidecar", help="PyInstaller executable name")
    parser.add_argument(
        "--output-dir", type=Path, default=SIDECAR_DIR, help="Directory for the staged sidecar folder"
    )
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.sidecar_name):
        parser.error("--sidecar-name may contain only ASCII letters, digits, '_' and '-'")
    problems = _check_build_environment()
    if problems:
        parser.error(
            "Build environment does not match declared dependencies: "
            + "; ".join(problems)
            + ". Install the extras first: python -m pip install -e '.[mp3,desktop-vieneu]'"
        )

    ffmpeg = args.ffmpeg.resolve()
    if not ffmpeg.is_file():
        parser.error(f"FFmpeg executable not found: {ffmpeg}")
    audiocpp = args.audiocpp.resolve() if args.audiocpp else None
    if audiocpp is not None and not audiocpp.is_file():
        parser.error(f"audio.cpp CLI executable not found: {audiocpp}")

    target = args.target or host_triple()
    extension = ".exe" if target.endswith("windows-msvc") else ""
    dist_dir = ROOT / "build" / "sidecar-dist" / args.sidecar_name
    work_dir = ROOT / "build" / "sidecar-work"
    separator = ";" if os.name == "nt" else ":"

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--name",
        args.sidecar_name,
        "--paths",
        str(ROOT / "src"),
        "--distpath",
        str(dist_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(work_dir),
        "--collect-all",
        "omnivoice",
        "--collect-all",
        "vieneu",
        "--collect-all",
        "vieneu_utils",
        "--collect-all",
        "sea_g2p",
        "--collect-all",
        "onnxruntime",
        "--collect-all",
        "yt_dlp",
        "--add-binary",
        f"{ffmpeg}{separator}.",
        str(ROOT / "src" / "tts_mcp" / "desktop.py"),
    ]
    subprocess.run(command, cwd=ROOT, check=True)

    built = dist_dir / args.sidecar_name
    if not built.is_dir():
        raise RuntimeError(f"PyInstaller did not produce onedir output at {built}")
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / args.sidecar_name
    if destination.exists() or destination.is_symlink():
        if destination.is_dir() and not destination.is_symlink():
            shutil.rmtree(destination)
        else:
            destination.unlink()
    shutil.copytree(built, destination, symlinks=True)
    executable = destination / f"{args.sidecar_name}{extension}"
    if not executable.is_file() or executable.is_symlink():
        raise RuntimeError(f"PyInstaller onedir output has no regular executable: {executable}")
    executable.chmod(executable.stat().st_mode | 0o111)
    print(destination)
    if audiocpp is not None:
        audiocpp_destination = destination / f"audiocpp-cli-{target}{extension}"
        shutil.copy2(audiocpp, audiocpp_destination)
        if not audiocpp_destination.name.endswith(".exe"):
            audiocpp_destination.chmod(audiocpp_destination.stat().st_mode | 0o111)
        print(audiocpp_destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
