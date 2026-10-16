# Tagged Multi-Platform Desktop Release Workflow

## Classification

Architectural: the repository has no automated desktop release flow. This adds
a GitHub Actions subsystem that validates release tags, builds native app
packages on four operating-system runners, and publishes a GitHub Release.

## Status

Approved by the user on 2026-10-14 together with [tasks](tasks.md).

## Problem

The repository documents manual native packaging, but it has no release
workflow. Creating a desktop release therefore requires building and assembling
the Python sidecar, audio.cpp CLI, FFmpeg, and Tauri bundles separately on each
supported operating system, then publishing the outputs by hand.

## Goal

Pushing a version tag builds and publishes matching Volo AI desktop packages
for Apple Silicon macOS, Intel macOS, Windows x64, and Linux x64. A release is
published only after the source versions match the tag and all four builds and
asset uploads succeed.

## Proposed behavior

### Tag and version gate

- A push of a tag matching `v*` starts one workflow.
- The first job accepts only strict `vX.Y.Z` tags and requires the tag version
  to equal `apps/desktop/package.json::version`,
  `apps/desktop/src-tauri/Cargo.toml::package.version`, and
  `apps/desktop/src-tauri/tauri.conf.json::version`.
- A malformed tag or version mismatch fails before any platform build starts.
  Source versions are updated before the release tag is created.

### Native builds and package contents

- Build each existing target on its native GitHub-hosted runner:
  `macos-15` for `aarch64-apple-darwin`, `macos-15-intel` for
  `x86_64-apple-darwin`, `windows-2025` for `x86_64-pc-windows-msvc`, and
  `ubuntu-24.04` for `x86_64-unknown-linux-gnu`.
- Install Node.js 22, Python 3.11, Rust, FFmpeg, and each target's Tauri system
  prerequisites. Check out audio.cpp v0.9.0 and build its CPU
  `vieneu_v3_turbo` CLI using the existing platform build instructions.
- Use portable x86_64 CPU kernels for audio.cpp: `-DENGINE_ENABLE_NATIVE_CPU=OFF`
  on Intel macOS, `--native-cpu OFF` on Linux, and `-CpuArch baseline` on
  Windows. Keep the existing macOS ARM64 build settings. Portable kernels
  improve compatibility with older x86_64 PCs and may reduce inference speed
  compared with runner-native kernels.
- Install the existing Python desktop extras and build requirements, run
  `npm ci --prefix apps/desktop`, package the target Python worker and FFmpeg
  with `scripts/build_sidecar.py`, then run the existing Tauri build.
- Each matrix job uploads its target's Tauri bundles under a unique artifact
  name and fails if it produced no bundle. The release assets include the UI,
  Tauri app, Python sidecar, audio.cpp CLI, and FFmpeg. They exclude model
  weights and application data.

### Release publication and recovery

- Workflow and build jobs have `contents: read`; only the publisher has
  `contents: write`.
- The publisher waits for validation and all four builds. It creates or reuses
  a draft release, uploads every target asset with the version, operating
  system, and architecture in its filename using
  `volo-ai_<tag>_<os>_<arch>.<bundle-extension>`, then publishes the draft.
- A validation or build failure cannot publish a public release. If publishing
  fails after draft creation, the draft remains unpublished for recovery.
- Serialize runs for the same tag without cancelling an active publisher. A
  rerun may replace assets on an existing draft; it leaves an already
  published release untouched.
- Packages are unsigned and are not notarized. macOS users may see Gatekeeper
  warnings or blocks, including an “app is damaged” message on Apple Silicon.

## Boundaries

- Keep the existing Python sidecar and its JSONL protocol; Rust replaces none
  of its runtime behavior in this change.
- Build each target on its native host; do not cross-compile sidecars.
- Do not add Apple Developer ID signing, notarization, model downloads, or
  bundled app data.
- Do not create or push a release tag during implementation. The first matching
  tag run is the end-to-end release check.
- Standard hosted runner disk and runtime limits may be insufficient for the
  PyTorch sidecar and audio.cpp build; moving to larger runners may incur
  Actions costs.

## Documentation

Update the existing README release instructions and desktop development guide
to explain tag/version rules, package assets, and unsigned macOS behavior.
After source checks, update the architecture overview with the verified
release workflow. That wiki page has no `## Requirements` section, so this
change does not need a `delta.md`.

## Related context

- [Architecture overview](../../../llm/architecture/overview.md)

## Impact map

Entry: no existing source; planned entry: `.github/workflows/release.yml::validate-version`
Flow: no existing flow; planned flow: tag push → version gate → four native builds → artifact uploads → draft release → publish
State changes: GitHub Release metadata and downloadable platform assets; no local application data changes
External effects: GitHub Actions runner usage and GitHub Release creation/upload through a least-privilege `GITHUB_TOKEN`
Change candidates: `.github/workflows/release.yml`, `README.md`, `docs/desktop-development.md`, `docs/llm/architecture/overview.md`
Verification: workflow lint and diff checks; inspect version gate, native target/runner pairs, portable kernel flags, job permissions, and publish dependencies; first matching tag run must publish four non-empty asset sets
Verified at: 1e7dbce4d65754d2d5f75216240101816409ed30
