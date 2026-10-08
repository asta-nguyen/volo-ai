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
            dist_dir = root / "build" / "sidecar-dist"
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
                ["omnivoice", "vieneu", "vieneu_utils", "onnxruntime"],
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


if __name__ == "__main__":
    unittest.main()
