"""CLI entry point — tts speak/clone/design/voices/save-voice/delete-voice/mcp"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .engine import get_engine, VOICES_DIR
from .convert import save_audio


def _add_generate_args(p: argparse.ArgumentParser) -> None:
    """Common args for all generate subcommands."""
    p.add_argument("--out", "-o", required=True, help="Output file path (.wav, .mp3, .flac)")
    p.add_argument("--speed", type=float, default=1.0, help="Speech speed factor (default: 1.0)")
    p.add_argument("--steps", type=int, default=32, help="Diffusion steps (16=fast, 32=balanced)")
    p.add_argument("--normalize", action="store_true", help="Normalize numbers to words")


def _generate_and_save(engine, **gen_kwargs) -> str:
    """Run generation and save to file."""
    out_path = gen_kwargs.pop("out")
    audio = engine.generate(**gen_kwargs)
    saved = save_audio(audio, out_path)
    print(f"[tts-mcp] Saved: {saved}")
    return saved


def cmd_speak(args: argparse.Namespace) -> None:
    """Auto voice TTS — no reference, no instruct."""
    engine = get_engine()
    _generate_and_save(
        engine,
        text=args.text,
        out=args.out,
        speed=args.speed,
        num_step=args.steps,
        normalize_text=args.normalize,
    )


def cmd_clone(args: argparse.Namespace) -> None:
    """Voice cloning from reference audio."""
    engine = get_engine()
    gen_kwargs: dict = {
        "text": args.text,
        "out": args.out,
        "speed": args.speed,
        "num_step": args.steps,
        "normalize_text": args.normalize,
    }
    if args.voice:
        # Use saved voice profile instead of raw ref audio
        prompt = engine.load_voice(args.voice)
        gen_kwargs["voice_clone_prompt"] = prompt
    else:
        gen_kwargs["ref_audio"] = args.ref
        if args.ref_text:
            gen_kwargs["ref_text"] = args.ref_text
    _generate_and_save(engine, **gen_kwargs)


def cmd_design(args: argparse.Namespace) -> None:
    """Voice design from instruct attributes."""
    engine = get_engine()
    _generate_and_save(
        engine,
        text=args.text,
        out=args.out,
        instruct=args.instruct,
        speed=args.speed,
        num_step=args.steps,
        normalize_text=args.normalize,
    )


def cmd_voices(args: argparse.Namespace) -> None:
    """List saved voice profiles."""
    from .engine import Engine

    voices = Engine.list_voices()
    if not voices:
        print("[tts-mcp] No saved voices. Use 'tts save-voice' to create one.")
        print(f"  Voice directory: {VOICES_DIR}")
        return
    print(f"Saved voices ({len(voices)}):")
    for v in voices:
        ref_text = v.get("ref_text") or "(auto-transcribed)"
        print(f"  • {v['name']}")
        print(f"      language: {v.get('language', 'en')}")
        print(f"      ref: {v.get('ref_audio', '?')}")
        print(f"      text: {ref_text}")


def cmd_save_voice(args: argparse.Namespace) -> None:
    """Save a voice profile for reuse."""
    engine = get_engine()
    path = engine.save_voice(args.name, args.ref, args.ref_text, args.language)
    print(f"[tts-mcp] Saved voice '{args.name}' → {path}")


def cmd_delete_voice(args: argparse.Namespace) -> None:
    """Delete a saved voice profile."""
    from .engine import Engine

    if Engine.delete_voice(args.name):
        print(f"[tts-mcp] Deleted voice '{args.name}'")
    else:
        print(f"[tts-mcp] Voice '{args.name}' not found", file=sys.stderr)
        sys.exit(1)


def cmd_mcp(args: argparse.Namespace) -> None:
    """Start MCP server (stdio transport)."""
    from .server import run_server

    run_server()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tts",
        description="OmniVoice TTS — speak, clone, design voices from terminal",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # speak — auto voice
    p_speak = sub.add_parser("speak", help="Generate TTS with auto voice")
    p_speak.add_argument("text", help="Text to synthesize")
    _add_generate_args(p_speak)
    p_speak.set_defaults(func=cmd_speak)

    # clone — voice cloning
    p_clone = sub.add_parser("clone", help="Clone a voice from reference audio")
    p_clone.add_argument("text", help="Text to synthesize")
    source = p_clone.add_mutually_exclusive_group(required=True)
    source.add_argument("--ref", help="Reference audio file path")
    source.add_argument("--voice", help="Use a saved voice profile name instead of --ref")
    p_clone.add_argument("--ref-text", help="Transcript of reference audio (auto if omitted)")
    _add_generate_args(p_clone)
    p_clone.set_defaults(func=cmd_clone)

    # design — voice design
    p_design = sub.add_parser("design", help="Design a voice from attributes")
    p_design.add_argument("text", help="Text to synthesize")
    p_design.add_argument(
        "--instruct",
        "-i",
        required=True,
        help='Voice attributes, e.g. "female, low pitch, british accent"',
    )
    _add_generate_args(p_design)
    p_design.set_defaults(func=cmd_design)

    # voices — list saved
    p_voices = sub.add_parser("voices", help="List saved voice profiles")
    p_voices.set_defaults(func=cmd_voices)

    # save-voice — create reusable profile
    p_save = sub.add_parser("save-voice", help="Save a voice profile for reuse")
    p_save.add_argument("name", help="Profile name")
    p_save.add_argument("--ref", required=True, help="Reference audio file")
    p_save.add_argument("--ref-text", help="Transcript (auto if omitted)")
    p_save.add_argument(
        "--language",
        choices=("en", "vi"),
        default="en",
        help="Reference voice language (default: en)",
    )
    p_save.set_defaults(func=cmd_save_voice)

    # delete-voice
    p_del = sub.add_parser("delete-voice", help="Delete a saved voice profile")
    p_del.add_argument("name", help="Profile name")
    p_del.set_defaults(func=cmd_delete_voice)

    # mcp — start MCP server
    p_mcp = sub.add_parser("mcp", help="Start MCP server (stdio transport)")
    p_mcp.set_defaults(func=cmd_mcp)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
