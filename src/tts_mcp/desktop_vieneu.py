"""Desktop-only VieNeu preprocessing and audio.cpp synthesis adapter."""

from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Callable

import numpy as np

from tts_mcp.convert import save_audio
from tts_mcp.engine import DownloadCancelled, validate_language

REPO_ID = "pnnbao-ump/VieNeu-TTS-v3-Turbo"
REVISION = "61b85e3d937fbbacb387714180e8182823512523"
MODEL_FILE = "gguf/vieneu-v3-turbo-q8_0.gguf"
MANIFEST_FILE = "gguf/voices/manifest.json"
ENCODER_FILE = "speaker_encoder.onnx"
VOICE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
REFERENCE_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg"}
OUTPUT_FORMATS = {"wav", "mp3"}


def _resolve_ffmpeg() -> str | None:
    bundled_root = getattr(sys, "_MEIPASS", None)
    if bundled_root:
        for name in ("ffmpeg", "ffmpeg.exe"):
            candidate = Path(bundled_root) / name
            if candidate.is_file():
                return str(candidate)
    env_path = os.environ.get("TTS_MCP_FFMPEG_PATH")
    if env_path:
        candidate = Path(env_path).expanduser()
        return str(candidate) if candidate.is_file() else None
    return shutil.which("ffmpeg")


def _target_triple() -> str | None:
    machine = platform.machine().lower()
    if sys.platform == "darwin":
        if machine in {"arm64", "aarch64"}:
            return "aarch64-apple-darwin"
        if machine in {"x86_64", "amd64"}:
            return "x86_64-apple-darwin"
    if sys.platform == "win32" and machine in {"x86_64", "amd64"}:
        return "x86_64-pc-windows-msvc"
    if sys.platform.startswith("linux") and machine in {"x86_64", "amd64"}:
        return "x86_64-unknown-linux-gnu"
    return None


def _read_manifest(path: Path) -> tuple[list[dict[str, str]], str] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    default = payload.get("default")
    rows = payload.get("voices")
    if not isinstance(default, str) or not isinstance(rows, list):
        return None

    voices: list[dict[str, str]] = []
    ids: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            return None
        voice_id, name, label = (row.get(key) for key in ("id", "name", "label"))
        if (
            not isinstance(voice_id, str)
            or not VOICE_ID_RE.fullmatch(voice_id)
            or not isinstance(name, str)
            or not name.strip()
            or not isinstance(label, str)
            or not label.strip()
            or voice_id in ids
        ):
            return None
        ids.add(voice_id)
        voices.append({"id": voice_id, "name": name, "label": label})
    if not voices or default not in ids:
        return None
    return voices, default


def _valid_ref_codes(path: Path) -> bool:
    try:
        rows = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return False
    found = False
    for row in rows:
        values = row.split()
        if not values:
            continue
        if len(values) != 16:
            return False
        try:
            codes = [int(value) for value in values]
        except ValueError:
            return False
        if any(value < 0 or value > 1023 for value in codes):
            return False
        found = True
    return found


def _read_embedding(path: Path) -> list[float] | None:
    try:
        values = [float(value) for value in path.read_text(encoding="utf-8").strip().split(",")]
    except (OSError, UnicodeError, ValueError):
        return None
    if len(values) != 192 or any(not math.isfinite(value) for value in values):
        return None
    return values


