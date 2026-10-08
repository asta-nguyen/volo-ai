# Architecture overview

## Purpose

The repository provides local text-to-speech through a shared Python engine,
with terminal, MCP, and Volo AI desktop entry points. The desktop app runs
the Python worker as a Tauri sidecar and stores model/audio data locally.

## Entry points

- `tts_mcp.cli:main` exposes terminal commands for speech generation, cloning,
  voice design, and saved voice profiles.
- `tts mcp` starts `tts_mcp.server:run_server`, exposing `speak`, `clone`,
  `design`, `list_voices`, `save_voice`, and `delete_voice` over MCP stdio.
- `tts_mcp.desktop:main` consumes JSONL requests for the Tauri desktop app.
  `status` reports OmniVoice and VieNeu readiness; `prepare_model` and
  `synthesize` require an explicit provider ID. OmniVoice retains auto, file,
  saved-profile, and voice-design synthesis. VieNeu supports manifest presets,
  saved Clone profiles, and one-off reference files.
- `apps/desktop/src/main.tsx` mounts the React UI; `App.tsx` owns the desktop
  provider selection, explicit model preparation, synthesis flow, and
  OmniVoice voice-profile library. The library includes Clone/Design creation,
  direct audio-file import, and seed-folder import,
  `src/lib/i18n.ts` owns the English/Vietnamese UI resources, and
  `src/lib/sidecar.ts` owns the sidecar process connection.
- `apps/desktop/src/components/ui.tsx` contains source-owned shadcn-style
  primitives backed by Base UI, `src/lib/utils.ts` owns class composition,
  and `src/styles.css` loads Tailwind CSS v4 and the Volo AI theme tokens.
- Provider selection is stored in `localStorage`; it defaults to OmniVoice and
  does not trigger model downloads. When OmniVoice becomes ready, `App.tsx`
  resolves the bundled `resources/seed-voices` directory and asks the sidecar to
  import its versioned manifests. The
  importer copies each reference audio file into app-local storage and creates
  the clone prompt there; SQLite records profile kinds, metadata, defaults, and
  installed seed versions. The Voice Profiles view also lets users choose an individual
  audio file; the UI derives a profile name from its filename and reuses the
  existing `save_voice` operation. It can also pass a user-selected seed root
  to the existing seed importer. Setup is therefore independent of the source
  repository or the original sample-audio path.
- `scripts/build_sidecar.py` packages the desktop worker and FFmpeg into a
  target-named executable and stages the matching audio.cpp CLI beside it for
  Tauri.

## Runtime boundaries

```text
Volo AI React UI
  -> Tauri shell plugin
  -> Python JSONL sidecar
  -> Engine / OmniVoice  OR  VieNeuProvider / audio.cpp CLI
  -> provider model cache and generated audio
```

The Python engine in `engine.py` owns OmniVoice device detection, model
readiness and download, generation, native long-form chunking configuration,
and saved voice profiles. The desktop-only `VieNeuProvider` downloads a pinned
GGUF, manifest voice assets, and CAM++ encoder; it uses Python for SEA-G2P and
speaker embeddings and calls the bundled CPU audio.cpp CLI for synthesis.
`convert.py` writes WAV, FLAC, OGG, or MP3 output; VieNeu WAV/MP3 output keeps
48 kHz, while OmniVoice generates at 24 kHz. MP3 requires FFmpeg and pydub,
while unsupported output extensions are rejected.
The frontend `SidecarClient` gives ordinary requests a five-minute timeout and
model preparation a longer one-hour timeout; a timed-out child is terminated
so the UI can recover instead of waiting forever.

The MCP `clone` tool accepts either reference audio or a saved profile. Saved
Clone profiles supply a voice-clone prompt; saved Design profiles supply their
design instruction. `list_voices` reports each profile's kind, language, and
kind-specific details. The MCP voice-library workflow and shared-store effects
are documented in [MCP voice library](../workflows/mcp-voice-library.md).
Desktop provider setup and synthesis are documented in
[Desktop speech providers](../workflows/desktop-vieneu.md).

## Domains

| Domain | Current boundary |
| --- | --- |
| Speech generation | `Engine.generate` serves CLI/MCP and desktop OmniVoice; `VieNeuProvider.synthesize` uses audio.cpp for desktop VieNeu |
| Model lifecycle | `Engine.model_status`/`ensure_model` and `VieNeuProvider.status`/`ensure_model` report provider readiness and desktop progress |
| Voice profiles | `Engine.save_voice`, `save_design_voice`, `load_voice_profile`, `load_voice`, `list_voices`, and `delete_voice`; Clone and Design profiles share the desktop library |
| MCP voice generation | `clone` and `list_voices` tools reuse saved Clone/Design profiles or accept external reference audio; MCP shares the app library when configured with the app-data path |
| Seed profiles | `Engine.import_seed_voices`, the `import_seed_voices` sidecar request, and bundled seed manifests |
| Desktop settings | `App.tsx` and `i18n.ts` expose provider setup plus General, Model, and Storage tabs; the Model tab reports OmniVoice details and both provider statuses |
| Desktop shell | React UI, Tauri plugins, JSONL sidecar, and the target-matched audio.cpp CLI |

## Data and dependencies

The engine reads `TTS_MCP_DATA_DIR`, defaulting to `~/.tts-mcp`. OmniVoice
assets use `models/omnivoice`; VieNeu assets and speaker-embedding cache use
`models/vieneu`. Generated audio is stored below `outputs`, and the SQLite
database is `volo.db`. Voice metadata lives in `voice_profiles` and
installed bundled seeds in `app_seeds`; Clone profiles keep copied reference
audio and clone prompts under `voices/<profile-name>/`, while Design profiles
store their `design_instruction` in SQLite and need no voice files. The desktop
shell passes its Tauri app-data directory to the sidecar. MCP uses `~/.tts-mcp`
unless `TTS_MCP_DATA_DIR` is set to that same app-data directory; in that case,
MCP voice listing, generation, saving, and deletion use the desktop library.
Release bundles include the native sidecar, audio.cpp CLI, and FFmpeg, so
installed users do not need Python, Node.js, or FFmpeg; those runtimes are only
development/build requirements.
The app interface supports English and Vietnamese through `i18next` and
`react-i18next`; the app locale is stored as `volo-ai.app-language`, while the
synthesis target remains `volo-ai.synthesis-language`.

## Sources

- `pyproject.toml`
- `src/tts_mcp/engine.py`
- `src/tts_mcp/convert.py`
- `src/tts_mcp/cli.py`
- `src/tts_mcp/server.py`
- `tests/test_server.py`
- `tests/test_engine.py`
- `README.md`
- `src/tts_mcp/desktop.py`
- `src/tts_mcp/desktop_vieneu.py`
- `tests/test_desktop.py`
- `tests/test_desktop_vieneu.py`
- `tests/test_build_sidecar.py`
- `scripts/build_sidecar.py`
- `docs/desktop-development.md`
- `apps/desktop/package.json`
- `apps/desktop/vite.config.ts`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/components/ui.tsx`
- `apps/desktop/src/lib/utils.ts`
- `apps/desktop/components.json`
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src-tauri/capabilities/default.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/resources/seed-voices/tony-hoang/manifest.json`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src/lib/sidecar.ts`
