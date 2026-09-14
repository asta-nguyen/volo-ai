import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from tts_mcp.convert import save_audio


class ConvertTests(unittest.TestCase):
    def test_mp3_requires_ffmpeg(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "speech.mp3"
            with patch("shutil.which", return_value=None), self.assertRaises(RuntimeError):
                save_audio(np.zeros(8, dtype=np.float32), str(output))

    def test_unknown_extension_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "speech.xyz"
            with self.assertRaises(ValueError):
                save_audio(np.zeros(8, dtype=np.float32), str(output))


if __name__ == "__main__":
    unittest.main()
