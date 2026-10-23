# Ship the desktop sidecar as PyInstaller onedir tasks

## Design

[Ship the desktop sidecar as PyInstaller onedir](design.md)

## Global Constraints

- The normal sidecar is PyInstaller onedir on all three targets
  (`aarch64-apple-darwin`, `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`);
  `scripts/build_sidecar.py` has no onefile mode and no `--onedir` flag. The
  optional Linux CUDA sidecar keeps its archive format.
- Spawn scope: command name `tts-sidecar`, `"cmd": "$RESOURCE/sidecar/tts-sidecar"`,
  `"sidecar": false`, args allowed as today. The frontend calls
  `Command.create("tts-sidecar", [], ...)` with the same environment
  (`TTS_MCP_DATA_DIR`, `TTS_MCP_APP_VERSION`) and the same stdin, stdout, kill
  and retry-once handling.
- Staged folder layout: `<output dir>/<sidecar name>/` holds the executable
  (`tts-sidecar`, `tts-sidecar.exe` on Windows), `_internal/`, FFmpeg as today,
  and `audiocpp-cli-<target triple>[.exe]` beside the executable. Default output
  dir `apps/desktop/src-tauri/sidecar` (git-ignored). No target-triple suffix on
  the folder name, CUDA build included (`<output dir>/tts-sidecar-cuda`).
- `bundle.resources` maps `sidecar/tts-sidecar` to `sidecar` and keeps
  `resources/seed-voices` at its current bundle path; `bundle.externalBin` is
  removed. No Python lookup code changes (`_audio_cpp_path()` is untouched).
- No change to the sidecar protocol, `status` behavior, model download, the
  optional CUDA runtime protocol, signing, notarization, or any updater.
- Release CI fails when any staged installer is 2 GiB or larger. The smoke
  script requires an `invalid_json` reply to a malformed line and then an `ok`
  reply to `status`, within 120 s, using a temporary data directory.
- Proof-of-concept gates (Task 1): the sidecar starts from the built bundle;
  warm boot is at most 2 s; the installer is below 2 GiB. If a gate fails, stop
  and report; do not continue to Task 2.

## Impact map

```text
Entry: apps/desktop/src/lib/sidecar.ts::SidecarClient.spawn (Command.sidecar at line 264); build entry .github/workflows/release.yml job "Build ${{ matrix.os }}" -> scripts/build_sidecar.py::main
Flow: SidecarClient.spawn -> @tauri-apps/plugin-shell Command -> capabilities/default.json shell:allow-spawn scope -> tauri-plugin-shell scope.rs (app.path().parse of "cmd") -> $RESOURCE/sidecar/tts-sidecar -> src/tts_mcp/desktop.py::main -> run_protocol; build: build_sidecar.py (PyInstaller onedir) -> apps/desktop/src-tauri/sidecar/tts-sidecar/ -> tauri.conf.json bundle.resources -> installers -> release-assets
State changes: none found in app data; build output apps/desktop/src-tauri/sidecar/ (git-ignored); installers grow from about 365 MB sidecar to about 1.1 GB on disk
External effects: PyInstaller and Tauri builds on three CI runners; GitHub release assets (2 GiB per-asset limit); no network or storage effects at runtime
Change candidates: apps/desktop/src-tauri/tauri.conf.json, apps/desktop/src-tauri/capabilities/default.json, apps/desktop/src/lib/sidecar.ts, scripts/build_sidecar.py, scripts/smoke_sidecar.py (new), tests/test_build_sidecar.py, .github/workflows/release.yml, .gitignore, docs/desktop-development.md, docs/llm/workflows/desktop-runtime-diagnostics.md, docs/llm/architecture/overview.md
Verification: python -m unittest discover -s tests -v; python -m compileall -q src tests; npm --prefix apps/desktop run build; cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml; Task 1 packaged-bundle checks on macOS arm64; scripts/smoke_sidecar.py against a freshly built folder; CI on three runners (not runnable here)
Verified at: a545fd5af796c2b8cc26a3f685180d612b043a24
```

## Tasks

### Task 1 — macOS proof of concept with gates

