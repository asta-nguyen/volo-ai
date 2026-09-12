# Local TTS Desktop App — Execution Plan

## Approved design

[Local TTS Desktop App design](../specs/2026-09-12-local-tts-desktop-app-design.md)

## Task 1 — Bootstrap the Tauri desktop shell

Files: create `apps/desktop/package.json`, `apps/desktop/index.html`,
`apps/desktop/tsconfig.json`, `apps/desktop/vite.config.ts`,
`apps/desktop/src/main.tsx`, `apps/desktop/src/App.tsx`,
`apps/desktop/src/styles.css`, `apps/desktop/src-tauri/Cargo.toml`,
`apps/desktop/src-tauri/src/lib.rs`,
`apps/desktop/src-tauri/tauri.conf.json`, and
`apps/desktop/src-tauri/capabilities/default.json`; add the current-host
development launcher `apps/desktop/src-tauri/binaries/tts-sidecar-aarch64-apple-darwin`.

Interfaces: establish the Tauri 2 + React + TypeScript + Vite project that
later tasks use; configure the shell, dialog, filesystem, path, and shell
plugins with least-privilege permissions.

Change: create a buildable desktop shell with an accessible empty app surface,
an `externalBin` entry for `binaries/tts-sidecar`, and no network service.
Use npm scripts `dev`, `build`, and `tauri` and pin the frontend engine to
Node.js 20+ through the package `engines` field.

Verify: run `node --version`, `npm install --prefix apps/desktop`,
`npm --prefix apps/desktop run build`, and
`cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`.

Files inspected, no change: `src/tts_mcp/cli.py`,
`src/tts_mcp/server.py`, `src/tts_mcp/engine.py`.

Steps:

1. Create the Tauri project files, least-privilege plugin capabilities, and a
   macOS development launcher that invokes `python -m tts_mcp.desktop`.
2. Run `npm install --prefix apps/desktop` to resolve the approved frontend
   dependencies.
3. Run `npm --prefix apps/desktop run build` and
   `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`.

## Task 2 — Add model lifecycle, language, validation, and audio contracts

Files: modify `pyproject.toml:1-31`,
`src/tts_mcp/engine.py:14-174`, and
`src/tts_mcp/convert.py:8-51`; create `tests/test_engine.py` and
`tests/test_convert.py`.

Interfaces: define `Engine.model_status()`,
`Engine.ensure_model(on_progress=None, should_cancel=None)`, and the optional
`Engine.generate(..., language=None)` parameter for the sidecar. Define
`save_audio(..., ffmpeg_path=None)` while keeping existing callers valid.

Change: make the Python package install OmniVoice, Hugging Face Hub, PyTorch,
torchaudio, and pydub for the local app, align `requires-python` to `>=3.10`,
and retain the existing `tn` extra. Download these assets into the app data
directory using resumable `snapshot_download`: `k2-fsa/OmniVoice`,
`eustlb/higgs-audio-v2-tokenizer`, and
`openai/whisper-large-v3-turbo`. Write a ready marker only after all assets
exist, and load OmniVoice from local paths with ASR preloaded so cloning
without a transcript remains offline.

Forward `language` only when supplied so CLI/MCP behavior remains
backward-compatible. Validate `en` and `vi` at the desktop boundary, reject
path traversal in voice names, and reject MP3 export when pydub or the
resolved FFmpeg executable is unavailable instead of silently changing the
file extension.

Verify: use stdlib `unittest` with fake model/download functions to assert
English/Vietnamese forwarding, invalid-language rejection, atomic model-ready
state, cancellation callback behavior, safe profile names, and explicit MP3
failure. Run `python -m unittest discover -s tests -v`.

Files inspected, no change: `src/tts_mcp/cli.py` and
`src/tts_mcp/server.py`; their existing calls remain valid through optional
parameters.

Steps:

1. Write the failing `unittest` cases for language forwarding, model state,
   profile-name validation, and MP3 failure.
2. Run `python -m unittest discover -s tests -v` and record the expected
   failures.
3. Add the approved runtime dependencies and Python 3.10 minimum in
   `pyproject.toml`.
4. Implement model asset paths, resumable download callbacks, atomic ready
   markers, cancellation checks, and local-only OmniVoice loading in
   `engine.py`.
5. Add the optional language forwarding and profile-name validation to
   `engine.py`.
6. Add explicit FFmpeg resolution/error handling to `convert.py`.
7. Run `python -m unittest discover -s tests -v` and require zero failures.

## Task 3 — Implement the Python JSONL sidecar

Files: create `src/tts_mcp/desktop.py` and `tests/test_desktop.py`.

Interfaces: consume newline-delimited requests on stdin and emit newline-
delimited responses on stdout. Requests are:

