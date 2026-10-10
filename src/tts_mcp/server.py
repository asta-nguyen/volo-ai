"""MCP server — exposes TTS tools to Claude Code, Codex, and other MCP clients.

Uses MCP SDK v2 (MCPServer, formerly FastMCP).
"""

from __future__ import annotations

import importlib.util
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

from mcp.server.mcpserver import MCPServer

from .desktop_vieneu import VieNeuProvider
from .engine import DATA_DIR, Engine, get_engine, validate_language
from .convert import save_audio

OUTPUT_DIR = DATA_DIR / "outputs"

server = MCPServer(
    name="tts-mcp",
    version="0.1.0",
    instructions=(
        "Local OmniVoice and VieNeu TTS server. Use status to inspect available "
        "providers, prepare_model to explicitly download model assets, and "
        "list_voices to see saved voice profiles."
    ),
)


@lru_cache(maxsize=1)
def get_vieneu_provider() -> VieNeuProvider:
    """Reuse one provider so concurrent MCP synthesis shares its inference lock."""
    return VieNeuProvider(DATA_DIR)


def _provider_id(provider: str) -> str:
    if not isinstance(provider, str) or provider not in {"omnivoice", "vieneu"}:
        raise ValueError("Unknown provider. Use 'omnivoice' or 'vieneu'.")
    return provider


def _validate_vieneu_controls(speed: float, steps: int, normalize: bool) -> None:
    if speed != 1.0 or steps != 32 or normalize:
        raise ValueError("VieNeu does not support speed, steps, or text normalization controls")


@server.tool()
def status() -> dict[str, Any]:
    """Report model readiness and runtime requirements for each provider."""
    omnivoice = get_engine().model_status()
    runtime_available = importlib.util.find_spec("omnivoice") is not None
    model_ready = bool(omnivoice["ready"])
    unavailable_reason = (
        "OmniVoice package is unavailable in this environment"
        if not runtime_available
        else (
            "OmniVoice model assets are not ready; "
            "run prepare_model(provider='omnivoice') first"
            if not model_ready
            else None
        )
    )
    return {
        "providers": {
            "omnivoice": {
                "model_ready": model_ready,
                "runtime_available": runtime_available,
                "preprocessing_available": True,
                "unavailable_reason": unavailable_reason,
            },
            "vieneu": get_vieneu_provider().status(),
        }
    }


@server.tool()
def prepare_model(provider: str) -> dict[str, Any]:
    """Explicitly download and verify assets for one provider."""
    provider_id = _provider_id(provider)
    result = (
        get_engine().ensure_model()
        if provider_id == "omnivoice"
        else get_vieneu_provider().ensure_model()
    )
    return {"provider": provider_id, "model_ready": bool(result["ready"])}


@server.tool()
def speak(
    text: str,
    output_path: str,
    speed: float = 1.0,
    steps: int = 32,
    normalize: bool = False,
    provider: str = "omnivoice",
    voice: str = "auto",
    preset_id: str | None = None,
    language: str | None = None,
) -> str:
    """Generate speech with OmniVoice or a manifest preset from VieNeu.

    Args:
        text: Text to synthesize.
        output_path: Output file path; VieNeu supports .wav and .mp3.
        speed: Speech speed factor (default 1.0).
        steps: Diffusion steps (16=fast, 32=balanced, default 32).
        normalize: Normalize numbers to words (default false).
        provider: Synthesis provider (omnivoice by default, or vieneu).
        voice: Use "auto" for OmniVoice or "preset" for VieNeu.
        preset_id: VieNeu preset ID from status().
        language: Optional synthesis language (en or vi).

    Returns:
        Path to the saved audio file.
    """
    provider_id = _provider_id(provider)
    if provider_id == "omnivoice":
        if voice != "auto" or preset_id is not None:
            raise ValueError("OmniVoice speak supports only voice='auto'; preset_id is for VieNeu")
        gen_kwargs: dict[str, Any] = {
            "text": text,
            "speed": speed,
            "num_step": steps,
            "normalize_text": normalize,
        }
        if language is not None:
            gen_kwargs["language"] = validate_language(language)
        audio = get_engine().generate(**gen_kwargs)
        path = save_audio(audio, output_path)
        return f"Audio saved to: {path}"

    if voice != "preset" or not isinstance(preset_id, str) or not preset_id.strip():
        raise ValueError("VieNeu speak requires voice='preset' and a preset_id from status()")
    _validate_vieneu_controls(speed, steps, normalize)
    output_format = Path(output_path).suffix.lower().lstrip(".")
    if output_format not in {"wav", "mp3"}:
        raise ValueError("VieNeu output_path must use .wav or .mp3")
    request = {
        "text": text,
        "language": validate_language(language if language is not None else "en"),
        "voice": "preset",
        "preset_id": preset_id,
        "format": output_format,
    }
    result = get_vieneu_provider().synthesize(
        request,
        Engine.list_voices(),
        OUTPUT_DIR,
        output_path=output_path,
    )
    return f"Audio saved to: {result['audio_path']}"


