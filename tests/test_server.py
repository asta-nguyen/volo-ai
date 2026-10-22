import unittest
from unittest.mock import Mock, patch

from mcp.client import Client

from tts_mcp.server import clone, list_voices, prepare_model, server, speak, status


class ServerTests(unittest.TestCase):
    def test_status_reports_provider_state_and_manifest_voices(self):
        engine = Mock()
        engine.model_status.return_value = {"ready": True}
        vieneu = Mock()
        vieneu.status.return_value = {
            "model_ready": False,
            "runtime_available": True,
            "preprocessing_available": True,
            "preset_voices": [{"id": "truc_ly", "name": "Truc Ly", "label": "Female"}],
            "default_voice": "truc_ly",
            "unavailable_reason": None,
        }
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.get_vieneu_provider", return_value=vieneu),
            patch("tts_mcp.server.importlib.util.find_spec", return_value=object()),
        ):
            result = status()

        self.assertTrue(result["providers"]["omnivoice"]["model_ready"])
        self.assertTrue(result["providers"]["omnivoice"]["runtime_available"])
        self.assertEqual(result["providers"]["vieneu"]["preset_voices"][0]["id"], "truc_ly")
        self.assertEqual(result["providers"]["vieneu"]["default_voice"], "truc_ly")

    def test_status_recommends_preparing_unready_omnivoice_model(self):
        engine = Mock()
        engine.model_status.return_value = {"ready": False}
        vieneu = Mock()
        vieneu.status.return_value = {
            "model_ready": False,
            "runtime_available": True,
            "preprocessing_available": True,
            "preset_voices": [],
            "default_voice": None,
            "unavailable_reason": "VieNeu model assets are not ready",
        }
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.get_vieneu_provider", return_value=vieneu),
            patch("tts_mcp.server.importlib.util.find_spec", return_value=object()),
        ):
            result = status()

        self.assertIn(
            "prepare_model(provider='omnivoice')",
            result["providers"]["omnivoice"]["unavailable_reason"],
        )

    def test_prepare_model_routes_only_selected_provider(self):
        engine = Mock()
        engine.ensure_model.return_value = {"ready": True}
        vieneu = Mock()
        vieneu.ensure_model.return_value = {"ready": True}
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.get_vieneu_provider", return_value=vieneu),
        ):
            self.assertEqual(
                prepare_model("vieneu"), {"provider": "vieneu", "model_ready": True}
            )
            vieneu.ensure_model.assert_called_once_with()
            engine.ensure_model.assert_not_called()

            self.assertEqual(
                prepare_model("omnivoice"), {"provider": "omnivoice", "model_ready": True}
            )
            engine.ensure_model.assert_called_once_with()
            vieneu.ensure_model.assert_called_once_with()

            with self.assertRaisesRegex(ValueError, "Unknown provider"):
                prepare_model("unknown")

        engine.ensure_model.assert_called_once_with()
        vieneu.ensure_model.assert_called_once_with()

    def test_speak_routes_vieneu_preset_to_requested_path(self):
        vieneu = Mock()
        vieneu.synthesize.return_value = {"audio_path": "/tmp/speech.wav", "format": "wav"}
        voices = [{"name": "Saved", "kind": "clone", "ref_audio": "/tmp/ref.wav"}]
        with (
            patch("tts_mcp.server.get_vieneu_provider", return_value=vieneu),
            patch("tts_mcp.server.Engine.list_voices", return_value=voices),
        ):
            result = speak(
                "Xin chào",
                "/tmp/speech.wav",
                provider="vieneu",
                voice="preset",
                preset_id="truc_ly",
                language="vi",
            )

        self.assertEqual(result, "Audio saved to: /tmp/speech.wav")
        request = vieneu.synthesize.call_args.args[0]
        self.assertEqual(request["voice"], "preset")
        self.assertEqual(request["preset_id"], "truc_ly")
        self.assertEqual(request["language"], "vi")
        self.assertEqual(vieneu.synthesize.call_args.kwargs["output_path"], "/tmp/speech.wav")
        self.assertEqual(vieneu.synthesize.call_args.args[1], voices)

    def test_clone_routes_saved_clone_and_one_off_reference_to_vieneu(self):
        vieneu = Mock()
        vieneu.synthesize.side_effect = lambda *_args, output_path, **_kwargs: {
            "audio_path": output_path,
            "format": "wav",
        }
        voices = [
            {
                "name": "Saved",
                "kind": "clone",
                "ref_audio": "/tmp/saved.wav",
            }
        ]
        with (
            patch("tts_mcp.server.get_vieneu_provider", return_value=vieneu),
            patch("tts_mcp.server.Engine.list_voices", return_value=voices),
        ):
            saved_result = clone(
                "Xin chào",
                "/tmp/clone.wav",
                voice="Saved",
                provider="vieneu",
                language="vi",
            )
            saved_request = vieneu.synthesize.call_args.args[0]
            file_result = clone(
                "Hello",
                "/tmp/file.wav",
                ref_audio_path="/tmp/reference.wav",
                provider="vieneu",
            )
            file_request = vieneu.synthesize.call_args.args[0]

        self.assertEqual(saved_result, "Cloned audio saved to: /tmp/clone.wav")
        self.assertEqual(saved_request["voice"], "profile")
        self.assertEqual(saved_request["voice_name"], "Saved")
        self.assertEqual(saved_request["language"], "vi")
        self.assertEqual(file_result, "Cloned audio saved to: /tmp/file.wav")
        self.assertEqual(file_request["voice"], "file")
        self.assertEqual(file_request["ref_audio"], "/tmp/reference.wav")
        self.assertEqual(file_request["language"], "en")

    def test_clone_routes_saved_vieneu_preset_and_rejects_omnivoice(self):
        vieneu = Mock()
        vieneu.synthesize.return_value = {"audio_path": "/tmp/preset.wav", "format": "wav"}
        voices = [
            {
                "name": "My-Preset",
                "kind": "vieneu_preset",
                "language": None,
                "preset_id": "truc_ly",
                "is_default": False,
            }
        ]
        engine = Mock()
        engine.load_voice_profile.return_value = {
            "kind": "vieneu_preset",
            "preset_id": "truc_ly",
        }
        with (
            patch("tts_mcp.server.get_vieneu_provider", return_value=vieneu),
            patch("tts_mcp.server.Engine.list_voices", return_value=voices),
        ):
            result = clone(
                "Xin chào",
                "/tmp/preset.wav",
                voice="My-Preset",
                provider="vieneu",
                language="vi",
            )

        self.assertEqual(result, "VieNeu preset audio saved to: /tmp/preset.wav")
        request = vieneu.synthesize.call_args.args[0]
        self.assertEqual(request["voice"], "preset")
        self.assertEqual(request["preset_id"], "truc_ly")
        self.assertNotIn("voice_name", request)
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.get_vieneu_provider") as vieneu_provider,
        ):
            with self.assertRaisesRegex(ValueError, "provider='vieneu'"):
                clone("Xin chào", "/tmp/preset.wav", voice="My-Preset")
        vieneu_provider.assert_not_called()

    def test_vieneu_rejects_unsupported_options_without_provider_fallback(self):
        with (
            patch("tts_mcp.server.get_engine") as engine,
            patch("tts_mcp.server.get_vieneu_provider") as vieneu,
        ):
            for kwargs, message, output_path in (
                (
                    {"preset_id": "truc_ly", "language": "fr"},
                    "Unsupported language",
                    "/tmp/speech.wav",
                ),
                ({"preset_id": "truc_ly", "speed": 1.2}, "does not support", "/tmp/speech.wav"),
                ({"preset_id": "truc_ly"}, "output_path must use", "/tmp/speech.flac"),
            ):
                with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, message):
                    speak(
                        "hello",
                        output_path,
                        provider="vieneu",
                        voice="preset",
                        **kwargs,
                    )
            with self.assertRaisesRegex(ValueError, "voice='preset'"):
                speak("hello", "/tmp/speech.wav", provider="vieneu")
            with self.assertRaisesRegex(ValueError, "does not use ref_text"):
                clone(
                    "hello",
                    "/tmp/speech.wav",
                    ref_audio_path="/tmp/reference.wav",
                    ref_text="hello",
                    provider="vieneu",
                )
            with self.assertRaisesRegex(ValueError, "Design profiles"):
                with patch(
                    "tts_mcp.server.Engine.list_voices",
                    return_value=[{"name": "Designed", "kind": "design"}],
                ):
                    clone("hello", "/tmp/speech.wav", voice="Designed", provider="vieneu")
            with self.assertRaisesRegex(ValueError, "Unknown provider"):
                speak("hello", "/tmp/speech.wav", provider="unknown")

        engine.assert_not_called()
        vieneu.assert_not_called()

    def test_vieneu_config_is_forwarded_only_when_supplied(self):
        vieneu = Mock()
        vieneu.synthesize.return_value = {"audio_path": "/tmp/out.wav", "format": "wav"}
        voices = [{"name": "Saved", "kind": "clone", "ref_audio": "/tmp/saved.wav"}]
        config = {"seed": 1234, "temperature": 0.6}
        calls = (
            lambda **extra: speak(
                "hello", "/tmp/out.wav", provider="vieneu", voice="preset",
                preset_id="truc_ly", **extra,
            ),
            lambda **extra: clone(
                "hello", "/tmp/out.wav", voice="Saved", provider="vieneu", **extra
            ),
            lambda **extra: clone(
                "hello", "/tmp/out.wav", ref_audio_path="/tmp/ref.wav",
                provider="vieneu", **extra,
            ),
        )
        with (
            patch("tts_mcp.server.get_vieneu_provider", return_value=vieneu),
            patch("tts_mcp.server.Engine.list_voices", return_value=voices),
        ):
            for call in calls:
                with self.subTest(call=call):
                    call(vieneu_config=config)
                    self.assertEqual(vieneu.synthesize.call_args.args[0]["vieneu_config"], config)
                    call()
                    self.assertNotIn("vieneu_config", vieneu.synthesize.call_args.args[0])

    def test_vieneu_config_is_rejected_for_omnivoice_before_engine_use(self):
        with (
            patch("tts_mcp.server.get_engine") as engine,
            patch("tts_mcp.server.get_vieneu_provider") as vieneu,
        ):
            with self.assertRaisesRegex(ValueError, "only valid for provider='vieneu'"):
                speak("hello", "/tmp/out.wav", vieneu_config={"seed": 1})
            with self.assertRaisesRegex(ValueError, "only valid for provider='vieneu'"):
                clone("hello", "/tmp/out.wav", voice="Saved", vieneu_config={"seed": 1})

        engine.assert_not_called()
        vieneu.assert_not_called()

    def test_vieneu_runtime_failure_does_not_fall_back_to_omnivoice(self):
        engine = Mock()
        vieneu = Mock()
        vieneu.synthesize.side_effect = RuntimeError("VieNeu model is not ready")
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.get_vieneu_provider", return_value=vieneu),
            patch("tts_mcp.server.Engine.list_voices", return_value=[]),
        ):
            with self.assertRaisesRegex(RuntimeError, "VieNeu model is not ready"):
                speak(
                    "hello",
                    "/tmp/speech.wav",
                    provider="vieneu",
                    voice="preset",
                    preset_id="truc_ly",
                )

        engine.generate.assert_not_called()

    def test_clone_requires_a_reference_or_saved_voice(self):
        with patch("tts_mcp.server.get_engine"):
            with self.assertRaisesRegex(ValueError, "ref_audio_path"):
                clone("hello", "speech.wav")

    def test_clone_loads_saved_clone_profile(self):
        prompt = object()
        engine = Mock()
        engine.load_voice_profile.return_value = {"kind": "clone", "prompt": prompt}
        engine.generate.return_value = object()
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.save_audio", return_value="speech.wav"),
        ):
            clone("hello", "speech.wav", voice="My-Voice")

        engine.load_voice_profile.assert_called_once_with("My-Voice")
        engine.generate.assert_called_once_with(
            text="hello",
            speed=1.0,
            num_step=32,
            normalize_text=False,
            voice_clone_prompt=prompt,
        )

    def test_clone_uses_saved_design_profile(self):
        engine = Mock()
        engine.load_voice_profile.return_value = {
            "kind": "design",
            "instruct": "female, warm tone",
        }
        engine.generate.return_value = object()
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.save_audio", return_value="speech.wav"),
        ):
            clone("hello", "speech.wav", voice="Warm-Voice")

        engine.generate.assert_called_once_with(
            text="hello",
            speed=1.0,
            num_step=32,
            normalize_text=False,
            instruct="female, warm tone",
        )

    def test_clone_forwards_external_reference_audio_and_transcript(self):
        engine = Mock()
        engine.generate.return_value = object()
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.save_audio", return_value="speech.wav"),
        ):
            clone(
                "hello",
                "speech.wav",
                ref_audio_path="/tmp/reference.wav",
                ref_text="hello there",
            )

        engine.generate.assert_called_once_with(
            text="hello",
            speed=1.0,
            num_step=32,
            normalize_text=False,
            ref_audio="/tmp/reference.wav",
            ref_text="hello there",
        )

    def test_list_voices_formats_clone_and_design_details(self):
        voices = [
            {
                "name": "My-Voice",
                "kind": "clone",
                "language": "vi",
                "ref_audio": "/voices/my-voice.wav",
                "design_instruction": None,
            },
            {
                "name": "Warm-Voice",
                "kind": "design",
                "language": "en",
                "ref_audio": None,
                "design_instruction": "female, warm tone",
            },
        ]
        with patch("tts_mcp.server.Engine.list_voices", return_value=voices):
            result = list_voices()

        self.assertIn("My-Voice (clone, vi)", result)
        self.assertIn("ref_audio: /voices/my-voice.wav", result)
        self.assertIn("Warm-Voice (design, en)", result)
        self.assertIn("design_instruction: female, warm tone", result)
        self.assertNotIn("ref: None", result)

    def test_list_voices_formats_vieneu_preset_id_without_language_or_audio(self):
        voices = [
            {
                "name": "My-Preset",
                "kind": "vieneu_preset",
                "language": None,
                "preset_id": "truc_ly",
                "ref_audio": None,
                "design_instruction": None,
            }
        ]
        with patch("tts_mcp.server.Engine.list_voices", return_value=voices):
            result = list_voices()

        self.assertIn("My-Preset (vieneu_preset); preset_id: truc_ly", result)
        self.assertNotIn("None", result)
        self.assertNotIn("ref_audio", result)

    def test_mcp_clone_routes_seeded_profile_for_both_providers(self):
        engine = Mock()
        engine.load_voice_profile.return_value = {
            "kind": "vieneu_preset",
            "preset_id": "minh_quan_pro",
            "ref_audio": "/voices/minh_quan_pro/reference.wav",
            "ref_text": "Xin chào",
        }
        engine.generate.return_value = object()
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.save_audio", return_value="speech.wav"),
        ):
            result = clone("hello", "speech.wav", voice="minh_quan_pro")

        self.assertIn("Cloned audio saved", result)
        engine.generate.assert_called_once_with(
            text="hello",
            speed=1.0,
            num_step=32,
            normalize_text=False,
            ref_audio="/voices/minh_quan_pro/reference.wav",
            ref_text="Xin chào",
        )

        vieneu = Mock()
        vieneu.synthesize.return_value = {"audio_path": "speech.wav", "format": "wav"}
        voice_row = {
            "name": "minh_quan_pro",
            "kind": "vieneu_preset",
            "preset_id": "minh_quan_pro",
            "ref_audio": "/voices/minh_quan_pro/reference.wav",
            "ref_text": "Xin chào",
        }
        with (
            patch("tts_mcp.server.get_vieneu_provider", return_value=vieneu),
            patch("tts_mcp.server.Engine.list_voices", return_value=[voice_row]),
        ):
            clone(
                "hello",
                "speech.wav",
                voice="minh_quan_pro",
                provider="vieneu",
            )

        routed = vieneu.synthesize.call_args.args[0]
        self.assertEqual(routed["voice"], "preset")
        self.assertEqual(routed["preset_id"], "minh_quan_pro")

    def test_mcp_list_voices_includes_seeded_reference_details(self):
        voice = {
            "name": "minh_quan_pro",
            "kind": "vieneu_preset",
            "preset_id": "minh_quan_pro",
            "ref_audio": "/voices/minh_quan_pro/reference.wav",
            "ref_text": "Xin chào",
        }
        with patch("tts_mcp.server.Engine.list_voices", return_value=[voice]):
            result = list_voices()

        self.assertIn("preset_id: minh_quan_pro", result)
        self.assertIn("ref_audio: /voices/minh_quan_pro/reference.wav", result)
        self.assertIn("ref_text: Xin chào", result)


class MCPProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_calls_vieneu_status_prepare_and_speak_tools(self):
        engine = Mock()
        engine.model_status.return_value = {"ready": True}
        vieneu = Mock()
        vieneu.status.return_value = {
            "model_ready": False,
            "runtime_available": True,
            "preprocessing_available": True,
            "preset_voices": [{"id": "truc_ly", "name": "Truc Ly", "label": "Female"}],
            "default_voice": "truc_ly",
            "unavailable_reason": None,
        }
        vieneu.ensure_model.return_value = {"ready": True}
        vieneu.synthesize.return_value = {"audio_path": "/tmp/vieneu.wav", "format": "wav"}
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.get_vieneu_provider", return_value=vieneu),
            patch("tts_mcp.server.importlib.util.find_spec", return_value=object()),
            patch("tts_mcp.server.Engine.list_voices", return_value=[]),
        ):
            async with Client(server) as client:
                status_result = await client.call_tool("status", {})
                prepare_result = await client.call_tool(
                    "prepare_model", {"provider": "vieneu"}
                )
                speak_result = await client.call_tool(
                    "speak",
                    {
                        "text": "Xin chào",
                        "output_path": "/tmp/vieneu.wav",
                        "provider": "vieneu",
                        "voice": "preset",
                        "preset_id": "truc_ly",
                        "language": "vi",
                    },
                )

        self.assertFalse(status_result.is_error)
        self.assertEqual(
            status_result.structured_content["providers"]["vieneu"]["default_voice"],
            "truc_ly",
        )
        self.assertFalse(prepare_result.is_error)
        self.assertTrue(prepare_result.structured_content["model_ready"])
        self.assertFalse(speak_result.is_error)
        self.assertIn("/tmp/vieneu.wav", speak_result.content[0].text)

    async def test_speak_tool_accepts_vieneu_config_object(self):
        vieneu = Mock()
        vieneu.synthesize.return_value = {"audio_path": "/tmp/vieneu.wav", "format": "wav"}
        with (
            patch("tts_mcp.server.get_vieneu_provider", return_value=vieneu),
            patch("tts_mcp.server.Engine.list_voices", return_value=[]),
        ):
            async with Client(server) as client:
                result = await client.call_tool(
                    "speak",
                    {
                        "text": "Xin chào",
                        "output_path": "/tmp/vieneu.wav",
                        "provider": "vieneu",
                        "voice": "preset",
                        "preset_id": "truc_ly",
                        "vieneu_config": {"seed": 1234, "do_sample": True},
                    },
                )

        self.assertFalse(result.is_error)
        self.assertEqual(
            vieneu.synthesize.call_args.args[0]["vieneu_config"],
            {"seed": 1234, "do_sample": True},
        )

    async def test_vieneu_runtime_error_is_returned_as_mcp_tool_error(self):
        engine = Mock()
        vieneu = Mock()
        vieneu.synthesize.side_effect = RuntimeError("VieNeu model is not ready")
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.get_vieneu_provider", return_value=vieneu),
            patch("tts_mcp.server.Engine.list_voices", return_value=[]),
        ):
            async with Client(server) as client:
                result = await client.call_tool(
                    "speak",
                    {
                        "text": "hello",
                        "output_path": "/tmp/speech.wav",
                        "provider": "vieneu",
                        "voice": "preset",
                        "preset_id": "truc_ly",
                    },
                )

        self.assertTrue(result.is_error)
        self.assertIn("VieNeu model is not ready", result.content[0].text)
        engine.generate.assert_not_called()

    async def test_validation_error_text_reaches_mcp_client(self):
        async with Client(server) as client:
            result = await client.call_tool(
                "speak",
                {"text": "hello", "output_path": "/tmp/speech.wav", "provider": "nope"},
            )

        self.assertTrue(result.is_error)
        self.assertIn("Unknown provider", result.content[0].text)

    async def test_calls_clone_with_saved_design_profile(self):
        engine = Mock()
        engine.load_voice_profile.return_value = {
            "kind": "design",
            "instruct": "female, warm tone",
        }
        engine.generate.return_value = object()
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.save_audio", return_value="speech.wav"),
        ):
            async with Client(server) as client:
                result = await client.call_tool(
                    "clone",
                    {"text": "hello", "output_path": "speech.wav", "voice": "Warm-Voice"},
                )

        self.assertFalse(result.is_error)
        self.assertIn("Designed audio saved to: speech.wav", result.content[0].text)
        engine.generate.assert_called_once_with(
            text="hello",
            speed=1.0,
            num_step=32,
            normalize_text=False,
            instruct="female, warm tone",
        )

    async def test_lists_tools_and_calls_speak(self):
        engine = Mock()
        engine.generate.return_value = object()
        with (
            patch("tts_mcp.server.get_engine", return_value=engine),
            patch("tts_mcp.server.save_audio", return_value="speech.wav") as save_audio,
        ):
            async with Client(server) as client:
                result = await client.list_tools()
                self.assertEqual(
                    {tool.name for tool in result.tools},
                    {
                        "speak",
                        "clone",
                        "design",
                        "list_voices",
                        "save_voice",
                        "delete_voice",
                        "status",
                        "prepare_model",
                    },
                )
                call_result = await client.call_tool(
                    "speak", {"text": "hello", "output_path": "speech.wav"}
                )

        self.assertFalse(call_result.is_error)
        self.assertIn("Audio saved to: speech.wav", call_result.content[0].text)
        save_audio.assert_called_once_with(engine.generate.return_value, "speech.wav")

if __name__ == "__main__":
    unittest.main()
