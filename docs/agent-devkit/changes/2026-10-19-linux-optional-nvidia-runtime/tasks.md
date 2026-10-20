# CPU-default Linux packages with optional NVIDIA runtime tasks

## Design

[CPU-default Linux packages with optional NVIDIA runtime](design.md)

## Global Constraints

- Keep macOS ARM64 and Windows x64 release behavior unchanged.
- Keep Linux CPU synthesis usable when the optional runtime is missing, stale,
  damaged, or cannot use an NVIDIA GPU.
- Keep bounded error diagnostics locally on all desktop platforms and provide
  a user-initiated, content-safe export from the Logs view.
- Download only version-matched runtime assets from the fixed public GitHub
  repository, validate them before execution, and replace installed files
  atomically.
- Do not require a system Python installation or change the audio.cpp CPU
  runtime.
- Do not create, move, or push a Git tag or publish a release during this
  change.

## Impact map

Entry: `apps/desktop/src/App.tsx::SettingsView` and
`src/tts_mcp/desktop.py::dispatch_request`
Flow: Settings → `SidecarClient.request` → desktop JSONL protocol → runtime
installer; startup → bundled CPU sidecar → verified optional CUDA sidecar when
the app version matches and the NVIDIA health check passes → existing engine
device detection
State changes: Optional sidecar and its version metadata under the Tauri
app-data directory; no changes to models, voices, or generated audio
External effects: Versioned GitHub Release asset downloads; GitHub Actions
builds and uploads the CPU installers and split CUDA sidecar assets
Change candidates: `.github/workflows/release.yml`,
`requirements-linux-cpu.txt`, `requirements-linux-cuda.txt`,
`scripts/build_sidecar.py`, `src/tts_mcp/desktop.py`,
new `src/tts_mcp/desktop_runtime.py`,
`tests/test_desktop.py`, `tests/test_build_sidecar.py`,
`apps/desktop/src/lib/sidecar.ts`, new desktop diagnostics helper and tests,
`apps/desktop/src/App.tsx`, `apps/desktop/src/lib/i18n.ts`,
`apps/desktop/src-tauri/capabilities/default.json`, `README.md`,
`docs/desktop-development.md`,
`docs/llm/architecture/overview.md`
Verification: Python unit suite; desktop frontend build; Tauri Rust check;
workflow asset-size and manifest checks; diagnostics export/privacy checks;
wiki validation; CUDA hardware smoke check only when a compatible NVIDIA host
is available
Verified at: ed2728a9892667e6204aca84ec77b25809668f97

## Baseline before source edits

- `python -m unittest discover -s tests -v` — failed before changes: 103 tests
  passed; `tests/test_server.py` failed to import `mcp.client.Client` from the
  installed `mcp` package.
