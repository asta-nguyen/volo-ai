"""Build the Python desktop worker as a PyInstaller onedir sidecar folder."""

from __future__ import annotations

import argparse
import importlib.metadata
import os
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

from packaging.requirements import Requirement


ROOT = Path(__file__).resolve().parents[1]
SIDECAR_DIR = ROOT / "apps" / "desktop" / "src-tauri" / "sidecar"
BUILD_EXTRAS = ("mp3", "desktop-vieneu")
FFMPEG_LIB_DIR = "ffmpeg-libs"
WINDOWS_X64_TARGET = "x86_64-pc-windows-msvc"
_SYSTEM_DYLIB_PREFIXES = ("/usr/lib/", "/System/")
_DEPENDENCY_COMMANDS = ("cmd LC_LOAD_DYLIB", "cmd LC_LOAD_WEAK_DYLIB", "cmd LC_REEXPORT_DYLIB")
_LDD_RESOLVED = re.compile(r"^\s*(\S+)\s+=>\s+(\S+)\s+\(0x[0-9a-fA-F]+\)")
_LDD_MISSING = re.compile(r"^\s*(\S+)\s+=>\s+not found")
_LINUX_SYSTEM_LIBS = (
    "ld-linux",
    "ld64.so",
    "ld-musl",
    "linux-vdso.so",
    "linux-gate.so",
    "libc.so",
    "libc_malloc_debug.so",
    "libm.so",
    "libmvec.so",
    "libdl.so",
    "librt.so",
    "libpthread.so",
    "libutil.so",
    "libresolv.so",
    "libnsl.so",
    "libnss_",
    "libanl.so",
    "libBrokenLocale.so",
    "libthread_db.so",
)


def _load_command_field(line: str, field: str) -> str:
    match = re.match(rf"\s*{field}\s+(.+?)\s+\(offset \d+\)\s*$", line)
    if match is None:
        raise RuntimeError(f"Unexpected otool output line: {line!r}")
    return match.group(1)


def _macho_dependencies(path: Path) -> tuple[list[str], list[str]]:
    """Return (dependent dylib names, rpath entries) of a Mach-O binary."""
    output = subprocess.check_output(["otool", "-l", str(path)], text=True)
    deps: list[str] = []
    rpaths: list[str] = []
    lines = output.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped in _DEPENDENCY_COMMANDS:
            deps.append(_load_command_field(lines[index + 2], "name"))
        elif stripped == "cmd LC_RPATH":
            rpaths.append(_load_command_field(lines[index + 2], "path"))
    return deps, rpaths


def _resolve_dylib(
    name: str, referer: Path, rpaths: list[str], executable_dir: Path
) -> Path | None:
    """Resolve a dylib install name to a file on disk, or None if unresolved."""
    if name.startswith("@loader_path/"):
        return referer.parent / name[len("@loader_path/") :]
    if name.startswith("@executable_path/"):
        return executable_dir / name[len("@executable_path/") :]
    if name.startswith("@rpath/"):
        suffix = name[len("@rpath/") :]
        for rpath in rpaths:
            expanded = rpath.replace("@loader_path", str(referer.parent)).replace(
                "@executable_path", str(executable_dir)
            )
            candidate = Path(expanded) / suffix
            if candidate.is_file():
                return candidate
        return None
    return Path(name)


