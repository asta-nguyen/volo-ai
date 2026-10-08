# Volo AI

Local text-to-speech desktop app powered by OmniVoice. The app runs on
macOS, Windows, and Linux through Tauri, with a bundled Python sidecar for
release builds.

## Current release scope

- Download OmniVoice assets on first launch with progress feedback.
- Generate speech with an automatic voice.
- Clone a voice from a local audio file.
- Save and reuse local voice profiles.
- English and Vietnamese synthesis, with English selected by default.
- English and Vietnamese app interface, configurable in Settings.
- Preview and export WAV or MP3.
- SQLite-backed local voice profiles with portable seed manifests.
- Tailwind CSS v4 utilities with shadcn-style/Base UI primitives.

All text, audio, model files, and generated output stay local. Microphone
recording, cloud inference, batch generation, and history are outside the
current release scope.

## Requirements

- Node.js 20+
- Python 3.10+
- Rust toolchain
- FFmpeg for MP3 export during source development

## Use the MCP server

The local server uses stdio and exposes `speak`, `clone`, `design`,
`list_voices`, `save_voice`, and `delete_voice`. From the repository root,
install the project in a virtual environment:

```sh
python -m venv .venv
# macOS / Linux
.venv/bin/python -m pip install -e .
# Windows PowerShell
.venv\Scripts\python.exe -m pip install -e .
```

Use the absolute path to `.venv/bin/tts` (macOS/Linux) or
`.venv\Scripts\tts.exe` (Windows) in the client setup so it starts the same
Python environment. Replace `/absolute/path/to/tts` below with that path.

`tts mcp` starts the stdio server directly; MCP clients run that command for
you after setup.

For Codex CLI:

```sh
codex mcp add volo-tts \
  --env 'TTS_MCP_DATA_DIR=/path/copied/from/Volo AI Settings/Storage' \
  -- /absolute/path/to/tts mcp
codex mcp list
```

Replace the `TTS_MCP_DATA_DIR` value with the exact directory shown in Volo AI
under **Settings → Storage**. This makes MCP use the same voice library, model
assets, and generated-audio folder as the app. To configure an already-added
server, the equivalent `~/.codex/config.toml` entry is:

```toml
[mcp_servers.volo-tts.env]
TTS_MCP_DATA_DIR = "/path/copied/from/Volo AI Settings/Storage"
```

Without this setting, the server keeps using `~/.tts-mcp` as a separate store.
When the shared path is set, `save_voice` and `delete_voice` change the app's
voice library too; saving a profile with an existing name replaces it.

For example, ask an agent to call `list_voices` with no arguments, then pass
one of the returned profile names to `clone`:

```json
{
  "text": "Hello there.",
  "output_path": "/tmp/hello.wav",
  "voice": "My-Voice"
}
```

To use a reference audio file instead, pass its path and optionally its
transcript:

```json
{
  "text": "Hello there.",
  "output_path": "/tmp/hello.wav",
  "ref_audio_path": "/path/to/reference.wav",
  "ref_text": "Transcript of the reference"
}
```

Omit `ref_text` when the reference transcript should be detected automatically.
Saved Clone and Design profiles both work with `clone(voice=...)`; external
reference audio continues to use `ref_audio_path`.

For Claude Code:

```sh
claude mcp add --transport stdio --scope user volo-tts -- /absolute/path/to/tts mcp
claude mcp list
```

The server uses `~/.tts-mcp` for model assets, voice profiles, and generated
audio by default. Set `TTS_MCP_DATA_DIR` in the MCP client's server
environment to choose another data directory. The first generation may
download the local model assets. See the [Codex MCP guide](https://developers.openai.com/codex/mcp)
and [Claude Code MCP guide](https://code.claude.com/docs/en/mcp) for client
configuration details.

## Run the desktop app locally

From the repository root:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[mp3,desktop-vieneu]'
npm --prefix apps/desktop install
npm --prefix apps/desktop run tauri dev
```

On first launch, choose OmniVoice or VieNeu-TTS. Model assets download only
after you request them; later launches reuse installed assets from the platform
app-data directory. The bundled `OmniVoice-Demo` voice is copied into that
directory and does not depend on any repository path.

Release builds include a native Python sidecar and FFmpeg helper, so users do
not install Python, Node.js, or FFmpeg. Build the sidecar on the matching
native host before packaging for another platform.

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
python -m pip install -e '.[mp3,desktop-vieneu]'
python -m pip install -r requirements-build.txt
python scripts/build_sidecar.py \
  --ffmpeg /absolute/path/to/ffmpeg \
  --audiocpp /absolute/path/to/audiocpp_cli \
  --target <rust-target-triple>
npm --prefix apps/desktop run tauri build
```

Build audio.cpp v0.9.0 with its CPU backend on the matching host before
packaging. Linux uses `scripts/build_linux.sh --backend cpu --target
audiocpp_cli`; Windows uses
`scripts/build_windows.ps1 -Preset windows-cpu-release -Target audiocpp_cli`.
For macOS, follow the CPU-only CMake command in the pinned
[audio.cpp v0.9.0 build guide](https://github.com/0xShug0/audio.cpp/tree/v0.9.0).
The model is downloaded on first use and is not bundled into the installer.

## Repository layout

- `src/tts_mcp/` — shared engine, CLI, MCP server, and JSONL desktop sidecar
- `apps/desktop/` — React/Vite frontend and Tauri shell
- `scripts/` — sidecar packaging helpers
- `tests/` — Python unit tests
- `docs/desktop-development.md` — detailed desktop development notes
- `docs/agent-devkit/` — approved product design and implementation plan
