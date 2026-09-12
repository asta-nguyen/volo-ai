# Volo AI Desktop

## Development requirements

- Node.js 20 or newer
- Python 3.10 or newer
- Rust toolchain required by Tauri
- A native FFmpeg executable for MP3 export during development

The packaged app bundles its Python sidecar and FFmpeg helper. End users do
not install these runtimes.

## Run locally

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[mp3,tn]'
python -m unittest discover -s tests -v
npm --prefix apps/desktop install
npm --prefix apps/desktop run tauri dev
```

The desktop sidecar is launched by Tauri. The development launcher currently
supports the checked-in macOS Apple Silicon host target and runs
`python -m tts_mcp.desktop` from the repository source tree.

## Build the sidecar

Install the build tool, then build on the native target host:

```sh
python -m pip install -r requirements-build.txt
python scripts/build_sidecar.py --ffmpeg /absolute/path/to/ffmpeg
```

The script stages a target-named executable under
`apps/desktop/src-tauri/binaries/`. Tauri expects one executable per target;
build each of these on its matching host:

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`
- `x86_64-pc-windows-msvc`
- `x86_64-unknown-linux-gnu`

## Build the desktop app

```sh
npm --prefix apps/desktop run build
npm --prefix apps/desktop run tauri build
```

The model checkpoint, audio tokenizer, and Whisper ASR assets download on
first launch. Keep the downloaded model out of the installer and verify the
offline flow after setup.
