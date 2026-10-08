import unittest
from unittest.mock import Mock, patch

from mcp.client import Client

from tts_mcp.server import clone, list_voices, server


class ServerTests(unittest.TestCase):
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


class MCPProtocolTests(unittest.IsolatedAsyncioTestCase):
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
                    {"speak", "clone", "design", "list_voices", "save_voice", "delete_voice"},
                )
                call_result = await client.call_tool(
                    "speak", {"text": "hello", "output_path": "speech.wav"}
                )

        self.assertFalse(call_result.is_error)
        self.assertIn("Audio saved to: speech.wav", call_result.content[0].text)
        save_audio.assert_called_once_with(engine.generate.return_value, "speech.wav")

if __name__ == "__main__":
    unittest.main()
