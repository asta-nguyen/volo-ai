# YouTube-first Video Transcription to SRT tasks

Issue: 6

## Design

[YouTube-first Video Transcription to SRT](design.md)

## Global Constraints

- The feature is limited to the Volo AI desktop UI and JSONL sidecar; do not add MCP or CLI entry points.
- Accept only HTTPS URLs on the approved YouTube and Facebook hosts; do not use browser cookies, login, PO-token providers, private links, or bypass access controls.
- Require the prepared local OmniVoice/Whisper provider and do not trigger model downloads from transcription. VieNeu readiness is not a prerequisite for transcription; keep synthesis behind the existing both-provider gate.
- Keep downloaded media temporary, remove it on every exit path, and do not store transcript or source URL in diagnostics or history.
- Process one video at a time and reject videos longer than 60 minutes.

## Impact map

Entry: `apps/desktop/src/App.tsx::App` / `SetupScreen` exposes Transcribe when OmniVoice/Whisper is ready, independently of VieNeu; synthesis still uses `allProvidersReady`. `src/tts_mcp/desktop.py::dispatch_request` validates the same readiness before accessing the lazy engine.
Flow: first-run setup offers Transcribe when OmniVoice/Whisper is ready → paste a YouTube URL first or Facebook URL → desktop sidecar → yt-dlp audio fetch → bundled FFmpeg normalization → local timestamped Whisper → transcript preview → user-selected SRT save. The synthesis workspace continues to require both providers.
State changes: the feature writes only the user-selected `.srt`, removes temporary source audio, and stores no transcript/history/diagnostic; readiness adds no persisted state.
External effects: the feature makes HTTPS requests to YouTube/Facebook and their media hosts, runs local Whisper inference, and writes a file only after the user chooses a destination; readiness adds no external effects.
Changed areas: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/i18n.ts`, `apps/desktop/src/lib/sidecar.ts`, `src/tts_mcp/transcribe.py`, `src/tts_mcp/desktop.py`, `src/tts_mcp/engine.py`, `pyproject.toml`, `scripts/build_sidecar.py`, related tests, and the desktop video-transcription wiki.
Verification: 106 targeted Python tests pass; `compileall`, desktop production build, and `cargo check` pass; wiki validator reports 0 errors/0 warnings across 37 requirements. The full suite runs 157 tests with one environment-baseline import error: installed `mcp==1.27.2` lacks `mcp.client.Client`, while the project pins `mcp==2.3.0`. Native UI checks confirmed Transcribe is offered and opens with OmniVoice/Whisper READY and VieNeu UNAVAILABLE, Synthesize returns to setup, and Transcribe is absent when OmniVoice is unavailable. The sidecar `model_not_ready` test passes. No live YouTube/Facebook fetch or successful-result save interaction was run without a nominated public test link.
Verified at: `9f8cbe062b27831c2b3ec7c3610d393702fb228d`.

## Baseline (before source edits)

- `python -m unittest discover -s tests -v`: 130 tests discovered; the suite exits with one import error in `test_server` because installed `mcp` is 1.27.2 and does not export `mcp.client.Client`, while `pyproject.toml` pins `mcp==2.3.0`. The other tests, including engine, desktop sidecar, and sidecar packaging coverage, pass.
- `python -m compileall -q src tests`: passes.
- `npm --prefix apps/desktop run build`: passes after `npm ci` in the worktree. Vite reports an existing >500 kB chunk warning. `npm ci` reports one high-severity audit advisory; it is outside this feature baseline and has not been investigated.
- Before Task 4 source edits (2026-10-21), `npm --prefix apps/desktop run build` passes; Vite still reports the >500 kB chunk warning. `apps/desktop/package.json` has no frontend test runner.

## Tasks

### Task 1 — Add timestamped YouTube-first transcription to the Python sidecar

Files: `pyproject.toml::dependencies`, `src/tts_mcp/engine.py::Engine`, `src/tts_mcp/desktop.py::dispatch_request`, `src/tts_mcp/desktop.py::run_protocol`, `src/tts_mcp/desktop.py::_resolve_ffmpeg`, `scripts/build_sidecar.py::main`, `tests/test_engine.py`, `tests/test_desktop.py`, `tests/test_build_sidecar.py`.
Interfaces: Consume the prepared Engine Whisper pipeline and the approved `transcribe_video` request; produce the source platform, timestamped SRT/transcript results, request-correlated progress, stable errors, and cooperative cancellation for the UI task.
Change: Add yt-dlp as a runtime dependency and include it in the packaged sidecar. Check `engine.model_status()` before accessing the lazy-loaded model, then reuse the loaded Whisper pipeline with timestamp output; validate HTTPS and the exact YouTube/Facebook host allowlists at the sidecar boundary; configure audio-only, single-video extraction without cookies or a PO-token provider; reject unknown or over-60-minute duration; normalize downloaded audio with bundled FFmpeg in a temporary directory; format valid timed chunks as sequential SRT; clean temporary files in `finally`. Run the operation in the sidecar worker path, allow only one active job, and check cancellation during download and before/after ASR inference.
Verify: Unit tests with mocked downloader, FFmpeg, and ASR assert valid/invalid YouTube and Facebook URLs, playlist and duration rejection, no-cookie/no-token-provider configuration, model-not-ready without downloads, valid Unicode SRT timestamps, empty/invalid ASR handling, errors and cancellation all clean temporary files, busy rejection, and progress correlation. Packaging test confirms yt-dlp extraction modules are collected. No test performs a platform network request.
Progress: done
Result: Added `yt-dlp>=2026.8.19` runtime dependency and `--collect-all yt_dlp` sidecar packaging; new `src/tts_mcp/transcribe.py` validates the exact HTTPS YouTube/Facebook host allowlists, rejects playlists/credentials/malformed input, downloads with the strict `bestaudio` audio-only selector (no audiovisual fallback; no audio-only stream fails as `missing_audio`) into a `TemporaryDirectory` with no cookies or token providers, rejects unknown or over-60-minute/private/age-restricted/live/unavailable videos, normalizes to 16 kHz mono WAV through the bundled FFmpeg resolver, guards on `engine.model_status()` before any lazy model access, and formats timestamped Whisper chunks into sequential `HH:MM:SS,mmm` SRT with a plain transcript. `Engine.transcribe_with_timestamps` reuses the loaded OmniVoice `_asr_pipe` with `return_timestamps=True`. `dispatch_request` maps `TranscriptionError` codes, `run_protocol` runs the job as a cancellable long operation with request-correlated metadata/fetch/audio/transcribe progress and a one-active-job busy rejection. Stable codes: invalid_url, video_unavailable, duration_limit, missing_audio, model_not_ready, audio_prepare_failed, transcription_failed, no_speech, busy, cancelled. Verified: `PYTHONPATH=src python -m unittest tests.test_desktop tests.test_engine tests.test_build_sidecar` 105 tests pass; `python -m compileall -q src tests` passes. Tests mock yt-dlp/FFmpeg/ASR and perform no platform network requests.

### Task 2 — Add the desktop transcript preview and SRT save flow

Files: `apps/desktop/src/App.tsx::App`, planned `apps/desktop/src/App.tsx::TranscribeView`, `apps/desktop/src/lib/sidecar.ts::SidecarClient`, `apps/desktop/src/lib/i18n.ts`.
Interfaces: Consume Task 1 request/result/progress/error contract; send URL, expose cancellation, preview title/duration/transcript, and save the returned SRT through the existing native dialog and filesystem APIs.
Change: Add a localized Transcribe navigation item and view after the existing app setup gate. Label YouTube as the primary source and Facebook as an additional supported source. Show a brief notice to process only media the user is authorized to use. Validate input for immediate feedback while retaining sidecar validation; show fetch/transcription state, disable duplicate submission, provide cancel, and display clear errors. Let the user save to a chosen `.srt` path with a safe default filename; closing the dialog leaves the preview and writes no file. Give this request a three-hour timeout and cancellation tracking in the existing client.
Verify: `npm --prefix apps/desktop run build` succeeds. Manually check YouTube-first label, Facebook secondary label, empty/invalid URL, progress, cancellation, transcript preview, save, and save-dialog dismissal in the desktop app; a live fetch remains unverified until a user-authorized public test link is available.
Progress: done
Result: Added a localized Transcribe navigation item and `TranscribeView` behind the setup gate (YouTube primary, Facebook secondary, authorization notice, URL validation, request-correlated progress and cancellation, transcript + timestamped SRT preview, and native save dialog with sanitized filename and `.srt` extension; dismissing the dialog writes nothing). `SidecarClient` tracks `activeTranscriptionId`, applies a three-hour timeout, and exposes `cancelTranscription()`. English/Vietnamese strings and localized error labels added. Visual review found and Devin fixed the empty-state preview card showing `Untitled video` before success; the result card now renders only after a result exists. Verified the native view and source labels; no live fetch or successful-result save interaction was run without a nominated public test link. Desktop production build passes.

### Task 3 — Document the implemented video transcription workflow

Files: `docs/llm/INDEX.md`, `docs/llm/architecture/overview.md`, planned `docs/llm/workflows/desktop-video-transcription.md`.
Interfaces: Document only the source behavior delivered by Tasks 1 and 2; update the architecture and feature inventory to link to the new workflow page.
Change: Record accepted URL hosts and YouTube-first ordering, access limits, local Whisper and SRT flow, progress/cancellation behavior, temporary-file cleanup, errors, and YouTube/Facebook/yt-dlp availability and terms risks. Do not add a requirements delta because the current wiki has no video-transcription requirements page.
Verify: Check every internal link and verify each behavior statement against the implemented source and tests.
Progress: done
Result: Created `docs/llm/workflows/desktop-video-transcription.md` with DVT requirements, flow, state, side effects, authorization, errors, and tests; updated the index and architecture overview. Task 4 added and merged `DVT-transcribe-whisper-readiness`. The wiki validator reports 0 errors/0 warnings across 37 requirements; `git diff --check` is clean and internal links resolve.

### Task 4 — Decouple Transcribe access from VieNeu readiness

Files: `apps/desktop/src/App.tsx::App`, `apps/desktop/src/App.tsx::SetupScreen`, `apps/desktop/src/lib/i18n.ts`, `docs/llm/workflows/desktop-video-transcription.md::DVT-transcribe-whisper-readiness`, `docs/llm/INDEX.md`.
Interfaces: Use the existing OmniVoice provider readiness state, app view navigation, SetupScreen callbacks, and localized UI copy; the sidecar's existing `model_not_ready` guard remains authoritative.
Change: Make Transcribe reachable whenever the local OmniVoice/Whisper ASR provider is ready, regardless of VieNeu status. When first-run setup remains visible because VieNeu is unavailable, show a Transcribe action only when OmniVoice/Whisper is ready. Let the Transcribe view pass its gate on OmniVoice/Whisper readiness while preserving the existing both-provider gate for synthesis. Keep Transcribe gated when OmniVoice/Whisper is not ready. Document the requirement in the DVT workflow.
Verify: `npm --prefix apps/desktop run build`; manually verify in the native app that OmniVoice/Whisper ready plus VieNeu unavailable exposes and opens Transcribe from setup, that synthesis remains behind setup, and that OmniVoice/Whisper not ready keeps Transcribe gated. Confirm the existing sidecar model-not-ready test still passes and run the wiki validator after updating the DVT requirement. No frontend test runner exists in `apps/desktop/package.json`.
Progress: done
Result: The setup gate exempts `view === "transcribe"` only when `omniVoiceReady`, preserving the both-provider synthesis gate; SetupScreen shows a localized Transcribe action only when OmniVoice/Whisper is ready. Native UI checks confirmed the action appears with OmniVoice READY and VieNeu UNAVAILABLE, opens Transcribe, Synthesize returns to setup, and Transcribe is absent when OmniVoice is unavailable. The sidecar model-not-ready test passes. Merged `DVT-transcribe-whisper-readiness` into the workflow page; wiki validator reports 0 errors/0 warnings across 37 requirements. Desktop production build passes.

## Files inspected, no change

- `src/tts_mcp/engine.py` — existing local Whisper model is loaded with OmniVoice; current `transcribe` API returns plain text.
- `src/tts_mcp/desktop.py` — JSONL dispatcher, long-operation worker/cancellation path, progress events, and bundled FFmpeg resolver.
- `apps/desktop/src/App.tsx` — navigation, setup gate, native save dialog, `writeTextFile`, and view patterns.
- `apps/desktop/src/lib/sidecar.ts` — generic request, five-minute default timeout, long-operation tracking, cancellation, and progress events.
- `apps/desktop/src/lib/i18n.ts` — English and Vietnamese desktop strings.
- `pyproject.toml` and `scripts/build_sidecar.py` — runtime dependencies and PyInstaller packaging.
- `tests/test_engine.py`, `tests/test_desktop.py`, and `tests/test_build_sidecar.py` — existing unit and packaging test patterns.
- `docs/llm/architecture/overview.md` and `docs/llm/workflows/desktop-vieneu.md` — source-grounded architecture and provider workflow documentation.
- `docs/llm/AGENTS.md` — verified-wiki documentation rules.
- `apps/desktop/package.json` — desktop scripts and confirmation that no frontend test runner is configured.
- `docs/agent-devkit/INDEX.md` — active changes index; this approved plan is linked under `## Changes`.

