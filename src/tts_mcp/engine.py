"""OmniVoice engine wrapper — lazy load, device auto-detect, voice profile cache."""

from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import threading
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np

# Default directories
DATA_DIR = Path(os.environ.get("TTS_MCP_DATA_DIR", Path.home() / ".tts-mcp"))
VOICES_DIR = DATA_DIR / "voices"
DB_PATH = DATA_DIR / "volo.db"
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
REFERENCE_AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg"}
VOICE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
SEED_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
DB_SCHEMA_VERSION = 2
_STORAGE_LOCK = threading.RLock()
_MIGRATED_STORAGES: set[tuple[Path, Path]] = set()
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


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _relative_data_path(path: Path) -> str:
    return path.resolve().relative_to(DATA_DIR.resolve()).as_posix()


def _resolve_data_path(value: str | None) -> Path | None:
    if not value:
        return None
    root = DATA_DIR.resolve()
    path = (root / value).resolve()
    if path != root and root not in path.parents:
        raise RuntimeError("Stored app-data path escaped the data directory")
    return path


def _copy_file_atomic(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.",
    )
    os.close(descriptor)
    temporary_path = Path(temporary)
    try:
        shutil.copy2(source, temporary_path)
        os.replace(temporary_path, destination)
    finally:
        temporary_path.unlink(missing_ok=True)


def _save_prompt_atomic(prompt: Any, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".pt",
    )
    os.close(descriptor)
    temporary_path = Path(temporary)
    try:
        prompt.save(str(temporary_path))
        os.replace(temporary_path, destination)
    finally:
        temporary_path.unlink(missing_ok=True)


def _validate_reference_audio_path(value: str) -> Path:
    path = Path(value)
    if path.suffix.lower() not in REFERENCE_AUDIO_EXTENSIONS:
        raise ValueError("Reference audio must be a WAV, MP3, FLAC, or OGG file")
    if not path.is_file():
        raise FileNotFoundError(f"Reference audio not found: {value}")
    try:
        import soundfile as sf

        sf.info(str(path))
    except (OSError, RuntimeError, ValueError) as exc:
        raise ValueError("Reference audio file is not a readable audio file") from exc
    return path.resolve()


