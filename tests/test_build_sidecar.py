import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_sidecar


class SidecarBuildTests(unittest.TestCase):
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
                ["omnivoice", "vieneu", "vieneu_utils", "sea_g2p", "onnxruntime"],
            )
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


if __name__ == "__main__":
    unittest.main()
