"""Audio conversion — save numpy array to wav or mp3."""

from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np


def save_audio(
    audio: np.ndarray,
    output_path: str,
    sample_rate: int = 24000,
    ffmpeg_path: str | None = None,
) -> str:
    """Save audio array to file. Format detected from extension.

    Supports: .wav, .flac, .ogg, .mp3
    """
    path = Path(output_path)
    ext = path.suffix.lower()

    if ext == ".mp3":
        _save_mp3(audio, str(path), sample_rate, ffmpeg_path)
    elif ext in (".wav", ".flac", ".ogg"):
        import soundfile as sf

        sf.write(str(path), audio, sample_rate)
    else:
        raise ValueError("Unsupported audio format. Use .wav, .flac, .ogg, or .mp3")

    return str(path)


def _save_mp3(
    audio: np.ndarray,
    path: str,
    sample_rate: int,
    ffmpeg_path: str | None = None,
) -> None:
    """Convert to mp3 via pydub and an explicit ffmpeg executable."""
    converter = ffmpeg_path or shutil.which("ffmpeg")
    if not converter:
        raise RuntimeError("MP3 export requires FFmpeg. Install it or provide ffmpeg_path.")
    try:
        from pydub import AudioSegment
        import soundfile as sf
        import io
    except ImportError:
        raise RuntimeError(
            "MP3 export requires the optional pydub dependency. "
            "Install with: pip install tts-mcp[mp3]"
        )

    AudioSegment.converter = converter
    with io.BytesIO() as buf:
        sf.write(buf, audio, sample_rate, format="wav")
        buf.seek(0)
        segment = AudioSegment.from_wav(buf)
        segment.export(path, format="mp3", bitrate="192k")
