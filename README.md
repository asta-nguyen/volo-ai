# Volo AI

Local text-to-speech desktop app powered by OmniVoice. The app runs on
macOS, Windows, and Linux through Tauri, with a bundled Python sidecar for
release builds.

## Current MVP

- Download OmniVoice assets on first launch with progress feedback.
- Generate speech with an automatic voice.
- Clone a voice from a local audio file.
- Save and reuse local voice profiles.
- English and Vietnamese synthesis, with English selected by default.
- English and Vietnamese app interface, configurable in Settings.
- Preview and export WAV or MP3.
- Tailwind CSS v4 utilities with SCSS component styling.

All text, audio, model files, and generated output stay local. Microphone
recording, cloud inference, voice design, batch generation, and history are
not part of the MVP.

## Requirements

- Node.js 20+
- Python 3.10+
- Rust toolchain
- FFmpeg for MP3 export during source development

## Run the desktop app locally

From the repository root:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[mp3]'
npm --prefix apps/desktop install
npm --prefix apps/desktop run tauri dev
```

On first launch, wait for the local model download to finish. Later launches
reuse the model from the platform app-data directory and work offline.

The checked-in development sidecar currently targets macOS Apple Silicon.
Build a native sidecar before packaging for another platform.

## Test

```sh
python -m unittest discover -s tests -v
python -m compileall -q src tests
npm --prefix apps/desktop run build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Manual smoke flow:

1. Open the app and confirm the first-run progress screen reaches `MODEL READY`.
2. Render an automatic English voice and play the result.
3. Switch to Vietnamese, enter Vietnamese text, and render again.
4. Choose `Clone from file`, select a short voice recording, optionally add
   its transcript, and render.
5. Save the reference as a profile, switch to `Saved profile`, and render it.
6. Export both WAV and MP3.

## Build a release app

Build the Python sidecar on the matching native host:

```sh
python -m pip install -r requirements-build.txt
python scripts/build_sidecar.py --ffmpeg /absolute/path/to/ffmpeg
npm --prefix apps/desktop run tauri build
```

Supported release targets are macOS Apple Silicon/Intel, Windows x64, and
Linux x64. The model is downloaded on first launch and is not bundled into
the installer.

## Repository layout

- `src/tts_mcp/` — shared engine, CLI, MCP server, and JSONL desktop sidecar
- `apps/desktop/` — React/Vite frontend and Tauri shell
- `scripts/` — sidecar packaging helpers
- `tests/` — Python unit tests
- `docs/desktop-development.md` — detailed desktop development notes
- `docs/agent-devkit/` — approved product design and implementation plan
