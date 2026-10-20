# CPU-default Linux packages with optional NVIDIA runtime tasks

## Design

[CPU-default Linux packages with optional NVIDIA runtime](design.md)

## Global Constraints

- Keep macOS ARM64 and Windows x64 release behavior unchanged.
- Keep Linux CPU synthesis usable when the optional runtime is missing, stale,
  damaged, or cannot use an NVIDIA GPU.
- Keep the normal Linux installer CPU-only; the CUDA payload remains a separate
  network download started from Settings.
- Keep the CPU, macOS, and Windows release targets and the website's
  installer-only asset list unchanged; the publisher still requires verified
  CUDA assets.
- Keep bounded error diagnostics locally on all desktop platforms and provide
  a user-initiated, content-safe export from the Logs view.
- Download only version-matched runtime assets from the fixed public GitHub
  repository, validate the archive and extracted tree before execution, and
  atomically select a complete replacement.
- Do not require a system Python installation or change the audio.cpp CPU
  runtime, model downloads, or hosting provider.
- Keep the existing v0.1.1 release target and run its full workflow after final
  review; do not introduce a new app version.

## Impact map

Entry: `apps/desktop/src/App.tsx::SettingsView`,
`src/tts_mcp/desktop.py::main`, and
`src/tts_mcp/desktop_runtime.py::install`
Flow: Settings → `SidecarClient.request` → desktop JSONL protocol → runtime
installer; release workflow → PyInstaller CUDA onedir output → PAX archive,
manifest, and split assets → publisher; startup → bundled CPU sidecar →
verified extracted CUDA executable and health check → `os.execve`, or CPU
fallback
State changes: Versioned, content-addressed extracted runtime directory and
`current.json` under Tauri app data; temporary staging is removed on failure;
models, voices, generated audio, and diagnostic data are unchanged
External effects: Versioned GitHub Release asset downloads; GitHub Actions
builds and publishes CPU installers and split CUDA archive assets
Change candidates: `.github/workflows/release.yml::build-cuda-runtime`,
`.github/workflows/release.yml::publish`, `scripts/build_sidecar.py::main`,
`scripts/package_cuda_runtime.py`, `src/tts_mcp/desktop_runtime.py`,
`src/tts_mcp/desktop.py::main`, `tests/test_build_sidecar.py`,
`tests/test_package_cuda_runtime.py`, `tests/test_desktop_runtime.py`,
`tests/test_desktop.py`, `docs/desktop-development.md`,
`docs/llm/workflows/desktop-runtime-diagnostics.md`
Verification: Focused builder, archive, runtime, and protocol tests; full
Python unit suite; archive and release asset verification; wiki validation;
full v0.1.1 release workflow; CUDA hardware smoke check only when a compatible
NVIDIA host is available
Verified at: dcd3d9853cc85e8796a516509454d9c68ece57a1

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

### Task 5 — Build and publish the CUDA runtime as an onedir archive

Files: `.github/workflows/release.yml::build-cuda-runtime`,
`.github/workflows/release.yml::publish`, `scripts/build_sidecar.py::main`,
`scripts/package_cuda_runtime.py::main`,
`tests/test_build_sidecar.py::SidecarBuildTests`,
`tests/test_package_cuda_runtime.py`
Interfaces: Keep the CPU sidecar's onefile build and existing release targets.
The CUDA build produces a Linux x64 onedir directory; packaging produces a
gzip-compressed POSIX PAX tar rooted at `runtime/`, with the fixed executable
at `runtime/tts-sidecar-cuda`. A format-2 manifest records archive size,
archive SHA-256, expanded size, entrypoint, and part metadata.
Change: Add explicit onedir output support to the sidecar builder without
changing its default. Package and split the CUDA directory into fixed-name
parts below 1,900,000,000 bytes. Extend asset verification to validate the
manifest, archive member types and paths, expanded-size metadata, executable
entrypoint, all part hashes, and the whole archive hash. Keep CUDA verification
required by the existing publisher and leave website installer filtering
unchanged.
Verify: Run the focused builder and package tests. Verify synthetic onedir
fixtures create and validate a format-2 archive, reject unsafe archives, split
and recombine under the per-asset limit, and produce matching part and archive
hashes. The requested tagged release run verifies the real CUDA build and
publisher path.
Progress: done
Result: Builder and package tests under Python 3.10 and `.venv` Python 3.12 —
onedir staging preserves the CPU onefile default, format-2 PAX archives split
below the part limit, verify archive and part hashes, and reject unsafe members,
symlinks, and size mismatches. Compression uses `gzip.GzipFile` so the stream
writer works with the repository's Python 3.10 minimum.

