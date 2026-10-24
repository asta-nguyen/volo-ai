# Verified codebase wiki

## Domains

- [Architecture](architecture/overview.md) — runtime entry points and
  boundaries across the Python engine, sidecar, and Tauri desktop app.
- [MCP voice library](workflows/mcp-voice-library.md) — agent voice generation
  from saved Clone/Design or seeded VieNeu profiles, direct manifest presets,
  or external reference audio, including shared app data.
- [Desktop speech providers](workflows/desktop-vieneu.md) — provider selection,
  on-demand asset setup, provider-aware saved VieNeu profiles, batch preset
  seeding, and synthesis through the native audio.cpp CLI.
- [Desktop audio history](workflows/desktop-audio-history.md) — local WAV/MP3
  history with numbered pagination and existing playback/file actions.
- [Desktop video transcription](workflows/desktop-video-transcription.md) —
  public YouTube-first (Facebook secondary) video links fetched with yt-dlp,
  normalized through bundled FFmpeg, transcribed locally into timestamped SRT,
  and saved through the native dialog.

## Requirement prefixes

| Prefix | Domain |
| --- | --- |
| DAH | Desktop audio history |
| DSET | Desktop settings and diagnostics |
| DVP | Desktop voice providers |
| DVT | Desktop video transcription |
| VLIB | MCP and shared voice profiles |

## Feature inventory

The desktop provider, audio-history, and MCP voice-library workflows have
source-backed deep coverage below. The remaining desktop behaviors are mapped
in the architecture overview but do not yet have dedicated wiki feature pages:

- [x] Desktop provider setup and offline synthesis — the desktop sidecar reports
  both providers, the first-run screen prepares all missing providers
  concurrently and blocks synthesis until both are ready, and Settings can
  prepare one provider on request. Synthesis routes to OmniVoice or VieNeu.
  VieNeu has separate per-request sampler settings, and Voice Profiles can
  batch seed its validated catalog into provider-capable profiles; see the
  desktop provider workflow.
- [ ] Advanced OmniVoice synthesis — desktop `synthesize` forwards native
  generation controls and duration-based long-form chunking; Voice Design
  remains available through the engine and CLI/MCP entry points.
- [ ] Desktop voice profiles — the desktop provides a profile library for
  creating Clone profiles from audio, Design profiles from a natural-language
  voice description, and named VieNeu preset profiles, and can batch seed the
  local VieNeu catalog with reference WAVs for OmniVoice. It lists, reuses, and
  deletes them through the shared SQLite library. Clone audio/prompts stay under
  app data, Design instructions and preset IDs stay in SQLite, and seeded
  references stay with their profile. Bundled versioned seed folders are
  imported on setup, and users can import individual audio files or seed folders
  directly from the Voice Profiles view.
- [ ] Desktop settings and interface localization — Settings stores the app
  locale separately from the synthesis language and exposes General, Model,
  Storage, and MCP tabs. The MCP tab generates copyable setup for Codex CLI,
  Claude Code, Claude Desktop, Cursor, VS Code / GitHub Copilot, and Zed,
  including the app data path; Settings is also reachable from the first-run
  setup screen. General also opens the public GitHub Ideas category for feature
  suggestions and the repository homepage for manually starring the project;
  a Ko-fi action opens the Volo AI support page in the system browser. The
  localized notice explains public visibility and GitHub sign-in.
- [x] Desktop audio history — the app lists local WAV/MP3 files, including
  legacy outputs without synthesis metadata, in newest-first numbered pages of
  20 items; it plays, renames, copies paths, and confirms deletion. See the
  [Desktop audio history workflow](workflows/desktop-audio-history.md).
- [x] Desktop update notices — startup checks the latest stable GitHub release
  without blocking app startup, at most once per 24 hours; Settings supports a
  manual check that can resurface a dismissed update, and a localized banner
  links to the validated release page without downloading or installing it. See
  the [architecture overview](architecture/overview.md).
