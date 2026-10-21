"""Public video link transcription — yt-dlp audio fetch, FFmpeg normalize, SRT."""

from __future__ import annotations

import math
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit

from tts_mcp.engine import DownloadCancelled, Engine

MAX_DURATION_SECONDS = 60 * 60
WHISPER_SAMPLE_RATE = 16000

YOUTUBE_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"})
FACEBOOK_HOSTS = frozenset(
    {"facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.watch"}
)
_HOST_PLATFORMS = {
    **{host: "youtube" for host in YOUTUBE_HOSTS},
    **{host: "facebook" for host in FACEBOOK_HOSTS},
}
_RESTRICTED_AVAILABILITY = {"private", "premium_only", "subscriber_only", "needs_auth"}
_FFMPEG_TIMEOUT_SECONDS = 600


class TranscriptionError(Exception):
    """User-actionable transcription failure carrying a stable error code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def validate_video_url(value: Any) -> tuple[str, str]:
    """Return (url, platform) for an approved single public video link."""
    if not isinstance(value, str) or not value.strip():
        raise TranscriptionError("invalid_url", "Paste a public YouTube or Facebook video link")
    url = value.strip()
    try:
        parts = urlsplit(url)
        parts.port  # raises ValueError for a malformed port
    except ValueError as exc:
        raise TranscriptionError("invalid_url", "The link is not a valid URL") from exc
    if parts.scheme.lower() != "https":
        raise TranscriptionError("invalid_url", "Only HTTPS video links are supported")
    if parts.username or parts.password:
        raise TranscriptionError("invalid_url", "Links with embedded credentials are not supported")
    platform = _HOST_PLATFORMS.get((parts.hostname or "").lower())
    if platform is None:
        raise TranscriptionError(
            "invalid_url", "Only public YouTube or Facebook video links are supported"
        )
    if parts.path.rstrip("/").lower().endswith("/playlist") or "list" in parse_qs(parts.query):
        raise TranscriptionError(
            "invalid_url", "Playlists are not supported; paste a single video link"
        )
    return url, platform


def _check_cancel(should_cancel: Callable[[], bool] | None) -> None:
    if should_cancel and should_cancel():
        raise DownloadCancelled("Transcription cancelled")


def _map_download_error(exc: Exception) -> TranscriptionError:
    lowered = str(exc).lower()
    if "requested format is not available" in lowered or "no video formats" in lowered:
        return TranscriptionError("missing_audio", "The video does not offer an audio-only stream")
    if "unsupported url" in lowered:
        return TranscriptionError(
            "invalid_url", "Only YouTube and Facebook video links are supported"
        )
    if (
        "private" in lowered
        or "sign in" in lowered
        or "log in" in lowered
        or "login" in lowered
        or "age" in lowered
        and "restrict" in lowered
        or "confirm your age" in lowered
        or "members only" in lowered
        or "premium" in lowered
    ):
        return TranscriptionError(
            "video_unavailable",
            "This video is private, age-restricted, or requires sign-in; "
            "only public videos are supported",
        )
    return TranscriptionError(
        "video_unavailable",
        "The video could not be fetched; it may be unavailable, removed, "
        "or temporarily unreachable",
    )


def _validated_video(info: Any) -> dict[str, Any]:
    """Return title/duration for one public video or raise a stable error."""
    if not isinstance(info, dict):
        raise TranscriptionError("video_unavailable", "The link did not resolve to a public video")
    if "entries" in info or info.get("_type") in {"playlist", "multi_video"}:
        raise TranscriptionError(
            "invalid_url", "Playlists are not supported; paste a single video link"
        )
    availability = info.get("availability")
    if isinstance(availability, str) and availability in _RESTRICTED_AVAILABILITY:
        raise TranscriptionError(
            "video_unavailable",
            "This video is private or requires sign-in; only public videos are supported",
        )
    if info.get("age_limit"):
        raise TranscriptionError(
            "video_unavailable", "This video is age-restricted and cannot be processed"
        )
    if info.get("is_live") or info.get("live_status") in {
        "is_live",
        "is_upcoming",
        "post_live",
    }:
        raise TranscriptionError(
            "video_unavailable", "Live streams cannot be transcribed; use a finished video"
        )
    duration = info.get("duration")
    if (
        isinstance(duration, bool)
        or not isinstance(duration, (int, float))
        or not math.isfinite(duration)
    ):
        raise TranscriptionError(
            "duration_limit",
            "Could not determine the video length; only videos up to 60 minutes are supported",
        )
    if duration <= 0 or duration > MAX_DURATION_SECONDS:
        raise TranscriptionError(
            "duration_limit", "Videos longer than 60 minutes are not supported"
        )
    return {"title": str(info.get("title") or "Untitled video"), "duration": float(duration)}


def _downloaded_file(info: Any, work_dir: Path) -> Path:
    if isinstance(info, dict):
        downloads = info.get("requested_downloads")
        if isinstance(downloads, list) and downloads and isinstance(downloads[0], dict):
            filepath = downloads[0].get("filepath")
            if isinstance(filepath, str) and Path(filepath).is_file():
                return Path(filepath)
    sources = sorted(
        path
        for path in work_dir.glob("source.*")
        if path.is_file() and path.suffix not in {".part", ".ytdl"}
    )
    if len(sources) == 1:
        return sources[0]
    raise TranscriptionError("missing_audio", "The video did not provide a usable audio track")


def _fetch_audio(
    url: str,
    ffmpeg_path: str | None,
    work_dir: Path,
    emit_progress: Callable[..., None],
    should_cancel: Callable[[], bool] | None,
) -> tuple[Path, dict[str, Any]]:
    """Download one public video's audio into work_dir; return file + metadata."""
    import yt_dlp

    last_percent: list[int] = [-1]

    def hook(status: dict[str, Any]) -> None:
        _check_cancel(should_cancel)
        state = status.get("status")
        if state == "downloading":
            total = status.get("total_bytes") or status.get("total_bytes_estimate")
            done = status.get("downloaded_bytes") or 0
            if total:
                percent = min(100, int(done * 100 // total))
                if percent != last_percent[0]:
                    last_percent[0] = percent
                    emit_progress("fetch", progress=percent / 100)
            elif last_percent[0] < 0:
                last_percent[0] = 0
                emit_progress("fetch")
        elif state == "finished":
            emit_progress("fetch", progress=1.0)

    options: dict[str, Any] = {
        "format": "bestaudio",
        "noplaylist": True,
        "outtmpl": str(work_dir / "source.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "cachedir": False,
        "socket_timeout": 30,
        "progress_hooks": [hook],
    }
    if ffmpeg_path:
        options["ffmpeg_location"] = ffmpeg_path

    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            _check_cancel(should_cancel)
            info = ydl.extract_info(url, download=False)
            meta = _validated_video(info)
            _check_cancel(should_cancel)
            downloaded = ydl.process_ie_result(info, download=True)
    except (DownloadCancelled, TranscriptionError):
        raise
    except yt_dlp.utils.DownloadCancelled as exc:
        raise DownloadCancelled(str(exc) or "Transcription cancelled") from exc
    except Exception as exc:
        raise _map_download_error(exc) from exc

    return _downloaded_file(downloaded, work_dir), meta


def _normalize_audio(source: Path, ffmpeg_path: str | None, work_dir: Path) -> Path:
    if not ffmpeg_path:
        raise TranscriptionError(
            "audio_prepare_failed", "The bundled FFmpeg is unavailable in this installation"
        )
    output = work_dir / "normalized.wav"
    command = [
        ffmpeg_path,
        "-y",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(WHISPER_SAMPLE_RATE),
        "-f",
        "wav",
        str(output),
    ]
    try:
        completed = subprocess.run(command, capture_output=True, timeout=_FFMPEG_TIMEOUT_SECONDS)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise TranscriptionError(
            "audio_prepare_failed", "Could not prepare the video audio for transcription"
        ) from exc
    if completed.returncode != 0 or not output.is_file():
        raise TranscriptionError(
            "audio_prepare_failed", "Could not prepare the video audio for transcription"
        )
    return output


def _format_srt_timestamp(seconds: float) -> str:
    millis = max(0, round(seconds * 1000))
    hours, remainder = divmod(millis, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, ms = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{ms:03}"


def _transcript_and_srt(result: Any, duration: float) -> tuple[str, str]:
    """Build plain transcript and SRT text from Whisper timestamped chunks."""
    if not isinstance(result, dict) or not isinstance(result.get("chunks"), list):
        raise TranscriptionError(
            "transcription_failed", "The transcription returned invalid timed output"
        )
    entries: list[tuple[float, float, str]] = []
    for chunk in result["chunks"]:
        if not isinstance(chunk, dict):
            raise TranscriptionError(
                "transcription_failed", "The transcription returned invalid timed output"
            )
        text = str(chunk.get("text") or "").strip()
        if not text:
            continue
        timestamp = chunk.get("timestamp")
        if not isinstance(timestamp, (list, tuple)) or len(timestamp) != 2:
            raise TranscriptionError(
                "transcription_failed", "The transcription returned invalid timestamps"
            )
        start, end = timestamp
        if (
            isinstance(start, bool)
            or not isinstance(start, (int, float))
            or not math.isfinite(start)
            or start < 0
        ):
            raise TranscriptionError(
                "transcription_failed", "The transcription returned invalid timestamps"
            )
        if end is None:
            end = duration
        if (
            isinstance(end, bool)
            or not isinstance(end, (int, float))
            or not math.isfinite(end)
            or end < start
        ):
            raise TranscriptionError(
                "transcription_failed", "The transcription returned invalid timestamps"
            )
        entries.append((float(start), float(end), text))
    if not entries:
        raise TranscriptionError("no_speech", "No speech was detected in this video")
    transcript = str(result.get("text") or "").strip() or " ".join(text for _, _, text in entries)
    blocks = [
        f"{index}\n{_format_srt_timestamp(start)} --> {_format_srt_timestamp(end)}\n{text}"
        for index, (start, end, text) in enumerate(entries, start=1)
    ]
    return transcript, "\n\n".join(blocks) + "\n"


def transcribe_video(
    request_id: str,
    url: Any,
    engine: Engine,
    ffmpeg_path: str | None,
    emit: Callable[[dict[str, Any]], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Fetch one public video, transcribe it locally, and return SRT content."""
    video_url, platform = validate_video_url(url)
    status = engine.model_status()
    if not isinstance(status, dict) or not status.get("ready"):
        raise TranscriptionError(
            "model_not_ready",
            "The local OmniVoice and Whisper models are not ready; finish model setup first",
        )

    def emit_progress(phase: str, **fields: Any) -> None:
        if emit:
            emit({"id": request_id, "event": "progress", "phase": phase, **fields})

    with tempfile.TemporaryDirectory(prefix="tts-transcribe-") as temp_dir:
        work_dir = Path(temp_dir)
        emit_progress("metadata")
        source, meta = _fetch_audio(video_url, ffmpeg_path, work_dir, emit_progress, should_cancel)
        emit_progress("audio")
        normalized = _normalize_audio(source, ffmpeg_path, work_dir)
        _check_cancel(should_cancel)
        emit_progress("transcribe")
        try:
            import soundfile as sf

            waveform, sample_rate = sf.read(str(normalized), dtype="float32")
            result = engine.transcribe_with_timestamps((waveform, sample_rate))
        except TranscriptionError:
            raise
        except Exception as exc:
            raise TranscriptionError(
                "transcription_failed", "The local transcription could not be completed"
            ) from exc
        _check_cancel(should_cancel)
        transcript, srt = _transcript_and_srt(result, meta["duration"])
        _check_cancel(should_cancel)
        return {
            "platform": platform,
            "title": meta["title"],
            "duration_seconds": meta["duration"],
            "transcript": transcript,
            "srt": srt,
        }
