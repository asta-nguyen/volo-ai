import io
import json
import tempfile
import time
import unittest
import wave
from pathlib import Path
from unittest.mock import Mock, patch

from tts_mcp.desktop import dispatch_request, run_protocol
from tts_mcp.engine import DownloadCancelled


class DesktopWorkerTests(unittest.TestCase):
    @staticmethod
    def write_wav(path: Path) -> None:
        with wave.open(str(path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(24000)
            audio.writeframes(b"\x00\x00")

    def test_status_returns_supported_languages(self):
        engine = Mock()
        engine.model_status.return_value = {
            "ready": False,
            "device": "cpu",
            "model": "model-id",
            "tokenizer": "tokenizer-id",
            "asr_model": "asr-id",
        }

        response = dispatch_request({"id": "1", "type": "status"}, engine)

        self.assertTrue(response["ok"])
        self.assertEqual(response["result"]["languages"], ["en", "vi"])
        self.assertEqual(response["result"]["model"], "model-id")
        self.assertEqual(response["result"]["tokenizer"], "tokenizer-id")
        self.assertEqual(response["result"]["asr_model"], "asr-id")

    def test_invalid_language_returns_structured_error(self):
        response = dispatch_request(
            {
                "id": "2",
                "type": "synthesize",
                "text": "hello",
                "language": "fr",
                "voice": "auto",
                "speed": 1.0,
                "format": "wav",
            },
            Mock(),
        )

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "invalid_input")

    def test_protocol_emits_json_lines(self):
        engine = Mock()
        engine.model_status.return_value = {
            "ready": True,
            "device": "cpu",
            "model": "model-id",
            "tokenizer": "tokenizer-id",
            "asr_model": "asr-id",
        }
        source = io.StringIO(json.dumps({"id": "1", "type": "status"}) + "\n")
        target = io.StringIO()

        run_protocol(source, target, engine)

        result = json.loads(target.getvalue())
        self.assertEqual(result["id"], "1")
        self.assertTrue(result["ok"])

    def test_reference_audio_rejects_unsupported_extension(self):
        engine = Mock()
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "reference.txt"
            reference.write_text("not audio")

            response = dispatch_request(
                {
                    "id": "4",
                    "type": "synthesize",
                    "text": "hello",
                    "language": "en",
                    "voice": "file",
                    "ref_audio": str(reference),
                    "format": "wav",
                },
                engine,
            )

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "invalid_input")
        engine.generate.assert_not_called()

    def test_reference_audio_rejects_invalid_file_contents(self):
        engine = Mock()
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "reference.wav"
            reference.write_text("not audio")

            response = dispatch_request(
                {
                    "id": "4b",
                    "type": "synthesize",
                    "text": "hello",
                    "language": "en",
                    "voice": "file",
                    "ref_audio": str(reference),
                    "format": "wav",
                },
                engine,
            )

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "invalid_input")
        engine.generate.assert_not_called()

    def test_synthesize_validates_and_saves_reference_audio(self):
        engine = Mock()
        engine.generate.return_value = object()
        progress = []
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "reference.wav"
            self.write_wav(reference)
            output_dir = Path(directory) / "outputs"
            with patch("tts_mcp.desktop.OUTPUT_DIR", output_dir), patch(
                "tts_mcp.desktop.save_audio", return_value=str(output_dir / "result.wav")
            ) as save_audio:
                response = dispatch_request(
                    {
                        "id": "5",
                        "type": "synthesize",
                        "text": "hello",
                        "language": "vi",
                        "voice": "file",
                        "ref_audio": str(reference),
                        "ref_text": "xin chao",
                        "speed": 1.25,
                        "format": "wav",
                    },
                    engine,
                    emit=progress.append,
                )

        self.assertTrue(response["ok"])
        self.assertEqual(response["result"]["format"], "wav")
        self.assertEqual(engine.generate.call_args.kwargs["language"], "vi")
        self.assertEqual(engine.generate.call_args.kwargs["ref_audio"], str(reference))
        save_audio.assert_called_once()

    def test_synthesize_supports_voice_design_and_advanced_config(self):
        engine = Mock()
        engine.generate.return_value = object()
        output_dir = Path(tempfile.mkdtemp())
        config = {
            "guidance_scale": 2.5,
            "t_shift": 0.2,
            "denoise": False,
            "audio_chunk_duration": 12,
        }
        try:
            with patch("tts_mcp.desktop.OUTPUT_DIR", output_dir), patch(
                "tts_mcp.desktop.save_audio", return_value=str(output_dir / "result.wav")
            ):
                response = dispatch_request(
                    {
                        "id": "design",
                        "type": "synthesize",
                        "text": "hello",
                        "language": "en",
                        "voice": "design",
                        "instruct": "female, warm",
                        "speed": 1.25,
                        "steps": 40,
                        "duration": 8,
                        "normalize_text": True,
                        "generation_config": config,
                        "format": "wav",
                    },
                    engine,
                )
        finally:
            output_dir.rmdir()

        self.assertTrue(response["ok"])
        kwargs = engine.generate.call_args.kwargs
        self.assertEqual(kwargs["instruct"], "female, warm")
        self.assertEqual(kwargs["duration"], 8.0)
        self.assertTrue(kwargs["normalize_text"])
        self.assertEqual(kwargs["generation_config"]["audio_chunk_duration"], 12.0)

    def test_design_requires_non_empty_instruction(self):
        engine = Mock()
        for instruct in (None, " "):
            response = dispatch_request(
                {
                    "id": "design-invalid",
                    "type": "synthesize",
                    "text": "hello",
                    "voice": "design",
                    "instruct": instruct,
                    "format": "wav",
                },
                engine,
            )
            self.assertFalse(response["ok"])
            self.assertEqual(response["error"]["code"], "invalid_input")
        engine.generate.assert_not_called()

    def test_synthesize_rejects_incompatible_voice_payloads(self):
        cases = [
            {"voice": "auto", "instruct": "female"},
            {"voice": "profile", "voice_name": "alice", "instruct": "female"},
            {"voice": "file", "voice_name": "alice"},
            {"voice": "design", "instruct": "female", "voice_name": "alice"},
        ]
        engine = Mock()
        for index, payload in enumerate(cases):
            response = dispatch_request(
                {
                    "id": f"incompatible-{index}",
                    "type": "synthesize",
                    "text": "hello",
                    "format": "wav",
                    **payload,
                },
                engine,
            )
            self.assertFalse(response["ok"])
            self.assertEqual(response["error"]["code"], "invalid_input")
        engine.generate.assert_not_called()

    def test_synthesize_rejects_invalid_generation_values(self):
        cases = [
            {"steps": True},
            {"steps": 1.5},
            {"duration": 0},
            {"duration": 10**1000},
            {"duration": float("inf")},
            {"normalize_text": "yes"},
            {"generation_config": {"guidance_scale": -1}},
            {"generation_config": {"audio_chunk_threshold": 0}},
            {"generation_config": {"denoise": 1}},
            {"generation_config": {"unknown": 1}},
            {"voice": ["auto"]},
        ]
        engine = Mock()
        for index, payload in enumerate(cases):
            response = dispatch_request(
                {
                    "id": f"invalid-value-{index}",
                    "type": "synthesize",
                    "text": "hello",
                    "voice": "auto",
                    "format": "wav",
                    **payload,
                },
                engine,
            )
            self.assertFalse(response["ok"])
            self.assertEqual(response["error"]["code"], "invalid_input")
        engine.generate.assert_not_called()

    def test_prepare_model_forwards_progress(self):
        engine = Mock()

        def ensure_model(**kwargs):
            kwargs["on_progress"]({"phase": "download", "progress": 0.5})
            return {"ready": True}

        engine.ensure_model.side_effect = ensure_model
        events = []

        response = dispatch_request(
            {"id": "6", "type": "prepare_model"}, engine, emit=events.append
        )

        self.assertTrue(response["ok"])
        self.assertEqual(events, [{"id": "6", "event": "progress", "phase": "download", "progress": 0.5}])

    def test_save_and_delete_voice_requests(self):
        engine = Mock()
        engine.save_voice.return_value = "/tmp/demo.pt"
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "reference.wav"
            self.write_wav(reference)
            save_response = dispatch_request(
                {
                    "id": "7",
                    "type": "save_voice",
                    "name": "demo",
                    "ref_audio": str(reference),
                    "language": "vi",
                },
                engine,
            )

        with patch("tts_mcp.desktop.Engine.delete_voice", return_value=True) as delete_voice:
            delete_response = dispatch_request(
                {"id": "8", "type": "delete_voice", "name": "demo"}, engine
            )

        self.assertTrue(save_response["ok"])
        engine.save_voice.assert_called_once()
        self.assertEqual(engine.save_voice.call_args.args[3], "vi")
        self.assertTrue(delete_response["ok"])
        self.assertTrue(delete_response["result"]["deleted"])
        delete_voice.assert_called_once_with("demo")

    def test_import_seed_voices_request(self):
        engine = Mock()
        engine.import_seed_voices.return_value = {
            "imported": [{"id": "demo", "name": "Demo", "language": "vi"}],
            "skipped": [],
            "errors": [],
        }

        response = dispatch_request(
            {"id": "seed", "type": "import_seed_voices", "seed_dir": "/resources/seeds"},
            engine,
        )

        self.assertTrue(response["ok"])
        self.assertEqual(response["result"]["imported"][0]["id"], "demo")
        engine.import_seed_voices.assert_called_once_with("/resources/seeds")

    def test_import_seed_voices_requires_directory(self):
        engine = Mock()

        response = dispatch_request(
            {"id": "seed-invalid", "type": "import_seed_voices", "seed_dir": " "},
            engine,
        )

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "invalid_input")
        engine.import_seed_voices.assert_not_called()

    def test_protocol_cancels_model_preparation(self):
        class BlockingEngine:
            def ensure_model(self, on_progress=None, should_cancel=None):
                while not should_cancel():
                    time.sleep(0.001)
                raise DownloadCancelled("Model download cancelled")

        source = io.StringIO(
            json.dumps({"id": "prepare", "type": "prepare_model"})
            + "\n"
            + json.dumps({"id": "cancel", "type": "cancel", "request_id": "prepare"})
            + "\n"
        )
        target = io.StringIO()

        run_protocol(source, target, BlockingEngine())

        responses = [json.loads(line) for line in target.getvalue().splitlines()]
        by_id = {response["id"]: response for response in responses}
        self.assertTrue(by_id["cancel"]["ok"])
        self.assertFalse(by_id["prepare"]["ok"])
        self.assertEqual(by_id["prepare"]["error"]["code"], "cancelled")


if __name__ == "__main__":
    unittest.main()
