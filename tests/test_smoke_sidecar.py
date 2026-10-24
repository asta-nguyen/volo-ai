import contextlib
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import smoke_sidecar


class _FakeStdin:
    def __init__(self) -> None:
        self.writes: list[str] = []
        self.closed = False

    def write(self, data: str) -> int:
        self.writes.append(data)
        return len(data)

    def flush(self) -> None:
        pass

    def close(self) -> None:
        self.closed = True


class _FakeProcess:
    def __init__(self, stdout_lines: list[str]) -> None:
        self.stdin = _FakeStdin()
        self.stdout = iter(stdout_lines)
        self.killed = False

    def wait(self, timeout: float | None = None) -> int:
        return 0

    def kill(self) -> None:
        self.killed = True


class SmokeSidecarTests(unittest.TestCase):
    def test_audiocpp_cli_name_only_required_on_windows_x64(self):
        cases = [
            ("posix", "arm64", None),
            ("posix", "x86_64", None),
            ("nt", "ARM64", None),
            ("nt", "AMD64", "audiocpp-cli-x86_64-pc-windows-msvc.exe"),
            ("nt", "x86_64", "audiocpp-cli-x86_64-pc-windows-msvc.exe"),
        ]
        for os_name, machine, expected in cases:
            with self.subTest(os_name=os_name, machine=machine):
                with (
                    patch.object(smoke_sidecar.os, "name", os_name),
                    patch.object(
                        smoke_sidecar.platform, "machine", return_value=machine
                    ),
                ):
                    self.assertEqual(smoke_sidecar._audiocpp_cli_name(), expected)

    def test_main_fails_when_windows_x64_audiocpp_is_missing(self):
        exe_name = "tts-sidecar.exe" if os.name == "nt" else "tts-sidecar"
        ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        with tempfile.TemporaryDirectory() as staging:
            sidecar_dir = Path(staging)
            (sidecar_dir / "_internal").mkdir()
            (sidecar_dir / "_internal" / ffmpeg_name).write_bytes(b"")
            (sidecar_dir / exe_name).write_bytes(b"")

            ok_check = subprocess.CompletedProcess(
                args=[], returncode=0, stdout="ok", stderr=""
            )
            with (
                patch.object(sys, "argv", ["smoke_sidecar.py", str(sidecar_dir)]),
                patch.object(
                    smoke_sidecar,
                    "_audiocpp_cli_name",
                    return_value="audiocpp-cli-x86_64-pc-windows-msvc.exe",
                ),
                patch.object(
                    smoke_sidecar.subprocess, "run", return_value=ok_check
                ),
                patch.object(smoke_sidecar.subprocess, "Popen") as popen,
                contextlib.redirect_stderr(io.StringIO()) as errors,
            ):
                result = smoke_sidecar.main()

        self.assertEqual(result, 1)
        popen.assert_not_called()
        self.assertIn("audiocpp-cli-x86_64-pc-windows-msvc.exe", errors.getvalue())

    def test_main_runs_windows_x64_audiocpp_help(self):
        exe_name = "tts-sidecar.exe" if os.name == "nt" else "tts-sidecar"
        ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        audiocpp_name = "audiocpp-cli-x86_64-pc-windows-msvc.exe"
        with tempfile.TemporaryDirectory() as staging:
            sidecar_dir = Path(staging)
            (sidecar_dir / "_internal").mkdir()
            (sidecar_dir / "_internal" / ffmpeg_name).write_bytes(b"")
            (sidecar_dir / exe_name).write_bytes(b"")
            audiocpp = sidecar_dir / audiocpp_name
            audiocpp.write_bytes(b"")

            proc = _FakeProcess(
                [
                    '{"ok": false, "error": {"code": "invalid_json"}}\n',
                    '{"id": "1", "ok": true}\n',
                ]
            )
            ok_check = subprocess.CompletedProcess(
                args=[], returncode=0, stdout="ok", stderr=""
            )
            with (
                patch.object(sys, "argv", ["smoke_sidecar.py", str(sidecar_dir)]),
                patch.object(
                    smoke_sidecar, "_audiocpp_cli_name", return_value=audiocpp_name
                ),
                patch.object(
                    smoke_sidecar.subprocess, "Popen", side_effect=lambda *a, **k: proc
                ),
                patch.object(
                    smoke_sidecar.subprocess, "run", return_value=ok_check
                ) as run,
                contextlib.redirect_stdout(io.StringIO()),
            ):
                result = smoke_sidecar.main()

        self.assertEqual(result, 0)
        self.assertEqual(
            run.call_args_list[-1].args[0], [str(audiocpp), "--help"]
        )

    def test_main_decodes_sidecar_pipes_as_utf8(self):
        exe_name = "tts-sidecar.exe" if os.name == "nt" else "tts-sidecar"
        ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        with tempfile.TemporaryDirectory() as staging:
            sidecar_dir = Path(staging)
            (sidecar_dir / "_internal").mkdir()
            (sidecar_dir / "_internal" / ffmpeg_name).write_bytes(b"")
            (sidecar_dir / exe_name).write_bytes(b"")
            audiocpp_name = smoke_sidecar._audiocpp_cli_name()
            if audiocpp_name is not None:
                (sidecar_dir / audiocpp_name).write_bytes(b"")

            proc = _FakeProcess(
                [
                    '{"ok": false, "error": {"code": "invalid_json"}}\n',
                    '{"id": "1", "ok": true}\n',
                ]
            )
            ffmpeg_check = subprocess.CompletedProcess(
                args=[], returncode=0, stdout="ffmpeg version 7.1", stderr=""
            )
            with (
                patch.object(sys, "argv", ["smoke_sidecar.py", str(sidecar_dir)]),
                patch.object(
                    smoke_sidecar.subprocess, "Popen", side_effect=lambda *a, **k: proc
                ) as popen,
                patch.object(
                    smoke_sidecar.subprocess, "run", return_value=ffmpeg_check
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                result = smoke_sidecar.main()

        self.assertEqual(result, 0)
        self.assertEqual(popen.call_args.kwargs["encoding"], "utf-8")
        self.assertTrue(popen.call_args.kwargs["text"])
        self.assertFalse(proc.killed)


if __name__ == "__main__":
    unittest.main()