- [x] Desktop video transcription — the Transcribe view accepts one public
  HTTPS YouTube link (Facebook secondary), streams progress through the
  sidecar, previews the transcript and timestamped SRT, and saves the SRT
  through the native dialog. The sidecar validates hosts, rejects
  playlists, over-60-minute or unavailable sources, downloads audio-only to
  a temporary directory with yt-dlp, normalizes it with bundled FFmpeg, and
  reuses the loaded Whisper pipeline. Transcribe requires OmniVoice/Whisper
  readiness; synthesis still requires both providers. See
  [Desktop video transcription](workflows/desktop-video-transcription.md).
- [ ] CLI generation and profile management — `tts_mcp/cli.py`.
- [x] MCP provider setup and voice generation — `status` and `prepare_model`
  report/prepare OmniVoice and VieNeu; `speak` and `clone` select VieNeu
  presets or Clone/reference voices, accept optional VieNeu sampler options
  such as `seed`, and keep OmniVoice as the default.
  MCP profile and shared-store behavior is in the workflow page.
- [x] Public bilingual desktop downloads, feature overview, and release history
  — the Next.js site serves English and Vietnamese pages, resolves validated
  latest stable GitHub release assets for macOS ARM64, Windows x64, and Linux x64,
  and links directly to the assets. Localized changelog pages read ordered version
  entries from the root `changelog.md`, link each version only to its exact
  tag's validated installer assets, and show a localized status when no
  verified installer is available. See the
  [architecture overview](architecture/overview.md), which also maps the
  localized feature overview route. The Features page and shared footer link to
  GitHub Ideas and the repository for manual starring; header/footer branding
  and the browser icon use the supplied Volo logo. A Ko-fi Floating Button is
  available across the localized web pages and opens the Volo AI support panel.
- [x] Desktop local REST API — Settings starts and stops an opt-in API bound to
  `127.0.0.1:8765`; it reuses the MCP tools and app data and stops with the
  desktop sidecar. See the [API reference](../desktop-local-api.md) for routes
  and the no-token trust boundary.
- [x] Desktop NVIDIA runtime and diagnostics — Linux x64 uses CPU PyTorch by
  default and can install a version-matched NVIDIA sidecar from Settings;
  failed GPU checks fall back to CPU. Logs is available during first-run setup
  before providers are ready and exports bounded, sanitized diagnostics only
  when requested, including failed-request context and an incomplete
  frontend-only report if the sidecar cannot respond. See [Desktop runtime and
  diagnostics](workflows/desktop-runtime-diagnostics.md).

## Sources

- `src/tts_mcp/engine.py`
- `src/tts_mcp/desktop.py`
- `src/tts_mcp/transcribe.py`
- `src/tts_mcp/desktop_runtime.py`
- `src/tts_mcp/desktop_diagnostics.py`
- `src/tts_mcp/cli.py`
- `src/tts_mcp/server.py`
- `src/tts_mcp/api.py`
- `tests/test_server.py`
- `tests/test_api.py`
- `tests/test_engine.py`
- `tests/test_desktop.py`
- `tests/test_desktop_runtime.py`
- `tests/test_desktop_diagnostics.py`
- `tests/test_package_cuda_runtime.py`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/update-check.ts`
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/components/ui/button.tsx`
- `apps/desktop/src/components/ui/tabs.tsx`
- `apps/desktop/src/components/ui/toggle-group.tsx`
- `apps/desktop/src/lib/utils.ts`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src/lib/sidecar.ts`
- `apps/desktop/src/lib/diagnostics.ts`
- `changelog.md`
- `apps/web/lib/changelog.ts`
- `apps/web/test/changelog.test.mjs`
- `scripts/package_cuda_runtime.py`
- `requirements-linux-cpu.txt`
- `requirements-linux-cuda.txt`
- `apps/desktop/package.json`
- `docs/desktop-local-api.md`