### Task 6 — Stream, safely extract, and select the CUDA runtime

Files: `src/tts_mcp/desktop_runtime.py::_validate_manifest`,
`src/tts_mcp/desktop_runtime.py::install`,
`src/tts_mcp/desktop_runtime.py::_read_installed`,
`src/tts_mcp/desktop_runtime.py::select`,
`src/tts_mcp/desktop_runtime.py::remove`,
`src/tts_mcp/desktop.py::main`,
`tests/test_desktop_runtime.py::DesktopRuntimeTests`,
`tests/test_desktop.py`
Interfaces: Preserve the existing JSONL install/status/remove requests,
progress, cancellation, and CPU fallback. Change the downloaded payload from a
single executable to the format-2 tar archive and return the extracted
CUDA executable path to the unchanged process handoff.
Change: Stream fixed-name release parts through per-part and whole-archive
hash checks into a validated tar reader; do not stage a second complete
archive. Enforce archive size, 20 GB expanded size, 100,000 member limit,
unique relative paths below `runtime/`, and a regular executable at the
manifest's fixed entrypoint. Reject absolute or parent-traversal paths,
duplicate names, hard links, devices, FIFOs, unsafe or escaping symlinks, and
members nested under symlinks. Extract only regular files, directories, and
safe relative symlinks into a temporary app-data directory; ignore archive
ownership and apply safe permissions. Check available space before download
and enforce expanded size during extraction. Hash the completed tree
deterministically, move it to its content-addressed directory, and atomically
update `current.json` only after every check passes. Keep the prior runtime on
download, cancellation, extraction, or state-write failure. Recompute the
tree hash and run the CUDA health check before each handoff; an old format-1
single-file runtime stays on CPU until the user installs the current format.
Removal deletes only managed runtime trees, their state file, and legacy
content-addressed `.bin` files.
Verify: Run focused runtime and protocol tests for valid installation,
wrong-version/target/part data, archive and tree size caps, traversal,
duplicate names, unsafe symlinks, unsupported tar members, missing or
non-executable entrypoint, insufficient space, cancellation during download
and extraction, checksum/tamper detection, failed replacement preserving the
previous runtime, healthy CUDA selection, legacy fallback, CPU fallback, and
managed-only removal. Confirm temporary files are removed on every failure.
Progress: done
Result: Focused builder, archive, runtime, and protocol suite — 67 tests passed;
streaming install, archive validation, extracted-tree tamper detection, CPU
fallback, cancellation cleanup, and failed-update preservation passed.

### Task 7 — Document the archive-based runtime

Files: `docs/desktop-development.md::Publish a release`,
`docs/llm/workflows/desktop-runtime-diagnostics.md::Flow`,
`docs/llm/workflows/desktop-runtime-diagnostics.md::State changes`,
`docs/llm/workflows/desktop-runtime-diagnostics.md::Error paths`,
`docs/llm/workflows/desktop-runtime-diagnostics.md::Tests`
Interfaces: Developer release instructions and the verified runtime wiki
describe the same onedir archive, streamed installation, app-data state, and
integrity behavior as source.
Change: Document that the CUDA CI job archives the onedir worker, while Linux
Settings streams and validates the optional runtime into app data. Keep the
user-facing CPU-default behavior and website installer list unchanged. Update
the wiki only from implemented source and tests; keep internal links relative.
Verify: Run the wiki validator and `git diff --check`; confirm each updated
claim matches source and test evidence and every index/link target resolves.
Progress: done
Result: `rtk node .agents/skills/document-wiki/scripts/validate-llm-wiki.mjs /Users/nus/projects/tts-mcp` validated 6 Markdown files and 28 requirements with 0 errors and 0 warnings; `rtk git diff --check` passed. Desktop release instructions and the runtime wiki now match the format-2 onedir archive and streaming installer.

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
- `docs/llm/AGENTS.md` — wiki verification and source-grounding rules.
- `docs/llm/architecture/overview.md` — high-level desktop runtime and release
  flow; its claims remain valid for the proposed change.
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

### D2 — Package the CUDA worker as an onedir archive

Question: How should the optional CUDA worker avoid PyInstaller's 4 GiB
onefile CArchive limit while remaining downloadable after app installation?
Decision: Proposed PyInstaller onedir output in a PAX tar archive, split into
versioned release parts. The app streams, verifies, safely extracts, and
content-addresses the runtime under app data before selecting its executable.
Impact: Changes the CUDA build output, release manifest format, archive trust
boundary, app-data state shape, runtime selection, and runtime documentation.
Approval: Approved by the user's `implement-task` instruction after the revised
design and tasks were presented together on 2026-10-20.
