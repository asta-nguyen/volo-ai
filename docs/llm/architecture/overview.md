# Architecture overview

## Purpose

The repository provides local text-to-speech through a shared Python engine,
with terminal, MCP, and Volo AI desktop entry points. The desktop app runs
the Python worker as a Tauri sidecar and stores model/audio data locally.

## Entry points

- `tts_mcp.cli:main` exposes terminal commands for speech generation, cloning,
  voice design, and saved voice profiles.
- `tts mcp` starts `tts_mcp.server:run_server` over MCP stdio. Its tools include
  `status` and `prepare_model`, plus `speak` and `clone` with OmniVoice as the
  default provider. VieNeu supports manifest presets through `speak` and saved
  Clone or one-off reference audio through `clone`; `design` and profile
  management remain OmniVoice/library operations.
- `tts_mcp.desktop:main` consumes JSONL requests for the Tauri desktop app.
  `status` reports OmniVoice and VieNeu readiness; `prepare_model` and
  `synthesize` require an explicit provider ID. OmniVoice retains auto, file,
  saved-profile, and voice-design synthesis. VieNeu supports manifest presets,
  saved Clone profiles, and one-off reference files.
- `apps/desktop/src/main.tsx` mounts the React UI; `App.tsx` owns the desktop
  provider selection, explicit model preparation, synthesis flow,
  OmniVoice voice-profile library, and Audio History view. The library includes
  Clone/Design creation, direct audio-file import, and seed-folder import,
  `src/lib/i18n.ts` owns the English/Vietnamese UI resources, and
  `src/lib/sidecar.ts` owns the sidecar process connection.
- Audio History uses `list_audio_history` and `delete_audio_history` sidecar
  operations. It plays generated files, includes legacy WAV/MP3 files without
  synthesis metadata, and asks for confirmation before deleting an output.
  Workspace separately retains only the five latest takes for the current app
  session; pruning that list does not delete files.
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
and saved voice profiles. `VieNeuProvider` downloads a pinned GGUF, manifest
voice assets, and CAM++ encoder; it uses Python for SEA-G2P and speaker
embeddings and calls the configured or bundled CPU audio.cpp CLI for synthesis.
Both the MCP server and desktop sidecar use this provider; the CLI remains
OmniVoice-only.
`convert.py` writes WAV, FLAC, OGG, or MP3 output; VieNeu WAV/MP3 output keeps
48 kHz, while OmniVoice generates at 24 kHz. MP3 requires FFmpeg and pydub,
while unsupported output extensions are rejected.
The frontend `SidecarClient` gives ordinary requests a five-minute timeout and
model preparation a longer one-hour timeout; a timed-out child is terminated
so the UI can recover instead of waiting forever.

The MCP `status` tool reports provider readiness, runtime and preprocessing
availability, and VieNeu presets. `prepare_model` downloads assets only for
the selected provider. `speak` and `clone` preserve OmniVoice when `provider`
is omitted; VieNeu is explicit and does not fall back. OmniVoice `clone`
accepts saved Clone/Design profiles or reference audio with an optional
transcript. VieNeu uses a manifest preset or a saved Clone/reference recording
and writes WAV or MP3 to the requested path. The MCP voice-library workflow
and shared-store effects are documented in
[MCP voice library](../workflows/mcp-voice-library.md).
Desktop provider setup and synthesis are documented in
[Desktop speech providers](../workflows/desktop-vieneu.md).

## Domains

| Domain | Current boundary |
| --- | --- |
| Speech generation | `Engine.generate` serves CLI/MCP and desktop OmniVoice; `VieNeuProvider.synthesize` serves MCP and desktop VieNeu through audio.cpp |
| Model lifecycle | `Engine.model_status`/`ensure_model` and `VieNeuProvider.status`/`ensure_model` serve MCP and desktop readiness and setup |
| Voice profiles | `Engine.save_voice`, `save_design_voice`, `load_voice_profile`, `load_voice`, `list_voices`, and `delete_voice`; Clone and Design profiles share the desktop library |
| MCP voice generation | `status`, `prepare_model`, `speak`, `clone`, and `list_voices` expose provider setup, VieNeu presets, and saved Clone/Design or external-reference workflows; MCP shares the app library when configured with the app-data path |
| Seed profiles | `Engine.import_seed_voices`, the `import_seed_voices` sidecar request, and bundled seed manifests |
| Audio history | `Engine.record_audio_history` and `list_audio_history`/`delete_audio_history` sidecar operations index files from `outputs`; React plays files and confirms deletion |
| Desktop settings | `App.tsx` and `i18n.ts` expose General, Model, Storage, and MCP tabs; MCP generates copyable client-specific setup for Codex CLI, Claude Code, Claude Desktop, Cursor, VS Code / GitHub Copilot, and Zed using the app-data path, and Settings is available from first-run setup |
| Desktop shell | React UI, Tauri plugins, JSONL sidecar, and the target-matched audio.cpp CLI |

## Data and dependencies

The engine reads `TTS_MCP_DATA_DIR`, defaulting to `~/.tts-mcp`. OmniVoice
assets use `models/omnivoice`; VieNeu assets and speaker-embedding cache use
`models/vieneu`. The desktop sidecar stores generated audio below `outputs`;
MCP writes to each request's `output_path`. Audio History discovers regular
WAV/MP3 files directly in `outputs` and stores synthesis metadata in the
SQLite `audio_history` table using only each file's basename. Files without a
metadata row remain visible with their file date; deleting a history item
removes the selected output and its metadata. The SQLite database is `volo.db`.
Voice metadata lives in `voice_profiles` and
installed bundled seeds in `app_seeds`; Clone profiles keep copied reference
audio and clone prompts under `voices/<profile-name>/`, while Design profiles
store their `design_instruction` in SQLite and need no voice files. The desktop
shell passes its Tauri app-data directory to the sidecar. MCP uses `~/.tts-mcp`
unless `TTS_MCP_DATA_DIR` is set to that same app-data directory; in that case,
MCP voice listing, generation, saving, and deletion use the desktop library.
MCP model preparation downloads only the selected provider's missing assets;
VieNeu requires `TTS_MCP_AUDIOCPP_PATH` for the local audio.cpp runtime.
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