@server.tool()
def clone(
    text: str,
    output_path: str,
    ref_audio_path: str | None = None,
    ref_text: str | None = None,
    voice: str | None = None,
    speed: float = 1.0,
    steps: int = 32,
    normalize: bool = False,
    provider: str = "omnivoice",
    language: str | None = None,
) -> str:
    """Generate speech with a saved profile or reference audio.

    Provide ref_audio_path and optionally ref_text.
    Or use a saved Clone or Design profile name with the 'voice' parameter.
    VieNeu accepts saved Clone profiles or reference audio, without ref_text.

    Args:
        text: Text to synthesize.
        output_path: Output file path (.wav, .mp3, .flac).
        ref_audio_path: Path to reference audio file (3-15 seconds recommended).
        ref_text: Transcript of reference audio (auto-transcribed if omitted).
        voice: Name of a saved Clone or Design profile (use instead of ref_audio_path).
        speed: Speech speed factor (default 1.0).
        steps: Diffusion steps (16=fast, 32=balanced, default 32).
        normalize: Normalize numbers to words (default false).
        provider: Synthesis provider (omnivoice by default, or vieneu).
        language: Optional synthesis language (en or vi).

    Returns:
        Path to the saved audio file.
    """
    provider_id = _provider_id(provider)
    if provider_id == "vieneu":
        _validate_vieneu_controls(speed, steps, normalize)
        if ref_text is not None:
            raise ValueError("VieNeu does not use ref_text; omit it for reference-audio cloning")
        output_format = Path(output_path).suffix.lower().lstrip(".")
        if output_format not in {"wav", "mp3"}:
            raise ValueError("VieNeu output_path must use .wav or .mp3")
        request: dict[str, Any] = {
            "text": text,
            "language": validate_language(language if language is not None else "en"),
            "format": output_format,
        }
        voices = Engine.list_voices()
        if voice:
            profile = next(
                (item for item in voices if item.get("name") == voice), None
            )
            if profile is None:
                raise FileNotFoundError(f"Voice profile '{voice}' was not found")
            if profile.get("kind") != "clone":
                raise ValueError("VieNeu supports saved Clone profiles, not Design profiles")
            request.update({"voice": "profile", "voice_name": voice})
        elif ref_audio_path:
            request.update({"voice": "file", "ref_audio": ref_audio_path})
        else:
            raise ValueError("Provide either 'ref_audio_path' or a saved Clone 'voice' profile")
        result = get_vieneu_provider().synthesize(
            request,
            voices,
            OUTPUT_DIR,
            output_path=output_path,
        )
        return f"Cloned audio saved to: {result['audio_path']}"

    engine = get_engine()
    gen_kwargs: dict[str, Any] = {
        "text": text,
        "speed": speed,
        "num_step": steps,
        "normalize_text": normalize,
    }
    if language is not None:
        gen_kwargs["language"] = validate_language(language)
    audio_label = "Cloned"
    if voice:
        profile = engine.load_voice_profile(voice)
        if profile["kind"] == "clone":
            gen_kwargs["voice_clone_prompt"] = profile["prompt"]
        else:
            audio_label = "Designed"
            gen_kwargs["instruct"] = profile["instruct"]
    elif ref_audio_path:
        gen_kwargs["ref_audio"] = ref_audio_path
        if ref_text:
            gen_kwargs["ref_text"] = ref_text
    else:
        raise ValueError("Provide either 'ref_audio_path' or 'voice' parameter")
    audio = engine.generate(**gen_kwargs)
    path = save_audio(audio, output_path)
    return f"{audio_label} audio saved to: {path}"


@server.tool()
def design(
    text: str,
    output_path: str,
    instruct: str,
    speed: float = 1.0,
    steps: int = 32,
    normalize: bool = False,
) -> str:
    """Design a voice from attributes (no reference audio needed).

    Supported attributes: gender (male/female), age, pitch, style,
    English accent (american, british, etc.), Chinese dialect.
    Example: 'female, low pitch, british accent'.

    Args:
        text: Text to synthesize.
        output_path: Output file path (.wav, .mp3, .flac).
        instruct: Voice attributes, e.g. "female, low pitch, british accent".
        speed: Speech speed factor (default 1.0).
        steps: Diffusion steps (16=fast, 32=balanced, default 32).
        normalize: Normalize numbers to words (default false).

    Returns:
        Path to the saved audio file.
    """
    engine = get_engine()
    audio = engine.generate(
        text=text,
        instruct=instruct,
        speed=speed,
        num_step=steps,
        normalize_text=normalize,
    )
    path = save_audio(audio, output_path)
    return f"Designed voice audio saved to: {path}"


@server.tool()
def list_voices() -> str:
    """List all saved voice profiles that can be used with the clone tool.

    Returns:
        A formatted list of saved voice profiles.
    """
    voices = Engine.list_voices()
    if not voices:
        return "No saved voices. Use save_voice to create one."
    lines = [f"Saved voices ({len(voices)}):"]
    for v in voices:
        line = f"  - {v['name']} ({v['kind']}, {v['language']})"
        if v["kind"] == "clone":
            line += f"; ref_audio: {v['ref_audio']}"
        else:
            line += f"; design_instruction: {v['design_instruction']}"
        lines.append(line)
    return "\n".join(lines)


@server.tool()
def save_voice(
    name: str,
    ref_audio_path: str,
    ref_text: str | None = None,
    language: str = "en",
) -> str:
    """Save a voice profile from reference audio for reuse in future sessions.

    This avoids re-loading reference audio each time you clone.

    Args:
        name: Profile name.
        ref_audio_path: Path to reference audio file.
        ref_text: Transcript (auto-transcribed if omitted).
        language: Reference voice language, either "en" or "vi".

    Returns:
        Path where the voice profile was saved.
    """
    engine = get_engine()
    path = engine.save_voice(name, ref_audio_path, ref_text, language)
    return f"Voice profile '{name}' saved to: {path}"


@server.tool()
def delete_voice(name: str) -> str:
    """Delete a saved voice profile by name.

    Args:
        name: Profile name to delete.

    Returns:
        Confirmation message.
    """
    if Engine.delete_voice(name):
        return f"Deleted voice profile: {name}"
    return f"Voice profile '{name}' not found"


def run_server() -> None:
    """Run MCP server with stdio transport."""
    import asyncio

    asyncio.run(server.run_stdio_async())
