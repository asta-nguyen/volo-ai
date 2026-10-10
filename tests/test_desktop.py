import io
import json
import tempfile
import time
import unittest
import wave
from pathlib import Path
from unittest.mock import Mock, patch

from tts_mcp.desktop import dispatch_request, run_protocol
from tts_mcp.engine import DownloadCancelled, Engine


class DesktopWorkerTests(unittest.TestCase):
    def setUp(self):
        history_patch = patch("tts_mcp.desktop.Engine.record_audio_history")
        self.history_writer = history_patch.start()
        self.addCleanup(history_patch.stop)

    @staticmethod
    def write_wav(path: Path) -> None:
        with wave.open(str(path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(24000)
            audio.writeframes(b"\x00\x00")

    def test_status_returns_supported_languages(self):
        engine = Mock()
        vieneu_provider = Mock()
        vieneu_provider.status.return_value = {
            "model_ready": False,
            "runtime_available": True,
            "preprocessing_available": True,
            "preset_voices": [{"id": "minh_quan_pro", "name": "Minh Quân Pro", "label": "Default"}],
            "default_voice": "minh_quan_pro",
            "unavailable_reason": None,
        }
        engine.model_status.return_value = {
            "ready": False,
            "device": "cpu",
            "model": "model-id",
            "tokenizer": "tokenizer-id",
            "asr_model": "asr-id",
        }

        response = dispatch_request(
            {"id": "1", "type": "status"}, engine, vieneu_provider=vieneu_provider
        )

        self.assertTrue(response["ok"])
        self.assertEqual(response["result"]["languages"], ["en", "vi"])
        self.assertEqual(response["result"]["model"], "model-id")
        self.assertEqual(response["result"]["tokenizer"], "tokenizer-id")
        self.assertEqual(response["result"]["asr_model"], "asr-id")
        self.assertEqual(
            response["result"]["providers"]["vieneu"]["preset_voices"][0]["id"],
            "minh_quan_pro",
        )
        self.assertIn("omnivoice", response["result"]["providers"])

    def test_prepare_and_synthesis_require_known_provider(self):
        engine = Mock()
        vieneu_provider = Mock()
        for request in (
            {"id": "missing-prepare", "type": "prepare_model"},
            {"id": "unknown-prepare", "type": "prepare_model", "provider": "other"},
            {"id": "missing-synthesis", "type": "synthesize"},
            {"id": "unknown-synthesis", "type": "synthesize", "provider": "other"},
            {"id": "invalid-synthesis", "type": "synthesize", "provider": []},
        ):
            response = dispatch_request(request, engine, vieneu_provider=vieneu_provider)
            self.assertFalse(response["ok"])
            self.assertEqual(response["error"]["code"], "invalid_input")
        engine.ensure_model.assert_not_called()
        vieneu_provider.ensure_model.assert_not_called()
        vieneu_provider.synthesize.assert_not_called()

    def test_omnivoice_requests_keep_engine_dispatch(self):
        engine = Mock()
        engine.ensure_model.return_value = {"ready": True}
        response = dispatch_request(
            {"id": "omnivoice-prepare", "type": "prepare_model", "provider": "omnivoice"},
            engine,
        )

        self.assertTrue(response["ok"])
        engine.ensure_model.assert_called_once()

    def test_vieneu_preset_dispatches_to_adapter(self):
        engine = Mock()
        vieneu_provider = Mock()
        vieneu_provider.synthesize.return_value = {"audio_path": "/tmp/result.wav", "format": "wav"}
        request = {
            "id": "vieneu",
            "type": "synthesize",
            "provider": "vieneu",
            "voice": "preset",
            "preset_id": "minh_quan_pro",
        }
        with patch.object(Engine, "list_voices", return_value=[]):
            response = dispatch_request(request, engine, vieneu_provider=vieneu_provider)

        self.assertTrue(response["ok"])
        vieneu_provider.synthesize.assert_called_once()
        engine.generate.assert_not_called()

    def test_synthesis_records_history_for_both_providers(self):
        engine = Mock()
        engine.generate.return_value = object()
        engine.load_voice_profile.return_value = {"kind": "design", "instruct": "warm"}
        vieneu_provider = Mock()
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory) / "outputs"

            def save_audio(_audio, path, **_kwargs):
                Path(path).parent.mkdir(parents=True, exist_ok=True)
                Path(path).write_bytes(b"audio")
                return path

            def vieneu_synthesize(_request, _voices, target_dir):
                target_dir.mkdir(parents=True, exist_ok=True)
                path = target_dir / "vieneu.wav"
                path.write_bytes(b"audio")
                return {"audio_path": str(path), "format": "wav"}

            vieneu_provider.synthesize.side_effect = vieneu_synthesize
            with (
                patch("tts_mcp.desktop.OUTPUT_DIR", output_dir),
                patch("tts_mcp.desktop.save_audio", side_effect=save_audio),
                patch.object(Engine, "list_voices", return_value=[]),
            ):
                omni_response = dispatch_request(
                    {
                        "id": "omni-history",
                        "type": "synthesize",
                        "provider": "omnivoice",
                        "text": "xin chao",
                        "voice": "profile",
                        "voice_name": "narrator",
                        "format": "wav",
                    },
                    engine,
                )
                vieneu_response = dispatch_request(
                    {
                        "id": "vieneu-history",
                        "type": "synthesize",
                        "provider": "vieneu",
                        "text": "hello",
                        "voice": "file",
                        "ref_audio": "/private/reference.wav",
                        "format": "wav",
                    },
                    engine,
                    vieneu_provider=vieneu_provider,
                )

        self.assertTrue(omni_response["ok"])
        self.assertTrue(vieneu_response["ok"])
        self.assertEqual(self.history_writer.call_count, 2)
        omni_entry = self.history_writer.call_args_list[0].kwargs
        self.assertEqual(omni_entry["provider"], "omnivoice")
        self.assertEqual(omni_entry["voice_name"], "narrator")
        self.assertEqual(omni_entry["text"], "xin chao")
        vieneu_entry = self.history_writer.call_args_list[1].kwargs
        self.assertEqual(vieneu_entry["provider"], "vieneu")
        self.assertEqual(vieneu_entry["voice_name"], "file")
        self.assertNotIn("/private/reference.wav", vieneu_entry.values())

    def test_history_lists_legacy_and_recorded_files_newest_first(self):
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory) / "outputs"
            output_dir.mkdir()
            legacy = output_dir / "legacy.mp3"
            recorded = output_dir / "recorded.wav"
            legacy.write_bytes(b"legacy")
            recorded.write_bytes(b"recorded")
            metadata = [
                {
                    "file_name": "recorded.wav",
                    "provider": "vieneu",
                    "voice_name": "minh_quan_pro",
                    "format": "wav",
                    "text": "Xin chào",
                    "created_at": "2020-01-01T00:00:00+00:00",
                }
            ]
            with (
                patch("tts_mcp.desktop.OUTPUT_DIR", output_dir),
                patch.object(Engine, "list_audio_history", return_value=metadata),
            ):
                response = dispatch_request(
                    {"id": "history", "type": "list_audio_history"}, Mock()
                )

        items = response["result"]["items"]
        self.assertTrue(response["ok"])
        self.assertEqual([item["id"] for item in items], ["legacy.mp3", "recorded.wav"])
        self.assertFalse(items[0]["metadata_available"])
        self.assertIsNone(items[0]["text"])
        self.assertTrue(items[1]["metadata_available"])
        self.assertEqual(items[1]["text"], "Xin chào")

    def test_delete_audio_history_removes_only_output_file_and_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory) / "outputs"
            output_dir.mkdir()
            audio = output_dir / "take.wav"
            audio.write_bytes(b"audio")
            with (
                patch("tts_mcp.desktop.OUTPUT_DIR", output_dir),
                patch.object(Engine, "delete_audio_history", return_value=True) as delete_metadata,
            ):
                response = dispatch_request(
                    {
                        "id": "delete",
                        "type": "delete_audio_history",
                        "file_name": "take.wav",
                    },
                    Mock(),
                )

                self.assertTrue(response["ok"])
                self.assertTrue(response["result"]["deleted"])
                self.assertFalse(audio.exists())
                delete_metadata.assert_called_once_with("take.wav")

    def test_delete_audio_history_rejects_traversal_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output_dir = root / "outputs"
            output_dir.mkdir()
            outside = root / "outside.wav"
            outside.write_bytes(b"keep")
            link = output_dir / "link.wav"
            try:
                link.symlink_to(outside)
            except OSError:
                self.skipTest("symlink creation is unavailable")
            with (
                patch("tts_mcp.desktop.OUTPUT_DIR", output_dir),
                patch.object(Engine, "delete_audio_history") as delete_metadata,
            ):
                traversal = dispatch_request(
                    {
                        "id": "traversal",
                        "type": "delete_audio_history",
                        "file_name": "../outside.wav",
                    },
                    Mock(),
                )
                symlink = dispatch_request(
                    {
                        "id": "symlink",
                        "type": "delete_audio_history",
                        "file_name": "link.wav",
                    },
                    Mock(),
                )
                self.assertFalse(traversal["ok"])
                self.assertFalse(symlink["ok"])
                self.assertTrue(outside.exists())
                delete_metadata.assert_not_called()

    def test_delete_audio_history_unlink_failure_preserves_metadata_for_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory) / "outputs"
            output_dir.mkdir()
            audio = output_dir / "take.wav"
            audio.write_bytes(b"audio")
            with (
                patch("tts_mcp.desktop.OUTPUT_DIR", output_dir),
                patch.object(Path, "unlink", side_effect=OSError("disk error")),
                patch.object(Engine, "delete_audio_history") as delete_metadata,
            ):
                response = dispatch_request(
                    {
                        "id": "delete",
                        "type": "delete_audio_history",
                        "file_name": "take.wav",
                    },
                    Mock(),
                )

            self.assertFalse(response["ok"])
            self.assertTrue(audio.exists())
            delete_metadata.assert_not_called()

    def test_history_write_failure_keeps_audio_discoverable(self):
        engine = Mock()
        engine.generate.return_value = object()
        self.history_writer.side_effect = OSError("database unavailable")
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory) / "outputs"

            def save_audio(_audio, path, **_kwargs):
                Path(path).parent.mkdir(parents=True, exist_ok=True)
                Path(path).write_bytes(b"audio")
                return path

            with (
                patch("tts_mcp.desktop.OUTPUT_DIR", output_dir),
                patch("tts_mcp.desktop.save_audio", side_effect=save_audio),
            ):
                response = dispatch_request(
                    {
                        "id": "metadata-failure",
                        "type": "synthesize",
                        "provider": "omnivoice",
                        "text": "hello",
                        "voice": "auto",
                        "format": "wav",
                    },
                    engine,
                )
                with patch.object(Engine, "list_audio_history", return_value=[]):
                    history = dispatch_request(
                        {"id": "list", "type": "list_audio_history"}, engine
                    )
                self.assertTrue(response["ok"])
                self.assertTrue(Path(response["result"]["audio_path"]).is_file())
                self.assertTrue(history["ok"])
                self.assertEqual(len(history["result"]["items"]), 1)
                self.assertFalse(history["result"]["items"][0]["metadata_available"])

    def test_vieneu_design_profile_is_rejected(self):
        from tts_mcp.desktop_vieneu import VieNeuProvider

        engine = Mock()
        with tempfile.TemporaryDirectory() as directory:
            provider = VieNeuProvider(Path(directory))
            request = {
                "id": "vieneu-design",
                "type": "synthesize",
                "provider": "vieneu",
                "text": "hello",
                "voice": "profile",
                "voice_name": "designer",
            }
            with patch.object(
                Engine, "list_voices", return_value=[{"name": "designer", "kind": "design"}]
            ):
                response = dispatch_request(request, engine, vieneu_provider=provider)

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "invalid_input")
        self.assertIn("Design profiles", response["error"]["message"])
        engine.generate.assert_not_called()

    def test_invalid_language_returns_structured_error(self):
        response = dispatch_request(
            {
                "id": "2",
                "type": "synthesize",
                "provider": "omnivoice",
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
                    "provider": "omnivoice",
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
                    "provider": "omnivoice",
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
            with (
                patch("tts_mcp.desktop.OUTPUT_DIR", output_dir),
                patch(
                    "tts_mcp.desktop.save_audio", return_value=str(output_dir / "result.wav")
                ) as save_audio,
            ):
                response = dispatch_request(
                    {
                        "id": "5",
                        "type": "synthesize",
                        "provider": "omnivoice",
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
            with (
                patch("tts_mcp.desktop.OUTPUT_DIR", output_dir),
                patch("tts_mcp.desktop.save_audio", return_value=str(output_dir / "result.wav")),
            ):
                response = dispatch_request(
                    {
                        "id": "design",
                        "type": "synthesize",
                        "provider": "omnivoice",
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
                    "provider": "omnivoice",
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
                    "provider": "omnivoice",
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
                    "provider": "omnivoice",
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
            {"id": "6", "type": "prepare_model", "provider": "omnivoice"},
            engine,
            emit=events.append,
        )

        self.assertTrue(response["ok"])
        self.assertEqual(
            events, [{"id": "6", "event": "progress", "phase": "download", "progress": 0.5}]
        )

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

    def test_save_design_voice_request(self):
        engine = Mock()
        response = dispatch_request(
            {
                "id": "design-save",
                "type": "save_design_voice",
                "name": "designer",
                "design_instruction": "warm, low, confident",
                "language": "vi",
            },
            engine,
        )

        self.assertTrue(response["ok"])
        self.assertEqual(response["result"], {"name": "designer", "kind": "design"})
        engine.save_design_voice.assert_called_once_with("designer", "warm, low, confident", "vi")

    def test_profile_synthesis_resolves_clone_and_design_profiles(self):
        engine = Mock()
        engine.generate.return_value = object()
        engine.load_voice_profile.side_effect = [
            {"kind": "clone", "prompt": "clone-prompt"},
            {"kind": "design", "instruct": "warm, low, confident"},
        ]
        output_dir = Path(tempfile.mkdtemp())
        try:
            with (
                patch("tts_mcp.desktop.OUTPUT_DIR", output_dir),
                patch("tts_mcp.desktop.save_audio", return_value=str(output_dir / "result.wav")),
            ):
                for name in ("clone", "designer"):
                    response = dispatch_request(
                        {
                            "id": name,
                            "type": "synthesize",
                            "provider": "omnivoice",
                            "text": "hello",
                            "language": "en",
                            "voice": "profile",
                            "voice_name": name,
                            "format": "wav",
                        },
                        engine,
                    )
                    self.assertTrue(response["ok"])
                    kwargs = engine.generate.call_args.kwargs
                    if name == "clone":
                        self.assertEqual(kwargs["voice_clone_prompt"], "clone-prompt")
                        self.assertNotIn("instruct", kwargs)
                    else:
                        self.assertEqual(kwargs["instruct"], "warm, low, confident")
                        self.assertNotIn("voice_clone_prompt", kwargs)
        finally:
            output_dir.rmdir()

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
            json.dumps({"id": "prepare", "type": "prepare_model", "provider": "omnivoice"})
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

    def test_protocol_cancels_selected_provider_preparation(self):
        class BlockingProvider:
            def ensure_model(self, on_progress=None, should_cancel=None):
                while not should_cancel():
                    time.sleep(0.001)
                raise DownloadCancelled("VieNeu model download cancelled")

        source = io.StringIO(
            json.dumps({"id": "prepare-vieneu", "type": "prepare_model", "provider": "vieneu"})
            + "\n"
            + json.dumps({"id": "cancel", "type": "cancel", "request_id": "prepare-vieneu"})
            + "\n"
        )
        target = io.StringIO()
        run_protocol(source, target, Mock(), BlockingProvider())

        responses = [json.loads(line) for line in target.getvalue().splitlines()]
        by_id = {response["id"]: response for response in responses}
        self.assertTrue(by_id["cancel"]["ok"])
        self.assertEqual(by_id["prepare-vieneu"]["error"]["code"], "cancelled")


if __name__ == "__main__":
    unittest.main()
