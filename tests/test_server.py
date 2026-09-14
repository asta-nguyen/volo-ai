import unittest
from unittest.mock import patch

from tts_mcp.server import clone


class ServerTests(unittest.TestCase):
    def test_clone_requires_a_reference_or_saved_voice(self):
        with patch("tts_mcp.server.get_engine"):
            with self.assertRaisesRegex(ValueError, "ref_audio_path"):
                clone("hello", "speech.wav")


if __name__ == "__main__":
    unittest.main()
