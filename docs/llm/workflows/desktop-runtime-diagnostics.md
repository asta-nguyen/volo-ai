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

The desktop app SHALL retain bounded local diagnostic events, make Logs and user-triggered export available from first-run setup before providers are ready, and include sanitized failed-request context in home-path-redacted reports without request payloads or generated content.

#### Scenario: Open Logs during setup

- GIVEN one or more providers are not ready or the sidecar is unavailable
- WHEN the user opens Logs from first-run setup
- THEN the app opens Logs and allows an explicit export, using a frontend-only report marked incomplete when the sidecar cannot respond

#### Scenario: Export a failed request

- GIVEN a failed request has diagnostic details
- WHEN the user chooses Export
- THEN the report includes its timestamp, operation, request ID, provider and last-known setup stage or asset when available, error code, sanitized error message, elapsed time, and sanitized stack details, while excluding request payloads, synthesized text, audio, and voice content

Evidence: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/diagnostics.ts`, `apps/desktop/src/lib/sidecar.ts`, `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_diagnostics.py`, `tests/test_desktop_diagnostics.py`

## Flow

Linux x64 release CI pins CPU-only Torch and torchaudio for the normal desktop
sidecar. A separate job builds a CUDA-enabled sidecar without rebuilding the
audio.cpp CLI or Tauri bundle. The CUDA sidecar uses PyInstaller onedir mode;
the job streams its files into a gzip-compressed POSIX PAX tar archive and
splits that archive into numbered release parts under the same app-version tag.
The format-2 manifest records the archive size and SHA-256, expanded file size,
fixed entrypoint, and each part's size and SHA-256. The publisher verifies all
installer targets, required Linux installer formats, archive contents, part
sizes, and manifest hashes.

The UI passes Tauri's app version and app-data directory when it starts the
sidecar. Linux x64 Settings can request an install, cancel it, or remove the
installed runtime. The Python worker fetches only manifest and part names
constructed for that exact version from the fixed GitHub repository. It checks
the target, version, fixed part names, archive and expanded-size limits,
available disk space, and SHA-256 values while streaming the archive into a
temporary app-data directory. It rejects unsafe paths, duplicate members,
unsupported tar types, unsafe symlinks, members nested under symlinks, and a
missing or non-executable entrypoint. It allows only regular files,
directories, and safe relative symlinks. The archive is not saved as a second
full-size file. After extraction, the worker hashes the tree and moves it to a
directory named by that digest; `current.json` is atomically replaced only
after the runtime is complete and verified. Progress events use the existing
JSONL channel during download and extraction.

On the next app start, the bundled CPU sidecar checks the app version, extracted
tree hash, and CUDA health check before replacing itself with the fixed worker
entrypoint. Before handoff it passes the bundled audio.cpp path in
`TTS_MCP_AUDIOCPP_PATH`. A missing optional runtime leaves the bundled CPU
worker as the normal default. A stale, damaged, or unusable installed runtime
keeps that worker active and records the fallback reason. A legacy format-1
single-file runtime is not selected; users can install the current archive.
Install, update, and remove actions take effect after the app restarts.

The first-run setup screen can open Logs even while a provider is not ready or
the sidecar failed to start. Logs combines the sidecar request history with
frontend events from browser local storage when status data is available. When
the user chooses Export, the app sends path-redacted frontend events to the
sidecar for a combined report, then writes the JSON only to the destination
chosen in the save dialog. If the sidecar request fails, it saves only the
frontend events in an explicitly incomplete report.

## State changes

- The extracted runtime directory and `current.json` live below the Tauri
  app-data directory in `nvidia-runtime/`. The state file records the app
  version, total regular-file size, and deterministic tree SHA-256. A failed or
  cancelled download or extraction removes its staging directory and leaves the
  previously selected runtime intact.
- Python diagnostics are stored in `diagnostics.jsonl`, bounded to 500 events
  and 1 MB. Frontend diagnostics are stored separately in browser local storage,
  bounded to 500 events and 1 MB. Sidecar stderr bursts are deduplicated to one
  recorded event per five-second window, and the next recorded message notes
  how many similar messages were suppressed.
- Export creates a JSON file only at the path selected by the user. Clearing
  Logs clears both local histories.
- Failed request events retain the operation, request ID, error code and type,
  elapsed time, and, for model preparation, the provider and latest preparation
  phase and asset when available. Detailed error messages are retained for
  `status` and `prepare_model`; other request failures retain the exception type
  to limit collection of operation input.

## Side effects

- Runtime installation downloads versioned release assets from
  `az-forge/volo-ai`; it does not send app data or synthesis content.
- Reports include the app version, operating system, architecture, runtime
  state, and recent error events. Home-directory paths are redacted in messages,
  asset names, and stack details. The report excludes request payloads,
  synthesized text, audio, and voice content, and is never uploaded
  automatically.
- Logging and report collection failures do not interrupt synthesis or runtime
  operations. The Logs view marks diagnostics as incomplete when collection or
  export fails.

## Authorization & constraints

- NVIDIA runtime controls are shown only when the sidecar reports Linux x64.
- App version and target must match the downloaded format-2 manifest. Fixed
  part names, archive and expanded sizes, checksums, member paths and types, and
  the entrypoint are validated before the installed worker is selected. Archive
  and expanded file sizes are each limited to 20 GB, there can be at most
  100,000 members, and each release part is below 1.9 GB.
- A CUDA health check must initialize a CUDA-enabled Torch build, allocate on
  the device, and synchronize before startup selects the optional sidecar.
- Runtime management requires internet access; CPU synthesis remains available
  without the optional download or a compatible GPU and driver.

## Error paths

- Unsafe, missing, oversized, wrong-version, wrong-target, malformed archive,
  unsafe member, or checksum-mismatched assets fail installation and remove the
  staging directory.
- Cancellation is checked during download and extraction. A replacement is not
  made active until all parts, archive members, extracted files, and the tree
  digest pass validation; a failed replacement preserves the previous runtime.
- A failed CUDA startup health check, missing driver/device, stale version, or
  changed extracted-tree hash records a CPU fallback reason and leaves synthesis
  on the bundled worker. A missing optional runtime is the default CPU state.
- Logs remains available from first-run setup while providers are not ready or
  the sidecar is unavailable. If the sidecar cannot respond during report
  export, the app can save an explicitly incomplete frontend-only report. If the
  home directory cannot be resolved, frontend freeform messages, stack details,
  and asset names are omitted from that export and it is marked incomplete.
  Filesystem or diagnostics-store failures are surfaced in Logs.

## Tests

- `tests/test_desktop_runtime.py` checks format-2 manifest validation, version
  and target mismatch, streaming part/archive checksums, traversal and duplicate
  names, unsafe links and tar types, expanded-size limits, cancellation cleanup,
  atomic update behavior, extracted-tree tampering, legacy fallback, GPU
  health-check selection, and managed removal scope.
- `tests/test_desktop_diagnostics.py` checks bounded persistence, home-path
  redaction, failed-request context in reports, export field exclusions,
  clearing, and write failures.
- `tests/test_package_cuda_runtime.py` checks onedir PAX archiving, splitting,
  part and archive hashes, unsafe archive rejection, release target validation,
  and missing installer targets.
- `tests/test_build_sidecar.py` checks the onedir staging layout with the
  audio.cpp CLI inside the folder, Windows executable naming, and the CUDA
  build's onedir tree staged outside Tauri without audio.cpp.
- `tests/test_desktop.py` checks failed model-preparation context and JSONL
  cancellation of an optional runtime install.

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