class VieNeuProvider:
    """Download the pinned VieNeu assets and synthesize through audio.cpp."""

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.root = self.data_dir / "models" / "vieneu"
        self._download_lock = threading.Lock()
        self._synthesis_lock = threading.Lock()
        self._speaker_encoder: Any = None

    @property
    def model_path(self) -> Path:
        return self.root / MODEL_FILE

    @property
    def manifest_path(self) -> Path:
        return self.root / MANIFEST_FILE

    @property
    def encoder_path(self) -> Path:
        return self.root / ENCODER_FILE

    def _audio_cpp_path(self) -> Path | None:
        configured = os.environ.get("TTS_MCP_AUDIOCPP_PATH")
        if configured:
            return Path(configured).expanduser()
        target = _target_triple() if getattr(sys, "frozen", False) else None
        if target:
            suffix = ".exe" if target.endswith("windows-msvc") else ""
            binary = Path(sys.executable).resolve().with_name(f"audiocpp-cli-{target}{suffix}")
            if binary.is_file():
                return binary
            tauri_binary = binary.with_name(f"audiocpp-cli{suffix}")
            return tauri_binary if tauri_binary.is_file() else binary
        return None

    def _runtime_status(self) -> tuple[bool, str | None]:
        binary = self._audio_cpp_path()
        if binary is None or not binary.is_file():
            return (
                False,
                "audio.cpp CLI is missing; install the desktop runtime or set TTS_MCP_AUDIOCPP_PATH.",
            )
        if os.name != "nt" and not os.access(binary, os.X_OK):
            return False, f"audio.cpp CLI is not executable: {binary}"
        try:
            result = subprocess.run(
                [str(binary), "--help"], capture_output=True, text=True, timeout=5, check=False
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return False, f"audio.cpp CLI cannot run: {exc}"
        if result.returncode != 0:
            return (
                False,
                "audio.cpp CLI did not start successfully; rebuild the bundled CPU runtime.",
            )
        return True, None

    @staticmethod
    def _preprocessing_status() -> tuple[bool, str | None]:
        try:
            from vieneu._v3_turbo_engine.speaker import OnnxSpeakerEncoder  # noqa: F401
            from vieneu_utils.phonemize_text import phonemize_text_with_emotions  # noqa: F401
        except Exception as exc:
            return (
                False,
                f"VieNeu preprocessing is unavailable; install tts-mcp[desktop-vieneu]: {exc}",
            )
        return True, None

    def _manifest(self) -> tuple[list[dict[str, str]], str] | None:
        return _read_manifest(self.manifest_path)

    def _valid_model_asset(self) -> bool:
        try:
            with self.model_path.open("rb") as model:
                if model.read(4) != b"GGUF":
                    return False
        except OSError:
            return False
        return self.model_path.stat().st_size > 4

    @staticmethod
    def _valid_encoder(path: Path) -> bool:
        return path.is_file() and path.stat().st_size > 0

    def _valid_voice_assets(self, voice_id: str) -> bool:
        voice_dir = self.root / "gguf" / "voices" / voice_id
        return (
            _valid_ref_codes(voice_dir / "ref_codes.txt")
            and _read_embedding(voice_dir / "speaker.emb.txt") is not None
        )

    def _model_ready(self) -> bool:
        manifest = self._manifest()
        return bool(
            manifest
            and self._valid_model_asset()
            and self._valid_encoder(self.encoder_path)
            and all(self._valid_voice_assets(voice["id"]) for voice in manifest[0])
        )

    def status(self) -> dict[str, Any]:
        runtime_available, runtime_reason = self._runtime_status()
        preprocessing_available, preprocessing_reason = self._preprocessing_status()
        manifest = self._manifest()
        model_ready = self._model_ready()
        reason = runtime_reason or preprocessing_reason
        if reason is None and not model_ready:
            reason = (
                "VieNeu model assets are not ready; "
                "run prepare_model(provider='vieneu') first"
            )
        return {
            "model_ready": model_ready,
            "runtime_available": runtime_available,
            "preprocessing_available": preprocessing_available,
            "preset_voices": manifest[0] if manifest else [],
            "default_voice": manifest[1] if manifest else None,
            "unavailable_reason": reason,
        }

    def _download_patterns(
        self,
        patterns: list[str],
        on_progress: Callable[[dict[str, Any]], None] | None,
        should_cancel: Callable[[], bool] | None,
    ) -> None:
        from huggingface_hub import snapshot_download
        from tqdm.auto import tqdm

        class ProgressBar(tqdm):
            def update(progress_bar, n=1):
                if should_cancel and should_cancel():
                    raise DownloadCancelled("VieNeu model download cancelled")
                result = super(ProgressBar, progress_bar).update(n)
                if on_progress:
                    progress = None
                    if progress_bar.total:
                        progress = min(1.0, progress_bar.n / progress_bar.total)
                    on_progress(
                        {
                            "phase": "download",
                            "asset": "VieNeu-TTS v3 Turbo",
                            "progress": progress,
                            "message": progress_bar.desc or "Downloading VieNeu assets",
                        }
                    )
                return result

        if should_cancel and should_cancel():
            raise DownloadCancelled("VieNeu model download cancelled")
        if on_progress:
            on_progress(
                {
                    "phase": "download",
                    "asset": "VieNeu-TTS v3 Turbo",
                    "progress": 0.0,
                    "message": "Preparing VieNeu assets",
                }
            )
        snapshot_download(
            repo_id=REPO_ID,
            revision=REVISION,
            local_dir=str(self.root),
            allow_patterns=patterns,
            max_workers=4,
            tqdm_class=ProgressBar,
        )

    @staticmethod
    def _unlink_invalid(path: Path, validator: Callable[[Path], bool]) -> None:
        if path.exists() and not validator(path):
            path.unlink()

    def ensure_model(
        self,
        on_progress: Callable[[dict[str, Any]], None] | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> dict[str, bool]:
        with self._download_lock:
            if self._model_ready():
                if on_progress:
                    on_progress(
                        {"phase": "ready", "progress": 1.0, "message": "VieNeu model ready"}
                    )
                return {"ready": True}
            if should_cancel and should_cancel():
                raise DownloadCancelled("VieNeu model download cancelled")

            self.root.mkdir(parents=True, exist_ok=True)
            self._unlink_invalid(self.manifest_path, lambda path: _read_manifest(path) is not None)
            if self._manifest() is None:
                self._download_patterns([MANIFEST_FILE], on_progress, should_cancel)
            manifest = self._manifest()
            if manifest is None:
                raise RuntimeError("Downloaded VieNeu preset manifest is invalid")

            voices, _ = manifest
            self._unlink_invalid(self.model_path, lambda path: self._valid_model_asset())
            self._unlink_invalid(self.encoder_path, self._valid_encoder)
            patterns = [
                pattern
                for pattern, path, valid in (
                    (MODEL_FILE, self.model_path, self._valid_model_asset()),
                    (ENCODER_FILE, self.encoder_path, self._valid_encoder(self.encoder_path)),
                )
                if not valid
            ]
            for voice in voices:
                voice_id = voice["id"]
                voice_dir = self.root / "gguf" / "voices" / voice_id
                codes = voice_dir / "ref_codes.txt"
                embedding = voice_dir / "speaker.emb.txt"
                self._unlink_invalid(codes, _valid_ref_codes)
                self._unlink_invalid(embedding, lambda path: _read_embedding(path) is not None)
                if not _valid_ref_codes(codes):
                    patterns.append(f"gguf/voices/{voice_id}/ref_codes.txt")
                if _read_embedding(embedding) is None:
                    patterns.append(f"gguf/voices/{voice_id}/speaker.emb.txt")
            if patterns:
                self._download_patterns(patterns, on_progress, should_cancel)
            if should_cancel and should_cancel():
                raise DownloadCancelled("VieNeu model download cancelled")
            if not self._model_ready():
                raise RuntimeError(
                    "VieNeu download finished, but one or more model assets failed validation"
                )
            if on_progress:
                on_progress({"phase": "ready", "progress": 1.0, "message": "VieNeu model ready"})
            return {"ready": True}

    @staticmethod
    def _reference_path(value: Any) -> Path:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("Reference audio path must be a non-empty string")
        path = Path(value).expanduser()
        if path.suffix.lower() not in REFERENCE_EXTENSIONS:
            raise ValueError("Reference audio must be a WAV, MP3, FLAC, or OGG file")
        if not path.is_file():
            raise FileNotFoundError(f"Reference audio file was not found: {value}")
        return path.resolve()

    @staticmethod
    def _reject_fields(request: dict[str, Any], fields: tuple[str, ...]) -> None:
        present = [field for field in fields if request.get(field) is not None]
        if present:
            raise ValueError(f"Fields not valid for this VieNeu voice mode: {', '.join(present)}")

    def _normalize_reference(self, path: Path, temp_dir: Path) -> Path:
        ffmpeg = _resolve_ffmpeg()
        if not ffmpeg:
            raise RuntimeError(
                "Reference audio requires FFmpeg; install it or set TTS_MCP_FFMPEG_PATH"
            )
        normalized = temp_dir / "reference.wav"
        try:
            subprocess.run(
                [
                    ffmpeg,
                    "-nostdin",
                    "-v",
                    "error",
                    "-y",
                    "-i",
                    str(path),
                    "-ac",
                    "1",
                    "-ar",
                    "48000",
                    "-c:a",
                    "pcm_s16le",
                    str(normalized),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            detail = getattr(exc, "stderr", None)
            raise RuntimeError(
                f"Could not normalize VieNeu reference audio: {detail or exc}"
            ) from exc
        if not normalized.is_file() or normalized.stat().st_size == 0:
            raise RuntimeError("FFmpeg did not produce a readable reference WAV")
        return normalized

    @staticmethod
    def _file_hash(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _speaker_embedding(self, source: Path, normalized: Path) -> Path:
        cache_path = self.root / "speaker-embeddings" / f"{self._file_hash(source)}.txt"
        if _read_embedding(cache_path) is not None:
            return cache_path
        if self._speaker_encoder is None:
            from vieneu._v3_turbo_engine.speaker import OnnxSpeakerEncoder

            self._speaker_encoder = OnnxSpeakerEncoder.from_pretrained(
                str(self.root), filename=ENCODER_FILE
            )
        import soundfile as sf

        audio, sample_rate = sf.read(str(normalized), dtype="float32", always_2d=True)
        embedding = self._speaker_encoder.embed(np.ascontiguousarray(audio.T), sample_rate)
        if np.asarray(embedding).size != 192 or not np.isfinite(embedding).all():
            raise RuntimeError("VieNeu speaker encoder returned an invalid embedding")
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache_path.with_name(f".{cache_path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_text(
                ",".join(f"{float(value):.8f}" for value in embedding) + "\n", encoding="utf-8"
            )
            temporary.replace(cache_path)
        finally:
            temporary.unlink(missing_ok=True)
        return cache_path

    def synthesize(
        self,
        request: dict[str, Any],
        voices: list[dict[str, Any]],
        output_dir: Path,
        output_path: Path | str | None = None,
    ) -> dict[str, str]:
        with self._synthesis_lock:
            return self._synthesize(request, voices, output_dir, output_path)

    def _synthesize(
        self,
        request: dict[str, Any],
        voices: list[dict[str, Any]],
        output_dir: Path,
        output_path: Path | str | None,
    ) -> dict[str, str]:
        text = request.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Text must not be empty")
        validate_language(request.get("language", "en"))
        output_format = str(request.get("format", "wav")).lower().lstrip(".")
        if output_format not in OUTPUT_FORMATS:
            raise ValueError("Format must be wav or mp3")
        destination = Path(output_path) if output_path is not None else None
        if destination is not None and destination.suffix.lower() != f".{output_format}":
            raise ValueError("Output path extension must match the selected wav or mp3 format")
        self._reject_fields(
            request,
            ("speed", "steps", "duration", "normalize_text", "generation_config", "instruct"),
        )

        voice_mode = request.get("voice")
        voice_args: list[str]
        reference: Path | None = None
        if voice_mode == "preset":
            self._reject_fields(request, ("voice_name", "ref_audio", "ref_text"))
            preset_id = request.get("preset_id")
            manifest = self._manifest()
            if (
                not isinstance(preset_id, str)
                or not manifest
                or preset_id not in {voice["id"] for voice in manifest[0]}
            ):
                raise ValueError("Unknown VieNeu preset voice")
            preset_dir = self.root / "gguf" / "voices" / preset_id
            voice_args = [
                "--task",
                "tts",
                "--request-option",
                f"reference_codes_file={preset_dir / 'ref_codes.txt'}",
                "--request-option",
                f"speaker_embedding_file={preset_dir / 'speaker.emb.txt'}",
            ]
        elif voice_mode == "profile":
            self._reject_fields(request, ("preset_id", "ref_audio", "ref_text"))
            voice_name = request.get("voice_name")
            if not isinstance(voice_name, str) or not voice_name.strip():
                raise ValueError("Voice profile name must be a non-empty string")
            profile = next((item for item in voices if item.get("name") == voice_name), None)
            if profile is None:
                raise FileNotFoundError(f"Voice profile '{voice_name}' was not found")
            if profile.get("kind") != "clone":
                raise ValueError("VieNeu supports saved Clone profiles, not Design profiles")
            reference = self._reference_path(profile.get("ref_audio"))
            voice_args = []
        elif voice_mode == "file":
            self._reject_fields(request, ("preset_id", "voice_name", "ref_text"))
            reference = self._reference_path(request.get("ref_audio"))
            voice_args = []
        else:
            raise ValueError("VieNeu voice must be preset, profile, or file")

        runtime_available, runtime_reason = self._runtime_status()
        preprocessing_available, preprocessing_reason = self._preprocessing_status()
        if not runtime_available:
            raise RuntimeError(runtime_reason or "audio.cpp CLI is unavailable")
        if not preprocessing_available:
            raise RuntimeError(preprocessing_reason or "VieNeu preprocessing is unavailable")
        if not self._model_ready():
            raise RuntimeError(
                "VieNeu model assets are not ready; run prepare_model(provider='vieneu') first"
            )

        from vieneu_utils.phonemize_text import phonemize_text_with_emotions

        phonemes = phonemize_text_with_emotions(text)
        if not isinstance(phonemes, str) or not phonemes.strip():
            raise ValueError("VieNeu could not phonemize the requested text")
        binary = self._audio_cpp_path()
        if binary is None:
            raise RuntimeError("audio.cpp CLI is unavailable")

        if destination is None:
            output_dir.mkdir(parents=True, exist_ok=True)
            destination = output_dir / f"{uuid.uuid4().hex}.{output_format}"
            working_output = destination
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            working_output = destination.with_name(
                f".{destination.stem}.{uuid.uuid4().hex}.tmp{destination.suffix}"
            )
        try:
            with tempfile.TemporaryDirectory(prefix="vieneu-") as temporary_dir:
                temp_dir = Path(temporary_dir)
                if reference is not None:
                    normalized = self._normalize_reference(reference, temp_dir)
                    embedding = self._speaker_embedding(reference, normalized)
                    voice_args = [
                        "--task",
                        "tts",
                        "--voice-ref",
                        str(normalized),
                        "--request-option",
                        f"speaker_embedding_file={embedding}",
                    ]
                native_output = temp_dir / "speech.wav"
                command = [
                    str(binary),
                    *voice_args[:2],
                    "--family",
                    "vieneu_v3_turbo",
                    "--model",
                    str(self.model_path),
                    "--backend",
                    "cpu",
                    "--text",
                    phonemes,
                    *voice_args[2:],
                    "--out",
                    str(native_output),
                ]
                subprocess.run(command, capture_output=True, text=True, check=True)
                if not native_output.is_file():
                    raise RuntimeError("audio.cpp did not produce an output WAV")
                import soundfile as sf

                info = sf.info(str(native_output))
                if info.frames <= 0 or info.samplerate != 48000:
                    raise RuntimeError("audio.cpp produced an unreadable or non-48 kHz WAV")
                audio, sample_rate = sf.read(str(native_output), dtype="float32", always_2d=True)
                save_audio(
                    np.asarray(audio, dtype=np.float32),
                    str(working_output),
                    sample_rate=sample_rate,
                    ffmpeg_path=_resolve_ffmpeg(),
                )
            if working_output != destination:
                working_output.replace(destination)
        except (OSError, subprocess.SubprocessError) as exc:
            detail = getattr(exc, "stderr", None)
            working_output.unlink(missing_ok=True)
            raise RuntimeError(f"VieNeu synthesis failed: {detail or exc}") from exc
        except Exception:
            working_output.unlink(missing_ok=True)
            raise
        return {"audio_path": str(destination), "format": output_format}
