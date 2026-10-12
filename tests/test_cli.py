import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import Mock, patch

from tts_mcp.cli import build_parser, cmd_clone, cmd_voices


class CliTests(unittest.TestCase):
    def test_clone_uses_saved_voice_when_requested(self):
        args = build_parser().parse_args(
            ["clone", "hello", "--out", "speech.wav", "--voice", "narrator"]
        )
        engine = Mock()
        prompt = object()
        engine.load_voice_profile.return_value = {"kind": "clone", "prompt": prompt}

        with patch("tts_mcp.cli.get_engine", return_value=engine), patch(
            "tts_mcp.cli._generate_and_save"
        ) as generate:
            cmd_clone(args)

        engine.load_voice_profile.assert_called_once_with("narrator")
        kwargs = generate.call_args.kwargs
        self.assertIs(kwargs["voice_clone_prompt"], prompt)
        self.assertNotIn("ref_audio", kwargs)

    def test_clone_passes_reference_and_transcript(self):
        args = build_parser().parse_args(
            [
                "clone",
                "hello",
                "--out",
                "speech.wav",
                "--ref",
                "reference.wav",
                "--ref-text",
                "reference text",
            ]
        )
        with patch("tts_mcp.cli.get_engine", return_value=Mock()), patch(
            "tts_mcp.cli._generate_and_save"
        ) as generate:
            cmd_clone(args)

        kwargs = generate.call_args.kwargs
        self.assertEqual(kwargs["ref_audio"], "reference.wav")
        self.assertEqual(kwargs["ref_text"], "reference text")
        self.assertNotIn("voice_clone_prompt", kwargs)

    def test_cli_clone_uses_seeded_reference_and_rejects_preset_only(self):
        args = build_parser().parse_args(
            ["clone", "hello", "--out", "speech.wav", "--voice", "minh_quan_pro"]
        )
        engine = Mock()
        engine.load_voice_profile.return_value = {
            "kind": "vieneu_preset",
            "preset_id": "minh_quan_pro",
            "ref_audio": "/voices/minh_quan_pro/reference.wav",
            "ref_text": "Xin chào",
        }
        with patch("tts_mcp.cli.get_engine", return_value=engine), patch(
            "tts_mcp.cli._generate_and_save"
        ) as generate:
            cmd_clone(args)

        kwargs = generate.call_args.kwargs
        self.assertEqual(kwargs["ref_audio"], "/voices/minh_quan_pro/reference.wav")
        self.assertEqual(kwargs["ref_text"], "Xin chào")
        self.assertNotIn("voice_clone_prompt", kwargs)

        engine.load_voice_profile.return_value = {
            "kind": "vieneu_preset",
            "preset_id": "minh_quan_pro",
        }
        with patch("tts_mcp.cli.get_engine", return_value=engine), patch(
            "tts_mcp.cli._generate_and_save"
        ) as generate, self.assertRaisesRegex(ValueError, "no saved Clone reference"):
            cmd_clone(args)
        generate.assert_not_called()

    def test_clone_requires_one_voice_source(self):
        parser = build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args(["clone", "hello", "--out", "speech.wav"])
        with self.assertRaises(SystemExit):
            parser.parse_args(
                [
                    "clone",
                    "hello",
                    "--out",
                    "speech.wav",
                    "--ref",
                    "reference.wav",
                    "--voice",
                    "narrator",
                ]
            )

    def test_cli_lists_vieneu_preset_without_clone_audio_fields(self):
        voice = {
            "name": "My-Preset",
            "language": None,
            "kind": "vieneu_preset",
            "preset_id": "truc_ly",
            "ref_audio": None,
            "ref_text": None,
        }
        output = StringIO()
        with patch("tts_mcp.engine.Engine.list_voices", return_value=[voice]), redirect_stdout(
            output
        ):
            cmd_voices(None)

        result = output.getvalue()
        self.assertIn("My-Preset", result)
        self.assertIn("provider: VieNeu", result)
        self.assertIn("preset ID: truc_ly", result)
        self.assertNotIn("ref:", result)
        self.assertNotIn("text:", result)


if __name__ == "__main__":
    unittest.main()
