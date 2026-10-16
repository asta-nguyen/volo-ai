# Tagged Multi-Platform Desktop Release Workflow — tasks

## Design

[Tagged Multi-Platform Desktop Release Workflow](design.md)

## Global Constraints

- Build each release target on its matching native GitHub-hosted runner; do
  not cross-compile the Python sidecar or audio.cpp CLI.
- Gate the build matrix on a strict `vX.Y.Z` tag matching all three desktop
  source version fields.
- Use portable audio.cpp CPU kernels on all three x86_64 targets; leave the
  macOS ARM64 build settings unchanged.
- Keep repository write permission in the release publisher only; publish
  after every target build and artifact upload succeeds.
- Keep packages unsigned, exclude model weights and app data, and leave an
  already published release unchanged on rerun.

## Impact map

Entry: no existing source; planned entry: `.github/workflows/release.yml::validate-version`
Flow: no existing flow; planned flow: tag push → version gate → four native builds → artifact uploads → draft release → publish
State changes: GitHub Release metadata and downloadable platform assets; no local application data changes
External effects: GitHub Actions runner usage and GitHub Release creation/upload through a least-privilege `GITHUB_TOKEN`
Change candidates: `.github/workflows/release.yml`, `README.md`, `docs/desktop-development.md`, `docs/llm/architecture/overview.md`
Verification: workflow lint and diff checks; inspect tag validation, target/runner pairs, portable flags, token permissions, and publish dependencies; first matching tag run produces all four non-empty asset sets
Verified at: 1e7dbce4d65754d2d5f75216240101816409ed30

## Approval Gate

Status: approved

## Decision Log

### D5 — Tag-triggered multi-platform releases

Question: How should CI publish the desktop builds?
Decision: A strict `vX.Y.Z` tag matching `package.json`, `Cargo.toml`, and
`tauri.conf.json` starts native builds for macOS ARM64, macOS Intel, Windows
x64, and Linux x64. CI publishes one GitHub Release only after all four builds
and asset uploads succeed. Packages ship without Apple Developer ID signing or
notarization.
Impact: Version validation gates the matrix; the release publisher alone gets
`contents: write`; assets are staged on a draft; same-tag runs are serialized;
build failures do not publish; and reruns do not replace an already published
release.
Confirmed by user: 2026-10-13

### D6 — Portable x86 CPU kernels

Question: Should CPU CLI builds target the CI runner's native instruction set
or wider x86_64 compatibility?
Decision: Build x86_64 audio.cpp CLI targets with portable kernels:
`-DENGINE_ENABLE_NATIVE_CPU=OFF` on Intel macOS, `--native-cpu OFF` on Linux,
and `-CpuArch baseline` on Windows. Leave macOS ARM64 build settings
unchanged.
Impact: Release CLIs support a wider range of PCs, with potentially slower
inference than host-native kernels. The workflow build commands are affected.
Confirmed by user: 2026-10-13

## Tasks

### Task 1 — Build and publish tagged native packages

Files:

- Create `.github/workflows/release.yml`.
- Read `apps/desktop/package.json::version`,
  `apps/desktop/src-tauri/Cargo.toml::package.version`, and
  `apps/desktop/src-tauri/tauri.conf.json::version`.
- Read `docs/desktop-development.md::Build the sidecar` and
  `docs/desktop-development.md::Build the desktop app` for the existing build
  commands.
- Read `scripts/build_sidecar.py::main` for the packaging inputs and staged
  sidecar names.

Interfaces: The `v*` tag trigger passes a strict tag/version guard before the
build matrix. Each matrix target produces a uniquely named artifact set for
the publisher. The publisher downloads all four sets and creates one GitHub
Release.

Change: Give validation and build jobs `contents: read`, and give the
publisher `contents: write`. Reject tags other than `vX.Y.Z` and reject a tag
whose version differs from any of the three source fields before starting
builds. Build `aarch64-apple-darwin` on `macos-15`,
`x86_64-apple-darwin` on `macos-15-intel`,
`x86_64-pc-windows-msvc` on `windows-2025`, and
`x86_64-unknown-linux-gnu` on `ubuntu-24.04`. Set up Node.js 22, Python 3.11,
Rust, FFmpeg, and Tauri's platform prerequisites. Check out audio.cpp v0.9.0
and build the CPU `vieneu_v3_turbo` CLI using the documented native build
commands; set `-DENGINE_ENABLE_NATIVE_CPU=OFF` on Intel macOS,
`--native-cpu OFF` on Linux, and `-CpuArch baseline` on Windows, leaving the
macOS ARM64 CPU settings unchanged. Install the existing desktop Python extras
and build requirements, run `npm ci --prefix apps/desktop`, package the
sidecar with `scripts/build_sidecar.py`, and run the Tauri build. Upload every
produced Tauri bundle with a unique target artifact name and fail if a target
produces none. The publisher stages all bundles on a draft, naming each
`volo-ai_<tag>_<os>_<arch>.<bundle-extension>`, and publishes only after all
uploads succeed. Same-tag runs do not cancel an active publisher; reruns can
replace draft assets but skip an already published release. Do not create a
tag during implementation.

Verify:

- `actionlint` accepts the workflow and `git diff --check` passes.
- Inspect that malformed or mismatched tags fail before the matrix, each
  matrix entry uses the intended native runner and target, only x86_64 jobs
  use portable CPU flags, every target uploads non-empty bundles, and publish
  depends on successful validation and all four build artifacts.
- Inspect workflow permissions and release handling: only the publisher has
  write access; failed builds cannot publish; a draft can be resumed; an
  already published release is unchanged.
- Compare the three source versions and the release guard. A successful
  matching tag run remains the end-to-end check and is not performed as part
  of implementation.

Progress: todo
Result: none

### Task 2 — Document tagged desktop releases

Files:

- Modify `README.md::Build a release app`.
- Modify `docs/desktop-development.md::Build the desktop app`.
- Update `docs/llm/architecture/overview.md::Entry points` and
  `docs/llm/architecture/overview.md::Data and dependencies` through the
  `document-wiki` Task updates procedure after source verification.

Interfaces: Release documentation describes the tag/version contract, four
target assets, bundled runtime contents, model-first-run behavior, and
unsigned macOS handling consistently with `.github/workflows/release.yml`.

Change: Document version alignment before tagging, the tag-triggered native
matrix, release asset names, included Python sidecar/audio.cpp CLI/FFmpeg, the
exclusion of model weights and app data, and unsigned macOS Gatekeeper
behavior. Keep the existing manual host build commands for local packaging.
Update the architecture overview only with behavior verified against the
completed workflow. Do not add `delta.md`; the architecture page has no
`## Requirements` section.

Verify:

- `git diff --check` passes, and all README and desktop guide commands remain
  accurate for local builds.
- Run the `document-wiki` validator for the repository and check that every
  edited wiki source path exists and internal links resolve.

Progress: todo
Result: none
