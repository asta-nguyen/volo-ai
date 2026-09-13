# Architecture overview

## Purpose

The repository provides local text-to-speech through a shared Python engine,
with terminal, MCP, and Volo AI desktop entry points. The desktop app runs
the Python worker as a Tauri sidecar and stores model/audio data locally.

## Entry points

- `tts_mcp.cli:main` exposes terminal commands for speech generation, cloning,
  voice design, and saved voice profiles.
- `tts_mcp.server:mcp` exposes the existing generation and voice-profile tools
  over MCP.
- `tts_mcp.desktop:main` consumes JSONL requests for the Tauri desktop app,
  including auto, file-clone, saved-profile, and voice-design synthesis.
- `apps/desktop/src/main.tsx` mounts the React UI; `App.tsx` owns the desktop
  user flow and the dedicated voice-profile library, `src/lib/i18n.ts` owns
  the English/Vietnamese UI resources, and `src/lib/sidecar.ts` owns the
  sidecar process connection.
- `apps/desktop/src/components/ui.tsx` contains source-owned shadcn-style
  primitives backed by Base UI, `src/lib/utils.ts` owns class composition,
  and `src/styles.css` loads Tailwind CSS v4 and the Volo AI theme tokens.
- `scripts/build_sidecar.py` packages the desktop worker and FFmpeg into a
  target-named executable for Tauri.

## Runtime boundaries

```text
Volo AI React UI
  -> Tauri shell plugin
  -> Python JSONL sidecar
  -> Engine / OmniVoice
  -> local model cache and generated audio
```

The Python engine in `engine.py` owns device detection, model readiness and
download, generation, native OmniVoice long-form chunking configuration, and
saved voice profiles. `convert.py` writes WAV, FLAC, OGG, or MP3 output; MP3
requires FFmpeg and pydub.

## Domains

| Domain | Current boundary |
| --- | --- |
| Speech generation | `Engine.generate`, CLI/MCP tools, and desktop `synthesize` request; desktop adds voice design and advanced OmniVoice generation config |
| Model lifecycle | `Engine.model_status`, `Engine.ensure_model`, and desktop progress events |
| Voice profiles | `Engine.save_voice`, `load_voice`, `list_voices`, and `delete_voice` |
| Desktop settings | `App.tsx` and `i18n.ts` persist the app interface locale separately from the synthesis language |
| Desktop shell | React UI, Tauri plugins, and the JSONL sidecar protocol |

## Data and dependencies

The engine reads `TTS_MCP_DATA_DIR`, defaulting to `~/.tts-mcp`. Model assets
are stored below its `models` directory and generated audio below `outputs`.
The desktop shell passes its Tauri app-data directory to the sidecar. The
runtime requires Python 3.10+, while the frontend requires Node.js 20+.
The app interface supports English and Vietnamese through `i18next` and
`react-i18next`; the app locale is stored as `volo-ai.app-language`, while the
synthesis target remains `volo-ai.synthesis-language`.

## Sources

- `pyproject.toml`
- `src/tts_mcp/engine.py`
- `src/tts_mcp/convert.py`
- `src/tts_mcp/cli.py`
- `src/tts_mcp/server.py`
- `src/tts_mcp/desktop.py`
- `apps/desktop/package.json`
- `apps/desktop/vite.config.ts`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/components/ui.tsx`
- `apps/desktop/src/lib/utils.ts`
- `apps/desktop/components.json`
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src/lib/sidecar.ts`
- `scripts/build_sidecar.py`
