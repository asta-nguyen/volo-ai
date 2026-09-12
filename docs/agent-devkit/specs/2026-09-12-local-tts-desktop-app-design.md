# Local TTS Desktop App

## Status

Approved.

## Related context

None. The repository has no verified `docs/llm/` wiki context.

## Product intent

Build a desktop application for end users to generate speech locally with
OmniVoice. The first release targets macOS, Windows, and Linux. MCP and the
existing CLI remain supported integrations for agents and terminal users, but
the desktop UI is the primary product surface.

## Decisions

- Framework: Tauri 2 with React, TypeScript, and Vite.
- Developer runtime: Node.js 20 or newer and Python 3.10 or newer.
- Packaged users do not install Node.js or Python; the application bundles a
  Python backend as a platform-specific Tauri sidecar.
- OmniVoice model weights are downloaded on first launch, with visible
  progress. Generation works offline after the model is ready.
- MVP generation modes: automatic voice and voice cloning from a selected
  audio file.
- Supported synthesis languages in the UI: English (`en`) and Vietnamese
  (`vi`), selected manually, with English as the default.
- Cloning accepts an audio file and optional transcript. Microphone recording
  is out of scope.
- An imported clone reference can optionally be saved as a reusable voice
  profile.
- MVP output: preview in the app and export WAV or MP3.
- Voice design, mobile apps, cloud inference, recording, batch generation, and
  generation history are out of scope.

## User experience

### First launch

1. The app checks whether the OmniVoice checkpoint, audio tokenizer, and
   default Whisper ASR assets required for transcript-free cloning are present
   and valid.
2. If not, it shows a setup screen with current phase, progress, downloaded
   size when available, and an actionable retry/cancel state.
3. A failed or cancelled download can resume or retry without corrupting the
   ready model state.
4. Once verification succeeds, the app opens the synthesis screen and does
   not require network access for normal generation or transcript-free
   cloning.

### Synthesis

The main screen lets the user enter text, choose English or Vietnamese,
choose automatic voice or a saved voice profile, set speed, generate audio,
play the result, and export it. English is selected initially and the choice
persists for the next launch. A clone flow lets the user select a reference
audio file, optionally enter its transcript, generate speech, and optionally
save the resulting voice profile. The UI warns when the reference language
differs from the selected target language because the reference accent can
carry into cross-language cloning.

Input validation happens before starting inference: empty text, missing files,
unsupported audio files, invalid speed, and invalid profile names produce
human-readable errors without starting the model.

## Architecture

```text
React UI
  -> Tauri Shell plugin
  -> long-lived Python sidecar
  -> existing Engine and OmniVoice model
  -> app data files and generated audio
```

The UI communicates with a long-lived Python worker through a small
newline-delimited JSON protocol. The worker reuses `Engine` so the model is
loaded once per app session. The UI does not route through MCP; MCP remains a
separate stdio interface for agent clients.

The worker protocol has request IDs and three response types:

- progress events containing request ID, phase, and numeric progress when
  available;
- successful completion containing the result metadata or output path;
- structured errors containing a stable error code and user-facing message.

Synthesis requests carry `language` as the enum `en` or `vi`; the worker
passes that value to OmniVoice's language parameter. Unknown language values
are rejected before inference.

Protocol messages stay on stdout; diagnostic logs stay on stderr. Generated
audio is written to an app-managed output directory. Tauri exposes completed
files for in-app preview and uses the native save dialog for exports.

The desktop package includes a matching FFmpeg helper for MP3 export, so MP3
does not depend on a user-installed system executable. WAV export continues
to use `soundfile` directly.

## Data and lifecycle

The packaged app stores model cache, voice profiles, and temporary/generated
audio under the platform app-data directory. It sets `TTS_MCP_DATA_DIR` for
the sidecar so the existing engine can use the same storage abstraction.
Voice profiles retain the existing prompt plus JSON metadata. Profile names
must be validated before they become filenames; path traversal is rejected.

The CLI keeps its current default data location and behavior unless the user
sets `TTS_MCP_DATA_DIR`. Existing MCP tools continue to call the shared engine
and audio conversion code.

## Failure and recovery

- No network or interrupted download: show the failed phase, preserve a
  resumable partial download where safe, and offer retry.
- Insufficient disk space: stop before generation and show the required
  action.
- Missing or invalid reference audio: reject it before inference.
- Missing saved voice: return a clear error and leave existing profiles intact.
- Model load or generation failure: keep the sidecar usable when possible,
  report the failure, and allow retry.
- Export failure: keep the generated preview available and show the target
  path/error.
- Sidecar crash: mark the current operation failed, restart it once, and show
  a diagnostic action if restart fails.

All text, reference audio, generated audio, and model data remain local. Logs
must not include the full user text or audio contents.

## Compatibility and packaging

Development uses npm with Node.js 20+ for the Tauri frontend and Python 3.10+
for the existing backend. The current `pyproject.toml` declaration of Python
3.11+ must be aligned to the agreed 3.10+ minimum after dependency
compatibility is checked.

Release artifacts are built for macOS Apple Silicon
(`aarch64-apple-darwin`) and Intel (`x86_64-apple-darwin`), Windows x64
(`x86_64-pc-windows-msvc`), and Linux x64 (`x86_64-unknown-linux-gnu`). Each
artifact contains the UI, Tauri shell, matching Python sidecar, and matching
FFmpeg helper; the model remains a first-run download.

## Proposed repository changes

- Add a Tauri desktop app under `apps/desktop` with the React UI and
  `src-tauri` shell.
- Add a Python sidecar entry point under `src/tts_mcp` that implements the
  JSON-lines worker protocol.
- Extend `engine.py` with model readiness/download status hooks, an optional
  language parameter, and shared input/profile validation, while preserving
  the CLI and MCP public behavior.
- Reuse `convert.py` for WAV/MP3 output and the existing voice profile storage.
- Add packaging/build documentation and focused smoke tests for the worker
  protocol, validation, model state transitions, and existing CLI/MCP paths.

## Verification

The implementation is complete when all of the following are demonstrated:

1. Development setup works with Node.js 20+ and Python 3.10+.
2. A clean first launch shows model download progress and reaches a verified
   ready state; retry/resume works after interruption.
3. With network disabled after setup, automatic speech generation, playback,
   and WAV/MP3 export work.
4. File-based cloning works with and without a transcript, and a saved voice
   can be reused and deleted.
5. English is the default language, Vietnamese can be selected, and both
   values reach OmniVoice correctly.
6. Invalid input and sidecar/model failures produce recoverable UI errors.
7. The Tauri app builds for macOS, Windows, and Linux, and the existing CLI
   and MCP smoke checks still pass.

## Execution

The execution plan is [Local TTS Desktop App plan](../plans/2026-09-12-local-tts-desktop-app-plan.md).