Files: `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/capabilities/default.json`, `apps/desktop/src/lib/sidecar.ts::SidecarClient.spawn`, `.gitignore`
Interfaces: produces the Tauri, capability and spawn contract that Tasks 2 to 4 rely on; consumes an existing onedir build at `/private/tmp/volo-bench/bench-onedir-aarch64-apple-darwin/` and the measuring script `/private/tmp/volo-bench/measure.py`.
Change: Make the real config edits from the Global Constraints (resources map, `externalBin` removed, capability scope with `$RESOURCE/sidecar/tts-sidecar`, `Command.create("tts-sidecar", [], ...)`, `.gitignore` entry for `apps/desktop/src-tauri/sidecar/`). Stage the proof folder by hand: copy the bench onedir folder to `apps/desktop/src-tauri/sidecar/tts-sidecar/`, rename its executable to `tts-sidecar` (if the renamed executable fails to start, rebuild with `build_sidecar.py --onedir --sidecar-name tts-sidecar --output-dir /private/tmp/volo-bench/poc` and copy that), and copy `/Applications/Volo AI.app/Contents/MacOS/audiocpp-cli` into it as `audiocpp-cli-aarch64-apple-darwin`. Build the app with an isolated identifier so it never touches real user data: `npm --prefix apps/desktop run tauri build -- --config '{"identifier":"com.voloai.sidecar-poc"}'`. Do not launch, modify or quit `/Applications/Volo AI.app`, and leave existing files under `apps/desktop/src-tauri/binaries/` alone. Launch the built app by executing `<bundle>/Contents/MacOS/volo-ai-desktop` directly in the background, remember its PID, and stop only that PID afterwards; remove `~/Library/Application Support/com.voloai.sidecar-poc` at the end. Record: warm boot and first `status` (median of runs 2 and 3 of `measure.py` against `<bundle>/Contents/Resources/sidecar/tts-sidecar`), installer size from `target/release/bundle/dmg`, the v0.2.0 macOS installer size for comparison (`gh release view v0.2.0 --repo az-forge/volo-ai --json assets`, read-only; skip if it fails), and how long a repeat `tauri build` takes after the resource folder is already copied.
Verify: (G1) the built bundle contains `Contents/Resources/sidecar/tts-sidecar` as an executable with `_internal/`, contains `Contents/Resources/resources/seed-voices`, and `Contents/MacOS` holds no `tts-sidecar` or `audiocpp-cli`; the launched app starts a process whose command path contains `Contents/Resources/sidecar/tts-sidecar` within 30 s (`pgrep -f`). (G2) warm boot at most 2 s and `status` replies `ok`. (G3) the dmg is below 2 GiB. Also `npm --prefix apps/desktop run build` and `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` pass. Covers the symlink edge case (the sidecar runs from the built bundle) and the `tauri dev` copy-time edge case (recorded rebuild time). Any gate failing stops the plan.
Progress: done
Result: all gates pass on macOS arm64. Config edits applied (`resources` map `sidecar/tts-sidecar`->`sidecar` + `resources/seed-voices` unchanged, `externalBin` removed, capability `tts-sidecar`/`$RESOURCE/sidecar/tts-sidecar`/`sidecar:false`, `Command.create("tts-sidecar", [], ...)`, `.gitignore` now `apps/desktop/src-tauri/sidecar/`). Proof folder staged 1.1 GB: bench onedir copied to `apps/desktop/src-tauri/sidecar/tts-sidecar/`, executable renamed `bench-onedir` -> `tts-sidecar` (boots: 4.87 s cold probe, `invalid_json` reply, no rebuild needed), `audiocpp-cli-aarch64-apple-darwin` copied from the installed app. `tauri build -- --config '{"identifier":"com.voloai.sidecar-poc"}'` ~1m38s. G1: bundle holds `Resources/sidecar/tts-sidecar` (Mach-O arm64, +x), `_internal/` and `audiocpp-cli-aarch64-apple-darwin` beside it; `Resources/resources/seed-voices` present; `Contents/MacOS` holds only `volo-ai-desktop`; launched app PID 20879 spawned bundled sidecar PID 22801 (path `Contents/Resources/sidecar/tts-sidecar`) in ~15 s. Bundler dereferenced all 30 `_internal` symlinks into real files; sidecar still runs from the bundle. G2: measure.py vs the bundled executable — boot 0.487/0.464/0.468 s, median of runs 2-3 ~0.466 s (<=2 s), first_status ~144-188 ms, device=mps, `status` ok, all exits 0. G3: dmg 491,274,793 B (468.5 MiB) < 2 GiB; released v0.2.0 macOS dmg is 380,773,769 B (363.1 MiB); .app 1.47 GiB on disk. Repeat `tauri build` with the folder already staged: 3m32s end-to-end (a prior repeat ran 1m29s but flaked in `bundle_dmg.sh` on an `hdiutil` unmount "Resource busy"; retry succeeded, dmg again 468.5 MiB). `npm --prefix apps/desktop run build` and `cargo check` pass; baseline `unittest discover` 241 tests OK. POC data dir `~/Library/Application Support/com.voloai.sidecar-poc` removed; app PID stopped, no stray processes.

