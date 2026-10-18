# Desktop Release Target and Build Corrections

## Goal

Classification: Architectural. Correct the existing desktop release workflow
and publish packages for macOS ARM64, Windows x64, and Linux x64. Stop producing
an Intel macOS desktop package because the required OmniVoice/PyTorch runtime
cannot be installed by the current Intel macOS build job.

## Scope

- Remove macOS x64 from the release build matrix and the publisher's expected
  target set; keep the other three targets unchanged.
- Run the Linux audio.cpp build helper from the `audio.cpp` checkout so its
  `cmake -S .` resolves to that project's `CMakeLists.txt`.
- Include the existing Windows `.ico` in Tauri's configured bundle icons.
- Update active release documentation in `README.md`,
  `docs/desktop-development.md`, and `docs/llm/architecture/overview.md` to
  identify Apple Silicon macOS, Windows, and Linux as supported desktop
  platforms, describe the three release targets, and state that Intel macOS is
  not an official desktop release target.
- Leave archived designs and plans unchanged as historical records.

Clarify the README's general platform statement as Apple Silicon macOS,
Windows, and Linux so it does not imply an Intel macOS desktop release.

## Behavior

- A tag release runs exactly these platform build jobs: macOS ARM64 on
  `macos-15`, Windows x64 on `windows-2025`, and Linux x64 on `ubuntu-24.04`.
- The publish check requires artifacts for those same three targets.
- The Linux audio.cpp helper runs with `audio.cpp` as its working directory;
  the later packaging step continues to find the CLI under `audio.cpp/build`.
- Tauri's bundle icon list includes both `icons/icon.png` and the existing
  `icons/icon.ico` so Windows bundling can find its required icon.
- Active documentation identifies Apple Silicon macOS, Windows, and Linux as
  supported desktop platforms; release targets are macOS ARM64, Windows x64,
  and Linux x64. It explains that no Intel macOS desktop package is produced.
  Archived artifacts continue to describe the release workflow as it existed
  when they were written.

## Edge cases

- The build matrix and publisher target set must be updated together; otherwise
  release validation will continue to require an artifact that CI no longer
  builds.
- The Linux build helper uses `cmake -S .`, so its step must execute from the
  audio.cpp checkout, not the parent repository.
- The `.ico` file already exists and is tracked. The change is to reference it
  in Tauri configuration, not regenerate it.

## Interfaces

The public release artifact set changes from four targets to three: macOS
ARM64, Windows x64, and Linux x64. No Python sidecar protocol, application
provider behavior, dependency, or runtime API changes are included.

## Verification

- `python -m json.tool apps/desktop/src-tauri/tauri.conf.json` validates the
  edited Tauri configuration.
- `git diff --check` checks the final patch formatting.
- Inspect the workflow matrix and `expected_targets` to confirm they contain
  exactly the three supported targets, and inspect the Linux step's working
  directory and Tauri's icon list.
- Update and validate the architecture overview with the repository's wiki
  validator. `actionlint` is not installed in the current environment, so the
  workflow will receive structural review and its target set will be checked
  against the publisher and active documentation. A full native build remains
  an end-to-end check for the next release tag; implementation will not create
  or push a tag.

## Related context

- [Architecture overview](../../../../llm/architecture/overview.md)

## Previous work

- [Tagged release workflow design](../2026-10-13-desktop-release-workflow/design.md)
- [Tagged release workflow tasks](../2026-10-13-desktop-release-workflow/tasks.md)