```json
{"id":"1","type":"status"}
{"id":"2","type":"prepare_model"}
{"id":"3","type":"synthesize","text":"...","language":"en","voice":"auto","ref_audio":null,"ref_text":null,"speed":1.0,"format":"wav"}
{"id":"4","type":"save_voice","name":"alice","ref_audio":"/tmp/ref.wav","ref_text":"..."}
{"id":"5","type":"list_voices"}
{"id":"6","type":"delete_voice","name":"alice"}
{"id":"7","type":"cancel","request_id":"2"}
```

Responses are either progress events
`{"id":"2","event":"progress","phase":"download","progress":0.4,"message":"..."}`,
success responses `{"id":"3","ok":true,"result":{...}}`, or structured
errors `{"id":"3","ok":false,"error":{"code":"invalid_input","message":"..."}}`.
The sidecar writes logs only to stderr, processes one synthesis at a time,
and creates generated files with UUID names under app data.

Change: dispatch the six user operations through the existing engine and
conversion functions; `cancel` is a separate control message. `prepare_model`
runs in a cancellable worker so the
stdin loop can receive `cancel`; progress callbacks are forwarded unchanged.
`status` returns `model_ready`, `device`, and `languages: ["en", "vi"]`.
`synthesize` accepts `voice: "auto"`, `voice: "profile"` with `voice_name`,
or `voice: "file"` with `ref_audio` and optional `ref_text`. It returns the
temporary audio path and selected format. Unknown operations, malformed JSON,
invalid language, missing files, unsupported formats, and missing profiles
return stable errors without inference.

Verify: write failing tests for every request shape, progress forwarding,
cancel handling, one-shot synthesis dispatch, and structured errors; run
`python -m unittest discover -s tests -v` after implementation with the model
and filesystem calls mocked.

Files inspected, no change: `src/tts_mcp/engine.py`,
`src/tts_mcp/convert.py`, `src/tts_mcp/cli.py`, and `src/tts_mcp/server.py`.

Steps:

1. Write failing `unittest` cases for JSONL dispatch, the request/response
   fields above, progress events, cancellation, and error codes.
2. Run `python -m unittest discover -s tests -v` and confirm the new tests
   fail for missing `desktop.py` behavior.
3. Implement the JSONL parser, request dispatcher, cancellation event, and
   stderr-only logging in `desktop.py`.
4. Connect `status`, `prepare_model`, `synthesize`, `save_voice`,
   `list_voices`, and `delete_voice` to the contracts from Task 2.
5. Run `python -m unittest discover -s tests -v` and require zero failures.

## Task 4 — Build the end-user synthesis UI

Files: modify `apps/desktop/src/App.tsx` and `apps/desktop/src/styles.css`;
create `apps/desktop/src/lib/sidecar.ts`.

Interfaces: `sidecar.ts` owns one long-lived `Command.sidecar` process,
newline parsing, request IDs, progress subscriptions, and cleanup. It
exposes typed functions matching Task 3: `status`, `prepareModel`,
`synthesize`, `saveVoice`, `listVoices`, and `deleteVoice`.

Change: implement the user flow as four visible states: model setup,
synthesis form, generation in progress, and generated result. The setup
screen starts `prepare_model`, displays phase/progress/message, supports
retry/cancel, and only unlocks synthesis after `model_ready` is true.

Visual source: implement the Stitch project `projects/9032336335707878809`
using its five desktop screens as references: model setup
(`9f1e47cc1dab4863a04e561127000905`), automatic voice
(`7db9ba023dae41babb9650bd791f9597`), file clone
(`2adbba2aca4a4a61a160f41c63c9d4a7`), result/export
(`7bf0b740944b458695e5b4331a1d0de8`), and voice profiles
(`83627a4dc57d456384228364624cfa23`). Preserve the Atelier Voice System
tokens: Geist for UI text, JetBrains Mono for telemetry, warm pale canvas,
forest-charcoal ink, structural borders, and muted terracotta `#B9654A` as the
single primary accent. Apply the reference's desktop 3-pane workspace only
where it supports the approved MVP; do not add its out-of-scope pitch,
temperature, waveform-editing, or history features.

The synthesis form provides text input, manual language selection with
English selected by default and persisted in local storage, automatic voice
or file-clone mode, file selection through the native picker, optional
reference transcript, speed control, and a save-profile option. It uses
labels, keyboard focus, disabled states, and status text for accessibility.
The result view plays the returned local audio and exports WAV/MP3 through the
native save dialog and filesystem copy. No text or audio is sent to a remote
endpoint.

Verify: run `npm --prefix apps/desktop run build`; then run
`npm --prefix apps/desktop run tauri dev` with a mocked sidecar response and
manually exercise first-run setup, English default, Vietnamese selection,
file clone, retry/cancel, playback, export, and recoverable errors.