### Task 2 — Make `build_sidecar.py` onedir-only and stage the final layout

Files: `scripts/build_sidecar.py::main`, `tests/test_build_sidecar.py`, `.github/workflows/release.yml` (CUDA sidecar steps only)
Interfaces: consumes the layout from Global Constraints; produces `<output dir>/<sidecar name>/` with `audiocpp-cli-<target triple>[.exe]` inside it, which Task 1's bundle mapping and Task 3's smoke script use.
Change: Remove the `--onedir` flag and the onefile branch; always pass `--onedir` to PyInstaller. Replace the module constant `BINARIES` with a default staging dir `apps/desktop/src-tauri/sidecar`, and copy the PyInstaller output to `<output dir>/<sidecar name>` (replace an existing folder; no target-triple suffix). When `--audiocpp` is given, copy it into that folder as `audiocpp-cli-<target triple>[.exe]` with the execute bit on non-Windows; when omitted, stage no audio.cpp file. Keep the environment check, `--collect-all` list, FFmpeg bundling, executable check and `--sidecar-name` validation. In `release.yml`, drop `--onedir` from the "Build CUDA sidecar" step and change the "Split and validate the CUDA sidecar" path to `build/cuda-runtime/tts-sidecar-cuda`. Update the three existing tests and add one Windows-naming test (no new test framework; stdlib `unittest` with the same patching style as the current tests):
- `test_builder_stages_onedir_with_audiocpp_inside_folder`: fake PyInstaller output `build/sidecar-dist/tts-sidecar/tts-sidecar/` containing `tts-sidecar` and `_internal/lib.bin`; target `aarch64-apple-darwin` with `--audiocpp`; expect `<out>/tts-sidecar/tts-sidecar`, `<out>/tts-sidecar/_internal/lib.bin`, and `<out>/tts-sidecar/audiocpp-cli-aarch64-apple-darwin` with the original bytes; the PyInstaller command contains `--onedir` and not `--onefile`; the `--collect-all` list is unchanged.
- `test_builder_names_windows_executables`: target `x86_64-pc-windows-msvc`; expect `tts-sidecar.exe` and `audiocpp-cli-x86_64-pc-windows-msvc.exe` inside the folder.
- `test_cuda_builder_can_skip_audiocpp_and_stage_outside_tauri`: sidecar name `tts-sidecar-cuda`, `--output-dir <tmp>/cuda-out`; expect `<out>/tts-sidecar-cuda/tts-sidecar-cuda`, no audio.cpp file, and the default staging dir not created.
- `test_cuda_builder_stages_onedir_output`: onedir fixture with `_internal/libtorch.so`; expect the whole tree under `<out>/tts-sidecar-cuda/` (symlinks preserved as today).
Verify: `python -m unittest tests.test_build_sidecar -v` passes (four build tests plus the three existing preflight tests); `python -m unittest discover -s tests -v` passes; `.venv/bin/python -m compileall -q src tests scripts` passes.
Progress: done
Result: `.venv/bin/python -m unittest tests.test_build_sidecar -v` — 7 tests OK (4 build + 3 preflight); `.venv/bin/python -m unittest discover -s tests` — 242 tests OK; `.venv/bin/python -m compileall -q src tests scripts` — OK. `build_sidecar.py` now always passes `--onedir`, stages `<output dir>/<sidecar name>/` (default `apps/desktop/src-tauri/sidecar`, constant `SIDECAR_DIR`), copies `audiocpp-cli-<triple>[.exe]` inside the folder with the execute bit on non-`.exe` names; `release.yml` CUDA steps updated (`--onedir` dropped, split path `build/cuda-runtime/tts-sidecar-cuda`).

### Task 3 — Smoke script, size guard and CI wiring

