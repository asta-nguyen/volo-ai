"""MCP server — exposes TTS tools to Claude Code, Codex, and other MCP clients.

Uses MCP SDK v2 (MCPServer, formerly FastMCP).
"""

from __future__ import annotations

import sys
from typing import Any

from mcp.server.mcpserver import MCPServer

from .engine import get_engine, Engine
from .convert import save_audio

server = MCPServer(
    name="tts-mcp",
    version="0.1.0",
    instructions=(
        "OmniVoice TTS server. Generate speech from text, clone voices from "
        "reference audio, or design voices from attributes. "
        "Use list_voices to see saved voice profiles."
    ),
)


@server.tool()
def speak(
    text: str,
    output_path: str,
    speed: float = 1.0,
    steps: int = 32,
    normalize: bool = False,
) -> str:
    """Generate speech from text using auto voice (no reference needed).

    Args:
        text: Text to synthesize.
        output_path: Output file path (.wav, .mp3, .flac).
        speed: Speech speed factor (default 1.0).
        steps: Diffusion steps (16=fast, 32=balanced, default 32).
        normalize: Normalize numbers to words (default false).

    Returns:
        Path to the saved audio file.
    """
    engine = get_engine()
    audio = engine.generate(
        text=text,
        speed=speed,
        num_step=steps,
        normalize_text=normalize,
    )
    path = save_audio(audio, output_path)
    return f"Audio saved to: {path}"


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
) -> str:
    """Clone a voice from reference audio and generate speech.

    Provide ref_audio_path and optionally ref_text.
    Or use a saved voice profile name with the 'voice' parameter.

    Args:
        text: Text to synthesize.
        output_path: Output file path (.wav, .mp3, .flac).
        ref_audio_path: Path to reference audio file (3-15 seconds recommended).
        ref_text: Transcript of reference audio (auto-transcribed if omitted).
        voice: Name of a saved voice profile (use instead of ref_audio_path).
        speed: Speech speed factor (default 1.0).
        steps: Diffusion steps (16=fast, 32=balanced, default 32).
        normalize: Normalize numbers to words (default false).

    Returns:
        Path to the saved audio file.
    """
    engine = get_engine()
    gen_kwargs: dict[str, Any] = {
        "text": text,
        "speed": speed,
        "num_step": steps,
        "normalize_text": normalize,
    }
    if voice:
        gen_kwargs["voice_clone_prompt"] = engine.load_voice(voice)
    elif ref_audio_path:
        gen_kwargs["ref_audio"] = ref_audio_path
        if ref_text:
            gen_kwargs["ref_text"] = ref_text
    else:
        raise ValueError("Provide either 'ref_audio_path' or 'voice' parameter")
    audio = engine.generate(**gen_kwargs)
    path = save_audio(audio, output_path)
    return f"Cloned audio saved to: {path}"


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
        lines.append(f"  - {v['name']} (ref: {v.get('ref_audio', '?')})")
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