def _stage_macos_ffmpeg(ffmpeg: Path, stage_dir: Path) -> list[tuple[Path, str]]:
    """Stage ffmpeg plus its non-system dylib closure as an isolated payload.

    Every staged file is rewritten to load its bundled dylibs via @loader_path,
    so the sidecar never resolves build-host library paths or collides with the
    Python wheels' own dylibs in the flat _internal directory. Returns the
    (source, destination) pairs to copy into _internal after PyInstaller runs.
    """
    executable = ffmpeg.resolve()
    executable_dir = executable.parent
    lib_dir = stage_dir / FFMPEG_LIB_DIR
    references: dict[Path, list[tuple[str, Path]]] = {}
    members: list[Path] = []
    queued = {executable}
    pending = [executable]
    while pending:
        current = pending.pop(0)
        deps, rpaths = _macho_dependencies(current)
        for dep in deps:
            if dep.startswith(_SYSTEM_DYLIB_PREFIXES):
                continue
            dep_path = _resolve_dylib(dep, current, rpaths, executable_dir)
            if dep_path is None or not dep_path.is_file():
                raise RuntimeError(
                    f"Bundled FFmpeg dependency not found: {dep} referenced by {current}"
                )
            resolved = dep_path.resolve()
            if resolved == current or resolved == executable:
                continue
            references.setdefault(current, []).append((dep, resolved))
            if resolved not in queued:
                queued.add(resolved)
                pending.append(resolved)
                members.append(resolved)
    staged_names = [library.name for library in members]
    if len(set(staged_names)) != len(staged_names):
        raise RuntimeError("Bundled FFmpeg staging hit a dylib name collision")

    shutil.rmtree(stage_dir, ignore_errors=True)
    stage_dir.mkdir(parents=True)
    staged_exe = stage_dir / executable.name
    shutil.copy2(executable, staged_exe)
    staged_exe.chmod(staged_exe.stat().st_mode | 0o200)
    staged: list[tuple[Path, str]] = [(staged_exe, ".")]
    staged_files: dict[Path, Path] = {executable: staged_exe}
    if members:
        lib_dir.mkdir()
        staged.append((lib_dir, lib_dir.name))
        for library in members:
            target = lib_dir / library.name
            shutil.copy2(library, target)
            target.chmod(target.stat().st_mode | 0o200)
            staged_files[library] = target
    for source, target in staged_files.items():
        prefix = (
            "@loader_path/"
            if target.parent == lib_dir
            else f"@loader_path/{lib_dir.name}/"
        )
        changes: list[str] = []
        for original, resolved in references.get(source, []):
            changes.extend(["-change", original, f"{prefix}{resolved.name}"])
        if changes:
            subprocess.run(["install_name_tool", *changes, str(target)], check=True)
        subprocess.run(["codesign", "--force", "--sign", "-", str(target)], check=True)
    return staged


def _is_linux_system_library(soname: str) -> bool:
    """Return True for glibc-family sonames tied to the host's dynamic loader."""
    return any(soname.startswith(prefix) for prefix in _LINUX_SYSTEM_LIBS)


def _elf_dependencies(path: Path) -> list[tuple[str, Path]]:
    """Return (soname, resolved library path) pairs of a dynamically linked ELF."""
    output = subprocess.check_output(["ldd", str(path)], text=True)
    deps: list[tuple[str, Path]] = []
    for line in output.splitlines():
        resolved = _LDD_RESOLVED.match(line)
        if resolved is not None:
            deps.append((resolved.group(1), Path(resolved.group(2))))
            continue
        missing = _LDD_MISSING.match(line)
        if missing is not None:
            raise RuntimeError(
                f"Bundled FFmpeg dependency not found: {missing.group(1)} referenced by {path}"
            )
    return deps


