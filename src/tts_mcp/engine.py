"""OmniVoice engine wrapper — lazy load, device auto-detect, voice profile cache."""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path
from typing import Any, Callable

import numpy as np

# Default directories
DATA_DIR = Path(os.environ.get("TTS_MCP_DATA_DIR", Path.home() / ".tts-mcp"))
VOICES_DIR = DATA_DIR / "voices"
MODELS_DIR = DATA_DIR / "models"
MODEL_DIR = MODELS_DIR / "omnivoice"
TOKENIZER_DIR = MODEL_DIR / "audio_tokenizer"
ASR_DIR = MODELS_DIR / "whisper-large-v3-turbo"
READY_MARKER = MODELS_DIR / "ready.json"
SAMPLE_RATE = 24000  # OmniVoice outputs at 24 kHz
MODEL_ID = "k2-fsa/OmniVoice"
TOKENIZER_ID = "eustlb/higgs-audio-v2-tokenizer"
ASR_ID = "openai/whisper-large-v3-turbo"
SUPPORTED_LANGUAGES = ("en", "vi")
VOICE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
GENERATION_CONFIG_KEYS = frozenset(
    {
        "guidance_scale",
        "t_shift",
        "position_temperature",
        "class_temperature",
        "layer_penalty_factor",
        "denoise",
        "preprocess_prompt",
        "postprocess_output",
        "audio_chunk_duration",
        "audio_chunk_threshold",
        "pad_duration",
        "fade_duration",
    }
)


class DownloadCancelled(RuntimeError):
    """Raised when a model download is cancelled by the desktop client."""


def validate_language(language: str) -> str:
    """Validate and normalize the languages exposed by the desktop app."""
    value = str(language).strip().lower()
    if value not in SUPPORTED_LANGUAGES:
        raise ValueError(f"Unsupported language: {language}. Use en or vi.")
    return value


def _download_asset(
    repo_id: str,
    destination: Path,
    on_progress: Callable[[dict[str, Any]], None] | None,
    should_cancel: Callable[[], bool] | None,
) -> None:
    """Download one Hugging Face snapshot and translate tqdm into events."""
    from huggingface_hub import snapshot_download
    from tqdm.auto import tqdm

    destination.parent.mkdir(parents=True, exist_ok=True)

    class ProgressBar(tqdm):
        def update(self, n=1):
            if should_cancel and should_cancel():
                raise DownloadCancelled("Model download cancelled")
            result = super().update(n)
            if on_progress:
                progress = None
                if self.total:
                    progress = min(1.0, self.n / self.total)
                on_progress(
                    {
                        "phase": "download",
                        "asset": repo_id,
                        "progress": progress,
                        "message": self.desc or f"Downloading {repo_id}",
                    }
                )
            return result

    if on_progress:
        on_progress(
            {
                "phase": "download",
                "asset": repo_id,
                "progress": 0.0,
                "message": f"Preparing {repo_id}",
            }
        )
    snapshot_download(
        repo_id=repo_id,
        local_dir=str(destination),
        max_workers=4,
        tqdm_class=ProgressBar,
    )


def _detect_device() -> str:
    """Auto-detect best available compute device."""
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda:0"
        if torch.backends.mps.is_available():
            return "mps"
    except ImportError:
        pass
    return "cpu"


def _get_dtype():
    """Get optimal dtype for the device."""
    try:
        import torch

        device = _detect_device()
        if device.startswith("cuda"):
            return torch.float16
        return torch.float32  # MPS/CPU often more stable with fp32
    except ImportError:
        return None