## Approval Gate

Status: approved

## Decision Log

- Scope corrected after user feedback: YouTube is the primary source; Facebook remains a secondary source from the earlier link-download clarification. Joint approval was granted (`Status: approved`); the user's implementation request authorized this work.
- Review fix: the yt-dlp format selector is strict `bestaudio` with no audiovisual fallback; a video without an audio-only stream fails with `missing_audio`.
- User clarified on 2026-10-21 that transcription requires Whisper, not VieNeu. Transcribe availability depends on OmniVoice/Whisper readiness while synthesis retains its both-provider gate.
- Review fix: `desktop.py::_resolve_ffmpeg` now falls back to `shutil.which("ffmpeg")` after the bundled and `TTS_MCP_FFMPEG_PATH` candidates, matching `desktop_vieneu._resolve_ffmpeg` and `convert.save_audio`; without it, a source-run sidecar always failed transcription with `audio_prepare_failed`.

### D1 — Transcription readiness

Question: Should Transcribe be available when OmniVoice/Whisper is ready but VieNeu is not?
Decision: Transcribe depends on local OmniVoice/Whisper readiness only; VieNeu is not a prerequisite. The synthesis workspace keeps its existing both-provider requirement.
Impact: Changes the Transcribe setup gate, adds a setup-screen entry action, updates bilingual copy, and adds the `DVT-transcribe-whisper-readiness` requirement. Implemented as Task 4 after the user reauthorized the work following presentation of the revised artifacts.
Confirmed by user: 2026-10-21
