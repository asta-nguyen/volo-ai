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
`list_voices`, `save_voice`, `delete_voice`, `status`, and `prepare_model`.
From the repository root,
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

Volo AI's **Settings → MCP** tab generates a copyable setup command or config
for Codex CLI, Claude Code, Claude Desktop, Cursor, VS Code / GitHub Copilot,
and Zed.
It includes the app's data directory so the MCP server can share voice profiles
and model assets with the desktop app. Replace the `tts` executable placeholder
with the path from the Python environment where `tts-mcp` is installed.

For Codex CLI:

```sh
codex mcp add volo-tts \
  --env 'TTS_MCP_DATA_DIR=/path/copied/from/Volo AI Settings/Storage' \
  --env 'TTS_MCP_AUDIOCPP_PATH=/absolute/path/to/audiocpp_cli' \
  --env 'TTS_MCP_FFMPEG_PATH=/absolute/path/to/ffmpeg' \
  -- /absolute/path/to/tts mcp
codex mcp list
```

Replace the `TTS_MCP_DATA_DIR` value with the exact directory shown in Volo AI
under **Settings → Storage**. This makes MCP use the same voice library and
model assets as the app. MCP audio is written to each tool call's `output_path`.
To configure an already-added server, the equivalent `~/.codex/config.toml` entry is:

```toml
[mcp_servers.volo-tts.env]
TTS_MCP_DATA_DIR = "/path/copied/from/Volo AI Settings/Storage"
TTS_MCP_AUDIOCPP_PATH = "/absolute/path/to/audiocpp_cli"
TTS_MCP_FFMPEG_PATH = "/absolute/path/to/ffmpeg"
```

Without this setting, the server keeps using `~/.tts-mcp` as a separate store.
When the shared path is set, `save_voice` and `delete_voice` change the app's
voice library too; saving a profile with an existing name replaces it.

`TTS_MCP_AUDIOCPP_PATH` points the MCP process to the CPU `audiocpp_cli`
executable required by VieNeu. Set `TTS_MCP_FFMPEG_PATH` when FFmpeg is not on
`PATH`; VieNeu needs it for reference-audio cloning, and MP3 export also needs
FFmpeg.

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

### VieNeu-TTS

Install the optional VieNeu preprocessing package into the same Python
environment that runs `tts mcp`:

```sh
python -m pip install -e '.[desktop-vieneu]'
# Add mp3 when you also want MP3 output.
python -m pip install -e '.[desktop-vieneu,mp3]'
```

Configure `TTS_MCP_AUDIOCPP_PATH` in the MCP server environment as shown above.
Keep `TTS_MCP_DATA_DIR` pointed at the Volo AI **Settings → Storage** path to
reuse the app's VieNeu model and saved Clone profiles. Set
`TTS_MCP_FFMPEG_PATH` if FFmpeg is not available on `PATH`.

VieNeu setup is explicit. Call `status` to inspect `providers.vieneu`. On a
fresh setup, `preset_voices` is empty until the local manifest is downloaded.
Call `prepare_model` with `{"provider": "vieneu"}`, then call `status` again
to choose a preset ID from `preset_voices`. Use that ID in `speak`:

```json
{
  "text": "Xin chào, đây là giọng VieNeu.",
  "output_path": "/tmp/vieneu.wav",
  "provider": "vieneu",
  "voice": "preset",
  "preset_id": "truc_ly",
  "language": "vi"
}
```

For cloning, use a saved Clone profile name or provide a one-off reference
file. `language` accepts `en` or `vi` and defaults to English:

```json
{
  "text": "Xin chào.",
  "output_path": "/tmp/vieneu-clone.wav",
  "provider": "vieneu",
  "voice": "My-Voice",
  "language": "vi"
}
```

For a one-off reference file, omit `voice` and pass `ref_audio_path`:

```json
{
  "text": "Xin chào.",
  "output_path": "/tmp/vieneu-reference.wav",
  "provider": "vieneu",
  "ref_audio_path": "/path/to/reference.wav",
  "language": "vi"
}
```

VieNeu does not consume `ref_text` and cannot use Design profiles. Omitting
`provider` keeps existing OmniVoice behavior. VieNeu does not download assets
automatically and never falls back to OmniVoice; run `prepare_model` first.

For Claude Code:

```sh
claude mcp add --transport stdio --scope user volo-tts -- /absolute/path/to/tts mcp
claude mcp list
```

The server uses `~/.tts-mcp` for model assets, voice profiles, and generated
audio by default. Set `TTS_MCP_DATA_DIR` in the MCP client's server
environment to choose another data directory. The first OmniVoice generation
may download its local model assets; VieNeu requires an explicit
`prepare_model(provider="vieneu")` call. See the [Codex MCP guide](https://developers.openai.com/codex/mcp)
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