- `python -m compileall -q src tests` — passed.
- `npm --prefix apps/desktop run build` — passed with the existing Vite
  chunk-size warning.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` — passed.

## Tasks

### Task 1 — Build and publish CPU-default Linux packages plus CUDA assets

Files: `.github/workflows/release.yml::build`,
`.github/workflows/release.yml::publish`, `requirements-linux-cpu.txt`,
`requirements-linux-cuda.txt`, `scripts/build_sidecar.py::main`
Interfaces: The existing Linux build continues to produce the three normal
Tauri installers. A separate CUDA sidecar job uploads a manifest and bounded
payload parts for the same release tag.
Change: Add paired Linux-only constraints for matching CPU and CUDA
`torch`/`torchaudio` versions. Use the CPU wheel index for the base sidecar and
constrain the full editable install; fail the build unless only CPU torch is
present. Add a separate Linux x64 CUDA sidecar build that does not rebuild
audio.cpp or a second Tauri app, verifies it contains CUDA torch, splits its
output below 1,900,000,000 bytes per part, and generates per-part and whole-file
SHA-256 metadata. Include these assets in publishing while requiring the
existing macOS ARM64, Windows x64, and Linux x64 installer targets. Reject
empty, oversized, missing, or manifest-mismatched assets. Keep auxiliary
runtime assets out of the public website's installer list.
Verify: Inspect the release target set and both dependency installation paths;
run the release asset validator on generated CPU and CUDA assets; confirm each
file is below its configured limit and rebuilding the manifest from the parts
matches the payload's whole-file hash. Check that the staged website release
parser ignores the auxiliary assets. A full tagged release is not created in
this task.
Progress: done
Result: Paired CPU/CUDA constraints, separate CUDA build, chunking and merged-release validation are implemented. `rtk python -m unittest tests.test_package_cuda_runtime tests.test_build_sidecar -v` passed, and the release workflow parsed with the publish job validating merged assets and the CUDA job validating its parts. No tagged release or upload was run.

### Task 2 — Install, validate, select, and remove the optional runtime

Files: `src/tts_mcp/desktop_runtime.py`,
`src/tts_mcp/desktop.py::dispatch_request`,
`src/tts_mcp/desktop.py::run_protocol`, `tests/test_desktop.py`
Interfaces: Add status, install, and remove requests with cancellable progress.
The sidecar receives the current app version through its environment. The
bundled CPU worker remains the launch entry point and starts the installed CUDA
worker only after a version check and successful CUDA health check.
Change: Use Python standard-library HTTP and hashing support to fetch the
fixed-version manifest and parts, validate trusted paths/target/version/size,
verify SHA-256, install via a temporary file and atomic replacement, and clean
partial downloads on failure or cancellation. Preserve an existing valid
runtime until its replacement is verified. Fall back to the CPU worker when
the runtime is absent, stale, or unusable. Before a successful handoff, pass
the app-bundled audio.cpp path in `TTS_MCP_AUDIOCPP_PATH`. Removal affects only
the optional runtime file. Record runtime download, validation, CUDA health,
selection, and CPU-fallback events in the shared local diagnostics facility;
avoid request payloads and generated content.
Verify: Run focused sidecar tests for invalid manifests, wrong tag/target,
traversal filenames, bad hashes, cancellation, failed replacement, stale
runtime, successful CUDA health check, and CPU fallback. Verify each relevant
runtime failure produces a useful diagnostic event and a diagnostics write
failure does not fail the runtime request. Run the existing desktop protocol
tests and full Python unit suite.
Progress: done
Result: Runtime install, cancellation, checksum validation, CPU fallback, failed executable handoff, and diagnostic privacy are covered by the focused suite (63 tests passed). The full Python suite passed in the project environment (`rtk .venv/bin/python -m unittest discover -s tests -v`: 144 tests). The earlier import failure came from the system Python's MCP 1.27.2; the project `.venv` uses MCP 2.3.0. A physical Linux NVIDIA GPU was unavailable for hardware execution.

### Task 3 — Add runtime controls to desktop Settings

Files: `apps/desktop/src/lib/sidecar.ts::SidecarClient`,
`apps/desktop/src/App.tsx::SettingsView`,
`apps/desktop/src/lib/i18n.ts`
Interfaces: Type the new sidecar requests, status result, and progress events.
Settings exposes runtime state and install/cancel/update/remove actions on
Linux x64 only.
Change: Pass Tauri's app version when launching the sidecar. Show download
progress and failures, keep CPU available while downloading, refresh state
after completion, and clearly require an app restart to activate or remove the
CUDA worker. Add a bounded local diagnostics log covering failed requests,
unhandled frontend errors, and process failures across supported desktop
platforms, including a startup GPU fallback reason. Add an Export diagnostics
action in Logs that saves a redacted JSON
report with app/platform/runtime metadata and recent error events; make Clear
logs clear persisted diagnostics. Add English and Vietnamese copy.
Verify: Run the desktop frontend build; inspect both locale strings and the
Linux-only runtime controls; confirm diagnostics export works on all desktop
platforms, excludes text/audio/request payloads, redacts the home path, and
macOS and Windows Settings remain unchanged.
Progress: done
Result: `rtk npm --prefix apps/desktop run build` and Prettier checks passed. The build retains the existing Vite chunk-size warning. Runtime controls are gated by Linux x64 status; the Logs implementation uses the native save dialog and bounded diagnostics store.

### Task 4 — Document Linux runtime choices

Files: `README.md::desktop release documentation`,
`docs/desktop-development.md::Publish a release`,
`docs/llm/architecture/overview.md::Data and dependencies`
Interfaces: User-facing setup documentation and verified architecture wiki
must describe the same CPU-default and optional NVIDIA behavior.
Change: Document that Linux installers bundle CPU PyTorch, NVIDIA support is
installed later from Settings and requires a compatible GPU/driver and
internet, and installation takes effect after restarting the app. Document
local-only, user-exported diagnostic reports and their content exclusions.
Update the wiki from implemented source only; keep the existing wiki index
links intact.
Verify: Run the repository wiki validator; inspect docs for consistent
platform behavior and links; run `git diff --check`.
Progress: done
Result: README, desktop release docs, and the verified architecture wiki describe CPU-default Linux, optional NVIDIA installation, CPU fallback, and local user-exported reports. The wiki validator reported 0 errors and 0 warnings; `rtk git diff --check` passed.

## Files inspected, no change

- `pyproject.toml` — confirms PyTorch and torchaudio are current base
  dependencies and can resolve differently by platform/index.
- `src/tts_mcp/engine.py` — owns automatic CUDA/MPS/CPU device detection.
- `src/tts_mcp/desktop_vieneu.py` — resolves the bundled audio.cpp executable
  relative to the active sidecar or `TTS_MCP_AUDIOCPP_PATH`.
- `apps/desktop/src/lib/sidecar.ts` — launches the target-named Tauri sidecar,
  passes app-data location, and already supports cancellable long requests.
- `apps/desktop/src/App.tsx::LogsView` — shows up to 500 request events in
  memory for the current session; it has no persistent error log or export.
- `apps/desktop/src-tauri/capabilities/default.json` — app permissions for
  dialogs and filesystem access, to review for the user-selected report path.
- `apps/desktop/src/App.tsx` and `apps/desktop/src/lib/i18n.ts` — own Settings
  and bilingual copy.
- `apps/web/lib/releases.ts` — the staged website changes filter platform
  installer names and formats; auxiliary CUDA assets are ignored.
- `docs/llm/AGENTS.md` and `docs/llm/architecture/overview.md` — wiki rules and
  the existing desktop/release behavior to update after implementation.
- `docs/agent-devkit/changes/archive/2026-10-18-desktop-release-build-fixes/`
  — prior release fix scope and verification.

## Approval Gate

Status: approved

## Decision Log

### D1 — CPU default with optional NVIDIA support on Linux

Question: Which Linux compute runtime should ship by default?
Decision: Bundle CPU support by default and let users install NVIDIA support
after installing the app.
Impact: Requires a split CUDA sidecar release payload, runtime management in
the desktop sidecar, Linux Settings controls, and release documentation.
Confirmed by user: 2026-10-19
