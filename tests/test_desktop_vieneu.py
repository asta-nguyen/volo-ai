import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock, patch

import numpy as np
import soundfile as sf

from tts_mcp.desktop_vieneu import (
    ENCODER_FILE,
    MANIFEST_FILE,
    MODEL_FILE,
    VieNeuProvider,
)
from tts_mcp.engine import DownloadCancelled

VOICE_IDS = [
    "adam_bua",
    "truc_ly",
    "anh_khoi",
    "mai_anh",
    "minh_quan_pro",
    "thuy_dung",
    "thien_tam_duc",
    "ngoc_huyen",
    "quang_son",
    "ngoc_tran",
    "minh_duc",
    "pham_tuyen",
    "thai_son",
    "xuan_vinh",
    "thanh_binh",
    "ngoc_linh",
    "doan_trang",
    "thuc_doan",
    "minh_triet",
    "my_duyen",
    "quynh_anh",
    "duc_tri",
    "kim_thanh",
    "adam",
    "manh_dung",
]


class VieNeuAssetFixture:
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.provider = VieNeuProvider(self.root)

    def manifest_payload(self):
        return {
            "default": "minh_quan_pro",
            "voices": [
                {"id": voice_id, "name": voice_id.title(), "label": f"Voice {voice_id}"}
                for voice_id in VOICE_IDS
            ],
        }

    def write_asset(self, relative: str):
        path = self.provider.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if relative == MANIFEST_FILE:
            path.write_text(json.dumps(self.manifest_payload()), encoding="utf-8")
        elif relative == MODEL_FILE:
            path.write_bytes(b"GGUF" + b"model")
        elif relative == ENCODER_FILE:
            path.write_bytes(b"onnx-model")
        elif relative.endswith("/ref_codes.txt"):
            path.write_text(" ".join(["1"] * 16) + "\n", encoding="utf-8")
        elif relative.endswith("/speaker.emb.txt"):
            path.write_text(",".join(["0.1"] * 192), encoding="utf-8")
        return path

    def write_complete_assets(self):
        self.write_asset(MANIFEST_FILE)
        self.write_asset(MODEL_FILE)
        self.write_asset(ENCODER_FILE)
        for voice_id in VOICE_IDS:
            self.write_asset(f"gguf/voices/{voice_id}/ref_codes.txt")
            self.write_asset(f"gguf/voices/{voice_id}/speaker.emb.txt")


class VieNeuAssetTests(VieNeuAssetFixture, unittest.TestCase):
    def test_manifest_exposes_presets_and_default(self):
        self.write_complete_assets()
        with (
            patch.object(self.provider, "_runtime_status", return_value=(True, None)),
            patch.object(self.provider, "_preprocessing_status", return_value=(True, None)),
        ):
            status = self.provider.status()

        self.assertTrue(status["model_ready"])
        self.assertEqual(len(status["preset_voices"]), 25)
        self.assertEqual(status["default_voice"], "minh_quan_pro")

    def test_readiness_requires_all_pinned_assets(self):
        self.write_complete_assets()
        missing = self.provider.root / "gguf" / "voices" / "adam" / "speaker.emb.txt"
        missing.unlink()

        self.assertFalse(self.provider._model_ready())

    def test_invalid_manifest_has_no_presets(self):
        self.provider.manifest_path.parent.mkdir(parents=True)
        self.provider.manifest_path.write_text("{", encoding="utf-8")
        with (
            patch.object(self.provider, "_runtime_status", return_value=(True, None)),
            patch.object(self.provider, "_preprocessing_status", return_value=(True, None)),
        ):
            status = self.provider.status()

        self.assertEqual(status["preset_voices"], [])
        self.assertIsNone(status["default_voice"])
        self.assertFalse(status["model_ready"])

    def test_cancelled_download_stays_not_ready_then_retry_completes(self):
        calls = []

        def download(patterns, _on_progress, _should_cancel):
            calls.append(list(patterns))
            if patterns == [MANIFEST_FILE]:
                self.write_asset(MANIFEST_FILE)
                return
            for relative in patterns:
                if len(calls) == 2 and relative == MODEL_FILE:
                    self.write_asset(relative)
                    raise DownloadCancelled("VieNeu model download cancelled")
                self.write_asset(relative)

        with patch.object(self.provider, "_download_patterns", side_effect=download):
            with self.assertRaises(DownloadCancelled):
                self.provider.ensure_model()
            self.assertFalse(self.provider._model_ready())
            self.provider.ensure_model()

        self.assertTrue(self.provider._model_ready())
        self.assertIn(MODEL_FILE, calls[1])
        self.assertNotIn(MODEL_FILE, calls[2])

    def test_missing_runtime_or_frontend_is_reported(self):
        with (
            patch.object(
                self.provider, "_runtime_status", return_value=(False, "Set TTS_MCP_AUDIOCPP_PATH")
            ),
            patch.object(
                self.provider,
                "_preprocessing_status",
                return_value=(False, "Install the desktop extra"),
            ),
        ):
            status = self.provider.status()

        self.assertFalse(status["runtime_available"])
        self.assertFalse(status["preprocessing_available"])
        self.assertIn("TTS_MCP_AUDIOCPP_PATH", status["unavailable_reason"])


