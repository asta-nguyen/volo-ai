import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_sidecar


class SidecarBuildTests(unittest.TestCase):
    def test_preflight_flags_vieneu_outside_declared_specifier(self):
        with (
            patch.object(
                build_sidecar.importlib.metadata,
                "requires",
                return_value=['vieneu<4,>=3.8.3 ; extra == "desktop-vieneu"'],
            ),
            patch.object(
                build_sidecar.importlib.metadata, "version", return_value="2.5.0"
            ) as version,
        ):
            problems = build_sidecar._check_build_environment()
            self.assertEqual(version.call_args.args[0], "vieneu")
            self.assertEqual(len(problems), 1)
            self.assertIn("vieneu", problems[0])
            self.assertIn("2.5.0", problems[0])

        with (
            patch.object(
                build_sidecar.importlib.metadata,
                "requires",
                return_value=['vieneu<4,>=3.8.3 ; extra == "desktop-vieneu"'],
            ),
            patch.object(build_sidecar.importlib.metadata, "version", return_value="3.8.3"),
        ):
            self.assertEqual(build_sidecar._check_build_environment(), [])

    def test_preflight_requires_installed_project(self):
        with patch.object(
            build_sidecar.importlib.metadata,
            "requires",
            side_effect=build_sidecar.importlib.metadata.PackageNotFoundError,
        ):
            self.assertEqual(
                build_sidecar._check_build_environment(),
                ["tts-mcp is not installed in this environment"],
            )

    def test_builder_aborts_when_environment_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")
            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(
                    build_sidecar,
                    "_check_build_environment",
                    return_value=["vieneu 2.5.0 does not satisfy vieneu<4,>=3.8.3"],
                ),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    ["build_sidecar.py", "--ffmpeg", str(ffmpeg)],
                ),
            ):
                with self.assertRaises(SystemExit) as raised:
                    build_sidecar.main()
            self.assertEqual(raised.exception.code, 2)
            run.assert_not_called()

    def test_builder_stages_both_binaries_for_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")
            audiocpp = root / "audiocpp_cli"
            audiocpp.write_bytes(b"audio.cpp")
            dist_dir = root / "build" / "sidecar-dist" / "tts-sidecar"
            dist_dir.mkdir(parents=True)
            (dist_dir / "tts-sidecar").write_bytes(b"sidecar")

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(build_sidecar, "BINARIES", root / "binaries"),
                patch.object(build_sidecar, "host_triple", return_value="aarch64-apple-darwin"),
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    [
                        "build_sidecar.py",
                        "--ffmpeg",
                        str(ffmpeg),
                        "--audiocpp",
                        str(audiocpp),
                    ],
                ),
            ):
                build_sidecar.main()

            command = run.call_args.args[0]
            collected = [
                command[index + 1]
                for index, value in enumerate(command[:-1])
                if value == "--collect-all"
            ]
            self.assertEqual(
                collected,
                ["omnivoice", "vieneu", "vieneu_utils", "sea_g2p", "onnxruntime", "yt_dlp"],
            )
            self.assertIn("--onefile", command)
            self.assertIn("--add-binary", command)
            self.assertIn(f"{ffmpeg.resolve()}:.", command)
            binaries = root / "binaries"
            self.assertEqual(
                (binaries / "tts-sidecar-aarch64-apple-darwin").read_bytes(), b"sidecar"
            )
            self.assertEqual(
                (binaries / "audiocpp-cli-aarch64-apple-darwin").read_bytes(), b"audio.cpp"
            )

    def test_cuda_builder_can_skip_audiocpp_and_stage_outside_tauri(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")
            dist_dir = root / "build" / "sidecar-dist" / "tts-sidecar-cuda"
            dist_dir.mkdir(parents=True)
            (dist_dir / "tts-sidecar-cuda").write_bytes(b"cuda sidecar")

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(build_sidecar, "BINARIES", root / "binaries"),
                patch.object(build_sidecar, "host_triple", return_value="x86_64-unknown-linux-gnu"),
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    [
                        "build_sidecar.py",
                        "--ffmpeg",
                        str(ffmpeg),
                        "--target",
                        "x86_64-unknown-linux-gnu",
                        "--sidecar-name",
                        "tts-sidecar-cuda",
                        "--output-dir",
                        str(root / "cuda-out"),
                    ],
                ),
            ):
                build_sidecar.main()

            command = run.call_args.args[0]
            self.assertIn("tts-sidecar-cuda", command)
            self.assertEqual(
                (root / "cuda-out" / "tts-sidecar-cuda-x86_64-unknown-linux-gnu").read_bytes(),
                b"cuda sidecar",
            )
            self.assertFalse((root / "binaries").exists())

    def test_cuda_builder_stages_onedir_output_without_changing_onefile_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")
            dist_dir = root / "build" / "sidecar-dist" / "tts-sidecar-cuda"
            onedir = dist_dir / "tts-sidecar-cuda"
            (onedir / "_internal").mkdir(parents=True)
            executable = onedir / "tts-sidecar-cuda"
            executable.write_bytes(b"cuda executable")
            library = onedir / "_internal" / "libtorch.so"
            library.write_bytes(b"cuda library")

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(build_sidecar, "host_triple", return_value="x86_64-unknown-linux-gnu"),
                patch.object(build_sidecar, "_check_build_environment", return_value=[]),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(
                    sys,
                    "argv",
                    [
                        "build_sidecar.py",
                        "--ffmpeg",
                        str(ffmpeg),
                        "--target",
                        "x86_64-unknown-linux-gnu",
                        "--sidecar-name",
                        "tts-sidecar-cuda",
                        "--onedir",
                        "--output-dir",
                        str(root / "cuda-out"),
                    ],
                ),
            ):
                build_sidecar.main()

            command = run.call_args.args[0]
            self.assertIn("--onedir", command)
            self.assertNotIn("--onefile", command)
            staged = root / "cuda-out" / "tts-sidecar-cuda-x86_64-unknown-linux-gnu"
            self.assertEqual((staged / "tts-sidecar-cuda").read_bytes(), b"cuda executable")
            self.assertEqual((staged / "_internal" / "libtorch.so").read_bytes(), b"cuda library")


if __name__ == "__main__":
    unittest.main()
