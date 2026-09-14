import json
import tempfile
import unittest
import wave
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

    @staticmethod
    def create_voice_clone_prompt(ref_audio, ref_text=None):
        class FakePrompt:
            def save(self, path):
                Path(path).write_bytes(b"prompt")

        return FakePrompt()


class EngineTests(unittest.TestCase):
    @staticmethod
    def write_wav(path: Path) -> None:
        with wave.open(str(path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(24000)
            audio.writeframes(b"\x00\x00")

    def storage_patches(self, root: Path):
        return patch.multiple(
            "tts_mcp.engine",
            DATA_DIR=root,
            DB_PATH=root / "volo.db",
            VOICES_DIR=root / "voices",
        )

    def test_generate_forwards_language(self):
        model = FakeModel()
        engine = Engine()
        engine._model = model

        audio = engine.generate("Xin chao", language="vi")

        self.assertEqual(audio.shape, (8,))
        self.assertEqual(model.kwargs["language"], "vi")

    def test_generate_forwards_duration_and_omnivoice_config(self):
        model = FakeModel()
        engine = Engine()
        engine._model = model
        generation_config = {
            "guidance_scale": 2.5,
            "t_shift": 0.2,
            "position_temperature": 4.0,
            "class_temperature": 0.3,
            "layer_penalty_factor": 4.5,
            "denoise": False,
            "preprocess_prompt": False,
            "postprocess_output": False,
            "audio_chunk_duration": 12.0,
            "audio_chunk_threshold": 24.0,
            "pad_duration": 0.05,
            "fade_duration": 0.05,
            "text": "must not replace the request",
        }

        engine.generate(
            "hello",
            language="en",
            instruct="female, warm",
            speed=1.2,
            num_step=48,
            duration=8.0,
            normalize_text=True,
            generation_config=generation_config,
        )

        self.assertEqual(model.kwargs["text"], "hello")
        self.assertEqual(model.kwargs["duration"], 8.0)
        self.assertTrue(model.kwargs["normalize_text"])
        self.assertEqual(model.kwargs["instruct"], "female, warm")
        for key, value in generation_config.items():
            if key != "text":
                self.assertEqual(model.kwargs[key], value)

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

            with (
                patch("tts_mcp.engine.MODEL_DIR", model_dir),
                patch("tts_mcp.engine.TOKENIZER_DIR", tokenizer_dir),
                patch("tts_mcp.engine.ASR_DIR", asr_dir),
                patch("tts_mcp.engine.READY_MARKER", marker),
            ):
                status = Engine().model_status()

        self.assertTrue(status["ready"])

    def test_storage_creates_production_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.storage_patches(root):
                connection = Engine._open_storage()
                tables = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }
                self.assertIn("voice_profiles", tables)
                self.assertIn("app_seeds", tables)
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)
                self.assertEqual(connection.execute("PRAGMA foreign_keys").fetchone()[0], 1)
                self.assertEqual(connection.execute("PRAGMA busy_timeout").fetchone()[0], 5000)
                connection.close()

    def test_save_voice_copies_reference_and_persists_metadata(self):
        engine = Engine()
        engine._model = FakeModel()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                saved_path = Path(engine.save_voice("demo", str(source), "xin chao", "vi"))
                voices = Engine.list_voices()
                self.assertEqual(len(voices), 1)
                self.assertEqual(voices[0]["language"], "vi")
                self.assertFalse(voices[0]["is_default"])
                self.assertEqual(Path(voices[0]["ref_audio"]).parent.name, "demo")
                self.assertTrue(saved_path.is_file())
                self.assertTrue((root / "voices" / "demo" / "reference.wav").is_file())
                self.assertNotEqual(Path(voices[0]["ref_audio"]), source)
                self.assertTrue(Engine.delete_voice("demo"))
                self.assertFalse((root / "voices" / "demo").exists())
                self.assertTrue(source.exists())

    def test_default_voice_is_unique_per_language(self):
        engine = Engine()
        engine._model = FakeModel()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.wav"
            self.write_wav(source)
            with self.storage_patches(root):
                engine.save_voice("vi_one", str(source), language="vi", is_default=True)
                engine.save_voice("vi_two", str(source), language="vi", is_default=True)
                engine.save_voice("en_one", str(source), language="en", is_default=True)
                defaults = {
                    voice["language"]: voice["name"]
                    for voice in Engine.list_voices()
                    if voice["is_default"]
                }
                self.assertEqual(defaults, {"vi": "vi_one", "en": "en_one"})

    def test_legacy_profiles_migrate_to_local_paths(self):
        engine = Engine()
        engine._model = FakeModel()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "legacy.wav"
            self.write_wav(source)
            voices_dir = root / "voices"
            voices_dir.mkdir()
            (voices_dir / "legacy.pt").write_bytes(b"legacy prompt")
            (voices_dir / "legacy.json").write_text(
                json.dumps(
                    {
                        "name": "legacy",
                        "ref_audio": str(source),
                        "ref_text": "legacy text",
                    }
                )
            )
            with self.storage_patches(root):
                voices = Engine.list_voices()
                self.assertEqual(voices[0]["name"], "legacy")
                self.assertTrue((voices_dir / "legacy" / "prompt.pt").exists())
                self.assertTrue((voices_dir / "legacy" / "reference.wav").exists())
                self.assertNotEqual(Path(voices[0]["ref_audio"]), source)
                self.assertTrue((voices_dir / "legacy.json").exists())

    def test_seed_import_is_idempotent_and_marks_default(self):
        engine = Engine()
        engine._model = FakeModel()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_folder = root / "seed-voices" / "omnivoice-demo"
            seed_folder.mkdir(parents=True)
            source = seed_folder / "reference.wav"
            self.write_wav(source)
            (seed_folder / "manifest.json").write_text(
                json.dumps(
                    {
                        "id": "omnivoice-demo",
                        "version": 1,
                        "name": "OmniVoice-Demo",
                        "language": "vi",
                        "default": True,
                        "ref_text": "Xin chao",
                        "audio": "reference.wav",
                    }
                )
            )
            with self.storage_patches(root):
                first = engine.import_seed_voices(str(seed_folder.parent))
                second = engine.import_seed_voices(str(seed_folder.parent))
                self.assertEqual([item["name"] for item in first["imported"]], ["OmniVoice-Demo"])
                self.assertEqual(second["skipped"][0]["reason"], "already_installed")
                profile = Engine.list_voices()[0]
                self.assertEqual(profile["language"], "vi")
                self.assertTrue(profile["is_default"])
                self.assertIn(root.resolve(), Path(profile["ref_audio"]).resolve().parents)

    def test_seed_manifest_rejects_path_traversal(self):
        engine = Engine()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed_folder = root / "seed-voices" / "bad-seed"
            seed_folder.mkdir(parents=True)
            (root / "outside.wav").write_bytes(b"not audio")
            (seed_folder / "manifest.json").write_text(
                json.dumps(
                    {
                        "id": "bad-seed",
                        "version": 1,
                        "name": "BadSeed",
                        "language": "en",
                        "default": False,
                        "audio": "../outside.wav",
                    }
                )
            )
            with self.storage_patches(root):
                result = engine.import_seed_voices(str(seed_folder.parent))
                self.assertEqual(len(result["errors"]), 1)
                self.assertIn("inside its seed folder", result["errors"][0]["message"])


if __name__ == "__main__":
    unittest.main()