Files: `scripts/smoke_sidecar.py` (new), `.github/workflows/release.yml` (normal sidecar packaging steps and "Stage non-empty release bundles")
Interfaces: consumes the staged folder from Task 2; produces CI steps that fail the release before publish.
Change: Write `scripts/smoke_sidecar.py` (stdlib only): argument is the staged folder path; resolve `tts-sidecar` (`tts-sidecar.exe` on Windows) inside it; start it with stdin and stdout pipes, stderr discarded, and env `TTS_MCP_DATA_DIR` set to a fresh temporary directory and `TTS_MCP_APP_VERSION` set to `0.0.0`; send `not json`, require a reply whose JSON has `ok: false` and error code `invalid_json`; then send `{"id":"1","type":"status"}`, require `ok: true`; close stdin and require exit within 20 s; kill the process and exit 1 on any miss or when 120 s total pass. Print the elapsed seconds for each step. In `release.yml`, add a step after each of the two "Package the desktop sidecar" steps (macOS/Linux bash, Windows pwsh) that runs `python scripts/smoke_sidecar.py apps/desktop/src-tauri/sidecar/tts-sidecar`. In "Stage non-empty release bundles", fail with a clear message when a package's size is 2 GiB (2147483648 bytes) or more.
Verify: after Task 2, build the real folder on this machine with `scripts/build_sidecar.py` (default output dir, `--ffmpeg /opt/homebrew/bin/ffmpeg`, `--audiocpp /Applications/Volo AI.app/Contents/MacOS/audiocpp-cli`, `.venv/bin/python`), then run `.venv/bin/python scripts/smoke_sidecar.py apps/desktop/src-tauri/sidecar/tts-sidecar`: exit 0 with step times printed. Negative check: run it on a folder whose executable is a shell script that exits immediately: exit non-zero. Validate the workflow with `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml'))"` if PyYAML is installed (otherwise `ruby -ryaml -e 'YAML.load_file(".github/workflows/release.yml")'`). The size guard and the Windows and Linux runner steps cannot be run here (`cannot verify` locally; they run in CI).
Progress: done
Result: real folder built with `.venv/bin/python scripts/build_sidecar.py --ffmpeg /opt/homebrew/bin/ffmpeg --audiocpp "/Applications/Volo AI.app/Contents/Resources/sidecar/audiocpp-cli-aarch64-apple-darwin"` (~2.7 min; the instructed `Contents/MacOS/audiocpp-cli` no longer exists because the installed app now uses the Task 1 resource layout — same binary, read-only, from `Resources/sidecar/`). `.venv/bin/python scripts/smoke_sidecar.py apps/desktop/src-tauri/sidecar/tts-sidecar` — exit 0; invalid_json reply 5.127s, status reply 10.631s, exit 0.391s. Negative check (folder with an immediately-exiting shell-script executable): exit 1. Workflow validated with `yaml.safe_load` (PyYAML). release.yml gained per-OS smoke steps after each "Package the desktop sidecar" step and the 2 GiB (2147483648 bytes) guard in "Stage non-empty release bundles"; the guard and the Windows/Linux runner steps cannot be verified locally (they run in CI).

### Task 4 — Documentation and release checklist

