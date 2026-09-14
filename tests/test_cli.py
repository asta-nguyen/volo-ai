import unittest
from unittest.mock import Mock, patch

from tts_mcp.cli import build_parser, cmd_clone


class CliTests(unittest.TestCase):
    def test_clone_uses_saved_voice_when_requested(self):
        args = build_parser().parse_args(
            ["clone", "hello", "--out", "speech.wav", "--voice", "narrator"]
        )
        engine = Mock()
        prompt = object()
        engine.load_voice.return_value = prompt

        with patch("tts_mcp.cli.get_engine", return_value=engine), patch(
            "tts_mcp.cli._generate_and_save"
        ) as generate:
            cmd_clone(args)

        engine.load_voice.assert_called_once_with("narrator")
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


if __name__ == "__main__":
    unittest.main()
