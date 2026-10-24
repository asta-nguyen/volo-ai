# Ship the desktop sidecar as PyInstaller onedir

## Goal

Cut the desktop app's cold start from about 14 seconds to about 1 second by
shipping the Python sidecar as a PyInstaller onedir folder instead of a onefile
executable. Measured on macOS arm64 with identical sidecar code (median of warm
runs, spawn until the first `status` reply / until the device is known):

| Build | Boot to protocol loop | First `status` | Device known |
| --- | --- | --- | --- |
| onefile (shipped today, 365 MB) | 6.6 s | 7.0 s | 14.1 s |
| onedir (1.1 GB on disk) | 0.46 s | 0.16 s | 1.15 s |

The cost is a one-time slow first launch after install (about 12 s measured) and
roughly three times the installed size.

## Scope

- Apply to all three official targets: `aarch64-apple-darwin`,
  `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`.
- The normal sidecar becomes onedir everywhere. onedir is the only packaging
  mode of `scripts/build_sidecar.py`; the onefile branch and the `--onedir` flag
  are removed. The optional Linux CUDA sidecar keeps its current output and
  archive format.
- The sidecar folder ships as a Tauri bundle resource and is spawned from its
  resource path. `audiocpp-cli` moves into the same folder, so neither binary
  stays in `externalBin`.
- Release CI gains a per-installer size guard and a staged-sidecar smoke test.
- Out of scope: any change to sidecar protocol, `status` behavior, model
  download, the optional CUDA runtime protocol, signing or notarization (the
  release workflow has none today), and any in-app updater (none exists).

## Behavior

- A packaged app spawns `<resource dir>/sidecar/tts-sidecar[.exe]` through the
  existing JSONL connection with the same environment (`TTS_MCP_DATA_DIR`,
  `TTS_MCP_APP_VERSION`), stdin, stdout, kill and retry-once behavior.
- The staged folder contains the PyInstaller executable and its `_internal`
  payload, FFmpeg as today, and `audiocpp-cli-<target triple>[.exe]` beside the
  executable. `_audio_cpp_path()` already finds that name beside
  `sys.executable`, so no Python lookup code changes.
- `scripts/build_sidecar.py` stages the folder at
  `<output dir>/<sidecar name>` with no target-triple suffix, for every build;
  the default output dir is `apps/desktop/src-tauri/sidecar` (git-ignored), so
  the normal sidecar lands at `apps/desktop/src-tauri/sidecar/tts-sidecar/`.
  Packaging for a target still runs on that target's host. The CUDA build still
  stages outside Tauri, still allows skipping `--audiocpp`, and its folder
  becomes `<output dir>/tts-sidecar-cuda` (its archive format is unchanged).
- Tauri copies the staged folder into the bundle with `bundle.resources`
  (`sidecar/tts-sidecar` to `sidecar`, with `resources/seed-voices` kept at its
  current bundle path); the `externalBin` entries are removed. The `shell:allow-spawn` capability allows
  the command named `tts-sidecar` with `"cmd": "$RESOURCE/sidecar/tts-sidecar"`
  and `"sidecar": false`; the shell plugin resolves path variables in `cmd`.
- The first launch after install or update may take about 12 s; later launches
  take about 1 s on macOS arm64. Windows and Linux are not yet measured.
- Release CI fails when any staged installer is 2 GiB or larger (GitHub's
  per-asset limit) and smoke-tests the staged sidecar before publishing: it
  starts the sidecar folder and requires an `invalid_json` reply to a malformed
  line, then an `ok` reply to `status`, within 120 s.
- User data, settings, model files and saved profiles are untouched.

## Edge cases

