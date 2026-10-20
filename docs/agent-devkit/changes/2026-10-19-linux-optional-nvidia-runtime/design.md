# CPU-default Linux packages with optional NVIDIA runtime

## Goal

Keep Linux desktop installers below GitHub's per-asset limit by bundling the
CPU-only PyTorch runtime by default, while allowing users to install NVIDIA
CUDA support later from Volo AI Settings.

## Scope

- Apply the runtime choice to Linux x64 only. Keep macOS ARM64 and Windows x64
  packaging and runtime behavior unchanged.
- Keep the current self-contained PyInstaller sidecar model. Linux app bundles
  contain the CPU sidecar; an optional CUDA-enabled sidecar is distributed as
  version-matched, split assets in the same GitHub Release.
- Install the optional sidecar under the Tauri app-data directory through the
  existing JSONL sidecar connection. The app continues to work on CPU if the
  add-on is absent, outdated, damaged, or cannot use an NVIDIA GPU.
- Provide install, cancel, status, update, and remove controls in Settings.
- Keep bounded diagnostic logs locally on all desktop platforms and let users
  export a report from Logs. Reports are user initiated and are never uploaded
  automatically.
- Do not add a system Python requirement, change audio.cpp's CPU build, alter
  model downloads, or introduce an external hosting service.

## Behavior

- CPU and CUDA release builds use paired Linux constraints for the same
  supported `torch`/`torchaudio` version, with an explicit CPU or CUDA wheel
  flavor. The CPU install uses PyTorch's CPU wheel index and constrains the
  full project install so it cannot resolve back to CUDA wheels. Before
  packaging, CI asserts that `torch.version.cuda` is absent from the CPU
  environment and present in the CUDA environment. CI rejects any normal
  installer asset at or above 2,000,000,000 bytes.
- A separate Linux x64 job builds the CUDA-enabled sidecar. It writes a
  versioned manifest containing the app version, target, payload size, and
  SHA-256 values, then splits the payload into release assets smaller than
  1,900,000,000 bytes. The normal Linux installer assets contain no CUDA
  runtime. The release publisher verifies the manifest and every part before
  upload; the download website continues to expose only the normal installers.
- Linux Settings reports whether NVIDIA support is supported, installed,
  active, or needs an update. Installing downloads only the manifest and
  sidecar parts for the app's exact version from the `asta-nguyen/volo-ai`
  GitHub Release.
  The sidecar validates the version, target, filenames, sizes, and SHA-256
  values; it writes to a temporary file under app data and atomically replaces
  the installed add-on only after verification. Progress and cancellation use
  the existing sidecar request protocol. A retry starts the download again.
- Desktop diagnostics record failed requests, unhandled frontend errors,
  sidecar start/exit and stderr failures, and runtime install, CUDA
  health-check, selection, and CPU-fallback events. The Logs view shows available error
  details and offers a user-initiated JSON report with app version, OS/arch,
  runtime state, and recent diagnostic events. Unexpected exceptions include
  their type and traceback without local variables. A bounded rotating local
  log keeps errors available after restart. The report excludes request
  payloads, synthesized text, audio, and voice content; it redacts the user's
  home path.
  Clearing logs removes the local diagnostic history too. Logging failures do
  not interrupt app operations.
- Removal deletes only the optional CUDA sidecar. Installing, updating, or
  removing the runtime requires restarting the app before the active backend
  changes; Settings states this clearly.
- At startup, the bundled CPU sidecar checks for a matching installed runtime
  and runs its CUDA health check. It hands the process to that runtime only
  when the check succeeds. Otherwise it continues with the bundled CPU
  sidecar. Before handing off, it passes the app-bundled audio.cpp executable
  through `TTS_MCP_AUDIOCPP_PATH`, so the optional sidecar keeps VieNeu
  available. The selected PyTorch build then reports CUDA or CPU through the
  existing device status.
- No GitHub tag is created, moved, or pushed by this change. Runtime assets are
  published by the existing tagged release workflow.

## Edge cases

- A missing release manifest, wrong app version or target, unsafe asset name,
  failed HTTP request, cancellation, insufficient disk space, or checksum
  mismatch fails installation and removes the temporary payload. An already
  installed runtime remains intact until a verified replacement is ready.
- A missing NVIDIA device, driver, or compatible CUDA runtime makes the health
  check fail; the app stays on CPU and reports that state instead of losing
  access to synthesis. The reason is recorded in local diagnostics and can be
  included in an exported report.
- An installed runtime built for another app version is not launched. Settings
  offers the matching add-on or removal; existing models, voices, and audio
  files remain untouched.
- The publisher rejects any normal installer or CUDA part at or above its
  configured byte limit, and rejects missing or inconsistent part metadata.
- If the user's machine has no internet connection, the preinstalled CPU
  runtime remains usable; the optional add-on cannot be installed or updated.
- If local diagnostics cannot be written or exported, synthesis and runtime
  management remain available; the Logs view reports that diagnostics are
  incomplete.

## Interfaces

- Extend the desktop JSONL protocol with runtime status, install, and remove
  operations, plus cancellable download progress. Keep model provider requests
  and their result shapes unchanged.
- Pass the Tauri app version to the bundled sidecar so it can require an exact
  version match before downloading or launching the add-on.
- Preserve the path to the app-bundled audio.cpp executable when the base
  sidecar starts the optional worker; the runtime payload does not bundle a
  second audio.cpp CLI.
- Provide the optional sidecar a `--runtime-check` mode that succeeds only
  when its CUDA build can initialize an available NVIDIA device. The bundled
  CPU sidecar invokes this check before selecting the downloaded executable.
- The release manifest names only fixed-format assets in the same versioned
  GitHub Release. The downloader constructs URLs for the fixed repository and
  validates each manifest value before writing or executing a payload.
- Settings shows runtime state, download progress, cancellation, and the
  restart requirement. The add-on is visible only on Linux x64.
- All desktop platforms use the shared local diagnostics facility; Linux adds
  CUDA-specific runtime events. Export is an explicit save action and sends no
  data to the owner.

## Verification

- Unit coverage checks manifest validation, version/target mismatch, safe
  filenames, checksum failures, cancellation cleanup, atomic replacement, and
  CPU fallback when the CUDA runtime is unavailable. Diagnostics coverage
  checks error capture, bounded persistence, home-path redaction, export
  contents, clear behavior, and that a logging failure does not block work.
- Sidecar build checks confirm the CPU build uses CPU wheels and the optional
  build produces the CUDA payload without staging another Tauri app bundle.
- Release workflow checks confirm every normal installer and CUDA part stays
  below its configured limit, the manifest matches the uploaded parts, and all
  three existing platform targets remain required.
- Run the repository's Python unit suite, desktop frontend build, Tauri Rust
  check, workflow structure check, and wiki validation after implementation.
  A real CUDA execution check requires a Linux x64 machine with a supported
  NVIDIA driver and GPU; without one, that hardware path cannot be verified.
  Verify that exported diagnostics contain no request payloads or generated
  content and can be saved from the Logs view on each desktop platform.

## Related context

- [Architecture overview](../../../llm/architecture/overview.md)

## Previous work

- [Desktop release target and build corrections](../archive/2026-10-18-desktop-release-build-fixes/design.md)
- [Tagged desktop release workflow](../archive/2026-10-13-desktop-release-workflow/design.md)
