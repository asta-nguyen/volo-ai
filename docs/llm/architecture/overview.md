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
  user flow and the dedicated voice-profile library, including the user-facing
  seed-folder import picker, `src/lib/i18n.ts` owns the English/Vietnamese UI
  resources, and `src/lib/sidecar.ts` owns the sidecar process connection.
- `apps/desktop/src/components/ui.tsx` contains source-owned shadcn-style
  primitives backed by Base UI, `src/lib/utils.ts` owns class composition,
  and `src/styles.css` loads Tailwind CSS v4 and the Volo AI theme tokens.
- When the model is ready, `App.tsx` resolves the bundled `resources/seed-voices`
  directory and asks the sidecar to import its versioned manifests. The
  importer copies each reference audio file into app-local storage and creates
  the clone prompt there; SQLite records metadata, defaults, and installed
  seed versions. The Voice Profiles view can also pass a user-selected seed
  root folder through the same sidecar operation; valid seed subfolders import
  independently while skipped and invalid folders are reported. Setup is
  therefore independent of the source repository or the original sample-audio
  path.
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
requires FFmpeg and pydub, while unsupported output extensions are rejected.
The frontend `SidecarClient` gives ordinary requests a five-minute timeout and
model preparation a longer one-hour timeout; a timed-out child is terminated
so the UI can recover instead of waiting forever.

## Domains

| Domain | Current boundary |
| --- | --- |
| Speech generation | `Engine.generate`, CLI/MCP tools, and desktop `synthesize` request; desktop adds voice design and advanced OmniVoice generation config |
| Model lifecycle | `Engine.model_status`, `Engine.ensure_model`, and desktop progress events |
| Voice profiles | `Engine.save_voice`, `load_voice`, `list_voices`, and `delete_voice` |
| Seed profiles | `Engine.import_seed_voices`, the `import_seed_voices` sidecar request, and bundled seed manifests |
| Desktop settings | `App.tsx` and `i18n.ts` expose General, Model, and Storage tabs; the Model tab reports readiness for the three offline assets and the configured device/model IDs |
| Desktop shell | React UI, Tauri plugins, and the JSONL sidecar protocol |

## Data and dependencies

The engine reads `TTS_MCP_DATA_DIR`, defaulting to `~/.tts-mcp`. Model assets
are stored below its `models` directory, generated audio below `outputs`, and
the SQLite database at `volo.db`. Voice metadata lives in `voice_profiles` and
installed bundled seeds in `app_seeds`; each profile's copied reference audio
and clone prompt live under `voices/<profile-name>/`. The desktop shell passes
its Tauri app-data directory to the sidecar. Release bundles include the
native sidecar and FFmpeg, so installed users do not need Python, Node.js, or
FFmpeg; those runtimes are only development/build requirements.
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
- `apps/desktop/src-tauri/capabilities/default.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/resources/seed-voices/omnivoice-demo/manifest.json`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src/lib/sidecar.ts`
- `scripts/build_sidecar.py`