def _open_database() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=5.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.execute("PRAGMA journal_mode = WAL")
    version = int(connection.execute("PRAGMA user_version").fetchone()[0])
    if version > DB_SCHEMA_VERSION:
        connection.close()
        raise RuntimeError(
            f"Database schema {version} is newer than this app supports ({DB_SCHEMA_VERSION})"
        )
    if version < 1:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS voice_profiles (
                name TEXT PRIMARY KEY,
                language TEXT NOT NULL CHECK (language IN ('en', 'vi')),
                kind TEXT NOT NULL DEFAULT 'clone' CHECK (kind IN ('clone', 'design')),
                ref_audio_path TEXT,
                prompt_path TEXT,
                design_instruction TEXT,
                ref_text TEXT,
                is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
                seed_key TEXT,
                seed_version INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                CHECK (
                    (kind = 'clone' AND prompt_path IS NOT NULL AND design_instruction IS NULL)
                    OR (kind = 'design' AND prompt_path IS NULL AND design_instruction IS NOT NULL)
                )
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_profiles_default_language
                ON voice_profiles(language) WHERE is_default = 1;
            CREATE TABLE IF NOT EXISTS app_seeds (
                seed_key TEXT PRIMARY KEY,
                version INTEGER NOT NULL,
                installed_at TEXT NOT NULL
            );
            PRAGMA user_version = 2;
            """
        )
        connection.commit()
    elif version < 2:
        connection.executescript(
            """
            CREATE TABLE voice_profiles_v2 (
                name TEXT PRIMARY KEY,
                language TEXT NOT NULL CHECK (language IN ('en', 'vi')),
                kind TEXT NOT NULL DEFAULT 'clone' CHECK (kind IN ('clone', 'design')),
                ref_audio_path TEXT,
                prompt_path TEXT,
                design_instruction TEXT,
                ref_text TEXT,
                is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
                seed_key TEXT,
                seed_version INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                CHECK (
                    (kind = 'clone' AND prompt_path IS NOT NULL AND design_instruction IS NULL)
                    OR (kind = 'design' AND prompt_path IS NULL AND design_instruction IS NOT NULL)
                )
            );
            INSERT INTO voice_profiles_v2
                (name, language, kind, ref_audio_path, prompt_path, design_instruction,
                 ref_text, is_default, seed_key, seed_version, created_at, updated_at)
            SELECT name, language, 'clone', ref_audio_path, prompt_path, NULL,
                   ref_text, is_default, seed_key, seed_version, created_at, updated_at
            FROM voice_profiles;
            DROP TABLE voice_profiles;
            ALTER TABLE voice_profiles_v2 RENAME TO voice_profiles;
            CREATE UNIQUE INDEX idx_voice_profiles_default_language
                ON voice_profiles(language) WHERE is_default = 1;
            PRAGMA user_version = 2;
            """
        )
        connection.commit()
    return connection


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
            file=sys.stderr,
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
        print("[tts-mcp] Model loaded.", file=sys.stderr)

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
            "tokenizer": TOKENIZER_ID,
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

    @staticmethod
    def _migrate_legacy_profiles(connection: sqlite3.Connection) -> None:
        """Import legacy JSON metadata and prompts into the SQLite store."""
        for meta_path in sorted(VOICES_DIR.glob("*.json")):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                name = Engine.validate_voice_name(meta.get("name", meta_path.stem))
            except (OSError, json.JSONDecodeError, TypeError, ValueError):
                continue
            if connection.execute(
                "SELECT 1 FROM voice_profiles WHERE name = ?", (name,)
            ).fetchone():
                continue

            legacy_prompt = VOICES_DIR / f"{name}.pt"
            if not legacy_prompt.is_file():
                continue
            profile_dir = VOICES_DIR / name
            prompt_path = profile_dir / "prompt.pt"
            try:
                if not prompt_path.exists():
                    _copy_file_atomic(legacy_prompt, prompt_path)
            except OSError:
                continue

            local_reference: Path | None = None
            raw_reference = meta.get("ref_audio")
            if isinstance(raw_reference, str):
                reference = Path(raw_reference)
                if reference.is_file() and reference.suffix.lower() in REFERENCE_AUDIO_EXTENSIONS:
                    local_reference = profile_dir / f"reference{reference.suffix.lower()}"
                    try:
                        if not local_reference.exists():
                            _copy_file_atomic(reference, local_reference)
                    except OSError:
                        local_reference = None

            try:
                language = validate_language(meta.get("language", "en"))
            except (TypeError, ValueError):
                language = "en"
            is_default = bool(meta.get("is_default", False))
            if is_default and connection.execute(
                "SELECT 1 FROM voice_profiles WHERE language = ? AND is_default = 1",
                (language,),
            ).fetchone():
                is_default = False
            ref_text = meta.get("ref_text")
            if not isinstance(ref_text, str):
                ref_text = None
            seed_key = meta.get("seed_key")
            if not isinstance(seed_key, str):
                seed_key = None
            seed_version = meta.get("seed_version")
            if isinstance(seed_version, bool) or not isinstance(seed_version, int):
                seed_version = None
            now = _utc_now()
            connection.execute(
                """
                INSERT INTO voice_profiles
                    (name, language, kind, ref_audio_path, prompt_path, design_instruction,
                     ref_text, is_default, seed_key, seed_version, created_at, updated_at)
                VALUES (?, ?, 'clone', ?, ?, NULL, ?, ?, ?, ?, ?, ?)
                """,
                (
                    name,
                    language,
                    _relative_data_path(local_reference) if local_reference else None,
                    _relative_data_path(prompt_path),
                    ref_text,
                    int(is_default),
                    seed_key,
                    seed_version,
                    now,
                    now,
                ),
            )
        connection.commit()

    @staticmethod
    def _open_storage() -> sqlite3.Connection:
        connection = _open_database()
        storage_key = (DB_PATH.resolve(), VOICES_DIR.resolve())
        if storage_key not in _MIGRATED_STORAGES:
            try:
                Engine._migrate_legacy_profiles(connection)
            except Exception:
                connection.close()
                raise
            _MIGRATED_STORAGES.add(storage_key)
        return connection

    def save_voice(
        self,
        name: str,
        ref_audio: str,
        ref_text: str | None = None,
        language: str = "en",
        *,
        seed_key: str | None = None,
        seed_version: int | None = None,
        is_default: bool = False,
    ) -> str:
        """Create a portable voice profile and save its metadata in SQLite."""
        name = self.validate_voice_name(name)
        language = validate_language(language)
        source = _validate_reference_audio_path(ref_audio)
        if ref_text is not None and not isinstance(ref_text, str):
            raise ValueError("Reference transcript must be a string")
        if seed_key is not None and not SEED_ID_RE.fullmatch(seed_key):
            raise ValueError("Seed id must contain only lowercase letters, numbers, '_' or '-'.")
        if isinstance(seed_version, bool) or (
            seed_version is not None and (not isinstance(seed_version, int) or seed_version <= 0)
        ):
            raise ValueError("Seed version must be a positive integer")
        if not isinstance(is_default, bool):
            raise ValueError("is_default must be a boolean")

        with _STORAGE_LOCK:
            connection = self._open_storage()
            profile_dir = VOICES_DIR / name
            staging_dir = VOICES_DIR / f".{name}.staging-{uuid.uuid4().hex}"
            backup_dir = VOICES_DIR / f".{name}.backup-{uuid.uuid4().hex}"
            current = connection.execute(
                "SELECT * FROM voice_profiles WHERE name = ?", (name,)
            ).fetchone()
            try:
                reference_path = staging_dir / f"reference{source.suffix.lower()}"
                prompt_path = staging_dir / "prompt.pt"
                _copy_file_atomic(source, reference_path)
                prompt = self.model.create_voice_clone_prompt(
                    ref_audio=str(reference_path), ref_text=ref_text
                )
                _save_prompt_atomic(prompt, prompt_path)

                if profile_dir.exists():
                    profile_dir.rename(backup_dir)
                staging_dir.rename(profile_dir)
                final_reference = profile_dir / reference_path.name
                final_prompt = profile_dir / prompt_path.name
                has_other_default = connection.execute(
                    """
                    SELECT 1 FROM voice_profiles
                    WHERE language = ? AND is_default = 1 AND name <> ?
                    """,
                    (language, name),
                ).fetchone()
                if is_default and not has_other_default:
                    final_default = True
                elif current and current["language"] == language:
                    final_default = bool(current["is_default"])
                else:
                    final_default = False
                now = _utc_now()
                created_at = current["created_at"] if current else now
                with connection:
                    if final_default:
                        connection.execute(
                            "UPDATE voice_profiles SET is_default = 0 WHERE language = ? AND name <> ?",
                            (language, name),
                        )
                    connection.execute(
                        """
                        INSERT INTO voice_profiles
                            (name, language, kind, ref_audio_path, prompt_path, design_instruction,
                             ref_text, is_default, seed_key, seed_version, created_at, updated_at)
                        VALUES (?, ?, 'clone', ?, ?, NULL, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(name) DO UPDATE SET
                            language = excluded.language,
                            kind = 'clone',
                            ref_audio_path = excluded.ref_audio_path,
                            prompt_path = excluded.prompt_path,
                            design_instruction = NULL,
                            ref_text = excluded.ref_text,
                            is_default = excluded.is_default,
                            seed_key = COALESCE(excluded.seed_key, voice_profiles.seed_key),
                            seed_version = COALESCE(excluded.seed_version, voice_profiles.seed_version),
                            updated_at = excluded.updated_at
                        """,
                        (
                            name,
                            language,
                            _relative_data_path(final_reference),
                            _relative_data_path(final_prompt),
                            ref_text,
                            int(final_default),
                            seed_key,
                            seed_version,
                            created_at,
                            now,
                        ),
                    )
            except Exception:
                if profile_dir.exists() and profile_dir != backup_dir:
                    shutil.rmtree(profile_dir, ignore_errors=True)
                if backup_dir.exists() and not profile_dir.exists():
                    backup_dir.rename(profile_dir)
                raise
            finally:
                if staging_dir.exists():
                    shutil.rmtree(staging_dir, ignore_errors=True)
                connection.close()
            if backup_dir.exists():
                shutil.rmtree(backup_dir, ignore_errors=True)
            return str(final_prompt)

    def save_design_voice(
        self,
        name: str,
        design_instruction: str,
        language: str = "en",
        *,
        is_default: bool = False,
    ) -> str:
        """Create or replace a profile backed by a voice design instruction."""
        name = self.validate_voice_name(name)
        language = validate_language(language)
        if not isinstance(design_instruction, str) or not design_instruction.strip():
            raise ValueError("Voice design instruction must be a non-empty string")
        if not isinstance(is_default, bool):
            raise ValueError("is_default must be a boolean")

        with _STORAGE_LOCK:
            connection = self._open_storage()
            profile_dir = VOICES_DIR / name
            backup_dir = VOICES_DIR / f".{name}.backup-{uuid.uuid4().hex}"
            current = connection.execute(
                "SELECT * FROM voice_profiles WHERE name = ?", (name,)
            ).fetchone()
            try:
                if profile_dir.exists():
                    profile_dir.rename(backup_dir)
                has_other_default = connection.execute(
                    """
                    SELECT 1 FROM voice_profiles
                    WHERE language = ? AND is_default = 1 AND name <> ?
                    """,
                    (language, name),
                ).fetchone()
                if is_default and not has_other_default:
                    final_default = True
                elif current and current["language"] == language:
                    final_default = bool(current["is_default"])
                else:
                    final_default = False
                now = _utc_now()
                created_at = current["created_at"] if current else now
                with connection:
                    if final_default:
                        connection.execute(
                            "UPDATE voice_profiles SET is_default = 0 WHERE language = ? AND name <> ?",
                            (language, name),
                        )
                    connection.execute(
                        """
                        INSERT INTO voice_profiles
                            (name, language, kind, ref_audio_path, prompt_path,
                             design_instruction, ref_text, is_default, seed_key,
                             seed_version, created_at, updated_at)
                        VALUES (?, ?, 'design', NULL, NULL, ?, NULL, ?, NULL, NULL, ?, ?)
                        ON CONFLICT(name) DO UPDATE SET
                            language = excluded.language,
                            kind = 'design',
                            ref_audio_path = NULL,
                            prompt_path = NULL,
                            design_instruction = excluded.design_instruction,
                            ref_text = NULL,
                            is_default = excluded.is_default,
                            updated_at = excluded.updated_at
                        """,
                        (
                            name,
                            language,
                            design_instruction.strip(),
                            int(final_default),
                            created_at,
                            now,
                        ),
                    )
            except Exception:
                if backup_dir.exists() and not profile_dir.exists():
                    backup_dir.rename(profile_dir)
                raise
            finally:
                connection.close()
            if backup_dir.exists():
                shutil.rmtree(backup_dir, ignore_errors=True)
            return name

    @staticmethod
    def _read_seed_manifest(seed_folder: Path) -> tuple[dict[str, Any], Path]:
        manifest_path = seed_folder / "manifest.json"
        if not manifest_path.is_file():
            raise FileNotFoundError(f"Seed manifest not found: {manifest_path}")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid seed manifest: {manifest_path}") from exc
        if not isinstance(manifest, dict):
            raise ValueError("Seed manifest must be a JSON object")
        seed_id = manifest.get("id")
        if not isinstance(seed_id, str) or not SEED_ID_RE.fullmatch(seed_id):
            raise ValueError("Seed manifest id must use lowercase letters, numbers, '_' or '-'")
        version = manifest.get("version")
        if isinstance(version, bool) or not isinstance(version, int) or version <= 0:
            raise ValueError("Seed manifest version must be a positive integer")
        name = Engine.validate_voice_name(manifest.get("name", ""))
        language = validate_language(manifest.get("language", ""))
        default = manifest.get("default", False)
        if not isinstance(default, bool):
            raise ValueError("Seed manifest default must be a boolean")
        ref_text = manifest.get("ref_text")
        if ref_text is not None and not isinstance(ref_text, str):
            raise ValueError("Seed manifest ref_text must be a string")
        audio_value = manifest.get("audio")
        if not isinstance(audio_value, str) or not audio_value.strip():
            raise ValueError("Seed manifest audio must be a relative file path")
        audio_relative = Path(audio_value)
        if audio_relative.is_absolute() or ".." in audio_relative.parts:
            raise ValueError("Seed manifest audio must stay inside its seed folder")
        audio_path = (seed_folder / audio_relative).resolve()
        if seed_folder.resolve() not in audio_path.parents:
            raise ValueError("Seed manifest audio must stay inside its seed folder")
        _validate_reference_audio_path(str(audio_path))
        return (
            {
                "id": seed_id,
                "version": version,
                "name": name,
                "language": language,
                "default": default,
                "ref_text": ref_text,
            },
            audio_path,
        )

    def import_seed_voices(self, seed_dir: str) -> dict[str, list[dict[str, str]]]:
        """Import versioned bundled voice folders into app-local storage."""
        root = Path(seed_dir)
        if not root.is_dir():
            raise FileNotFoundError(f"Seed directory not found: {seed_dir}")
        result: dict[str, list[dict[str, str]]] = {
            "imported": [],
            "skipped": [],
            "errors": [],
        }
        for seed_folder in sorted(path for path in root.iterdir() if path.is_dir()):
            try:
                manifest, audio_path = self._read_seed_manifest(seed_folder)
                seed_id = manifest["id"]
                version = manifest["version"]
                with _STORAGE_LOCK, closing(self._open_storage()) as connection:
                    installed = connection.execute(
                        "SELECT version FROM app_seeds WHERE seed_key = ?", (seed_id,)
                    ).fetchone()
                    existing = connection.execute(
                        "SELECT 1 FROM voice_profiles WHERE name = ?", (manifest["name"],)
                    ).fetchone()
                    default_exists = connection.execute(
                        """
                        SELECT 1 FROM voice_profiles
                        WHERE language = ? AND is_default = 1
                        """,
                        (manifest["language"],),
                    ).fetchone()
                if installed and installed["version"] >= version:
                    result["skipped"].append(
                        {"id": seed_id, "name": manifest["name"], "reason": "already_installed"}
                    )
                    continue
                if existing:
                    with _STORAGE_LOCK, closing(self._open_storage()) as connection:
                        with connection:
                            connection.execute(
                                """
                                INSERT INTO app_seeds(seed_key, version, installed_at)
                                VALUES (?, ?, ?)
                                ON CONFLICT(seed_key) DO UPDATE SET
                                    version = excluded.version,
                                    installed_at = excluded.installed_at
                                """,
                                (seed_id, version, _utc_now()),
                            )
                    result["skipped"].append(
                        {"id": seed_id, "name": manifest["name"], "reason": "profile_exists"}
                    )
                    continue

                self.save_voice(
                    manifest["name"],
                    str(audio_path),
                    manifest["ref_text"],
                    manifest["language"],
                    seed_key=seed_id,
                    seed_version=version,
                    is_default=bool(manifest["default"] and not default_exists),
                )
                with _STORAGE_LOCK, closing(self._open_storage()) as connection:
                    with connection:
                        connection.execute(
                            """
                            INSERT INTO app_seeds(seed_key, version, installed_at)
                            VALUES (?, ?, ?)
                            ON CONFLICT(seed_key) DO UPDATE SET
                                version = excluded.version,
                                installed_at = excluded.installed_at
                            """,
                            (seed_id, version, _utc_now()),
                        )
                result["imported"].append(
                    {"id": seed_id, "name": manifest["name"], "language": manifest["language"]}
                )
            except Exception as exc:
                result["errors"].append(
                    {"id": seed_folder.name, "message": str(exc)}
                )
        return result

    def load_voice_profile(self, name: str) -> dict[str, Any]:
        """Resolve a saved profile for a synthesis request."""
        name = self.validate_voice_name(name)
        with _STORAGE_LOCK:
            with closing(self._open_storage()) as connection:
                row = connection.execute(
                    """
                    SELECT kind, prompt_path, design_instruction
                    FROM voice_profiles WHERE name = ?
                    """,
                    (name,),
                ).fetchone()
        if row and row["kind"] not in {"clone", "design"}:
            raise ValueError(f"Unsupported voice profile kind: {row['kind']}")
        if row and row["kind"] == "design":
            instruction = row["design_instruction"]
            if not isinstance(instruction, str) or not instruction.strip():
                raise RuntimeError(f"Voice profile '{name}' has no design instruction")
            return {"kind": "design", "instruct": instruction}
        prompt_path = _resolve_data_path(row["prompt_path"] if row else None)
        if prompt_path is None or not prompt_path.exists():
            raise FileNotFoundError(
                f"Voice profile '{name}' not found. Saved voices: {self.list_voices()}"
            )
        from omnivoice import VoiceClonePrompt

        return {"kind": "clone", "prompt": VoiceClonePrompt.load(str(prompt_path))}

    def load_voice(self, name: str):
        """Load a saved voice clone prompt by name for CLI and MCP callers."""
        profile = self.load_voice_profile(name)
        if profile["kind"] != "clone":
            raise ValueError(f"Voice profile '{name}' is a design profile")
        return profile["prompt"]

    @staticmethod
    def list_voices() -> list[dict[str, Any]]:
        """List all saved voice profiles."""
        with _STORAGE_LOCK:
            with closing(Engine._open_storage()) as connection:
                rows = connection.execute(
                    """
                    SELECT name, language, kind, ref_audio_path, design_instruction,
                           ref_text, is_default
                    FROM voice_profiles
                    ORDER BY is_default DESC, language ASC, name ASC
                    """
                ).fetchall()
        return [
            {
                "name": row["name"],
                "language": row["language"],
                "kind": row["kind"],
                "ref_audio": str(_resolve_data_path(row["ref_audio_path"]))
                if row["ref_audio_path"]
                else None,
                "design_instruction": row["design_instruction"],
                "ref_text": row["ref_text"],
                "is_default": bool(row["is_default"]),
            }
            for row in rows
        ]

    @staticmethod
    def delete_voice(name: str) -> bool:
        """Delete a saved voice profile."""
        name = Engine.validate_voice_name(name)
        with _STORAGE_LOCK:
            with closing(Engine._open_storage()) as connection:
                row = connection.execute(
                    "SELECT 1 FROM voice_profiles WHERE name = ?", (name,)
                ).fetchone()
                if row:
                    with connection:
                        connection.execute("DELETE FROM voice_profiles WHERE name = ?", (name,))
            profile_dir = VOICES_DIR / name
            legacy_prompt = VOICES_DIR / f"{name}.pt"
            legacy_meta = VOICES_DIR / f"{name}.json"
            deleted = bool(row)
            if profile_dir.is_dir():
                shutil.rmtree(profile_dir)
                deleted = True
            for legacy_path in (legacy_prompt, legacy_meta):
                if legacy_path.exists():
                    legacy_path.unlink()
                    deleted = True
            return deleted


# Module-level convenience
def get_engine() -> Engine:
    return Engine()
