"""JSONL worker used by the Tauri desktop application."""

from __future__ import annotations

import json
import os
import queue
import sys
import threading
import uuid
from pathlib import Path
from typing import Any, Callable, TextIO

from .convert import save_audio
from .engine import (
    DATA_DIR,
    DownloadCancelled,
    Engine,
    SUPPORTED_LANGUAGES,
    get_engine,
    validate_language,
)

OUTPUT_DIR = DATA_DIR / "outputs"
ALLOWED_FORMATS = {"wav", "mp3"}


def _ok(request_id: str, result: Any) -> dict[str, Any]:
    return {"id": request_id, "ok": True, "result": result}


def _error(request_id: str, code: str, message: str) -> dict[str, Any]:
    return {
        "id": request_id,
        "ok": False,
        "error": {"code": code, "message": message},
    }


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


def _synthesize(request: dict[str, Any], engine: Engine) -> dict[str, Any]:
    text = request.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Text must not be empty")
    language = validate_language(request.get("language", "en"))
    voice = request.get("voice", "auto")
    if voice not in {"auto", "profile", "file"}:
        raise ValueError("Voice must be auto, profile, or file")
    output_format = str(request.get("format", "wav")).lower().lstrip(".")
    if output_format not in ALLOWED_FORMATS:
        raise ValueError("Format must be wav or mp3")
    try:
        speed = float(request.get("speed", 1.0))
    except (TypeError, ValueError) as exc:
        raise ValueError("Speed must be a number") from exc
    if not 0.25 <= speed <= 4.0:
        raise ValueError("Speed must be between 0.25 and 4.0")

    kwargs: dict[str, Any] = {
        "text": text,
        "language": language,
        "speed": speed,
        "num_step": int(request.get("steps", 32)),
    }
    if voice == "profile":
        kwargs["voice_clone_prompt"] = engine.load_voice(request.get("voice_name", ""))
    elif voice == "file":
        ref_audio = request.get("ref_audio")
        if not isinstance(ref_audio, str) or not Path(ref_audio).is_file():
            raise FileNotFoundError("Reference audio file was not found")
        kwargs["ref_audio"] = ref_audio
        ref_text = request.get("ref_text")
        if ref_text:
            kwargs["ref_text"] = ref_text

    audio = engine.generate(**kwargs)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{uuid.uuid4().hex}.{output_format}"
    save_audio(audio, str(output_path), ffmpeg_path=_resolve_ffmpeg())
    return {"audio_path": str(output_path), "format": output_format}


def dispatch_request(
    request: dict[str, Any],
    engine: Engine,
    emit: Callable[[dict[str, Any]], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Handle one decoded request and return one terminal response."""
    request_id = _request_id(request)
    operation = request.get("type")
    try:
        if operation == "status":
            status = engine.model_status()
            return _ok(
                request_id,
                {
                    "model_ready": bool(status["ready"]),
                    "device": status["device"],
                    "languages": list(SUPPORTED_LANGUAGES),
                },
            )
        if operation == "prepare_model":
            result = engine.ensure_model(
                on_progress=(
                    (lambda progress: emit({"id": request_id, "event": "progress", **progress}))
                    if emit
                    else None
                ),
                should_cancel=should_cancel,
            )
            return _ok(request_id, {"model_ready": bool(result["ready"])})
        if operation == "synthesize":
            return _ok(request_id, _synthesize(request, engine))
        if operation == "save_voice":
            path = engine.save_voice(
                request["name"], request["ref_audio"], request.get("ref_text")
            )
            return _ok(request_id, {"path": path})
        if operation == "list_voices":
            return _ok(request_id, {"voices": Engine.list_voices()})
        if operation == "delete_voice":
            return _ok(
                request_id,
                {"deleted": Engine.delete_voice(request["name"])},
            )
        if operation == "cancel":
            return _error(request_id, "invalid_request", "Cancel is only valid during a model download")
        return _error(request_id, "invalid_request", f"Unknown operation: {operation}")
    except DownloadCancelled as exc:
        return _error(request_id, "cancelled", str(exc))
    except KeyError as exc:
        return _error(request_id, "invalid_input", f"Missing field: {exc.args[0]}")
    except FileNotFoundError as exc:
        return _error(request_id, "not_found", str(exc))
    except ValueError as exc:
        return _error(request_id, "invalid_input", str(exc))
    except RuntimeError as exc:
        return _error(request_id, "operation_failed", str(exc))
    except Exception:
        print("[tts-mcp] desktop operation failed", file=sys.stderr)
        return _error(request_id, "internal_error", "The local TTS operation failed")


def run_protocol(source: TextIO, target: TextIO, engine: Engine) -> None:
    """Run the sidecar protocol, allowing cancel during model preparation."""
    requests: queue.Queue[dict[str, Any] | None] = queue.Queue()
    active: dict[str, threading.Event] = {}
    workers: list[threading.Thread] = []
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
                write(_error(request_id, "not_found", "No active download for request"))
            continue
        if operation == "prepare_model":
            if active:
                write(_error(request_id, "busy", "A model download is already running"))
                continue
            cancel_event = threading.Event()
            active[request_id] = cancel_event

            def prepare(
                request=request,
                request_id=request_id,
                cancel_event=cancel_event,
            ) -> None:
                try:
                    write(
                        dispatch_request(
                            request,
                            engine,
                            emit=write,
                            should_cancel=cancel_event.is_set,
                        )
                    )
                finally:
                    active.pop(request_id, None)

            worker = threading.Thread(target=prepare, daemon=True)
            workers.append(worker)
            worker.start()
            continue
        write(dispatch_request(request, engine))

    for worker in workers:
        worker.join()


def main() -> None:
    run_protocol(sys.stdin, sys.stdout, get_engine())


if __name__ == "__main__":
    main()
