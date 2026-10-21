"""JSONL worker used by the Tauri desktop application."""

from __future__ import annotations

import json
import importlib.util
import math
import os
import queue
import sys
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, TextIO

from tts_mcp.convert import save_audio
from tts_mcp import desktop_diagnostics, desktop_runtime
from tts_mcp.api import ApiServer, ApiStartError
from tts_mcp.engine import (
    DATA_DIR,
    DownloadCancelled,
    Engine,
    GENERATION_CONFIG_KEYS,
    SUPPORTED_LANGUAGES,
    get_engine,
    validate_language,
)
from tts_mcp.desktop_vieneu import VieNeuProvider

OUTPUT_DIR = DATA_DIR / "outputs"
AUDIO_HISTORY_PAGE_SIZE = 50
ALLOWED_FORMATS = {"wav", "mp3"}
ALLOWED_REFERENCE_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg"}
GENERATION_BOOLEAN_KEYS = {"denoise", "preprocess_prompt", "postprocess_output"}
GENERATION_POSITIVE_KEYS = {"audio_chunk_duration", "audio_chunk_threshold"}
VIENEU_SEED_REFERENCE_TEXT = (
    "Xin chào. Đây là mẫu giọng được tạo để lưu vào thư viện giọng nói của bạn."
)


_api_server: ApiServer | None = None
_api_server_lock = threading.Lock()


def _local_api_server() -> ApiServer:
    """Return the single loopback API server owned by this sidecar process."""
    global _api_server
    with _api_server_lock:
        if _api_server is None:
            _api_server = ApiServer()
        return _api_server


def _stop_local_api_server() -> None:
    global _api_server
    with _api_server_lock:
        server = _api_server
    if server is None:
        return
    server.stop()
    with _api_server_lock:
        if _api_server is server:
            _api_server = None


def _ok(request_id: str, result: Any) -> dict[str, Any]:
    return {"id": request_id, "ok": True, "result": result}


def _error(request_id: str, code: str, message: str) -> dict[str, Any]:
    return {
        "id": request_id,
        "ok": False,
        "error": {"code": code, "message": message},
    }


def _record_dispatch_failure(operation: Any, code: str, exc: Exception) -> None:
    import traceback

    category = (
        "runtime_install_failed" if operation == "install_nvidia_runtime" else "request_failed"
    )
    stack = "".join(traceback.format_list(traceback.extract_tb(exc.__traceback__)))[-12_000:]
    desktop_diagnostics.record(
        DATA_DIR,
        category,
        operation=str(operation or "unknown"),
        code=code,
        message=type(exc).__name__,
        traceback=stack,
    )


def _runtime_check() -> int:
    try:
        import torch

        if torch.version.cuda is None:
            raise RuntimeError("This sidecar was built without CUDA support")
        torch.cuda.init()
        torch.empty(1, device="cuda")
        torch.cuda.synchronize()
        return 0
    except Exception as exc:
        print(
            f"CUDA runtime check failed: {type(exc).__name__}: {str(exc)[:500]}",
            file=sys.stderr,
        )
        return 1


def _request_id(request: dict[str, Any]) -> str:
    return str(request.get("id", ""))