class Engine:
    """Singleton OmniVoice engine wrapper with lazy loading."""

    _instance: "Engine | None" = None
    _model: Any = None
    _model_lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @property
    def model(self):
        """Lazy-load OmniVoice model on first access."""
        if self._model is None:
            self._load_model()
        return self._model

    def _load_model(self):
        """Load OmniVoice model — heavy, only called once."""
        from omnivoice import OmniVoice

        self.ensure_model()
        device = _detect_device()
        dtype = _get_dtype()
        kwargs: dict[str, Any] = {"device_map": device}
        if dtype is not None:
            kwargs["dtype"] = dtype

        print(
            f"[tts-mcp] Loading OmniVoice on {device} ({dtype})...",
            file=__import__("sys").stderr,
        )
        kwargs.update(
            {
                "load_asr": True,
                "asr_model_name": str(ASR_DIR),
                "asr_device": device,
            }
        )
        with self._model_lock:
            if self._model is None:
                self._model = OmniVoice.from_pretrained(str(MODEL_DIR), **kwargs)
        print("[tts-mcp] Model loaded.", file=__import__("sys").stderr)

    def model_status(self) -> dict[str, Any]:
        """Return whether all assets needed for offline generation are ready."""
        ready = (
            READY_MARKER.is_file()
            and (MODEL_DIR / "config.json").is_file()
            and TOKENIZER_DIR.is_dir()
            and (ASR_DIR / "config.json").is_file()
        )
        return {
            "ready": ready,
            "device": _detect_device(),
            "model": MODEL_ID,
            "asr_model": ASR_ID,
        }

    def ensure_model(
        self,
        on_progress: Callable[[dict[str, Any]], None] | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> dict[str, Any]:
        """Download and verify all assets needed for local generation."""
        if self.model_status()["ready"]:
            if on_progress:
                on_progress(
                    {
                        "phase": "ready",
                        "progress": 1.0,
                        "message": "Model ready",
                    }
                )
            return self.model_status()

        with self._model_lock:
            if self.model_status()["ready"]:
                return self.model_status()
            if should_cancel and should_cancel():
                raise DownloadCancelled("Model download cancelled")

            _download_asset(MODEL_ID, MODEL_DIR, on_progress, should_cancel)
            if not TOKENIZER_DIR.is_dir():
                _download_asset(TOKENIZER_ID, TOKENIZER_DIR, on_progress, should_cancel)
            _download_asset(ASR_ID, ASR_DIR, on_progress, should_cancel)

            MODELS_DIR.mkdir(parents=True, exist_ok=True)
            marker_tmp = READY_MARKER.with_suffix(".tmp")
            marker_tmp.write_text(
                json.dumps(
                    {
                        "model": MODEL_ID,
                        "tokenizer": TOKENIZER_ID,
                        "asr_model": ASR_ID,
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            marker_tmp.replace(READY_MARKER)

        if on_progress:
            on_progress(
                {
                    "phase": "verify",
                    "progress": 1.0,
                    "message": "Model verified",
                }
            )
        return self.model_status()

    def generate(
        self,
        text: str,
        ref_audio: str | None = None,
        ref_text: str | None = None,
        instruct: str | None = None,
        voice_clone_prompt: Any = None,
        language: str | None = None,
        speed: float = 1.0,
        num_step: int = 32,
        normalize_text: bool = False,
        duration: float | None = None,
        generation_config: dict[str, Any] | None = None,
    ) -> np.ndarray:
        """Generate audio from text.

        Modes (auto-detected from args):
        - Voice clone: ref_audio provided (with optional ref_text)
        - Voice design: instruct provided (no ref_audio)
        - Auto voice: neither ref_audio nor instruct
        - Saved voice: voice_clone_prompt provided (overrides ref_audio)
        """
        kwargs: dict[str, Any] = {
            "text": text,
            "speed": speed,
            "num_step": num_step,
        }
        if duration is not None:
            kwargs["duration"] = duration
        if normalize_text:
            kwargs["normalize_text"] = True
        if language is not None:
            kwargs["language"] = language
        if generation_config:
            kwargs.update(
                {
                    key: value
                    for key, value in generation_config.items()
                    if key in GENERATION_CONFIG_KEYS
                }
            )

        if voice_clone_prompt is not None:
            kwargs["voice_clone_prompt"] = voice_clone_prompt
        elif ref_audio is not None:
            kwargs["ref_audio"] = ref_audio
            if ref_text is not None:
                kwargs["ref_text"] = ref_text
        elif instruct is not None:
            kwargs["instruct"] = instruct

        audio_list = self.model.generate(**kwargs)
        return audio_list[0]  # np.ndarray shape (T,) at 24 kHz

    # ── Voice profile management ──────────────────────────────────────

    @staticmethod
    def validate_voice_name(name: str) -> str:
        """Validate a profile name before using it as a filename."""
        value = str(name).strip()
        if not VOICE_NAME_RE.fullmatch(value):
            raise ValueError(
                "Voice name must start with a letter or number and contain "
                "only letters, numbers, '_' or '-'."
            )
        return value

    def save_voice(self, name: str, ref_audio: str, ref_text: str | None = None) -> str:
        """Create and save a voice clone prompt for reuse across sessions."""
        name = self.validate_voice_name(name)
        if not Path(ref_audio).is_file():
            raise FileNotFoundError(f"Reference audio not found: {ref_audio}")
        VOICES_DIR.mkdir(parents=True, exist_ok=True)

        prompt = self.model.create_voice_clone_prompt(ref_audio=ref_audio, ref_text=ref_text)
        prompt_path = VOICES_DIR / f"{name}.pt"
        prompt.save(str(prompt_path))

        # Save metadata
        meta = {"name": name, "ref_audio": ref_audio, "ref_text": ref_text}
        meta_path = VOICES_DIR / f"{name}.json"
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False))

        return str(prompt_path)

    def load_voice(self, name: str):
        """Load a saved voice clone prompt by name."""
        name = self.validate_voice_name(name)
        prompt_path = VOICES_DIR / f"{name}.pt"
        if not prompt_path.exists():
            raise FileNotFoundError(
                f"Voice profile '{name}' not found. Saved voices: {self.list_voices()}"
            )
        from omnivoice import VoiceClonePrompt

        return VoiceClonePrompt.load(str(prompt_path))

    @staticmethod
    def list_voices() -> list[dict[str, str]]:
        """List all saved voice profiles."""
        VOICES_DIR.mkdir(parents=True, exist_ok=True)
        voices = []
        for meta_path in sorted(VOICES_DIR.glob("*.json")):
            try:
                meta = json.loads(meta_path.read_text())
                voices.append(meta)
            except (json.JSONDecodeError, OSError):
                continue
        return voices

    @staticmethod
    def delete_voice(name: str) -> bool:
        """Delete a saved voice profile."""
        name = Engine.validate_voice_name(name)
        prompt_path = VOICES_DIR / f"{name}.pt"
        meta_path = VOICES_DIR / f"{name}.json"
        deleted = False
        if prompt_path.exists():
            prompt_path.unlink()
            deleted = True
        if meta_path.exists():
            meta_path.unlink()
            deleted = True
        return deleted


# Module-level convenience
def get_engine() -> Engine:
    return Engine()
