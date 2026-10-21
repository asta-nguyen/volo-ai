# YouTube-first Video Transcription to SRT

Issue: 6

## Goal

Let a Volo AI desktop user paste a publicly accessible YouTube link first, or a Facebook video link, preview the speech as timestamped text, and save the transcript as an `.srt` subtitle file. Speech recognition runs locally with the Whisper model already used by OmniVoice.

## Scope

- Add a Transcribe view to the Volo AI desktop app and one JSONL sidecar operation, `transcribe_video`.
- Support one HTTPS video URL from YouTube first (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`) and Facebook second (`facebook.com`, `www.facebook.com`, `m.facebook.com`, `web.facebook.com`, `fb.watch`). Use `yt-dlp` best-effort extraction with no browser cookies, login, PO-token provider, or private-video support. Do not bypass login, age gates, CAPTCHA, rate limits, or other access controls.
- Fetch audio only, reject playlists and videos longer than 60 minutes, and use the bundled FFmpeg to normalize temporary audio for the existing local Whisper ASR model. The prepared OmniVoice/Whisper provider is required; VieNeu readiness is not required for transcription. This feature does not download model assets.
- Show the timestamped transcript in the desktop UI and let the user choose where to save an UTF-8 `.srt` file. The downloaded media is temporary and is deleted after success, error, or cancellation. The transcript is not written to app history or diagnostics.
- Localize UI labels and errors in English and Vietnamese.
- Exclude exporting extracted audio, translation, summarization, speaker diarization, playlist/batch processing, MCP/CLI support, and authenticated/private links.

## Behavior

1. The user can open Transcribe once the local OmniVoice/Whisper provider is ready, even if VieNeu is not ready. When first-run setup is still visible, it offers a Transcribe action in that state. The user pastes one YouTube link (the primary source) or Facebook link and starts the job. The synthesis workspace keeps its existing requirement that both providers are ready.
2. The UI sends the URL to the sidecar and displays fetch/transcription progress. The sidecar validates the URL again, obtains one public video and its audio stream, checks duration, and converts audio into a temporary file using bundled FFmpeg.
3. The sidecar checks that OmniVoice/Whisper assets are already ready before touching the lazy-loaded engine, so the operation cannot start a model download. OmniVoice's current public `transcribe()` wrapper returns plain text, so the timestamp adapter requests chunks from the already-loaded underlying Transformers pipeline rather than loading a duplicate Whisper model. The sidecar returns the video title, duration, plain transcript, and SRT text; it does not save output automatically.
4. The user previews the transcript and chooses a destination through the native save dialog. The app writes the returned SRT content as UTF-8 with `.srt` extension.
5. Cancel stops an active download and removes temporary files. If cancellation is requested during Whisper inference, it takes effect after that inference call returns. Only one transcription job may run at a time. The frontend request timeout is three hours, matching the existing longest sidecar timeout.

SRT entries use sequential numbering and `HH:MM:SS,mmm` timestamps from Whisper's start/end times. Empty or invalid timed output fails with a localized error rather than creating a malformed file. Whisper detects the spoken language; the output is not translated. The timestamp adapter depends on the shape of OmniVoice's loaded Transformers pipeline, so its contract must be covered by a mocked unit test and checked when upgrading OmniVoice/Transformers.

The downloader is best effort: yt-dlp says site extraction can break as sites change; its YouTube guidance says some downloads may require PO tokens, which this MVP will not obtain. YouTube's Terms restrict automated access and downloading except where permitted by the service, with permission, or by law; Meta also says automated collection without permission violates its terms. A public URL alone does not settle those permissions. The UI must tell users to process only media they are authorized to use, and public release requires a separate decision on platform authorization and terms compliance. See [yt-dlp supported sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), [yt-dlp YouTube extractor guidance](https://github.com/yt-dlp/yt-dlp/wiki/Extractors), [YouTube Terms](https://www.youtube.com/t/terms), and [Meta's scraping policy explanation](https://about.fb.com/news/2021/04/how-we-combat-scraping/).

## Edge cases

- Reject non-HTTPS URLs, unapproved hosts, URL credentials, empty input, and malformed links before any download.
- Return a clear error for private, age-restricted, login-gated, removed, live, unsupported, or unavailable videos; do not attempt cookies, PO-token providers, or alternate authenticated routes. If OmniVoice/Whisper is not already ready, keep Transcribe behind setup and return a model-not-ready error from the sidecar without triggering downloads. VieNeu readiness does not gate transcription.
- Reject playlists, multiple results, missing/unknown duration, and duration greater than 60 minutes.
- Report download/network/FFmpeg failures, missing audio, model-not-ready, ASR failures, and no speech as actionable errors. Remove temporary media on success, handled error, and cancellation; an abrupt process termination can leave an OS temp directory, so never put source media in app data.
- On cancellation, stop the download promptly where possible. During the non-interruptible ASR call, acknowledge cancellation after the call returns and do not offer a save action.
- Reject concurrent transcription requests with a busy response. Keep progress events correlated to the request ID and ensure a terminal response is emitted on success, error, or cancellation.
- If the user closes the save dialog, keep the transcript preview available and create no output file.

## Interfaces

- **Sidecar request:** `{ "type": "transcribe_video", "url": "https://..." }`.
- **Progress events:** request-correlated phases for metadata/fetch, audio preparation, and transcription; download progress may include a percentage, while transcription may be indeterminate.
- **Success result:** `{ "platform": "youtube" | "facebook", "title": string, "duration_seconds": number, "transcript": string, "srt": string }`.
- **Failure:** existing sidecar error envelope with stable codes for invalid URL, unavailable/private video, duration limit, missing audio, model not ready, cancellation, and busy state.
- **Frontend:** one Transcribe view using the existing sidecar client, progress/cancel patterns, native save dialog, `writeTextFile`, and bilingual UI copy. Make it reachable when OmniVoice/Whisper is ready regardless of VieNeu readiness, including a setup-screen action when first-run setup remains visible. Keep synthesis behind the existing both-provider gate. Show a short notice to process only media the user has rights and permission to use.
- **ASR:** use the loaded Whisper Transformers pipeline with timestamp output, following the documented `return_timestamps=True` behavior; do not instantiate a second Whisper model. See [Transformers ASR pipeline documentation](https://huggingface.co/docs/transformers/main_classes/pipelines#automatic-speech-recognition).

## Verification

- Unit checks cover HTTPS/host validation, playlist and duration rejection, no-cookie/no-token-provider downloader configuration, mocked download/FFmpeg/ASR behavior, cleanup on all handled exits, cancellation, busy state, progress correlation, and SRT timestamp formatting with Unicode text.
- Desktop build verifies TypeScript types and the new view's integration with the existing save dialog and sidecar client. Manual native UI checks cover OmniVoice/Whisper ready with VieNeu unavailable, transcription access from setup, the synthesis gate remaining in place, and transcription staying gated when OmniVoice/Whisper is not ready.
- Sidecar packaging check verifies yt-dlp and its extractor modules are included with the bundled worker.
- No live YouTube or Facebook URL has been supplied. Mocked tests can verify handling, but live public-link availability cannot be established without a user-authorized test URL and may change with platform/yt-dlp updates or YouTube token requirements.
- This change installs base `yt-dlp` only (`pyproject.toml`) and the packaged sidecar collects `yt_dlp` without EJS scripts or a JavaScript runtime (`scripts/build_sidecar.py`). Official guidance says full YouTube support needs `yt-dlp-ejs` plus a supported external JS runtime, so videos requiring EJS may fail extraction; whether other public links extract was not live-tested and remains best-effort. See the [yt-dlp EJS guidance](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

## Related context

- [Architecture overview](../../../../llm/architecture/overview.md) — JSONL sidecar, local model readiness, packaging, FFmpeg, and UI boundaries.
- [Desktop speech providers](../../../../llm/workflows/desktop-vieneu.md) — current desktop setup and local inference behavior.
