import io
import json
import os
import queue
import tempfile
import threading
import time
import unittest
import wave
from datetime import datetime, timezone
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

    @staticmethod
    def ready_vieneu_status(presets):
        return {
            "model_ready": True,
            "runtime_available": True,
            "preprocessing_available": True,
            "preset_voices": presets,
            "unavailable_reason": None,
        }

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

    def test_save_vieneu_preset_uses_manifest_catalog_without_downloading(self):
        engine = Mock()
        engine.save_vieneu_preset.return_value = "My-VieNeu"
        vieneu_provider = Mock()
        vieneu_provider.status.return_value = {
            "preset_voices": [{"id": "minh_quan_pro", "name": "Minh Quân Pro"}]
        }

        response = dispatch_request(
            {
                "id": "save-preset",
                "type": "save_vieneu_preset",
                "name": "My-VieNeu",
                "preset_id": "minh_quan_pro",
            },
            engine,
            vieneu_provider=vieneu_provider,
        )

        self.assertTrue(response["ok"])
        self.assertEqual(
            response["result"],
            {"name": "My-VieNeu", "kind": "vieneu_preset", "preset_id": "minh_quan_pro"},
        )
        engine.save_vieneu_preset.assert_called_once_with("My-VieNeu", "minh_quan_pro")
        vieneu_provider.ensure_model.assert_not_called()

    def test_save_vieneu_preset_rejects_missing_catalog_or_unknown_id(self):
        for catalog, preset_id, expected in (
            ([], "minh_quan_pro", "list is unavailable"),
            ([{"id": "other"}], "minh_quan_pro", "Unknown VieNeu preset ID"),
        ):
            with self.subTest(catalog=catalog):
                engine = Mock()
                provider = Mock()
                provider.status.return_value = {"preset_voices": catalog}
                response = dispatch_request(
                    {
                        "id": "save-preset",
                        "type": "save_vieneu_preset",
                        "name": "My-VieNeu",
                        "preset_id": preset_id,
                    },
                    engine,
                    vieneu_provider=provider,
                )
                self.assertFalse(response["ok"])
                self.assertEqual(response["error"]["code"], "invalid_input")
                self.assertIn(expected, response["error"]["message"])
                engine.save_vieneu_preset.assert_not_called()
                provider.ensure_model.assert_not_called()

    def test_vieneu_saved_preset_profile_routes_to_preset_request(self):
        engine = Mock()
        provider = Mock()
        provider.synthesize.return_value = {"audio_path": "/tmp/preset.wav", "format": "wav"}
        voices = [
            {
                "name": "My-VieNeu",
                "language": None,
                "kind": "vieneu_preset",
                "preset_id": "minh_quan_pro",
                "is_default": False,
            }
        ]
        request = {
            "id": "saved-preset",
            "type": "synthesize",
            "provider": "vieneu",
            "text": "Xin chào",
            "language": "vi",
            "voice": "profile",
            "voice_name": "My-VieNeu",
            "format": "wav",
        }
        with patch.object(Engine, "list_voices", return_value=voices):
            response = dispatch_request(request, engine, vieneu_provider=provider)

        self.assertTrue(response["ok"])
        routed = provider.synthesize.call_args.args[0]
        self.assertEqual(routed["voice"], "preset")
        self.assertEqual(routed["preset_id"], "minh_quan_pro")
        self.assertNotIn("voice_name", routed)
        self.assertEqual(provider.synthesize.call_args.args[1], voices)
        engine.generate.assert_not_called()

    def test_omnivoice_rejects_vieneu_preset_profile_with_provider_guidance(self):
        engine = Mock()
        engine.load_voice_profile.return_value = {
            "kind": "vieneu_preset",
            "preset_id": "minh_quan_pro",
        }

        response = dispatch_request(
            {
                "id": "wrong-provider",
                "type": "synthesize",
                "provider": "omnivoice",
                "text": "hello",
                "voice": "profile",
                "voice_name": "My-VieNeu",
                "format": "wav",
            },
            engine,
        )

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "invalid_input")
        self.assertIn("provider='vieneu'", response["error"]["message"])
        engine.generate.assert_not_called()

    def test_omnivoice_seeded_preset_uses_reference_and_pure_preset_fails(self):
        engine = Mock()
        engine.generate.return_value = object()
        with tempfile.TemporaryDirectory() as tmp:
            reference = Path(tmp) / "reference.wav"
            output = Path(tmp) / "output.wav"
            self.write_wav(reference)
            engine.load_voice_profile.return_value = {
                "kind": "vieneu_preset",
                "preset_id": "minh_quan_pro",
                "ref_audio": str(reference),
                "ref_text": "Xin chào",
            }
            with patch("tts_mcp.desktop.OUTPUT_DIR", Path(tmp)), patch(
                "tts_mcp.desktop.save_audio", return_value=str(output)
            ):
                response = dispatch_request(
                    {
                        "id": "seeded-preset",
                        "type": "synthesize",
                        "provider": "omnivoice",
                        "text": "hello",
                        "voice": "profile",
                        "voice_name": "minh_quan_pro",
                        "format": "wav",
                    },
                    engine,
                )

            self.assertTrue(response["ok"])
            self.assertEqual(engine.generate.call_args.kwargs["ref_audio"], str(reference))
            self.assertEqual(engine.generate.call_args.kwargs["ref_text"], "Xin chào")

            engine.load_voice_profile.return_value = {
                "kind": "vieneu_preset",
                "preset_id": "minh_quan_pro",
            }
            pure_response = dispatch_request(
                {
                    "id": "pure-preset",
                    "type": "synthesize",
                    "provider": "omnivoice",
                    "text": "hello",
                    "voice": "profile",
                    "voice_name": "minh_quan_pro",
                    "format": "wav",
                },
                engine,
            )
            self.assertFalse(pure_response["ok"])
            self.assertIn("seed the VieNeu voices", pure_response["error"]["message"])

    def test_seed_vieneu_voices_requires_ready_manifest_and_runtime(self):
        presets = [{"id": "minh_quan_pro", "name": "Minh Quân Pro", "label": "Default"}]
        for status, message in (
            ({**self.ready_vieneu_status(presets), "model_ready": False,
              "unavailable_reason": "VieNeu model assets are not ready; prepare VieNeu first"},
             "prepare VieNeu"),
            ({**self.ready_vieneu_status(presets), "runtime_available": False,
              "unavailable_reason": "audio.cpp CLI is missing"}, "audio.cpp CLI"),
            ({**self.ready_vieneu_status(presets), "preprocessing_available": False,
              "unavailable_reason": "VieNeu preprocessing is unavailable"}, "preprocessing"),
            ({**self.ready_vieneu_status([])}, "manifest"),
        ):
            with self.subTest(status=status):
                engine = Mock()
                provider = Mock()
                provider.status.return_value = status
                with patch.object(Engine, "list_voices", return_value=[]):
                    response = dispatch_request(
                        {"id": "seed", "type": "seed_vieneu_voices"},
                        engine,
                        vieneu_provider=provider,
                    )
                self.assertFalse(response["ok"])
                self.assertIn(message.lower(), response["error"]["message"].lower())
                engine.save_vieneu_seed_reference.assert_not_called()
                provider.synthesize.assert_not_called()
                provider.ensure_model.assert_not_called()

    def test_seed_vieneu_voices_synthesizes_every_manifest_preset(self):
        presets = [
            {"id": "first_voice", "name": "First Voice", "label": "First"},
            {"id": "second_voice", "name": "Second Voice", "label": "Second"},
        ]
        engine = Mock()
        provider = Mock()
        provider.status.return_value = self.ready_vieneu_status(presets)
        calls = []

        def synthesize(request, _voices, _output_dir, output_path=None):
            calls.append((request, Path(output_path)))
            self.write_wav(Path(output_path))
            return {"audio_path": str(output_path), "format": "wav"}

        provider.synthesize.side_effect = synthesize
        events = []
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            Engine, "list_voices", return_value=[]
        ), patch("tts_mcp.desktop.OUTPUT_DIR", Path(tmp) / "outputs"):
            response = dispatch_request(
                {"id": "seed", "type": "seed_vieneu_voices"},
                engine,
                emit=events.append,
                vieneu_provider=provider,
            )

        self.assertTrue(response["ok"])
        result = response["result"]
        self.assertEqual([item["preset_id"] for item in result["profiles"]],
                         ["first_voice", "second_voice"])
        self.assertEqual([item["status"] for item in result["profiles"]], ["created", "created"])
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(call[0]["language"] == "vi" for call in calls))
        self.assertTrue(all(call[0]["text"] ==
                            "Xin chào. Đây là mẫu giọng được tạo để lưu vào thư viện giọng nói của bạn."
                            for call in calls))
        self.assertTrue(all(call[0]["voice"] == "preset" for call in calls))
        self.assertTrue(all(call[1].parent.name.startswith("vieneu-seed-") for call in calls))
        self.assertEqual([event["preset_id"] for event in events], ["first_voice", "second_voice"])
        self.assertEqual([event["phase"] for event in events], ["seed_vieneu", "seed_vieneu"])
        engine.save_vieneu_seed_reference.assert_any_call(
            "first_voice",
            "first_voice",
            str(calls[0][1]),
            "Xin chào. Đây là mẫu giọng được tạo để lưu vào thư viện giọng nói của bạn.",
        )
        self.history_writer.assert_not_called()
        self.assertFalse((Path(tmp) / "outputs").exists())

    def test_seed_vieneu_voices_reuses_valid_and_regenerates_missing_audio(self):
        presets = [
            {"id": "existing_voice", "name": "Existing", "label": "Ready"},
            {"id": "missing_voice", "name": "Missing", "label": "New"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            reference = Path(tmp) / "saved.wav"
            self.write_wav(reference)
            engine = Mock()
            provider = Mock()
            provider.status.return_value = self.ready_vieneu_status(presets)
            provider.synthesize.side_effect = lambda request, _voices, _output_dir, output_path=None: (
                self.write_wav(Path(output_path)) or {"audio_path": str(output_path), "format": "wav"}
            )
            voices = [
                {
                    "name": "Existing-Profile",
                    "kind": "vieneu_preset",
                    "preset_id": "existing_voice",
                    "ref_audio": str(reference),
                    "ref_text": "Xin chào. Đây là mẫu giọng được tạo để lưu vào thư viện giọng nói của bạn.",
                }
            ]
            with patch.object(Engine, "list_voices", return_value=voices):
                response = dispatch_request(
                    {"id": "seed", "type": "seed_vieneu_voices"},
                    engine,
                    vieneu_provider=provider,
                )

        self.assertTrue(response["ok"])
        self.assertEqual(
            [item["status"] for item in response["result"]["profiles"]],
            ["reused", "created"],
        )
        self.assertEqual(provider.synthesize.call_count, 1)
        self.assertEqual(
            engine.save_vieneu_seed_reference.call_args_list[0].args[:2],
            ("existing_voice", "Existing-Profile"),
        )

    def test_seed_vieneu_voices_continues_after_item_failure(self):
        presets = [
            {"id": "conflict", "name": "Conflict", "label": "Existing"},
            {"id": "good_voice", "name": "Good Voice", "label": "Good"},
        ]
        engine = Mock()
        provider = Mock()
        provider.status.return_value = self.ready_vieneu_status(presets)
        provider.synthesize.side_effect = lambda _request, _voices, _output_dir, output_path=None: (
            self.write_wav(Path(output_path)) or {"audio_path": str(output_path), "format": "wav"}
        )
        voices = [{"name": "conflict", "kind": "clone"}]
        with patch.object(Engine, "list_voices", return_value=voices):
            response = dispatch_request(
                {"id": "seed", "type": "seed_vieneu_voices"},
                engine,
                vieneu_provider=provider,
            )

        self.assertTrue(response["ok"])
        self.assertEqual(response["result"]["failed"][0]["preset_id"], "conflict")
        self.assertIn("clone voice profile", response["result"]["failed"][0]["message"])
        self.assertEqual(response["result"]["profiles"][0]["preset_id"], "good_voice")
        engine.save_vieneu_seed_reference.assert_called_once()

    def test_seed_vieneu_voices_cancellation_keeps_completed_and_reports_unfinished(self):
        presets = [
            {"id": "first_voice", "name": "First", "label": "First"},
            {"id": "second_voice", "name": "Second", "label": "Second"},
        ]
        engine = Mock()
        provider = Mock()
        provider.status.return_value = self.ready_vieneu_status(presets)
        cancelled = threading.Event()
        provider.synthesize.side_effect = lambda _request, _voices, _output_dir, output_path=None: (
            self.write_wav(Path(output_path)) or {"audio_path": str(output_path), "format": "wav"}
        )
        engine.save_vieneu_seed_reference.side_effect = lambda *_args: cancelled.set()
        with patch.object(Engine, "list_voices", return_value=[]):
            response = dispatch_request(
                {"id": "seed", "type": "seed_vieneu_voices"},
                engine,
                should_cancel=cancelled.is_set,
                vieneu_provider=provider,
            )

        self.assertTrue(response["ok"])
        self.assertTrue(response["result"]["cancelled"])
        self.assertEqual([item["preset_id"] for item in response["result"]["profiles"]],
                         ["first_voice"])
        self.assertEqual(response["result"]["unfinished"], ["second_voice"])
        self.assertEqual(provider.synthesize.call_count, 1)

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
        self.assertEqual(set(response["result"]), {"items"})
        self.assertEqual([item["id"] for item in items], ["legacy.mp3", "recorded.wav"])
        self.assertFalse(items[0]["metadata_available"])
        self.assertIsNone(items[0]["text"])
        self.assertTrue(items[1]["metadata_available"])
        self.assertEqual(items[1]["text"], "Xin chào")

    def test_list_audio_history_pages_legacy_and_recorded_files(self):
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory) / "outputs"
            output_dir.mkdir()
            metadata = []
            expected = []
            base_timestamp = 1_700_000_000
            for index in range(55):
                file_name = f"{'recorded' if index % 2 == 0 else 'legacy'}_{index:02}.wav"
                output = output_dir / file_name
                output.write_bytes(b"audio")
                timestamp = base_timestamp + index // 2
                os.utime(output, (timestamp, timestamp))
                created_at = datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
                expected.append((created_at, file_name))
                if index % 2 == 0:
                    metadata.append(
                        {
                            "file_name": file_name,
                            "provider": "vieneu",
                            "voice_name": "minh_quan_pro",
                            "format": "wav",
                            "text": file_name,
                            "created_at": created_at,
                        }
                    )

            expected.sort(key=lambda item: item[1])
            expected.sort(key=lambda item: item[0], reverse=True)
            expected_ids = [file_name for _, file_name in expected]
            with (
                patch("tts_mcp.desktop.OUTPUT_DIR", output_dir),
                patch.object(Engine, "list_audio_history", return_value=metadata),
            ):
                first = dispatch_request(
                    {"id": "history-1", "type": "list_audio_history", "paginated": True},
                    Mock(),
                )
                second = dispatch_request(
                    {
                        "id": "history-2",
                        "type": "list_audio_history",
                        "paginated": True,
                        "cursor": first["result"]["next_cursor"],
                    },
                    Mock(),
                )

        self.assertTrue(first["ok"])
        self.assertTrue(second["ok"])
        self.assertEqual(first["result"]["total"], 55)
        self.assertEqual(len(first["result"]["items"]), 50)
        self.assertEqual(len(second["result"]["items"]), 5)
        self.assertIsNone(second["result"]["next_cursor"])
        items = first["result"]["items"] + second["result"]["items"]
        item_ids = [item["id"] for item in items]
        self.assertEqual(item_ids, expected_ids)
        self.assertEqual(len(item_ids), len(set(item_ids)))
        legacy_item = next(item for item in items if item["id"] == "legacy_01.wav")
        self.assertFalse(legacy_item["metadata_available"])
        self.assertIsNone(legacy_item["text"])

    def test_list_audio_history_rejects_invalid_cursor(self):
        response = dispatch_request(
            {
                "id": "history",
                "type": "list_audio_history",
                "paginated": True,
                "cursor": {"created_at": "", "id": "take.wav"},
            },
            Mock(),
        )

        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "invalid_input")

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

    def test_protocol_cancels_seed_request(self):
        class QueueLines:
            def __init__(self):
                self.lines = queue.Queue()

            def __iter__(self):
                return self

            def __next__(self):
                line = self.lines.get()
                if line is None:
                    raise StopIteration
                return line

        source = QueueLines()
        target = io.StringIO()
        started = threading.Event()
        release = threading.Event()
        provider = Mock()
        provider.status.return_value = self.ready_vieneu_status(
            [
                {"id": "first_voice", "name": "First", "label": "First"},
                {"id": "second_voice", "name": "Second", "label": "Second"},
            ]
        )

        def synthesize(_request, _voices, _output_dir, output_path=None):
            started.set()
            if not release.wait(timeout=3):
                raise RuntimeError("test synth timed out")
            self.write_wav(Path(output_path))
            return {"audio_path": str(output_path), "format": "wav"}

        provider.synthesize.side_effect = synthesize
        with patch.object(Engine, "list_voices", return_value=[]):
            worker = threading.Thread(
                target=run_protocol, args=(source, target, Mock(), provider), daemon=True
            )
            worker.start()
            source.lines.put(json.dumps({"id": "seed", "type": "seed_vieneu_voices"}) + "\n")
            self.assertTrue(started.wait(timeout=3))
            source.lines.put(
                json.dumps({"id": "cancel", "type": "cancel", "request_id": "seed"}) + "\n"
            )
            source.lines.put(None)
            deadline = time.time() + 3
            while '"id": "cancel"' not in target.getvalue() and time.time() < deadline:
                time.sleep(0.005)
            self.assertIn('"id": "cancel"', target.getvalue())
            release.set()
            worker.join(timeout=5)

        self.assertFalse(worker.is_alive())
        messages = [json.loads(line) for line in target.getvalue().splitlines()]
        result = next(
            message["result"]
            for message in messages
            if message.get("id") == "seed" and message.get("ok")
        )
        self.assertTrue(result["cancelled"])
        self.assertEqual([item["preset_id"] for item in result["profiles"]], ["first_voice"])
        self.assertEqual(result["unfinished"], ["second_voice"])

    def test_protocol_accepts_concurrent_seed_requests(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            provider = Mock()
            provider.status.return_value = self.ready_vieneu_status(
                [{"id": "minh_quan_pro", "name": "Minh Quân Pro", "label": "Default"}]
            )
            barrier = threading.Barrier(2)

            def synthesize(_request, _voices, _output_dir, output_path=None):
                barrier.wait(timeout=3)
                self.write_wav(Path(output_path))
                return {"audio_path": str(output_path), "format": "wav"}

            provider.synthesize.side_effect = synthesize
            source = io.StringIO(
                json.dumps({"id": "seed-one", "type": "seed_vieneu_voices"})
                + "\n"
                + json.dumps({"id": "seed-two", "type": "seed_vieneu_voices"})
                + "\n"
            )
            target = io.StringIO()
            with (
                patch.multiple(
                    "tts_mcp.engine",
                    DATA_DIR=root,
                    DB_PATH=root / "volo.db",
                    VOICES_DIR=root / "voices",
                ),
                patch("tts_mcp.desktop.DATA_DIR", root),
                patch("tts_mcp.desktop.OUTPUT_DIR", root / "outputs"),
            ):
                run_protocol(source, target, Engine(), provider)
                profiles = Engine.list_voices()

            self.assertEqual(len(profiles), 1)
            self.assertEqual(profiles[0]["preset_id"], "minh_quan_pro")
            profile_dir = root / "voices" / "minh_quan_pro"
            self.assertEqual([path.name for path in profile_dir.iterdir()], ["reference.wav"])
            messages = [json.loads(line) for line in target.getvalue().splitlines()]
            results = [message["result"] for message in messages if message.get("ok")]
            self.assertEqual(len(results), 2)
            self.assertTrue(
                all(result["profiles"][0]["name"] == "minh_quan_pro" for result in results)
            )
        self.history_writer.assert_not_called()

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
