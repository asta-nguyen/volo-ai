# Desktop video transcription

## Requirements

### DVT-concurrency-cancellation

The sidecar SHALL run one active transcription at a time, reject a second
request with `busy`, emit request-correlated progress for the metadata,
fetch, audio, and transcribe phases, and honor `cancel` cooperatively during
download and around the ASR call.

#### Scenario: reject a second transcription

- GIVEN a `transcribe_video` request is already running
- WHEN another `transcribe_video` request arrives
- THEN the sidecar answers `busy` immediately while the active job continues

#### Scenario: cancel an active transcription

- GIVEN a `transcribe_video` request is running
- WHEN a `cancel` request names its id
- THEN the worker raises cancellation — promptly during download and
  cooperatively around ASR — and the request answers `cancelled`

Evidence: `src/tts_mcp/transcribe.py`, `src/tts_mcp/desktop.py`, `tests/test_desktop.py`

### DVT-duration-limit

The sidecar SHALL reject videos with unknown, non-positive, or
over-60-minute durations with `duration_limit` before downloading.

#### Scenario: reject an over-length or unknown duration

- GIVEN metadata reports no duration, a non-positive duration, or a duration
  over 60 minutes
- WHEN the sidecar inspects the metadata
- THEN it returns `duration_limit` without downloading

Evidence: `src/tts_mcp/transcribe.py`, `tests/test_desktop.py`

### DVT-local-model-reuse

The sidecar SHALL verify `engine.model_status()` before any lazy model
access and reuse the already-loaded OmniVoice Whisper ASR pipeline for
timestamped chunks without loading a second ASR model or triggering model
downloads.

#### Scenario: model not ready

- GIVEN OmniVoice/Whisper assets are incomplete
- WHEN a `transcribe_video` request is validated
- THEN the sidecar returns `model_not_ready` without calling the downloader
  or loading the model

Evidence: `src/tts_mcp/transcribe.py`, `src/tts_mcp/engine.py`, `tests/test_desktop.py`, `tests/test_engine.py`

### DVT-public-access-only

The sidecar SHALL fetch only publicly available single videos without
browser cookies, login, PO-token providers, or access-control bypasses and
reject private, age-restricted, members-only, live, upcoming, or multi-entry
sources before downloading.

#### Scenario: reject a restricted video

- GIVEN metadata marks the video private, subscriber/premium only,
  needs-auth, age-restricted, live, or upcoming
- WHEN the sidecar inspects the metadata
- THEN it returns `video_unavailable` before downloading

#### Scenario: reject a playlist result

- GIVEN yt-dlp resolves the link to a playlist or multi-entry result
- WHEN the sidecar inspects the metadata
- THEN it returns `invalid_url` without downloading

Evidence: `src/tts_mcp/transcribe.py`, `tests/test_desktop.py`

### DVT-save-flow

The Transcribe view SHALL preview the title, duration, transcript, and
timestamped SRT and write the SRT as UTF-8 only after the user chooses a
destination in the native save dialog with a forced `.srt` extension.

#### Scenario: dismiss the save dialog

- GIVEN a completed transcription
- WHEN the user closes the save dialog without a path
- THEN no file is written and the preview remains