def _stage_linux_ffmpeg(ffmpeg: Path, stage_dir: Path) -> list[tuple[Path, str]]:
    """Stage ffmpeg plus its non-glibc shared-library closure as an isolated payload.

    Every staged file gets an rpath pointing at the bundled ffmpeg-libs directory,
    so the sidecar never resolves host library paths or collides with the Python
    wheels' own shared objects in the flat _internal directory. Returns the
    (source, destination) pairs to copy into _internal after PyInstaller runs.
    """
    executable = ffmpeg.resolve()
    lib_dir = stage_dir / FFMPEG_LIB_DIR
    members: dict[str, Path] = {}
    queued = {executable}
    pending = [executable]
    while pending:
        current = pending.pop(0)
        for soname, dep_path in _elf_dependencies(current):
            if _is_linux_system_library(soname):
                continue
            resolved = dep_path.resolve()
            if resolved == current or resolved == executable:
                continue
            existing = members.get(soname)
            if existing is not None and existing != resolved:
                raise RuntimeError(
                    f"Bundled FFmpeg staging hit a shared-library name collision: {soname}"
                )
            members[soname] = resolved
            if resolved not in queued:
                queued.add(resolved)
                pending.append(resolved)

    shutil.rmtree(stage_dir, ignore_errors=True)
    stage_dir.mkdir(parents=True)
    staged_exe = stage_dir / executable.name
    shutil.copy2(executable, staged_exe)
    staged_exe.chmod(staged_exe.stat().st_mode | 0o200)
    staged: list[tuple[Path, str]] = [(staged_exe, ".")]
    if members:
        lib_dir.mkdir()
        staged.append((lib_dir, lib_dir.name))
        for soname, library in members.items():
            target = lib_dir / soname
            shutil.copy2(library, target)
            target.chmod(target.stat().st_mode | 0o200)
        subprocess.run(
            [
                "patchelf",
                "--force-rpath",
                "--set-rpath",
                f"$ORIGIN/{lib_dir.name}",
                str(staged_exe),
            ],
            check=True,
        )
        for soname in members:
            subprocess.run(
                ["patchelf", "--force-rpath", "--set-rpath", "$ORIGIN", str(lib_dir / soname)],
                check=True,
            )
    return staged


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
    chocolatey_install = os.environ.get("ChocolateyInstall")
    if chocolatey_install:
        shim_dir = (Path(chocolatey_install) / "bin").resolve()
        if shim_dir in ffmpeg.parents:
            parser.error(
                f"FFmpeg executable is a Chocolatey ShimGen launcher: {ffmpeg}. "
                "Bundle the real ffmpeg.exe from the package's tools directory instead."
            )
    audiocpp = args.audiocpp.resolve() if args.audiocpp else None
    if audiocpp is not None and not audiocpp.is_file():
        parser.error(f"audio.cpp CLI executable not found: {audiocpp}")

    target = args.target or host_triple()
    if "windows" in target:
        if target != WINDOWS_X64_TARGET:
            parser.error(
                f"Unsupported Windows target {target}: only {WINDOWS_X64_TARGET} "
                "is supported."
            )
        host = host_triple() if args.target else target
        if host != WINDOWS_X64_TARGET:
            parser.error(
                f"Cannot build Windows target {target} on host {host}: PyInstaller "
                "is not a cross-compiler. Run this script on a native x64 Windows "
                f"host ({WINDOWS_X64_TARGET}) to produce a working .exe sidecar."
            )
        if struct.calcsize("P") * 8 != 64:
            parser.error(
                f"Building {target} requires a 64-bit Python interpreter; install "
                "a 64-bit Python on Windows x64 and retry."
            )
    extension = ".exe" if target.endswith("windows-msvc") else ""
    dist_dir = ROOT / "build" / "sidecar-dist" / args.sidecar_name
    work_dir = ROOT / "build" / "sidecar-work"
    separator = ";" if os.name == "nt" else ":"
    staged_ffmpeg: list[tuple[Path, str]] = []
    ffmpeg_args = ["--add-binary", f"{ffmpeg}{separator}."]
    if target.endswith("apple-darwin"):
        staged_ffmpeg = _stage_macos_ffmpeg(ffmpeg, ROOT / "build" / "ffmpeg-macos")
        ffmpeg_args = []
    elif "linux" in target:
        staged_ffmpeg = _stage_linux_ffmpeg(ffmpeg, ROOT / "build" / "ffmpeg-linux")
        ffmpeg_args = []

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
        *ffmpeg_args,
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
    for source, relative in staged_ffmpeg:
        target_path = destination / "_internal" / relative
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, target_path, dirs_exist_ok=True)
        else:
            shutil.copy2(source, target_path)
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
