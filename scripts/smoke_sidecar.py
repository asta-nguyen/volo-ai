"""Smoke-test a staged PyInstaller onedir sidecar over its JSONL protocol."""

from __future__ import annotations

import json
import os
import platform
import queue
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

TOTAL_TIMEOUT = 120.0
EXIT_TIMEOUT = 20.0
_EOF = object()
_WINDOWS_X64_MACHINES = {"amd64", "x86_64"}
_WINDOWS_X64_AUDIOCPP = "audiocpp-cli-x86_64-pc-windows-msvc.exe"


def _read_reply(
    lines: queue.Queue[str | object], deadline: float, request_id: str | None = None
) -> dict | None:
    """Return the first JSON reply (matching request_id when given) or None."""
    while time.perf_counter() < deadline:
        try:
            line = lines.get(timeout=max(0.0, deadline - time.perf_counter()))
        except queue.Empty:
            return None
        if line is _EOF:
            return None
        try:
            reply = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(reply, dict) and (
            request_id is None or str(reply.get("id")) == request_id
        ):
            return reply
    return None


def _fail(proc: subprocess.Popen, message: str) -> int:
    print(f"smoke_sidecar: {message}", file=sys.stderr)
    proc.kill()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    return 1


def _check_bundled_ffmpeg(sidecar_dir: Path) -> int:
    ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    ffmpeg = sidecar_dir / "_internal" / ffmpeg_name
    if not ffmpeg.is_file():
        print(f"smoke_sidecar: bundled FFmpeg not found: {ffmpeg}", file=sys.stderr)
        return 1
    try:
        check = subprocess.run(
            [str(ffmpeg), "-version"], capture_output=True, text=True, timeout=60
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"smoke_sidecar: bundled FFmpeg failed to launch: {exc}", file=sys.stderr)
        return 1
    if check.returncode != 0:
        detail = check.stderr.strip() or check.stdout.strip()
        print(f"smoke_sidecar: bundled FFmpeg failed to launch: {detail}", file=sys.stderr)
        return 1
    version = check.stdout.splitlines() or ["<no output>"]
    print(f"bundled FFmpeg: {version[0]}")
    return 0


def _audiocpp_cli_name() -> str | None:
    """Return the audio.cpp filename the frozen resolver expects on this host."""
    if os.name == "nt" and platform.machine().lower() in _WINDOWS_X64_MACHINES:
        return _WINDOWS_X64_AUDIOCPP
    return None


def _check_bundled_audiocpp(sidecar_dir: Path) -> int:
    audiocpp_name = _audiocpp_cli_name()
    if audiocpp_name is None:
        return 0
    audiocpp = sidecar_dir / audiocpp_name
    if not audiocpp.is_file():
        print(f"smoke_sidecar: bundled audio.cpp CLI not found: {audiocpp}", file=sys.stderr)
        return 1
    try:
        check = subprocess.run(
            [str(audiocpp), "--help"], capture_output=True, text=True, timeout=60
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(
            f"smoke_sidecar: bundled audio.cpp CLI failed to launch: {exc}",
            file=sys.stderr,
        )
        return 1
    if check.returncode != 0:
        detail = check.stderr.strip() or check.stdout.strip()
        print(
            f"smoke_sidecar: bundled audio.cpp CLI failed to launch: {detail}",
            file=sys.stderr,
        )
        return 1
    print(f"bundled audio.cpp CLI: {audiocpp.name}")
    return 0


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: smoke_sidecar.py <staged sidecar folder>", file=sys.stderr)
        return 1
    sidecar_dir = Path(sys.argv[1])
    name = "tts-sidecar.exe" if os.name == "nt" else "tts-sidecar"
    executable = sidecar_dir / name
    if not executable.is_file():
        print(f"smoke_sidecar: executable not found: {executable}", file=sys.stderr)
        return 1
    if _check_bundled_ffmpeg(sidecar_dir) != 0:
        return 1
    if _check_bundled_audiocpp(sidecar_dir) != 0:
        return 1

    deadline = time.perf_counter() + TOTAL_TIMEOUT
    with tempfile.TemporaryDirectory(prefix="tts-sidecar-smoke-") as data_dir:
        env = dict(os.environ)
        env["TTS_MCP_DATA_DIR"] = data_dir
        env["TTS_MCP_APP_VERSION"] = "0.0.0"
        step = time.perf_counter()
        proc = subprocess.Popen(
            [str(executable)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=env,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        lines: queue.Queue[str | object] = queue.Queue()

        def read_stdout() -> None:
            for line in proc.stdout:
                lines.put(line)
            lines.put(_EOF)

        threading.Thread(target=read_stdout, daemon=True).start()
        try:
            proc.stdin.write("not json\n")
            proc.stdin.flush()
            reply = _read_reply(lines, deadline)
            if (
                reply is None
                or reply.get("ok") is not False
                or reply.get("error", {}).get("code") != "invalid_json"
            ):
                return _fail(proc, f"expected an invalid_json error reply, got {reply!r}")
            print(f"invalid_json reply in {time.perf_counter() - step:.3f}s")

            step = time.perf_counter()
            proc.stdin.write('{"id":"1","type":"status"}\n')
            proc.stdin.flush()
            reply = _read_reply(lines, deadline, request_id="1")
            if reply is None or reply.get("ok") is not True:
                return _fail(proc, f"expected an ok status reply, got {reply!r}")
            print(f"status reply in {time.perf_counter() - step:.3f}s")

            step = time.perf_counter()
            proc.stdin.close()
            try:
                proc.wait(
                    timeout=min(EXIT_TIMEOUT, max(0.0, deadline - time.perf_counter()))
                )
            except subprocess.TimeoutExpired:
                return _fail(proc, "sidecar did not exit within 20s of stdin close")
            print(f"exit in {time.perf_counter() - step:.3f}s")
            return 0
        except (BrokenPipeError, OSError) as exc:
            return _fail(proc, f"sidecar pipe failed: {exc}")


if __name__ == "__main__":
    raise SystemExit(main())
