# Volo AI Desktop

## Development requirements

- Node.js 22 or newer
- Python 3.10 or newer
- Rust toolchain required by Tauri
- A native FFmpeg executable for MP3 export during development

The packaged app bundles its Python sidecar and FFmpeg helper. End users do
not install these runtimes. It also bundles the versioned voice seeds under
`apps/desktop/src-tauri/resources/seed-voices`; the first ready launch copies
seed audio and generated prompts into the platform app-data directory. From
Voice Profiles, users can also import a seed root folder containing one
subfolder per voice seed; each seed must include `manifest.json` and its
declared audio file.

## Run locally

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[mp3,desktop-vieneu]'
python -m unittest discover -s tests -v
npm --prefix apps/desktop install
npm --prefix apps/desktop run tauri dev
```

The desktop sidecar is launched by Tauri. The development launcher can use the
repository sidecar wrapper, but release packaging must use the target-named
PyInstaller executable produced below.

The first-run screen requires both OmniVoice and VieNeu-TTS to be ready before
the synthesis workspace opens. One explicit preparation action starts all
missing model downloads concurrently and reuses complete assets already in
app data. The Model tab can be reopened to inspect and install either provider;
its detailed model fields describe OmniVoice. VieNeu presets come from the
pinned local manifest, and the workspace also offers saved Clone profiles and
one-off reference files.

The React UI uses `i18next` and `react-i18next` for its English/Vietnamese
interface locale. Tailwind CSS v4 is loaded from `src/styles.css` through the
Vite plugin, while source-owned shadcn-style primitives backed by Base UI live
in `src/components/ui/`. The app uses `lucide-react` for icons and Motion
for reduced-motion-aware route and state transitions. The
Settings language is separate from the synthesis language selected in the
workspace. Settings includes General, Model, Storage, and MCP tabs. The MCP
tab generates copyable local-server setup for Codex CLI, Claude Code, Claude
Desktop, Cursor, VS Code / GitHub Copilot, and Zed. The Model tab retains
OmniVoice asset, device, model ID, and target-language details.

The optional `tn` extra is not required by the desktop release; it adds native
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
python -m pip install -e '.[mp3,desktop-vieneu]'
python -m pip install -r requirements-build.txt
python scripts/build_sidecar.py \
  --ffmpeg /absolute/path/to/ffmpeg \
  --audiocpp /absolute/path/to/audiocpp_cli \
  --target <rust-target-triple>
```

Check out audio.cpp at `v0.9.0` and build its CPU backend on the matching host.
For macOS (Apple Silicon or Intel), run from that checkout:

```sh
cmake -S . -B build/macos-cpu-release \
  -DCMAKE_BUILD_TYPE=Release \
  -DENGINE_ENABLE_CUDA=OFF \
  -DENGINE_ENABLE_VULKAN=OFF \
  -DENGINE_ENABLE_METAL=OFF \
  -DENGINE_ENABLE_OPENMP=OFF \
  -DGGML_OPENMP=OFF \
  -DAUDIOCPP_MODEL_SET=custom \
  -DAUDIOCPP_MODELS=vieneu_v3_turbo
cmake --build build/macos-cpu-release \
  --parallel "$(sysctl -n hw.logicalcpu)" \
  --target audiocpp_cli
```

Linux and Windows use these commands from the audio.cpp checkout:

```sh
scripts/build_linux.sh --backend cpu --model-set custom --models vieneu_v3_turbo --target audiocpp_cli
```

```powershell
scripts\build_windows.ps1 -Preset windows-cpu-release -ModelSet custom -Models "vieneu_v3_turbo" -Target audiocpp_cli
```

For local development, set `TTS_MCP_AUDIOCPP_PATH` to the resulting CLI path.
The release packaging script accepts that path as `--audiocpp`.

The packaging script stages target-named Python and audio.cpp executables under
`apps/desktop/src-tauri/binaries/`. Tauri expects native binaries; build each
official desktop target on its matching host:

- `aarch64-apple-darwin`
- `x86_64-pc-windows-msvc`
- `x86_64-unknown-linux-gnu`

Intel macOS is not an official Volo AI desktop packaging target. The standalone
audio.cpp CLI can still be built locally on Intel macOS.

## Build the desktop app

Tauri packages the target-named sidecars already under
`apps/desktop/src-tauri/binaries/`; it does not rebuild the Python worker.
Rebuild the sidecar after changing `src/tts_mcp/desktop.py` or its packaged
dependencies, then build the app.

### Publish a release

Prepare a desktop release by updating the repository-root `release.md` with a
short summary and selected user-facing highlights for this release only. Commit
that file and set the same `X.Y.Z` version in
`apps/desktop/package.json`, `apps/desktop/src-tauri/Cargo.toml`, and
`apps/desktop/src-tauri/tauri.conf.json` before pushing tag `vX.Y.Z`. The tag
must match all three version fields, and its commit must contain non-empty
release notes. Do not create a GitHub Release by hand; pushing the tag starts
the release workflow.

CI builds on native GitHub-hosted runners for Apple Silicon macOS
(`aarch64-apple-darwin`), Windows x64 (`x86_64-pc-windows-msvc`), and Linux
x64 (`x86_64-unknown-linux-gnu`). Intel macOS is not an official desktop
release target because the OmniVoice/PyTorch runtime dependencies cannot be
installed by the Intel build job. Each published bundle is named
`volo-ai_<tag>_<os>_<arch>.<bundle-extension>`. The workflow stages all three
target artifact sets on a draft release and publishes it only after every build
and upload succeeds. The published description comes from `release.md` in the
tagged commit. Linux installers use CPU-only PyTorch. A separate Linux x64 job
builds the optional CUDA sidecar, splits it into checksummed release assets, and
publishes its version-matched manifest with the installers. The website lists
only installer assets. A failed run can resume an existing draft; rerunning a
tag with an already published release leaves that release unchanged.

Release bundles include the native Python sidecar, the audio.cpp VieNeu CLI,
and FFmpeg. They exclude model weights and app data; users download model
assets during first-run setup. Linux users can install optional NVIDIA support
from Settings when they have a supported NVIDIA GPU and driver. This download
requires internet access, leaves CPU synthesis available while it runs, and
requires an app restart to activate or remove the runtime. GPU health failures
fall back to CPU and appear in local diagnostics. Logs keeps a bounded local
history and exports a redacted JSON report only after the user chooses Export;
it excludes request text, generated audio, and voice content. Packages are
unsigned and not notarized, so macOS Gatekeeper may warn about or block the app,
including with an “app is damaged” message on Apple Silicon. Keep using the
manual host build commands below for local packaging.

```sh
npm --prefix apps/desktop run build
npm --prefix apps/desktop run tauri build
```

The first-run screen downloads incomplete OmniVoice and VieNeu assets only
after the user starts setup, and runs those downloads concurrently. Later runs
reuse complete assets from the platform app-data directory. Keep model weights
out of the installer.
