import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_sidecar


class SidecarBuildTests(unittest.TestCase):
    def test_build_includes_engine_package_and_ffmpeg(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "ffmpeg"
            ffmpeg.write_bytes(b"ffmpeg")
            dist_dir = root / "build" / "sidecar-dist"
            dist_dir.mkdir(parents=True)
            (dist_dir / "tts-sidecar").write_bytes(b"sidecar")

            with (
                patch.object(build_sidecar, "ROOT", root),
                patch.object(build_sidecar, "BINARIES", root / "binaries"),
                patch.object(build_sidecar, "host_triple", return_value="aarch64-apple-darwin"),
                patch.object(build_sidecar.subprocess, "run") as run,
                patch.object(sys, "argv", ["build_sidecar.py", "--ffmpeg", str(ffmpeg)]),
            ):
                build_sidecar.main()

            command = run.call_args.args[0]
            self.assertIn("--collect-all", command)
            self.assertEqual(command[command.index("--collect-all") + 1], "omnivoice")
            self.assertIn("--add-binary", command)
            self.assertIn(f"{ffmpeg.resolve()}:.", command)


if __name__ == "__main__":
    unittest.main()