class VieNeuSynthesisTests(VieNeuAssetFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.write_complete_assets()
        self.provider._runtime_status = Mock(return_value=(True, None))
        self.provider._preprocessing_status = Mock(return_value=(True, None))
        self.binary = self.root / "audiocpp_cli"
        self.binary.write_bytes(b"fake cli")
        self.binary.chmod(0o755)
        self.reference = self.root / "reference.wav"
        sf.write(self.reference, np.zeros(480, dtype=np.float32), 48000)
        self.outputs = self.root / "outputs"
        self.phonemizer_modules()

    def phonemizer_modules(self):
        package = ModuleType("vieneu_utils")
        package.__path__ = []
        module = ModuleType("vieneu_utils.phonemize_text")
        module.phonemize_text_with_emotions = Mock(return_value="sˈin tʃˈaː2w")
        self.phonemizer = module.phonemize_text_with_emotions
        self.modules_patch = patch.dict(
            "sys.modules",
            {"vieneu_utils": package, "vieneu_utils.phonemize_text": module},
        )
        self.modules_patch.start()
        self.addCleanup(self.modules_patch.stop)

    def run_audio_cpp(self, args, **kwargs):
        if args[0].endswith("ffmpeg") or args[0].endswith("ffmpeg.exe"):
            sf.write(args[-1], np.zeros(480, dtype=np.float32), 48000)
        elif "--out" in args:
            destination = Path(args[args.index("--out") + 1])
            sf.write(destination, np.zeros(480, dtype=np.float32), 48000)
        return subprocess_result(args)

    def invoke(self, **overrides):
        request = {
            "text": "Xin chào",
            "language": "vi",
            "voice": "preset",
            "preset_id": "minh_quan_pro",
            "format": "wav",
            **overrides,
        }
        with (
            patch.dict("os.environ", {"TTS_MCP_AUDIOCPP_PATH": str(self.binary)}),
            patch("tts_mcp.desktop_vieneu.subprocess.run", side_effect=self.run_audio_cpp),
        ):
            return self.provider.synthesize(request, [], self.outputs)

    def test_preset_uses_manifest_assets_and_writes_48khz(self):
        result = self.invoke()
        info = sf.info(result["audio_path"])

        self.assertEqual(info.samplerate, 48000)
        self.assertTrue(Path(result["audio_path"]).is_file())

    def test_unknown_preset_does_not_launch_cli(self):
        with patch("tts_mcp.desktop_vieneu.subprocess.run") as run:
            with self.assertRaisesRegex(ValueError, "Unknown VieNeu preset"):
                self.invoke(preset_id="not_in_manifest")

        run.assert_not_called()

    def test_saved_clone_uses_reference_and_campp_embedding(self):
        encoder = Mock()
        encoder.embed.return_value = np.zeros(192, dtype=np.float32)
        self.provider._speaker_encoder = encoder
        profile = {
            "name": "my_clone",
            "kind": "clone",
            "ref_audio": str(self.reference),
        }
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            return self.run_audio_cpp(args, **kwargs)

        with (
            patch.dict("os.environ", {"TTS_MCP_AUDIOCPP_PATH": str(self.binary)}),
            patch("tts_mcp.desktop_vieneu.subprocess.run", side_effect=run),
        ):
            result = self.provider.synthesize(
                {
                    "text": "Xin chào",
                    "language": "vi",
                    "voice": "profile",
                    "voice_name": "my_clone",
                },
                [profile],
                self.outputs,
            )

        self.assertTrue(Path(result["audio_path"]).is_file())
        self.assertEqual(encoder.embed.call_count, 1)
        self.assertEqual(calls[-1][calls[-1].index("--task") + 1], "tts")
        self.assertIn("--voice-ref", calls[-1])
        self.assertTrue(list((self.provider.root / "speaker-embeddings").glob("*.txt")))

    def test_one_off_non_wav_is_normalized_without_persisting(self):
        reference = self.root / "reference.mp3"
        reference.write_bytes(b"fake mp3")
        encoder = Mock()
        encoder.embed.return_value = np.zeros(192, dtype=np.float32)
        self.provider._speaker_encoder = encoder
        with patch("tts_mcp.desktop_vieneu._resolve_ffmpeg", return_value="ffmpeg"):
            with patch.dict("os.environ", {"TTS_MCP_AUDIOCPP_PATH": str(self.binary)}):
                with patch(
                    "tts_mcp.desktop_vieneu.subprocess.run", side_effect=self.run_audio_cpp
                ) as run:
                    result = self.provider.synthesize(
                        {
                            "text": "hello",
                            "language": "en",
                            "voice": "file",
                            "ref_audio": str(reference),
                        },
                        [],
                        self.outputs,
                    )

        self.assertTrue(Path(result["audio_path"]).is_file())
        self.assertEqual(run.call_args_list[0].args[0][0], "ffmpeg")
        self.assertFalse((self.provider.root / "user-voices").exists())

    def test_cli_failure_removes_partial_output(self):
        def fail_after_partial(args, **kwargs):
            if "--out" in args:
                Path(args[args.index("--out") + 1]).write_bytes(b"partial")
                raise subprocess.CalledProcessError(1, args, stderr="native failure")

        with (
            patch.dict("os.environ", {"TTS_MCP_AUDIOCPP_PATH": str(self.binary)}),
            patch("tts_mcp.desktop_vieneu.subprocess.run", side_effect=fail_after_partial),
        ):
            with self.assertRaisesRegex(RuntimeError, "native failure"):
                self.provider.synthesize(
                    {
                        "text": "hello",
                        "language": "en",
                        "voice": "preset",
                        "preset_id": "minh_quan_pro",
                    },
                    [],
                    self.outputs,
                )

        self.assertEqual(list(self.outputs.glob("*")), [])

    def test_mp3_export_preserves_48khz(self):
        with (
            patch.dict("os.environ", {"TTS_MCP_AUDIOCPP_PATH": str(self.binary)}),
            patch("tts_mcp.desktop_vieneu.subprocess.run", side_effect=self.run_audio_cpp),
            patch("tts_mcp.desktop_vieneu.save_audio", return_value="speech.mp3") as save_audio,
        ):
            self.provider.synthesize(
                {
                    "text": "hello",
                    "language": "en",
                    "voice": "preset",
                    "preset_id": "minh_quan_pro",
                    "format": "mp3",
                },
                [],
                self.outputs,
            )

        self.assertEqual(save_audio.call_args.kwargs["sample_rate"], 48000)


def subprocess_result(args):
    import subprocess

    return subprocess.CompletedProcess(args, 0, "", "")


if __name__ == "__main__":
    unittest.main()