Files inspected, no change: `src/tts_mcp/desktop.py`, `src/tts_mcp/engine.py`,
and `src/tts_mcp/convert.py`.

Steps:

1. Add the typed sidecar process client and line/event parser.
2. Run `npm --prefix apps/desktop run build` to verify the client types and
   imports.
3. Add setup, language, text, voice-mode, file-picker, generation, profile,
   playback, and export states to `App.tsx`.
4. Add the accessible layout, progress, disabled/error, and result styles.
5. Run `npm --prefix apps/desktop run build` and the manual Tauri smoke flow.

## Task 5 — Package the sidecar and desktop artifacts

Files: modify `apps/desktop/src-tauri/tauri.conf.json` and
`pyproject.toml:23-27`; create `requirements-build.txt`,
`scripts/build_sidecar.py`, and `docs/desktop-development.md`.

Interfaces: package `tts_mcp.desktop:main` as the executable named
`tts-sidecar`, stage target-triple names expected by Tauri, and include a
matching FFmpeg executable inside the sidecar bundle. The sidecar resolves
FFmpeg from the bundled PyInstaller extraction directory first, then the
explicit development environment path.

Change: add the `tts-desktop` entry point, a reproducible PyInstaller build
script that fails if the target FFmpeg input is missing, and Tauri resource/
external-binary configuration for these target triples:

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`
- `x86_64-pc-windows-msvc`
- `x86_64-unknown-linux-gnu`

Document source development with Node.js 20+, Python 3.10+, a Python virtual
environment, `pip install -e '.[mp3,tn]'`, `npm install`, and
`npm --prefix apps/desktop run tauri dev`. Document native builds with
`python scripts/build_sidecar.py --ffmpeg /path/to/ffmpeg` followed by
`npm --prefix apps/desktop run tauri build`; do not require users to install
Python, Node.js, or FFmpeg.

Verify: run `python -m unittest discover -s tests -v`,
`npm --prefix apps/desktop run build`, and
`cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`. On each
release host, run the sidecar build command, assert the target-named binary
exists, and run `npm --prefix apps/desktop run tauri build`.

Files inspected, no change: `src/tts_mcp/cli.py`,
`src/tts_mcp/server.py`, and `src/tts_mcp/convert.py`.

Steps:

1. Add the `tts-desktop` entry point and build-tool requirements.
2. Write the sidecar packaging script with PyInstaller, target naming, and
   bundled FFmpeg validation.
3. Update Tauri bundle configuration and resource paths.
4. Write the development and release commands in
   `docs/desktop-development.md`.
5. Run the Python, frontend, Rust, sidecar, and Tauri build checks listed
   above on the current host.

## Task 6 — Final review and verification

Files: all files changed by Tasks 1–5; no new product files.

Interfaces: verify the implementation against the approved design and this
plan, including the persisted language decision and all sidecar messages.

Change: inspect the complete diff for accidental scope, stale docs, missing
validation, unsafe profile paths, data-loss behavior, accessibility gaps, and
unnecessary abstractions. Confirm CLI and MCP callers still use the existing
optional interfaces and that the desktop app never requires a remote server.

Verify: run fresh, complete checks:

```sh
python -m unittest discover -s tests -v
npm --prefix apps/desktop run build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
python -m tts_mcp.cli --help
```

Then run the native Tauri build on each available target host and perform the
first-run/offline/English/Vietnamese/clone/export smoke checklist. Invoke
`review-and-verify` for the final requirements and diff review. Because this
feature changes user-visible behavior and the repository has no existing
`docs/llm/` wiki, invoke `document-wiki` after verification to document the
desktop app and setup flow.

Files inspected, no change: generated model caches, generated audio, and
platform build output directories.

Steps:

1. Read the approved design, this plan, and the decision log before review.
2. Run every fresh verification command listed above and read complete
   output.
3. Review the diff and requirements, fix any in-scope blocker, and repeat the
   failed check.
4. Invoke `review-and-verify` and record its required result block.
5. Invoke `document-wiki` after a passing review.

## Approval Gate

Required: yes
Reason: The plan changes public Python interfaces, dependencies, packaging,
and more than a small set of files.
Status: approved

## Decision Log

### D1 — Stitch UI reference

Question: Which visual design should the desktop UI follow?
Decision: Use Stitch project `9032336335707878809`, including its Atelier
Voice System and five desktop screen references, while limiting controls to
the approved local TTS and file-clone MVP.
Impact: Task 4 owns the visual implementation and must preserve the Stitch
palette, typography, spacing, 3-pane composition, and screen states without
adding out-of-scope product behavior.
Confirmed by user: 2026-09-12