def _resolve_ffmpeg() -> str | None:
    bundled_root = getattr(sys, "_MEIPASS", None)
    candidates = []
    if bundled_root:
        candidates.append(Path(bundled_root) / "ffmpeg")
        candidates.append(Path(bundled_root) / "ffmpeg.exe")
    env_path = os.environ.get("TTS_MCP_FFMPEG_PATH")
    if env_path:
        candidates.append(Path(env_path))
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def _validate_reference_audio(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Reference audio path must be a non-empty string")
    path = Path(value)
    if path.suffix.lower() not in ALLOWED_REFERENCE_EXTENSIONS:
        raise ValueError("Reference audio must be a WAV, MP3, FLAC, or OGG file")
    if not path.is_file():
        raise FileNotFoundError(f"Reference audio file was not found: {value}")
    try:
        import soundfile as sf

        sf.info(str(path))
    except (OSError, RuntimeError, ValueError) as exc:
        raise ValueError("Reference audio file is not a readable audio file") from exc
    return value


def _validate_number(value: Any, field: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a number")
    try:
        number = float(value)
    except OverflowError as exc:
        raise ValueError(f"{field} must be non-negative and finite") from exc
    if not math.isfinite(number) or (number <= 0 if positive else number < 0):
        qualifier = "greater than zero" if positive else "non-negative and finite"
        raise ValueError(f"{field} must be {qualifier}")
    return number


def _validate_generation_config(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("generation_config must be an object")
    unknown = [key for key in value if key not in GENERATION_CONFIG_KEYS]
    if unknown:
        raise ValueError("Unsupported generation config: " + ", ".join(str(key) for key in unknown))

    validated: dict[str, Any] = {}
    for key, item in value.items():
        if key in GENERATION_BOOLEAN_KEYS:
            if not isinstance(item, bool):
                raise ValueError(f"{key} must be a boolean")
            validated[key] = item
        else:
            validated[key] = _validate_number(item, key, positive=key in GENERATION_POSITIVE_KEYS)
    return validated


def _has_payload(value: Any) -> bool:
    return value is not None and not (isinstance(value, str) and not value.strip())


def _reject_voice_payload(request: dict[str, Any], fields: tuple[str, ...]) -> None:
    present = [field for field in fields if _has_payload(request.get(field))]
    if present:
        raise ValueError(f"Fields not valid for this voice mode: {', '.join(present)}")


def _synthesize(request: dict[str, Any], engine: Engine) -> dict[str, Any]:
    if "vieneu_config" in request:
        raise ValueError("vieneu_config is only valid for the VieNeu provider")
    text = request.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Text must not be empty")
    language = validate_language(request.get("language", "en"))
    voice = request.get("voice", "auto")
    if not isinstance(voice, str) or voice not in {"auto", "profile", "file", "design"}:
        raise ValueError("Voice must be auto, profile, file, or design")
    output_format = str(request.get("format", "wav")).lower().lstrip(".")
    if output_format not in ALLOWED_FORMATS:
        raise ValueError("Format must be wav or mp3")
    speed = _validate_number(request.get("speed", 1.0), "Speed")
    if not 0.25 <= speed <= 4.0:
        raise ValueError("Speed must be between 0.25 and 4.0")

    steps = request.get("steps", 32)
    if isinstance(steps, bool) or not isinstance(steps, int) or steps <= 0:
        raise ValueError("Steps must be a positive integer")
    duration_value = request.get("duration")
    duration = (
        None
        if duration_value is None
        else _validate_number(duration_value, "Duration", positive=True)
    )
    normalize_text = request.get("normalize_text", False)
    if not isinstance(normalize_text, bool):
        raise ValueError("normalize_text must be a boolean")
    generation_config = _validate_generation_config(request.get("generation_config"))

    kwargs: dict[str, Any] = {
        "text": text,
        "language": language,
        "speed": speed,
        "num_step": steps,
        "normalize_text": normalize_text,
    }
    if voice == "profile":
        _reject_voice_payload(request, ("ref_audio", "ref_text", "instruct"))
        voice_name = request.get("voice_name")
        if not isinstance(voice_name, str) or not voice_name.strip():
            raise ValueError("Voice profile name must be a non-empty string")
        profile = engine.load_voice_profile(voice_name)
        if profile["kind"] == "vieneu_preset":
            ref_audio = profile.get("ref_audio")
            ref_text = profile.get("ref_text")
            if not isinstance(ref_audio, str) or not isinstance(ref_text, str):
                raise ValueError(
                    f"VieNeu preset profile '{voice_name}' has no saved Clone reference; "
                    "select provider='vieneu' or seed the VieNeu voices first"
                )
            kwargs["ref_audio"] = _validate_reference_audio(ref_audio)
            kwargs["ref_text"] = ref_text
        elif profile["kind"] == "design":
            kwargs["instruct"] = profile["instruct"]
        else:
            kwargs["voice_clone_prompt"] = profile["prompt"]
    elif voice == "file":
        _reject_voice_payload(request, ("voice_name", "instruct"))
        ref_audio = _validate_reference_audio(request.get("ref_audio"))
        kwargs["ref_audio"] = ref_audio
        ref_text = request.get("ref_text")
        if ref_text is not None and not isinstance(ref_text, str):
            raise ValueError("Reference transcript must be a string")
        if ref_text and ref_text.strip():
            kwargs["ref_text"] = ref_text
    elif voice == "design":
        _reject_voice_payload(request, ("voice_name", "ref_audio", "ref_text"))
        instruct = request.get("instruct")
        if not isinstance(instruct, str) or not instruct.strip():
            raise ValueError("Voice design instruction must be a non-empty string")
        kwargs["instruct"] = instruct
    else:
        _reject_voice_payload(request, ("voice_name", "ref_audio", "ref_text", "instruct"))

    if duration is not None:
        kwargs["duration"] = duration
    if generation_config:
        kwargs["generation_config"] = generation_config

    audio = engine.generate(**kwargs)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{uuid.uuid4().hex}.{output_format}"
    save_audio(audio, str(output_path), ffmpeg_path=_resolve_ffmpeg())
    return {"audio_path": str(output_path), "format": output_format}


def _provider_id(request: dict[str, Any]) -> str:
    provider = request.get("provider")
    if not isinstance(provider, str) or provider not in {"omnivoice", "vieneu"}:
        raise ValueError("Provider must be omnivoice or vieneu")
    return provider


def _history_voice_name(request: dict[str, Any]) -> str:
    voice = request.get("voice", "auto")
    if voice in {"profile", "preset"}:
        field = "voice_name" if voice == "profile" else "preset_id"
        value = request.get(field)
        return value.strip() if isinstance(value, str) and value.strip() else voice
    return voice if isinstance(voice, str) and voice in {"auto", "design", "file"} else "auto"


def _record_audio_history(request: dict[str, Any], provider: str, result: dict[str, Any]) -> None:
    try:
        audio_path = Path(result["audio_path"]).resolve()
        output_dir = OUTPUT_DIR.resolve()
        output_format = result["format"]
        if audio_path.parent != output_dir or not audio_path.is_file():
            return
        if (
            not isinstance(output_format, str)
            or output_format not in ALLOWED_FORMATS
            or audio_path.suffix.lower() != f".{output_format}"
        ):
            raise ValueError("Generated audio is not a supported file in the output directory")
        Engine.record_audio_history(
            file_name=audio_path.name,
            provider=provider,
            voice_name=_history_voice_name(request),
            format=output_format,
            text=request["text"],
            created_at=datetime.now(timezone.utc).isoformat(),
        )
    except Exception as exc:
        print(f"[tts-mcp] audio history metadata write failed: {exc}", file=sys.stderr)


def _list_audio_history() -> list[dict[str, Any]]:
    metadata = {item["file_name"]: item for item in Engine.list_audio_history()}
    output_dir = OUTPUT_DIR.resolve()
    if not output_dir.exists():
        return []

    items = []
    for path in output_dir.iterdir():
        if path.is_symlink() or path.suffix.lower() not in {".wav", ".mp3"}:
            continue
        try:
            if not path.is_file():
                continue
            stat = path.stat()
        except FileNotFoundError:
            continue
        record = metadata.get(path.name)
        items.append(
            {
                "id": path.name,
                "audio_path": str(path.resolve()),
                "format": path.suffix.lower().lstrip("."),
                "created_at": record["created_at"]
                if record
                else datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                "provider": record["provider"] if record else None,
                "voice_name": record["voice_name"] if record else None,
                "text": record["text"] if record else None,
                "metadata_available": record is not None,
            }
        )
    items.sort(key=lambda item: item["id"])
    items.sort(key=lambda item: item["created_at"], reverse=True)
    return items


def _list_audio_history_page(cursor: Any) -> dict[str, Any]:
    if cursor is not None and (
        not isinstance(cursor, dict)
        or set(cursor) != {"created_at", "id"}
        or not isinstance(cursor["created_at"], str)
        or not cursor["created_at"].strip()
        or not isinstance(cursor["id"], str)
        or not cursor["id"].strip()
    ):
        raise ValueError("Audio history cursor must contain created_at and id strings")

    items = _list_audio_history()
    total = len(items)
    if cursor is not None:
        items = [
            item
            for item in items
            if item["created_at"] < cursor["created_at"]
            or (item["created_at"] == cursor["created_at"] and item["id"] > cursor["id"])
        ]
    page = items[:AUDIO_HISTORY_PAGE_SIZE]
    has_more = len(items) > AUDIO_HISTORY_PAGE_SIZE
    last_item = page[-1] if has_more else None
    return {
        "items": page,
        "total": total,
        "next_cursor": (
            {"created_at": last_item["created_at"], "id": last_item["id"]} if last_item else None
        ),
    }


def _delete_audio_history(file_name: Any) -> bool:
    if (
        not isinstance(file_name, str)
        or not file_name
        or Path(file_name).name != file_name
        or "/" in file_name
        or "\\" in file_name
        or Path(file_name).suffix.lower() not in {".wav", ".mp3"}
        or Path(file_name).stem in {"", ".", ".."}
    ):
        raise ValueError("Audio history ID must be a WAV or MP3 basename")
    output_dir = OUTPUT_DIR.resolve()
    path = OUTPUT_DIR / file_name
    if path.is_symlink():
        raise ValueError("Audio history cannot delete a symbolic link")
    resolved = path.resolve(strict=True)
    if resolved.parent != output_dir or not resolved.is_file():
        raise ValueError("Audio history file must be directly inside the output directory")
    resolved.unlink()
    Engine.delete_audio_history(file_name)
    return True


def _readable_seed_reference(profile: dict[str, Any]) -> Path | None:
    value = profile.get("ref_audio")
    if (
        profile.get("ref_text") != VIENEU_SEED_REFERENCE_TEXT
        or not isinstance(value, str)
        or Path(value).suffix.lower() != ".wav"
    ):
        return None
    try:
        return Path(_validate_reference_audio(value))
    except (FileNotFoundError, ValueError):
        return None


def _seed_vieneu_voices(
    request_id: str,
    engine: Engine,
    provider: VieNeuProvider,
    emit: Callable[[dict[str, Any]], None] | None,
    should_cancel: Callable[[], bool] | None,
) -> dict[str, Any]:
    status = provider.status()
    presets = status.get("preset_voices") if isinstance(status, dict) else None
    if not isinstance(presets, list) or not presets:
        raise RuntimeError(
            "VieNeu preset manifest is unavailable or invalid; check the local preset manifest."
        )
    preset_ids = [voice.get("id") if isinstance(voice, dict) else None for voice in presets]
    if any(not isinstance(preset_id, str) or not preset_id for preset_id in preset_ids) or len(
        set(preset_ids)
    ) != len(preset_ids):
        raise RuntimeError("VieNeu preset manifest contains invalid or duplicate IDs.")
    if not status.get("runtime_available"):
        raise RuntimeError(
            status.get("unavailable_reason")
            or "audio.cpp CLI is unavailable; install the desktop runtime first."
        )
    if not status.get("preprocessing_available"):
        raise RuntimeError(
            status.get("unavailable_reason")
            or "VieNeu preprocessing is unavailable; install tts-mcp[desktop-vieneu]."
        )
    if not status.get("model_ready"):
        raise RuntimeError(
            status.get("unavailable_reason")
            or "VieNeu model assets are not ready; prepare VieNeu before seeding voices."
        )

    outcomes: list[dict[str, str]] = []
    failed: list[dict[str, str]] = []
    unfinished: list[str] = []
    cancelled = False
    for current, preset in enumerate(presets, start=1):
        preset_id = preset["id"]
        if should_cancel and should_cancel():
            unfinished.extend(voice["id"] for voice in presets[current - 1 :])
            cancelled = True
            break
        if emit:
            emit(
                {
                    "id": request_id,
                    "event": "progress",
                    "phase": "seed_vieneu",
                    "preset_id": preset_id,
                    "current": current,
                    "total": len(presets),
                    "message": preset.get("name") or preset_id,
                }
            )
        try:
            voices = Engine.list_voices()
            matches = [
                voice
                for voice in voices
                if voice.get("kind") == "vieneu_preset" and voice.get("preset_id") == preset_id
            ]
            if len(matches) > 1:
                raise ValueError(f"Multiple voice profiles use VieNeu preset ID '{preset_id}'")
            if matches:
                profile_name = matches[0]["name"]
                reference = _readable_seed_reference(matches[0])
                item_status = "reused" if reference else "updated"
            else:
                profile_name = preset_id
                collision = next(
                    (voice for voice in voices if voice.get("name") == profile_name), None
                )
                if collision:
                    raise ValueError(
                        f"A {collision.get('kind', 'voice')} voice profile named "
                        f"'{profile_name}' already exists"
                    )
                reference = None
                item_status = "created"

            if reference is None:
                with tempfile.TemporaryDirectory(prefix="vieneu-seed-") as temporary:
                    temporary_dir = Path(temporary)
                    output_path = temporary_dir / "reference.wav"
                    provider.synthesize(
                        {
                            "text": VIENEU_SEED_REFERENCE_TEXT,
                            "language": "vi",
                            "format": "wav",
                            "voice": "preset",
                            "preset_id": preset_id,
                        },
                        voices,
                        temporary_dir,
                        output_path=output_path,
                    )
                    if not output_path.is_file():
                        raise RuntimeError("VieNeu did not produce a reference WAV")
                    _validate_reference_audio(str(output_path))
                    reference = output_path
                    engine.save_vieneu_seed_reference(
                        preset_id,
                        profile_name,
                        str(reference),
                        VIENEU_SEED_REFERENCE_TEXT,
                    )
            else:
                engine.save_vieneu_seed_reference(
                    preset_id,
                    profile_name,
                    str(reference),
                    VIENEU_SEED_REFERENCE_TEXT,
                )
            outcomes.append(
                {
                    "preset_id": preset_id,
                    "name": profile_name,
                    "status": item_status,
                }
            )
        except Exception as exc:
            failed.append({"preset_id": preset_id, "message": str(exc)})

    return {
        "profiles": outcomes,
        "failed": failed,
        "unfinished": unfinished,
        "cancelled": cancelled,
    }


def dispatch_request(
    request: dict[str, Any],
    engine: Engine,
    emit: Callable[[dict[str, Any]], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
    vieneu_provider: VieNeuProvider | None = None,
) -> dict[str, Any]:
    """Handle one decoded request and return one terminal response."""
    request_id = _request_id(request)
    operation = request.get("type")
    try:
        if operation == "status":
            status = engine.model_status()
            provider = vieneu_provider or VieNeuProvider(DATA_DIR)
            vieneu_status = provider.status()
            omnivoice_available = importlib.util.find_spec("omnivoice") is not None
            return _ok(
                request_id,
                {
                    "model_ready": bool(status["ready"]),
                    "device": status["device"],
                    "languages": list(SUPPORTED_LANGUAGES),
                    "model": status["model"],
                    "tokenizer": status["tokenizer"],
                    "asr_model": status["asr_model"],
                    "nvidia_runtime": desktop_runtime.emit_runtime_status(
                        DATA_DIR, os.environ.get("TTS_MCP_APP_VERSION")
                    ),
                    "diagnostics": desktop_diagnostics.events(DATA_DIR),
                    "diagnostics_complete": desktop_diagnostics.is_complete(),
                    "providers": {
                        "omnivoice": {
                            "model_ready": bool(status["ready"]),
                            "runtime_available": omnivoice_available,
                            "preprocessing_available": True,
                            "unavailable_reason": None
                            if omnivoice_available
                            else "OmniVoice package is unavailable in this environment",
                        },
                        "vieneu": vieneu_status,
                    },
                },
            )
        if operation == "install_nvidia_runtime":
            result = desktop_runtime.install(
                DATA_DIR,
                os.environ.get("TTS_MCP_APP_VERSION"),
                request_id,
                should_cancel=should_cancel or (lambda: False),
                emit=emit,
            )
            desktop_diagnostics.record(
                DATA_DIR,
                "runtime_installed",
                operation=operation,
                code="success",
                message=f"NVIDIA runtime {result['version']} verified and installed",
            )
            return _ok(request_id, result)
        if operation == "remove_nvidia_runtime":
            removed = desktop_runtime.remove(DATA_DIR)
            desktop_diagnostics.record(
                DATA_DIR,
                "runtime_removed",
                operation=operation,
                code="success",
                message="Optional NVIDIA runtime removed"
                if removed
                else "No optional runtime was installed",
            )
            return _ok(request_id, {"removed": removed})
        if operation == "get_diagnostics":
            runtime = desktop_runtime.emit_runtime_status(
                DATA_DIR, os.environ.get("TTS_MCP_APP_VERSION")
            )
            return _ok(
                request_id,
                desktop_diagnostics.report(
                    DATA_DIR,
                    app_version=os.environ.get("TTS_MCP_APP_VERSION"),
                    runtime=runtime,
                    frontend_events=request.get("frontend_events"),
                    frontend_complete=request.get("frontend_complete", True) is True,
                ),
            )
        if operation == "clear_diagnostics":
            desktop_diagnostics.clear(DATA_DIR)
            return _ok(
                request_id,
                {"cleared": True, "diagnostics_complete": desktop_diagnostics.is_complete()},
            )
        if operation == "prepare_model":
            provider_id = _provider_id(request)
            prepare = (
                engine.ensure_model
                if provider_id == "omnivoice"
                else (vieneu_provider or VieNeuProvider(DATA_DIR)).ensure_model
            )
            result = prepare(
                on_progress=(
                    (
                        lambda progress: emit(
                            {
                                "id": request_id,
                                "event": "progress",
                                **progress,
                                "provider": provider_id,
                            }
                        )
                    )
                    if emit
                    else None
                ),
                should_cancel=should_cancel,
            )
            return _ok(request_id, {"model_ready": bool(result["ready"])})
        if operation == "synthesize":
            provider_id = _provider_id(request)
            if provider_id == "omnivoice":
                result = _synthesize(request, engine)
            else:
                provider = vieneu_provider or VieNeuProvider(DATA_DIR)
                voices = Engine.list_voices()
                provider_request = request
                if request.get("voice") == "profile":
                    voice_name = request.get("voice_name")
                    profile = next(
                        (
                            voice
                            for voice in voices
                            if isinstance(voice_name, str) and voice.get("name") == voice_name
                        ),
                        None,
                    )
                    if profile and profile.get("kind") == "vieneu_preset":
                        provider_request = {
                            **request,
                            "voice": "preset",
                            "preset_id": profile["preset_id"],
                        }
                        provider_request.pop("voice_name", None)
                result = provider.synthesize(provider_request, voices, OUTPUT_DIR)
            _record_audio_history(request, provider_id, result)
            return _ok(request_id, result)
        if operation == "save_voice":
            name = request["name"]
            ref_audio = _validate_reference_audio(request["ref_audio"])
            language = validate_language(request.get("language", "en"))
            path = engine.save_voice(name, ref_audio, request.get("ref_text"), language)
            return _ok(request_id, {"path": path})
        if operation == "save_design_voice":
            name = request["name"]
            language = validate_language(request.get("language", "en"))
            engine.save_design_voice(name, request["design_instruction"], language)
            return _ok(request_id, {"name": name, "kind": "design"})
        if operation == "save_vieneu_preset":
            name = request["name"]
            preset_id = request["preset_id"]
            provider = vieneu_provider or VieNeuProvider(DATA_DIR)
            preset_voices = provider.status().get("preset_voices", [])
            if not isinstance(preset_voices, list) or not preset_voices:
                raise ValueError(
                    "VieNeu preset list is unavailable; prepare VieNeu to load its local manifest"
                )
            if not any(
                isinstance(voice, dict) and voice.get("id") == preset_id for voice in preset_voices
            ):
                raise ValueError(f"Unknown VieNeu preset ID: {preset_id}")
            saved_name = engine.save_vieneu_preset(name, preset_id)
            return _ok(
                request_id,
                {"name": saved_name, "kind": "vieneu_preset", "preset_id": preset_id},
            )
        if operation == "import_seed_voices":
            seed_dir = request["seed_dir"]
            if not isinstance(seed_dir, str) or not seed_dir.strip():
                raise ValueError("Seed directory must be a non-empty string")
            return _ok(request_id, engine.import_seed_voices(seed_dir))
        if operation == "seed_vieneu_voices":
            provider = vieneu_provider or VieNeuProvider(DATA_DIR)
            return _ok(
                request_id,
                _seed_vieneu_voices(request_id, engine, provider, emit, should_cancel),
            )
        if operation == "list_voices":
            return _ok(request_id, {"voices": Engine.list_voices()})
        if operation == "list_audio_history":
            paginated = request.get("paginated", False)
            if not isinstance(paginated, bool):
                raise ValueError("paginated must be a boolean")
            cursor = request.get("cursor")
            if paginated:
                return _ok(request_id, _list_audio_history_page(cursor))
            if cursor is not None:
                raise ValueError("cursor requires paginated audio history")
            return _ok(request_id, {"items": _list_audio_history()})
        if operation == "delete_audio_history":
            if "file_name" not in request:
                raise KeyError("file_name")
            return _ok(request_id, {"deleted": _delete_audio_history(request["file_name"])})
        if operation == "delete_voice":
            return _ok(
                request_id,
                {"deleted": Engine.delete_voice(request["name"])},
            )
        if operation == "start_api":
            try:
                return _ok(request_id, _local_api_server().start())
            except ApiStartError as exc:
                return _error(request_id, exc.code, str(exc))
        if operation == "stop_api":
            return _ok(request_id, _local_api_server().stop())
        if operation == "api_status":
            return _ok(request_id, _local_api_server().state())
        if operation == "cancel":
            return _error(
                request_id,
                "invalid_request",
                "Cancel is only valid during a model or optional runtime download",
            )
        return _error(request_id, "invalid_request", f"Unknown operation: {operation}")
    except DownloadCancelled as exc:
        _record_dispatch_failure(operation, "cancelled", exc)
        return _error(request_id, "cancelled", str(exc))
    except desktop_runtime.RuntimeDownloadCancelled as exc:
        desktop_diagnostics.record(
            DATA_DIR,
            "runtime_install_cancelled",
            operation=str(operation),
            code="cancelled",
            message="NVIDIA runtime download cancelled by the user",
        )
        return _error(request_id, "cancelled", str(exc))
    except KeyError as exc:
        _record_dispatch_failure(operation, "invalid_input", exc)
        return _error(request_id, "invalid_input", f"Missing field: {exc.args[0]}")
    except FileNotFoundError as exc:
        _record_dispatch_failure(operation, "not_found", exc)
        return _error(request_id, "not_found", str(exc))
    except ValueError as exc:
        _record_dispatch_failure(operation, "invalid_input", exc)
        return _error(request_id, "invalid_input", str(exc))
    except RuntimeError as exc:
        _record_dispatch_failure(operation, "operation_failed", exc)
        return _error(request_id, "operation_failed", str(exc))
    except Exception as exc:
        _record_dispatch_failure(operation, "internal_error", exc)
        print(
            f"[tts-mcp] desktop operation failed: {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        import traceback

        traceback.print_exc(file=sys.stderr)
        return _error(request_id, "internal_error", "The local TTS operation failed")


def run_protocol(
    source: TextIO,
    target: TextIO,
    engine: Engine,
    vieneu_provider: VieNeuProvider | None = None,
) -> None:
    """Run the sidecar protocol, allowing cancellation of long operations."""
    requests: queue.Queue[dict[str, Any] | None] = queue.Queue()
    active: dict[str, threading.Event] = {}
    active_preparations: set[str] = set()
    active_seeds: set[str] = set()
    active_runtime_installs: set[str] = set()
    workers: set[threading.Thread] = set()
    write_lock = threading.Lock()

    def write(payload: dict[str, Any]) -> None:
        with write_lock:
            target.write(json.dumps(payload, ensure_ascii=False) + "\n")
            target.flush()

    def read_requests() -> None:
        for line in source:
            try:
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError("request must be a JSON object")
                requests.put(value)
            except (json.JSONDecodeError, ValueError) as exc:
                write(_error("", "invalid_json", str(exc)))
        requests.put(None)

    reader = threading.Thread(target=read_requests, daemon=True)
    reader.start()

    while True:
        request = requests.get()
        if request is None:
            break
        operation = request.get("type")
        request_id = _request_id(request)
        if operation == "cancel":
            target_id = str(request.get("request_id", ""))
            event = active.get(target_id)
            if event:
                event.set()
                write(_ok(request_id, {"cancelled": target_id}))
            else:
                write(_error(request_id, "not_found", "No active operation for request"))
            continue
        if operation in {"prepare_model", "seed_vieneu_voices", "install_nvidia_runtime"}:
            provider_id = request.get("provider") if operation == "prepare_model" else None
            if not isinstance(provider_id, str) or provider_id not in {"omnivoice", "vieneu"}:
                provider_id = None
            if operation == "prepare_model" and active_seeds:
                write(_error(request_id, "busy", "VieNeu voice seeding is already running"))
                continue
            if operation == "install_nvidia_runtime" and active_runtime_installs:
                write(
                    _error(request_id, "busy", "An NVIDIA runtime installation is already running")
                )
                continue
            if provider_id is not None:
                if provider_id in active_preparations:
                    write(
                        _error(
                            request_id,
                            "busy",
                            f"A {provider_id} model download is already running",
                        )
                    )
                    continue
                active_preparations.add(provider_id)
            cancel_event = threading.Event()
            active[request_id] = cancel_event
            if operation == "seed_vieneu_voices":
                active_seeds.add(request_id)
            if operation == "install_nvidia_runtime":
                active_runtime_installs.add(request_id)

            def run_long_operation(
                request=request,
                request_id=request_id,
                cancel_event=cancel_event,
                provider_id=provider_id,
            ) -> None:
                try:
                    write(
                        dispatch_request(
                            request,
                            engine,
                            emit=write,
                            should_cancel=cancel_event.is_set,
                            vieneu_provider=vieneu_provider,
                        )
                    )
                finally:
                    active.pop(request_id, None)
                    if provider_id is not None:
                        active_preparations.discard(provider_id)
                    active_seeds.discard(request_id)
                    active_runtime_installs.discard(request_id)
                    workers.discard(threading.current_thread())

            worker = threading.Thread(target=run_long_operation, daemon=True)
            workers.add(worker)
            worker.start()
            continue
        write(dispatch_request(request, engine, vieneu_provider=vieneu_provider))

    _stop_local_api_server()
    try:
        for worker in tuple(workers):
            worker.join()
    finally:
        _stop_local_api_server()


def main() -> None:
    if sys.argv[1:] == ["--runtime-check"]:
        raise SystemExit(_runtime_check())
    runtime_path, fallback_reason = desktop_runtime.select(
        DATA_DIR, os.environ.get("TTS_MCP_APP_VERSION")
    )
    if runtime_path:
        desktop_diagnostics.record(
            DATA_DIR,
            "runtime_cuda_selected",
            code="cuda",
            message="Verified optional NVIDIA runtime selected",
        )
        env = {**os.environ, "TTS_MCP_ACTIVE_RUNTIME": "cuda"}
        audio_cpp_path = VieNeuProvider(DATA_DIR)._audio_cpp_path()
        if audio_cpp_path:
            env["TTS_MCP_AUDIOCPP_PATH"] = audio_cpp_path
        try:
            os.execve(runtime_path, [str(runtime_path)], env)
        except OSError as exc:
            fallback_reason = f"NVIDIA runtime could not start: {type(exc).__name__}"
    if fallback_reason:
        desktop_diagnostics.record(
            DATA_DIR,
            "runtime_cpu_fallback",
            code="cpu",
            message=fallback_reason,
        )
    run_protocol(sys.stdin, sys.stdout, get_engine(), VieNeuProvider(DATA_DIR))


if __name__ == "__main__":
    main()