Files: `docs/desktop-development.md`, `docs/llm/workflows/desktop-runtime-diagnostics.md`, `docs/llm/architecture/overview.md`
Interfaces: consumes the final behavior of Tasks 1 to 3; uses `document-wiki`'s `## Task updates` flow for the `docs/llm` pages.
Change: In `docs/desktop-development.md`, update the sidecar build section: the script always builds an onedir folder at `apps/desktop/src-tauri/sidecar/tts-sidecar/` with `audiocpp-cli-<target triple>` inside it, the Tauri build copies that folder as a resource, the stage must be rebuilt after sidecar code changes, the first launch after install is slower than later ones, and installers are about three times larger on disk. Add a short release checklist: launch a CI-built installer on Windows and on Linux (AppImage) and on a quarantined macOS download, confirm the engine comes online; if Windows cannot spawn the sidecar from the scope path, add a platform-specific capability entry naming `tts-sidecar.exe`. In the two wiki pages, update every statement that says the normal sidecar is onefile or that mentions the `test_build_sidecar` onefile default, and the overview's packaging description of `scripts/build_sidecar.py` and the Tauri bundle; run the repository's wiki validator if one exists (`docs/llm/AGENTS.md` names it).
Verify: `git diff -- docs` shows no remaining "onefile default" statement (`rg -n "onefile" docs/llm docs/desktop-development.md` returns only historical or CUDA-size remarks that are still true); the wiki validator, if present, reports 0 errors.
Progress: done
Result: `rg -n "onefile" docs/llm docs/desktop-development.md` — no matches (the remaining "single-file" remarks are historical: the legacy format-1 CUDA runtime and the previous sidecar, both still true). Wiki validator `node .agents/skills/document-wiki/scripts/validate-llm-wiki.mjs` — 7 Markdown files, 37 requirements, 0 errors, 0 warnings. `docs/desktop-development.md` updated (onedir folder at `apps/desktop/src-tauri/sidecar/tts-sidecar/` with `audiocpp-cli-<triple>` inside, Tauri copies it as a resource, rebuild after sidecar code changes, slower first launch, ~3x installer size, release checklist for Windows/Linux AppImage/quarantined macOS plus the `tts-sidecar.exe` capability fallback). `docs/llm` pages updated per `document-wiki`'s `## Task updates` (no delta to merge): overview's `build_sidecar.py` packaging description and the diagnostics page's `test_build_sidecar` coverage statement, each re-verified against the changed source/tests.

### Task 5 — Final macOS verification with the real build script

Files: none modified unless a check fails.
Interfaces: consumes Tasks 1 to 4.
Change: From a clean staging folder, run the real `scripts/build_sidecar.py` (as in Task 3), compare its layout with the Task 1 proof folder (executable name, `_internal/`, `audiocpp-cli-aarch64-apple-darwin` beside it), run `scripts/smoke_sidecar.py` on it, run `/private/tmp/volo-bench/measure.py` against its executable, and record warm boot and first `status`.
Verify: layout matches the proof folder; smoke exits 0; warm boot at most 2 s; `python -m unittest discover -s tests -v`, `python -m compileall -q src tests scripts`, `npm --prefix apps/desktop run build` and `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` pass. Covers the final proof that the real script output matches what the bundle was proven with; Windows and Linux runtime spawn stays `cannot verify` here and is covered by the Task 4 release checklist.
Progress: done
Result: clean re-stage with the real `scripts/build_sidecar.py` (~2.6 min) — layout matches the Task 1 proof folder: `apps/desktop/src-tauri/sidecar/tts-sidecar/` holds executable `tts-sidecar` (Mach-O arm64, +x), `_internal/`, and `audiocpp-cli-aarch64-apple-darwin` (+x) beside it. `scripts/smoke_sidecar.py` — exit 0 (invalid_json 5.391s, status 10.874s, exit 0.281s). `measure.py` on the staged executable — boot 0.450/0.451/0.442s (median 0.450s ≤ 2s), first_status 589-625ms ok, device=mps resolved ~1.05s, exits 0. `.venv/bin/python -m unittest discover -s tests` — 242 tests OK; `.venv/bin/python -m compileall -q src tests scripts` — OK; `npm --prefix apps/desktop run build` — built in 4.14s; `cargo check` — OK; `git diff --check` — clean. Windows/Linux runtime spawn: cannot verify locally, covered by the Task 4 release checklist.

## Files inspected, no change

- `src/tts_mcp/desktop_vieneu.py` — `_audio_cpp_path()` already resolves `audiocpp-cli-<triple>` beside `sys.executable`; `_resolve_ffmpeg()` uses `sys._MEIPASS`, which onedir also sets.
- `src/tts_mcp/desktop.py` — `main()` and the CUDA `os.execve` handoff are unaffected.
- `scripts/package_cuda_runtime.py` — takes the payload folder as an argument and does not depend on the folder's name.
- `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/build.rs` — shell plugin registration only; no sidecar path logic.
- `~/.cargo/registry/src/*/tauri-plugin-shell-2.3.6/src/scope.rs` — confirms `cmd` goes through `app.path().parse`.
- `docs/llm/INDEX.md`, `docs/agent-devkit/INDEX.md` — wiki coverage and change indexing.

## Approval Gate

Status: approved

## Decision Log

2026-10-23 — The user chose to also ignore `apps/desktop/src-tauri/binaries/` in `.gitignore` (the stale local onefile binaries there would otherwise show as untracked 387 MB files) and to unstage the index. No change to scope, behavior, interface, schema or risk; the approval gate stays `approved`.
