import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from tts_mcp.engine import Engine, validate_language


class FakeModel:
    def __init__(self):
        self.kwargs = None

    def generate(self, **kwargs):
        self.kwargs = kwargs
        return [np.zeros(8, dtype=np.float32)]


class EngineTests(unittest.TestCase):
    def test_generate_forwards_language(self):
        model = FakeModel()
        engine = Engine()
        engine._model = model

        audio = engine.generate("Xin chao", language="vi")

        self.assertEqual(audio.shape, (8,))
        self.assertEqual(model.kwargs["language"], "vi")

    def test_language_boundary_accepts_only_supported_languages(self):
        self.assertEqual(validate_language("en"), "en")
        self.assertEqual(validate_language("vi"), "vi")
        with self.assertRaises(ValueError):
            validate_language("fr")

    def test_voice_name_rejects_path_traversal(self):
        self.assertEqual(Engine.validate_voice_name("alice_01"), "alice_01")
        with self.assertRaises(ValueError):
            Engine.validate_voice_name("../alice")

    def test_model_status_requires_ready_marker_and_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model_dir = root / "omnivoice"
            tokenizer_dir = model_dir / "audio_tokenizer"
            asr_dir = root / "whisper"
            model_dir.mkdir()
            tokenizer_dir.mkdir()
            asr_dir.mkdir()
            (model_dir / "config.json").write_text("{}")
            (asr_dir / "config.json").write_text("{}")
            marker = root / "ready.json"
            marker.write_text(json.dumps({"model": "k2-fsa/OmniVoice"}))

            with patch("tts_mcp.engine.MODEL_DIR", model_dir), patch(
                "tts_mcp.engine.TOKENIZER_DIR", tokenizer_dir
            ), patch("tts_mcp.engine.ASR_DIR", asr_dir), patch(
                "tts_mcp.engine.READY_MARKER", marker
            ):
                status = Engine().model_status()

        self.assertTrue(status["ready"])


if __name__ == "__main__":
    unittest.main()