- Tauri may dereference or mishandle symlinks in the copied folder
  (PyInstaller's macOS output contains them): the proof of concept must run the
  sidecar from the built bundle, not only from the staging folder.
- Windows: the scope path omits `.exe` so one capability file serves all
  targets. If a Windows build cannot spawn it, use a platform-specific
  capability entry that names `tts-sidecar.exe`; the task list holds that
  decision point.
- Linux AppImage mounts read-only: the sidecar must not write inside its own
  folder. PyInstaller's `_internal` payload is read-only at runtime today.
- macOS App Translocation and quarantine change the app's on-disk path and add
  a first-launch Gatekeeper check: the path comes from `$RESOURCE` at runtime;
  quarantine behavior on a downloaded installer is not verified by CI.
- Process lifetime: onefile ran a bootloader parent plus a Python child; onedir
  has a single process, so `kill` no longer risks orphaning the child.
- `tauri dev` copies the large resource folder on build; the extra copy time is
  recorded by the proof of concept. Developers must rebuild the folder after
  changing sidecar code, as they rebuild the single file today.
- An installer that reaches the size limit blocks the release; the fallback is
  to stop and reconsider (for example CPU-only trimming), not to ship a split.

## Interfaces

- `apps/desktop/src-tauri/tauri.conf.json`: `bundle.resources` maps the staged
  folder to `sidecar`; `bundle.externalBin` is removed.
- `apps/desktop/src-tauri/capabilities/default.json`: spawn scope changes from
  a sidecar entry to the resource-path command entry.
- `apps/desktop/src/lib/sidecar.ts`: `Command.sidecar(...)` becomes
  `Command.create("tts-sidecar", [], ...)`; options are unchanged.
- `scripts/build_sidecar.py`: single onedir mode, staging folder without the
  triple suffix, `audiocpp-cli-<triple>` staged inside the folder when given.
- `scripts/smoke_sidecar.py` (new, stdlib only): takes the staged folder path,
  starts its executable with a temporary data directory, and exits non-zero
  unless the invalid-line and `status` replies arrive within 120 s. One script
  serves all three CI runners.
- `.github/workflows/release.yml`: drop `--onedir` from the CUDA step and point
  its packaging step at `build/cuda-runtime/tts-sidecar-cuda`; run the smoke
  script after sidecar packaging; add the 2 GiB size guard to the bundle
  staging step. `.gitignore` ignores the staging folder and, as an addition,
  keeps ignoring `apps/desktop/src-tauri/binaries/`.
- `tests/test_build_sidecar.py`, `docs/desktop-development.md`, and the two
  `docs/llm` statements about the onefile default are updated to match.

## Verification

- Proof of concept first, on macOS arm64: build the sidecar folder, run
  `npm --prefix apps/desktop run tauri build`, launch the packaged app's
  sidecar through Tauri, and measure boot and first `status`. Gates: the
  sidecar starts from the built bundle; warm boot is at most 2 s; the installer
  is below 2 GiB. Record the installer size next to the 365 MB-sidecar baseline
  and stop for review if a gate fails.
- Unit tests (`python -m unittest discover -s tests -v`) cover the new staging
  layout, the removed flags, and the CUDA build unchanged.
- `npm --prefix apps/desktop run build` and `cargo check` pass.
- CI on all three runners builds installers, enforces the size guard, and runs
  the staged-sidecar smoke test. The Windows and Linux spawn-from-resource-path
  step cannot be proven headless; launch a CI-built installer on each OS
  before publishing and treat that as a release checklist item.

## Related context

- [Desktop runtime diagnostics](../../../../llm/workflows/desktop-runtime-diagnostics.md)
  describes the onedir CUDA sidecar and the `test_build_sidecar` coverage whose
  "onefile default" wording this change makes stale.

## Previous work

- [CPU-default Linux packages with optional NVIDIA runtime](../2026-10-19-linux-optional-nvidia-runtime/design.md)
  introduced the onedir build and the 2 GiB asset-limit constraint reused here.
- [Tagged multi-platform desktop release workflow](../2026-10-13-desktop-release-workflow/design.md)
  owns the release jobs this change extends.
