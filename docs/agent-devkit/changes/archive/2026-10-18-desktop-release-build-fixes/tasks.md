# Desktop Release Target and Build Corrections tasks

## Design

[Desktop Release Target and Build Corrections](design.md)

## Global Constraints

- Keep the existing tag validation, artifact naming, release permissions, and
  draft/publish behavior.
- Build the remaining sidecars and audio.cpp CLIs on their native runners; do
  not cross-compile them.
- Do not create or push a release tag or publish a GitHub Release during
  implementation.
- Keep the app's provider behavior and runtime dependencies unchanged on the
  remaining targets.
- Leave archived designs and plans unchanged.

## Impact map

Entry: `.github/workflows/release.yml::on.push.tags`
Flow: tag push → validate tag, versions, and release notes → build macOS ARM64,
Windows x64, and Linux x64 → upload bundles → validate expected artifacts →
publish GitHub Release
State changes: GitHub Release metadata and downloadable assets; no local app
data changes
External effects: GitHub Actions runner use and GitHub Release asset upload by
the existing release publisher
Change candidates: `.github/workflows/release.yml`,
`apps/desktop/src-tauri/tauri.conf.json`, `README.md`,
`docs/desktop-development.md`, `docs/llm/architecture/overview.md`
Verification: Tauri config JSON parsing, `git diff --check`, structural review
and static inspection of matrix/expected targets, Linux working directory,
icon list, and updated documentation; `actionlint` is unavailable here, and a
release-tag run remains the later end-to-end check
Verified at: 824ed3d23394f3bbc496fa3080ee9b101e760193

## Baseline evidence

GitHub Actions run `39108857814`: macOS ARM64 passed; macOS x64 could not
resolve the required `torch>=2.8.0`; Linux failed because `build_linux.sh`
ran from the repository root and CMake could not find its project file; Windows
failed Tauri bundling because no `.ico` was configured.

## Tasks

### Task 1 — Correct release targets and build configuration

Files:

- `.github/workflows/release.yml::build`
- `.github/workflows/release.yml::publish`
- `apps/desktop/src-tauri/tauri.conf.json::bundle`

Interfaces: The build matrix and publisher's expected target set must agree on
the three supported release targets. The Linux build step must run from the
audio.cpp checkout. Tauri's bundle configuration must expose its existing
Windows icon.

Change: Remove the macOS x64 matrix entry and remove `("macos", "x64")` from
`expected_targets`. Keep macOS ARM64, Windows x64, and Linux x64 unchanged. Set
the Linux audio.cpp build step's working directory to `audio.cpp` and invoke
`scripts/build_linux.sh` there. Add `icons/icon.ico` to the bundle icon list
while preserving `icons/icon.png`.

Verify:

- `python -m json.tool apps/desktop/src-tauri/tauri.conf.json` succeeds.
- `git diff --check` succeeds.
- Inspect the matrix and `expected_targets` to confirm both contain exactly
  macOS ARM64, Windows x64, and Linux x64; inspect that the Linux helper runs
  from `audio.cpp` and the icon list contains `icons/icon.ico`. Review the
  edited workflow structure because `actionlint` is unavailable here.

Progress: done
Result: `python -m json.tool`, Ruby YAML parsing, `git diff --check`, and static inspection passed; the matrix and publisher require the same three targets, Linux runs from `audio.cpp`, and Tauri includes the existing ICO. `actionlint` is unavailable, so GitHub-specific workflow semantics were not linted.

### Task 2 — Update active platform support documentation

Files:

- `README.md::introduction and Build a release app`
- `docs/desktop-development.md::Build the desktop app`
- `docs/llm/architecture/overview.md::Entry points`

Interfaces: README, desktop development guide, and architecture overview must
describe the same three release targets as the workflow. The README's general
OS list must specify Apple Silicon macOS, Windows, and Linux.

Change: Update active platform and release target statements to Apple Silicon
macOS, Windows, and Linux (release targets: macOS ARM64, Windows x64, and Linux
x64), and explicitly state that Intel macOS has no official desktop release
package. Keep old release designs and plans unchanged as history.

Verify:

- Search the active README, desktop development guide, and architecture
  overview for release target statements; none claim an Intel macOS release.
- Run the `document-wiki` validator for `docs/llm/` and verify all referenced
  sources and links resolve.
- `git diff --check` succeeds.
- Confirm the release workflow's target set still matches all three active
  documents. The next matching release tag is the end-to-end verification and
  will not be created during this task.

Progress: done
Result: active docs name Apple Silicon macOS, Windows, and Linux, and distinguish Intel audio.cpp CLI builds from official desktop packages. Wiki validator passed (5 Markdown files, 26 requirements, 0 errors, 0 warnings); `compileall`, the desktop frontend build, and `cargo check` passed; no workflow-specific tests were found.

## Files inspected, no change

- `pyproject.toml` — the package requires `torch>=2.8.0`, which the macOS x64
  Actions job could not resolve.
- `scripts/build_sidecar.py` — confirms native target sidecar naming and that
  the Tauri packaging path is otherwise unchanged.
- `docs/llm/AGENTS.md` and `docs/llm/INDEX.md` — wiki scope and documentation
  conventions.
- `docs/agent-devkit/changes/archive/2026-10-13-desktop-release-workflow/` —
  prior approved release design and tasks; retained as history.

## Approval Gate

Status: approved
Approved by user in conversation: 2026-10-18

## Decision Log

### D1 — Remove Intel macOS release target

Decision: Remove macOS x64 from the automated desktop release; retain macOS
ARM64, Windows x64, and Linux x64. See [decisions](decisions.md).

Impact: The build matrix, publisher's expected target set, and active release
documentation change. Runtime behavior for the remaining targets is unchanged.

Confirmed by user: 2026-10-18
