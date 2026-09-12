"""Build the Python desktop worker as a Tauri target-named sidecar."""

from __future__ import annotations

import argparse
import os
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
    parser.add_argument("--target", default=None, help="Rust target triple; defaults to the current host")
    args = parser.parse_args()

    ffmpeg = args.ffmpeg.resolve()
    if not ffmpeg.is_file():
        parser.error(f"FFmpeg executable not found: {ffmpeg}")

    target = args.target or host_triple()
    extension = ".exe" if target.endswith("windows-msvc") else ""
    output_name = f"tts-sidecar-{target}{extension}"
    dist_dir = ROOT / "build" / "sidecar-dist"
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
        "tts-sidecar",
        "--distpath",
        str(dist_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(work_dir),
        "--collect-all",
        "omnivoice",
        "--add-binary",
        f"{ffmpeg}{separator}.",
        str(ROOT / "src" / "tts_mcp" / "desktop.py"),
    ]
    subprocess.run(command, cwd=ROOT, check=True)

    built = dist_dir / f"tts-sidecar{extension}"
    if not built.is_file():
        raise RuntimeError(f"PyInstaller did not produce {built}")
    BINARIES.mkdir(parents=True, exist_ok=True)
    destination = BINARIES / output_name
    shutil.copy2(built, destination)
    if not destination.name.endswith(".exe"):
        destination.chmod(destination.stat().st_mode | 0o111)
    print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
