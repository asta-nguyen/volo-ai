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
python -m pip install -e '.[mp3]'
python -m unittest discover -s tests -v
npm --prefix apps/desktop install
npm --prefix apps/desktop run tauri dev
```

The desktop sidecar is launched by Tauri. The development launcher currently
supports the checked-in macOS Apple Silicon host target and runs
`python -m tts_mcp.desktop` from the repository source tree.

The React UI uses `i18next` and `react-i18next` for its English/Vietnamese
interface locale. Tailwind CSS v4 is loaded from `src/styles.css` through the
Vite plugin, while source-owned shadcn-style primitives backed by Base UI live
in `src/components/ui.tsx`. The app uses `lucide-react` for icons and Motion
for reduced-motion-aware route and state transitions. The
Settings language is separate from the synthesis language selected in the
workspace.

The optional `tn` extra is not required by the desktop MVP; it adds native
OpenFST/Pynini dependencies for text normalization.

## Format code

Install the Python development formatter with the project extras, then run:

```sh
python -m pip install -e '.[dev]'
python -m ruff format src tests
python -m ruff format --check src tests
npm --prefix apps/desktop run format
npm --prefix apps/desktop run format:check
```

Prettier formats the TypeScript, TSX, CSS, JSON, and HTML files under
`apps/desktop`; Ruff formats Python source and tests.

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
