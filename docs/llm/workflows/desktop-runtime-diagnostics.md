# Desktop runtime and diagnostics

## Requirements

### DSET-linux-nvidia-runtime

The desktop app SHALL keep Linux x64 on its bundled CPU runtime by default and
offer a version-matched optional NVIDIA CUDA sidecar that falls back to CPU
when the installed sidecar cannot pass its CUDA health check.

#### Scenario: CUDA runtime is unavailable

- GIVEN an installed optional runtime is stale, damaged, or cannot initialize CUDA
- WHEN the bundled Linux sidecar starts
- THEN the app remains available on CPU and records the fallback reason locally

Evidence: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/sidecar.ts`, `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_runtime.py`, `tests/test_desktop.py`, `tests/test_desktop_runtime.py`

### DSET-local-diagnostics

The desktop app SHALL keep bounded local diagnostic events and export a
home-path-redacted report only after the user chooses Export.

#### Scenario: A user exports an error report

- GIVEN local desktop errors or runtime events have been recorded
- WHEN the user exports diagnostics from Logs
- THEN the saved JSON contains app, platform, runtime, and error details without request payloads, synthesized text, audio, or voice content

Evidence: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/diagnostics.ts`, `apps/desktop/src/lib/sidecar.ts`, `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_diagnostics.py`, `tests/test_desktop_diagnostics.py`

## Flow

Linux x64 release CI pins CPU-only Torch and torchaudio for the normal desktop
sidecar. A separate job builds a CUDA-enabled sidecar without rebuilding the
audio.cpp CLI or Tauri bundle. It publishes a manifest and numbered payload
parts under the same app-version tag. The publisher verifies all installer
targets, required Linux installer formats, part sizes, and the manifest hashes.

The UI passes Tauri's app version and app-data directory when it starts the
sidecar. Linux x64 Settings can request an install, cancel it, or remove the
installed runtime. The Python worker fetches only manifest and part names
constructed for that exact version from the fixed GitHub repository. It checks
the target, version, fixed part names, size limits, available disk space, and
SHA-256 values before writing a content-addressed executable. It atomically
replaces the runtime state file only after the payload is complete. Progress
events use the existing JSONL channel.

On the next app start, the bundled CPU sidecar checks the app version, payload
hash, and CUDA health check before replacing itself with the optional worker.
Before handoff it passes the bundled audio.cpp path in
`TTS_MCP_AUDIOCPP_PATH`. A missing optional runtime leaves the bundled CPU
worker as the normal default. A stale, damaged, or unusable installed runtime
keeps that worker active and records the fallback reason. Install, update, and
remove actions take effect after the app restarts.

## State changes

- The optional executable and `current.json` live below the Tauri app-data
  directory in `nvidia-runtime/`. The state file points to a payload named by
  its SHA-256 digest. A failed or cancelled download removes its temporary file
  and leaves the previously selected runtime intact.
- Python diagnostics are stored in `diagnostics.jsonl`, bounded to 500 events
  and 1 MB. Frontend and process diagnostics are stored separately in bounded
  browser local storage.
- Export creates a JSON file only at the path selected by the user. Clearing
  Logs clears both local histories.

## Side effects

- Runtime installation downloads versioned release assets from
  `asta-nguyen/volo-ai`; it does not send app data or synthesis content.
- Reports include the app version, operating system, architecture, runtime
  state, and recent error events. Home-directory paths are redacted. The report
  excludes request payloads, synthesized text, audio, and voice content, and is
  never uploaded automatically.
- Logging and report collection failures do not interrupt synthesis or runtime
  operations. The Logs view marks diagnostics as incomplete when collection or
  export fails.

## Authorization & constraints

- NVIDIA runtime controls are shown only when the sidecar reports Linux x64.
- App version and target must match the downloaded manifest. Manifest names,
  file sizes, and checksums are validated before the installed worker is
  selected. The payload limit is 20 GB and each release part is below 1.9 GB.
- A CUDA health check must initialize a CUDA-enabled Torch build, allocate on
  the device, and synchronize before startup selects the optional sidecar.
- Runtime management requires internet access; CPU synthesis remains available
  without the optional download or a compatible GPU and driver.

## Error paths

- Unsafe, missing, oversized, wrong-version, wrong-target, or checksum-mismatched
  assets fail installation and remove the temporary download.
- Cancellation is checked between download chunks. A replacement is not made
  active until all parts pass validation.
- A failed CUDA startup health check, missing driver/device, stale version, or
  changed payload hash records a CPU fallback reason and leaves synthesis on
  the bundled worker. A missing optional runtime is the default CPU state.
- If the sidecar cannot respond during report export, the app can save an
  explicitly incomplete frontend-only report. Filesystem or diagnostics-store
  failures are surfaced in Logs.

## Tests

- `tests/test_desktop_runtime.py` checks manifest validation, version and target
  mismatch, traversal names, checksums, cancellation cleanup, atomic update
  behavior, stale runtime fallback, GPU health-check selection, and removal
  scope.
- `tests/test_desktop_diagnostics.py` checks bounded persistence, home-path
  redaction, export field exclusions, clearing, and write failures.
- `tests/test_package_cuda_runtime.py` checks splitting, part and whole-file
  hashes, release target validation, and missing installer targets.
- `tests/test_build_sidecar.py` checks the normal paired binaries and the
  CUDA-sidecar build without audio.cpp staging.
- `tests/test_desktop.py` checks JSONL cancellation of an optional runtime
  install.

## Related

- [Architecture overview](../architecture/overview.md)

## Sources

- `.github/workflows/release.yml`
- `requirements-linux-cpu.txt`
- `requirements-linux-cuda.txt`
- `scripts/build_sidecar.py`
- `scripts/package_cuda_runtime.py`
- `src/tts_mcp/desktop.py`
- `src/tts_mcp/desktop_runtime.py`
- `src/tts_mcp/desktop_diagnostics.py`
- `tests/test_build_sidecar.py`
- `tests/test_package_cuda_runtime.py`
- `tests/test_desktop.py`
- `tests/test_desktop_runtime.py`
- `tests/test_desktop_diagnostics.py`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/sidecar.ts`
- `apps/desktop/src/lib/diagnostics.ts`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src-tauri/capabilities/default.json`