Evidence: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/sidecar.ts`, `apps/desktop/src/lib/i18n.ts`

### DVT-source-scope

The desktop SHALL accept one HTTPS video URL per `transcribe_video` request
on the approved YouTube and Facebook host allowlists, presenting YouTube as
the primary source and Facebook as a secondary source.

#### Scenario: accept a public YouTube link

- GIVEN the user pastes an HTTPS link on `youtube.com`, `www.youtube.com`,
  `m.youtube.com`, or `youtu.be`
- WHEN the sidecar validates the request
- THEN it accepts the URL and reports the platform as `youtube`

#### Scenario: accept a public Facebook link

- GIVEN the user pastes an HTTPS link on `facebook.com`, `www.facebook.com`,
  `m.facebook.com`, `web.facebook.com`, or `fb.watch`
- WHEN the sidecar validates the request
- THEN it accepts the URL and reports the platform as `facebook`

#### Scenario: reject other links

- GIVEN the URL is empty, malformed, non-HTTPS, on another host, carries
  embedded credentials, or references a playlist
- WHEN the sidecar validates the request
- THEN it returns `invalid_url` before any download

Evidence: `src/tts_mcp/transcribe.py`, `src/tts_mcp/desktop.py`, `tests/test_desktop.py`

### DVT-srt-output

A successful request SHALL return the source platform, title, duration, a
plain transcript, and sequentially numbered SRT entries with
`HH:MM:SS,mmm` timestamps that preserve Unicode text.

#### Scenario: invalid or empty ASR output

- GIVEN the ASR result contains malformed chunks or timestamps
- WHEN the sidecar formats the output
- THEN it returns `transcription_failed`; output without usable speech
  returns `no_speech`

Evidence: `src/tts_mcp/transcribe.py`, `tests/test_desktop.py`

### DVT-temporary-media

Downloaded source media SHALL stay in a temporary directory outside app
data, be normalized to mono 16 kHz WAV through the bundled FFmpeg resolver,
and be removed on handled success, error, and cancellation paths.

#### Scenario: clean temporary media after a request

- GIVEN a `transcribe_video` request succeeds, fails, or is cancelled
- WHEN the request ends
- THEN the `tts-transcribe-*` temporary directory and its contents are
  removed

Evidence: `src/tts_mcp/transcribe.py`, `src/tts_mcp/desktop.py`, `tests/test_desktop.py`

### DVT-transcribe-whisper-readiness

The desktop SHALL make the Transcribe view available when the local
OmniVoice Whisper ASR provider is ready, regardless of VieNeu readiness,
while keeping synthesis gated on both providers.

#### Scenario: open transcription with VieNeu unavailable

- GIVEN OmniVoice/Whisper is ready and VieNeu is unavailable or not ready
- WHEN the user opens Transcribe from first-run setup or app navigation
- THEN the transcription workflow is available without preparing VieNeu
  assets

#### Scenario: keep synthesis gated

- GIVEN OmniVoice/Whisper is ready and VieNeu is not ready
- WHEN the user opens the synthesis workspace
- THEN the existing both-provider setup gate remains in effect

Evidence: `apps/desktop/src/App.tsx`

## Flow

1. Transcribe is available when local OmniVoice/Whisper is ready, even if
   VieNeu is not; first-run setup shows a Transcribe action in that state.
   Synthesis remains behind the both-provider setup gate. The Transcribe view
   badges YouTube as the primary source and Facebook as a supported secondary
   source, and shows an authorization notice telling users to process only
   media they are allowed to use. The UI checks that the input is an HTTPS
   URL on an allowlisted host without credentials for immediate feedback; the
   sidecar validates it again.
2. `transcribe_video` runs as a JSONL long operation. The sidecar validates
   the URL (exact host allowlist, no credentials, no playlist forms), checks
   `engine.model_status().ready` and returns `model_not_ready` otherwise,
   then yt-dlp fetches metadata with `download=False`.
3. Metadata validation rejects playlist or multi-entry results, restricted
   availability, age limits, live or upcoming streams, and unknown or
   over-60-minute durations. `process_ie_result` then downloads the strict
   `bestaudio` audio-only stream — no audiovisual fallback — into a
   `tts-transcribe-*` `TemporaryDirectory` with `noplaylist` and no cookie or
   token-provider configuration.
4. The `_resolve_ffmpeg()` binary — bundled, then `TTS_MCP_FFMPEG_PATH`, then
   a PATH `ffmpeg` — normalizes the downloaded file to mono 16 kHz WAV
   (`-vn -ac 1 -ar 16000`). At startup the frozen sidecar restores the
   pre-launch values of the library-path variables its bootloader injects
   (`*_ORIG`), so spawned helpers resolve their own libraries instead of the
   bundled ones.
5. `Engine.transcribe_with_timestamps` reads the WAV through soundfile and
   reuses `model._asr_pipe` with `return_timestamps=True` and no
   `chunk_length_s`, so audio longer than 30 seconds uses Whisper's sequential
   long-form decoding; the model detects the spoken language and no
   translation is applied. Chunked decoding was dropped because it merged
   minutes of speech into single segments and lost words on long videos.
6. Valid `(start, end)` chunks become sequentially numbered
   `HH:MM:SS,mmm` SRT blocks; a missing chunk end falls back to the video
   duration. A chunk longer than `MAX_CUE_SECONDS` (7 s) is split into
   word groups of at most that length, timed in proportion to their word
   count; text without spaces stays one cue. The response returns `platform`, `title`, `duration_seconds`,
   `transcript`, and `srt`. The view previews all of them and saves the SRT
   through the native dialog with a sanitized title as the default filename.
7. Requests emit `metadata`, `fetch` (with a progress fraction), `audio`,
   and `transcribe` progress events correlated by request id. A second
   concurrent request returns `busy`. `cancel` raises `DownloadCancelled` in
   the worker — promptly during download, cooperatively around the ASR call —
   and answers `cancelled` without a save offer.

## State changes

- URL, progress, result, error, and saved state are in-memory only. Source
  URLs and transcripts are never written to audio history, the voice
  library, or diagnostics; diagnostics record only the operation name, error
  code, and exception type.
- The only durable write is the user-selected `.srt` file via
  `writeTextFile`.
- Downloaded media lives only inside a `tts-transcribe-*` temporary
  directory and is removed on every handled path; abrupt process
  termination may leave OS temporary files behind.

## Side effects

- HTTPS requests to YouTube/Facebook and their media hosts through yt-dlp;
  no cookies, login, or PO-token providers are configured.
- Local Whisper inference on the shared OmniVoice pipeline; the ASR model is
  loaded once by the engine and reused.
- The `transcribe_video` request uses a three-hour sidecar timeout.

## Authorization & constraints

- The sidecar is a local JSONL process with no account or remote
  authorization layer; extraction never attempts cookies, sign-in,
  CAPTCHA handling, or rate-limit bypass, and restricted sources fail with
  `video_unavailable`.
- One video per job, up to 60 minutes. The feature does not translate,
  summarize, diarize speakers, batch playlists, or export the extracted
  audio.
- The view and its errors are localized in English and Vietnamese.
- yt-dlp extractor behavior and YouTube/Facebook availability can change
  upstream; public extraction that starts requiring authentication fails
  with an actionable error rather than a workaround.
- The shipped dependency is base `yt-dlp` only (`pyproject.toml`), and the
  packaged sidecar collects `yt_dlp` with no `yt-dlp-ejs` scripts or
  external JavaScript runtime (`scripts/build_sidecar.py`). Per yt-dlp's
  EJS guidance, full YouTube support needs those components, so videos
  requiring EJS may fail with `video_unavailable`; extraction of other
  public videos remains best-effort and was not live-tested. See the
  [yt-dlp EJS wiki](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

## Error paths

- `invalid_url` — malformed or empty URL, non-HTTPS scheme, unapproved host,
  embedded credentials, playlist URL, or playlist-shaped result.
- `video_unavailable` — private, needs-auth, premium, or subscriber
  availability; age restriction; live or upcoming stream; extractor or
  download failure.
- `source_blocked` — the site rate-limits or bot-checks this network
  ("not a bot", HTTP 429, "too many requests"); checked before the sign-in
  wording so a bot check is not reported as a private video.
- `duration_limit` — missing, non-positive, or over-60-minute duration.
- `missing_audio` — the video offers no audio-only stream, or the download
  produced no usable audio track.
- `model_not_ready` — OmniVoice/Whisper assets incomplete; checked before
  any lazy model access so no model download starts.
- `audio_prepare_failed` — bundled FFmpeg missing or normalization failed.
- `transcription_failed` — the ASR call raised or returned malformed timed
  output.
- `no_speech` — the result contained no usable speech chunks.
- `busy` — a second transcription request while one is running.
- `cancelled` — cooperative cancellation during download or around ASR.

## Tests

- `tests/test_desktop.py::TranscribeVideoTests` covers URL
  acceptance/rejection, playlist and restricted-metadata rejection, duration
  limits, download-error mapping, missing audio, FFmpeg failures,
  cancellation before and during download, ASR failure and empty-output
  handling, SRT formatting with Unicode and duration fallback, progress
  phases, model-not-ready, and temporary-directory cleanup.
- `tests/test_desktop.py::DesktopWorkerTests` covers `busy` rejection of a
  second concurrent `transcribe_video` request through `run_protocol`.
- `tests/test_engine.py` covers the timestamped ASR adapter's reuse of the
  loaded `_asr_pipe`, its call arguments, and the missing-pipeline error.
- `tests/test_build_sidecar.py` covers `yt_dlp` collection in the packaged
  sidecar.
- All tests mock yt-dlp, FFmpeg, and the ASR pipeline; none performs a
  platform network request. Live YouTube/Facebook fetching remains
  unverified.

## Related

- [Architecture overview](../architecture/overview.md)
- [Desktop speech providers](desktop-vieneu.md)

## Sources

- `src/tts_mcp/transcribe.py`
- `src/tts_mcp/desktop.py`
- `src/tts_mcp/engine.py`
- `tests/test_desktop.py`
- `tests/test_engine.py`
- `tests/test_build_sidecar.py`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/sidecar.ts`
- `apps/desktop/src/lib/i18n.ts`
- `pyproject.toml`
- `scripts/build_sidecar.py`
