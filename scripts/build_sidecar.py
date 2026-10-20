"""Build the Python desktop worker as a Tauri target-named sidecar."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BINARIES = ROOT / "apps" / "desktop" / "src-tauri" / "binaries"


def host_triple() -> str:
    output = subprocess.check_output(["rustc", "-vV"], text=True)
    for line in output.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError("Could not determine the Rust host target triple")


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
        "--output-dir", type=Path, default=BINARIES, help="Directory for packaged executables"
    )
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.sidecar_name):
        parser.error("--sidecar-name may contain only ASCII letters, digits, '_' and '-'")

    ffmpeg = args.ffmpeg.resolve()
    if not ffmpeg.is_file():
        parser.error(f"FFmpeg executable not found: {ffmpeg}")
    audiocpp = args.audiocpp.resolve() if args.audiocpp else None
    if audiocpp is not None and not audiocpp.is_file():
        parser.error(f"audio.cpp CLI executable not found: {audiocpp}")

    target = args.target or host_triple()
    extension = ".exe" if target.endswith("windows-msvc") else ""
    output_name = f"tts-sidecar-{target}{extension}"
    dist_dir = ROOT / "build" / "sidecar-dist" / args.sidecar_name
    work_dir = ROOT / "build" / "sidecar-work"
    separator = ";" if os.name == "nt" else ":"

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
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
        "--add-binary",
        f"{ffmpeg}{separator}.",
        str(ROOT / "src" / "tts_mcp" / "desktop.py"),
    ]
    subprocess.run(command, cwd=ROOT, check=True)

    built = dist_dir / f"{args.sidecar_name}{extension}"
    if not built.is_file():
        raise RuntimeError(f"PyInstaller did not produce {built}")
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / output_name.replace("tts-sidecar", args.sidecar_name, 1)
    shutil.copy2(built, destination)
    if not destination.name.endswith(".exe"):
        destination.chmod(destination.stat().st_mode | 0o111)
    print(destination)
    if audiocpp is not None:
        audiocpp_destination = output_dir / f"audiocpp-cli-{target}{extension}"
        shutil.copy2(audiocpp, audiocpp_destination)
        if not audiocpp_destination.name.endswith(".exe"):
            audiocpp_destination.chmod(audiocpp_destination.stat().st_mode | 0o111)
        print(audiocpp_destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
