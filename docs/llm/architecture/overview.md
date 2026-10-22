# Architecture overview

## Purpose

The repository provides local text-to-speech through a shared Python engine,
with terminal, MCP, and Volo AI desktop entry points. The desktop app runs
the Python worker as a Tauri sidecar and stores model/audio data locally.

## Entry points

- `tts_mcp.cli:main` exposes terminal commands for speech generation, cloning,
  voice design, and saved voice profiles.
- `tts mcp` starts `tts_mcp.server:run_server` over MCP stdio. Its tools include
  `status` and `prepare_model`, plus `speak` and `clone` with OmniVoice as the
  default provider. VieNeu supports manifest presets through `speak` and saved
  Clone or one-off reference audio through `clone`; `design` and profile
  management remain OmniVoice/library operations.
- `tts_mcp.desktop:main` consumes JSONL requests for the Tauri desktop app.
  `status` reports OmniVoice and VieNeu readiness; `prepare_model` and
  `synthesize` require an explicit provider ID. It also reports Linux x64
  optional NVIDIA runtime state and serves runtime install/remove and
  diagnostics export/clear requests. It owns the opt-in loopback REST API
  lifecycle; the API delegates to the existing MCP tools. OmniVoice retains
  auto, file, saved-profile, and voice-design synthesis. VieNeu supports
  manifest presets, saved Clone profiles, and one-off reference files.
  `transcribe_video`
  accepts one public HTTPS video link on the approved YouTube/Facebook host
  allowlists, downloads its audio with yt-dlp into a temporary directory,
  normalizes it with bundled FFmpeg, and returns a plain transcript and
  timestamped SRT from the loaded Whisper pipeline.
- `apps/desktop/src/main.tsx` mounts the React UI; `App.tsx` owns the desktop
  provider selection, explicit model preparation, synthesis flow,
  OmniVoice voice-profile library, and Audio History view. The library includes
  Clone/Design creation, direct audio-file import, and seed-folder import,
  `src/lib/i18n.ts` owns the English/Vietnamese UI resources, and
  `src/lib/sidecar.ts` owns the sidecar process connection. Settings offers the
  optional Linux x64 NVIDIA runtime; Logs displays local errors and supports a
  user-triggered redacted diagnostics export. The Transcribe view pastes a
  public video link, previews the returned transcript and SRT, and writes the
  `.srt` through the native save dialog.
- Audio History uses `list_audio_history`, `rename_audio_history`, and
  `delete_audio_history` sidecar operations. It plays generated files, includes
  legacy WAV/MP3 files without synthesis metadata, lets users rename an output
  while keeping its extension, copies the output's local path, and asks for
  confirmation before deleting it.
  Workspace separately retains only the five latest takes for the current app
  session; pruning that list does not delete files.
- `apps/desktop/src/components/ui/` contains source-owned shadcn components
  backed by Base UI, `src/lib/utils.ts` owns class composition, and
  `src/styles.css` loads Tailwind CSS v4 and the Volo AI theme tokens.
- `.github/workflows/release.yml` starts on a `v*` tag push, checks that the
  strict `vX.Y.Z` tag matches all three desktop version fields and that the
  tagged commit has non-empty `release.md`, then builds macOS ARM64, Windows
  x64, and Linux x64 packages. Intel macOS is not an official desktop release
  target. Linux packages use CPU-only PyTorch; a separate job builds a
  version-matched CUDA sidecar and publishes it as a checksummed manifest and
  split payload assets. The publisher verifies installer targets and runtime
  assets before publishing a GitHub Release with the tagged notes.
- `apps/web/app/(default)/page.tsx` redirects `/` to `/vi`; the localized
  Next.js app serves `/en` and `/vi` with matching document languages and
  metadata. Its download page supports the same macOS ARM64, Windows x64, and
  Linux x64 targets as the release workflow.
- Both website root layouts load `https://umami.n2q.site/script.js` through
  Next.js Script with `afterInteractive` and website ID
  `8211b2f9-c053-475c-a0fb-a4b18f551ba0` for web analytics.
- Website download links emit the `download` Umami event with platform and
  installer format properties. The homepage download CTAs, hero GitHub link,
  and latest release-notes link also emit named click events.
- The website's Node.js server reads the latest stable release from the public
  GitHub Releases API and caches metadata for five minutes. It validates the
  release tag, notes URL, asset names, formats, sizes, and direct GitHub asset
  URLs before rendering download links. GitHub's no-release response, API
  failures, and platforms without a matching asset have separate localized
  states; valid links point directly to GitHub installer assets. Its asset-name
  filter ignores the auxiliary CUDA manifest and payload parts.
- The website also serves localized `/en/changelog` and `/vi/changelog` pages
  whose entries come from the repository-root `changelog.md`. Strict
  `## vMAJOR.MINOR.PATCH` headings delimit entries in file order; invalid
  headings are ignored and a duplicate version keeps only its first entry. For
  each entry tag, the server queries the GitHub Releases API for that exact tag
  with a five-second timeout and five-minute cache, requires a stable
  non-draft release, and validates installer asset names, formats, sizes, and
  direct GitHub asset URLs. Notes render Markdown with raw HTML, authored
  links, and images disabled, so the only outbound links on the page are
  version-matched installer downloads; a missing release, an empty asset list,
  or an API failure keeps the notes visible with a localized no-installer
  status. Next.js output tracing ships `changelog.md` with the
  server-rendered route, and a missing or unreadable file is an application
  error. The tagged root `release.md` remains the per-tag notes source for the
  release workflow.
- The localized `/en/features` and `/vi/features` pages summarize the main
  desktop and companion-tool capabilities. The route renders the English and
  Vietnamese copy defined in `apps/web/lib/site-copy.ts` and links to the
  existing localized download page. A localized community section links to the
  public GitHub Ideas category and repository homepage for manually starring
  the project, with a notice about public suggestions and GitHub sign-in.
  The shared footer exposes both links on every localized page. Header/footer
  branding uses the supplied Volo logo PNG through Next.js Image optimization;
  the same `apps/web/app/icon.png` supplies the browser icon.
- The website includes localized macOS Gatekeeper guidance: an Apple-supported
  Open Anyway path for trusted official downloads, redownload/stop advice for
  a damaged-app warning, and a separate advanced disclosure explaining the
  system-wide effect of temporarily disabling Gatekeeper and how to re-enable
  and check it.
- Provider selection is stored in `localStorage`; it defaults to OmniVoice and
  does not trigger model downloads. When OmniVoice becomes ready, `App.tsx`
  resolves the bundled `resources/seed-voices` directory and asks the sidecar to
  import its versioned manifests. The
  importer copies each reference audio file into app-local storage and creates
  the clone prompt there; SQLite records profile kinds, metadata, defaults, and
  installed seed versions. The Voice Profiles view also lets users choose an individual
  audio file; the UI derives a profile name from its filename and reuses the
  existing `save_voice` operation. Typed and derived profile names go through
  the same `toVoiceName` helper in `App.tsx`, which strips Vietnamese
  diacritics and replaces other unsupported characters with `-` so they match
  the engine's ASCII name rule. It can also pass a user-selected seed root
  to the existing seed importer. Setup is therefore independent of the source
  repository or the original sample-audio path.
- `scripts/build_sidecar.py` packages the desktop worker and FFmpeg into a
  target-named executable and can stage the matching audio.cpp CLI beside the
  regular worker. The separate CUDA build omits that CLI and Tauri bundle.

## Runtime boundaries

```text
Volo AI React UI
  -> Tauri shell plugin
  -> bundled CPU Python JSONL sidecar
  -> verified optional CUDA sidecar on Linux x64, or CPU fallback
  -> Engine / OmniVoice  OR  VieNeuProvider / audio.cpp CLI
  -> provider model cache and generated audio
```

The Python engine in `engine.py` owns OmniVoice device detection, model
readiness and download, generation, native long-form chunking configuration,
and saved voice profiles. `VieNeuProvider` downloads a pinned GGUF, manifest
voice assets, and CAM++ encoder; it uses Python for SEA-G2P and speaker
embeddings and calls the configured or bundled CPU audio.cpp CLI for synthesis.
Both the MCP server and desktop sidecar use this provider; the CLI remains
OmniVoice-only.
The desktop sidecar can start a JSON REST API on `127.0.0.1:8765` from Settings
> MCP. It is off by default, shares the existing MCP operations and app data,
and stops with the sidecar. It has no token; the API reference documents the
accepted same-machine process trust boundary and route contract.
`convert.py` writes WAV, FLAC, OGG, or MP3 output; VieNeu WAV/MP3 output keeps
48 kHz, while OmniVoice generates at 24 kHz. MP3 requires FFmpeg and pydub,
while unsupported output extensions are rejected.
The frontend `SidecarClient` gives ordinary requests a five-minute timeout,
model preparation and seeding a one-hour timeout, and optional runtime
installation and video transcription a three-hour timeout. Synthesis runs inline
on the sidecar's request loop, so a `synthesize` request and any request sent
while one is pending get a one-hour timeout; a long OmniVoice script can take
several minutes. Because a model call cannot be interrupted, cancelling a render
(`SidecarClient.cancelSynthesis`) restarts the sidecar; it is refused while a
model download, seed import, runtime install, or transcription is running, and
the restart also stops the local API server. `Engine` serializes OmniVoice generation,
Whisper transcription, and clone-prompt creation behind one class-level
`_inference_lock`, because the sidecar runs synthesis on its request loop while
transcription and seed imports run on worker threads, and concurrent MPS work
aborts the process; a render requested during a transcription waits for it. Runtime downloads emit progress and support
cancellation. Startup checks the exact app version and performs a CUDA health
check; a stale or unusable runtime leaves CPU synthesis available.
The React UI also checks GitHub's latest stable release at startup without
blocking rendering, with a five-second timeout and a 24-hour automatic-check
cooldown. A newer version appears in an in-app banner; Settings > General can
check manually, and a manual check can resurface a dismissed release. Dismissals
are stored by release tag. The Tauri shell-open scope accepts the exact
`https://github.com/az-forge/volo-ai/releases/tag/vMAJOR.MINOR.PATCH` URL (strict
SemVer, no leading-zero components), the repository homepage, and its
`/discussions/categories/ideas` page. Update notices open the validated release
URL and do not download or install updates.
Settings > General includes a localized community card with separate actions
for suggesting a feature and starring Volo AI. These open the fixed public
Ideas category and repository homepage in the system browser. The card explains
that ideas are public and GitHub sign-in is required to post, vote, or star.
The app stores no feedback, makes no feedback API calls, and records a frontend
diagnostic if the browser opener fails; interactions happen on GitHub.
Local audio playback branches by platform in the shared
`AudioPlayer`/`InlineAudioPreview` components, which receive local file paths:
on Linux WebKitGTK they read the file through `tauri-plugin-fs` into a
MIME-typed `blob:` URL — inline previews read lazily on play, and Blob URLs are
revoked on path change or unmount — while Windows and macOS keep `convertFileSrc`
asset-protocol URLs. The fs capability scopes `read_file` to the app-data
directory, and native open/save dialogs grant only their selected paths for the
session; there is no global `$HOME/**` fs scope. The Linux AppImage
configuration sets `bundleMediaFramework` to true; `.deb` and `.rpm` remain
configured to use system GStreamer.
`[~] Verification limit: an Ubuntu 24.04 amd64-emulation build produced a
157.97 MiB AppImage after invoking the extracted linuxdeploy plugin because
QEMU could not execute the plugin AppImage. Inspection found 265 GStreamer
plugins, including WAV parsing, playback, typefind, and the plugin scanner. The
artifact used placeholder sidecars, so release installation and Linux runtime
playback remain unverified; Windows/macOS playback was not retested.
The React root provides one in-memory TanStack Query client. `App.tsx` queries
sidecar status and voice profiles, and loads cursor-paginated Audio History
only while that view is active. Successful profile and preparation mutations
invalidate their related queries; synthesis invalidates History, while a
confirmed History deletion removes the item from cached pages. Queries and
mutations run for the local sidecar while the OS is offline, do not retry
automatically, and do not refetch on focus or reconnect. `SidecarClient` keeps
its single retry when the child process has stopped. Progress and logs remain
event-driven UI state.

The desktop sidecar keeps bounded diagnostic events locally, and the frontend
keeps bounded process and interface errors in local storage. Logs can clear
both histories or save a JSON report through the user's file chooser. Exported
reports include app/platform/runtime metadata and recent errors, redact the
home path, and omit request payloads and generated content.

The MCP `status` tool reports provider readiness, runtime and preprocessing
availability, and VieNeu presets. `prepare_model` downloads assets only for
the selected provider. `speak` and `clone` preserve OmniVoice when `provider`
is omitted; VieNeu is explicit and does not fall back. OmniVoice `clone`
accepts saved Clone/Design profiles or reference audio with an optional
transcript. VieNeu uses a manifest preset or a saved Clone/reference recording
and writes WAV or MP3 to the requested path. The MCP voice-library workflow
and shared-store effects are documented in
[MCP voice library](../workflows/mcp-voice-library.md).
Desktop provider setup and synthesis are documented in
[Desktop speech providers](../workflows/desktop-vieneu.md).
Public video-link transcription to SRT is documented in
[Desktop video transcription](../workflows/desktop-video-transcription.md).

## Domains

| Domain | Current boundary |
| --- | --- |
| Speech generation | `Engine.generate` serves CLI/MCP and desktop OmniVoice; `VieNeuProvider.synthesize` serves MCP and desktop VieNeu through audio.cpp |
| Model lifecycle | `Engine.model_status`/`ensure_model` and `VieNeuProvider.status`/`ensure_model` serve MCP and desktop readiness and setup |
| Voice profiles | `Engine.save_voice`, `save_design_voice`, `load_voice_profile`, `load_voice`, `list_voices`, and `delete_voice`; Clone and Design profiles share the desktop library |
| MCP voice generation | `status`, `prepare_model`, `speak`, `clone`, and `list_voices` expose provider setup, VieNeu presets, and saved Clone/Design or external-reference workflows; MCP shares the app library when configured with the app-data path |
| Desktop local API | Optional `127.0.0.1:8765` REST server delegates status, preparation, synthesis, and voice-profile operations to the existing MCP tools; Settings owns start/stop and the sidecar stops it on exit |
| Seed profiles | `Engine.import_seed_voices`, the `import_seed_voices` sidecar request, and bundled seed manifests |
| Audio history | `Engine.record_audio_history` and `list_audio_history`/`rename_audio_history`/`delete_audio_history` sidecar operations index files from `outputs`; React plays and renames files, copies their local path, and confirms deletion |
| Desktop settings | `App.tsx` and `i18n.ts` expose General, Model, Storage, and MCP tabs; General supports manual stable-release checks and public GitHub Ideas/Star links, Linux x64 Model settings manage the optional NVIDIA sidecar, and Logs exports local diagnostics; MCP generates copyable client-specific setup for Codex CLI, Claude Code, Claude Desktop, Cursor, VS Code / GitHub Copilot, and Zed using the app-data path |
| Video transcription | `transcribe_video` validates approved public video hosts, fetches audio with yt-dlp into a temporary directory, normalizes with bundled FFmpeg, reuses `Engine.transcribe_with_timestamps` on the loaded Whisper pipeline, and returns transcript + SRT for the Transcribe view's native save flow |
| Desktop shell | React UI, Tauri plugins, JSONL sidecar, optional Linux CUDA worker, and target-matched audio.cpp CLI |
| Public download site | `apps/web` serves English and Vietnamese product/download, feature overview, and changelog pages, reads versioned notes from the root `changelog.md`, resolves validated stable GitHub Releases, and exposes only direct installer URLs for downloads |

## Data and dependencies

The engine reads `TTS_MCP_DATA_DIR`, defaulting to `~/.tts-mcp`. OmniVoice
assets use `models/omnivoice`; VieNeu assets and speaker-embedding cache use
`models/vieneu`. The desktop sidecar stores generated audio below `outputs`;
MCP writes to each request's `output_path`. Audio History discovers regular
WAV/MP3 files directly in `outputs` and stores synthesis metadata in the
SQLite `audio_history` table using only each file's basename. Files without a
metadata row remain visible with their file date. Renaming an item moves the
output without replacing an occupied filename and updates only its basename in
`audio_history`, preserving the synthesis metadata; Copy path copies its local
absolute path. Deleting a history item removes the selected output and its
metadata. The SQLite database is `volo.db`.
Voice metadata lives in `voice_profiles` and
installed bundled seeds in `app_seeds`; Clone profiles keep copied reference
audio and clone prompts under `voices/<profile-name>/`, while Design profiles
store their `design_instruction` in SQLite and need no voice files. The desktop
shell passes its Tauri app-data directory to the sidecar. MCP uses `~/.tts-mcp`
unless `TTS_MCP_DATA_DIR` is set to that same app-data directory; in that case,
MCP voice listing, generation, saving, and deletion use the desktop library.
MCP model preparation downloads only the selected provider's missing assets;
VieNeu requires `TTS_MCP_AUDIOCPP_PATH` for the local audio.cpp runtime.
Release bundles include the native sidecar, audio.cpp CLI, and FFmpeg, so
installed users do not need Python, Node.js, or FFmpeg; those runtimes are only
development/build requirements.
The tagged release workflow requires the root `release.md` to be committed with
the tag; that per-release summary becomes the published release description.
The website's changelog instead reads the cumulative repository-root
`changelog.md`, which release preparation updates alongside `release.md` with a
new `## vX.Y.Z` entry per release.
Installers exclude model weights and app data, which are prepared on first use.
Linux installers bundle CPU-only PyTorch; the optional CUDA sidecar downloads
from the same versioned release and is installed below app data after a user
action. `yt-dlp` is a packaged runtime dependency for video transcription;
downloaded media stays in temporary storage outside app data and is removed
after each handled request, and neither source URLs nor transcripts are
persisted. Desktop diagnostic history is stored locally in bounded files/browser
storage; a user-triggered report redacts the home path and excludes request and
generated content.
Release packages are unsigned and are not notarized.
The app interface supports English and Vietnamese through `i18next` and
`react-i18next`; the app locale is stored as `volo-ai.app-language`, while the
synthesis target remains `volo-ai.synthesis-language`.

## Sources

- `apps/web/app/icon.png`

- `pyproject.toml`
- `src/tts_mcp/engine.py`
- `src/tts_mcp/convert.py`
- `src/tts_mcp/cli.py`
- `src/tts_mcp/server.py`
- `tests/test_server.py`
- `tests/test_engine.py`
- `README.md`
- `src/tts_mcp/desktop.py`
- `src/tts_mcp/api.py`
- `src/tts_mcp/transcribe.py`
- `src/tts_mcp/desktop_runtime.py`
- `src/tts_mcp/desktop_diagnostics.py`
- `src/tts_mcp/desktop_vieneu.py`
- `tests/test_desktop.py`
- `tests/test_api.py`
- `tests/test_desktop_vieneu.py`
- `tests/test_build_sidecar.py`
- `tests/test_package_cuda_runtime.py`
- `tests/test_desktop_runtime.py`
- `tests/test_desktop_diagnostics.py`
- `scripts/build_sidecar.py`
- `scripts/package_cuda_runtime.py`
- `requirements-linux-cpu.txt`
- `requirements-linux-cuda.txt`
- `docs/desktop-development.md`
- `apps/desktop/package.json`
- `apps/desktop/vite.config.ts`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/components/ui/button.tsx`
- `apps/desktop/src/components/ui/tabs.tsx`
- `apps/desktop/src/components/ui/toggle-group.tsx`
- `apps/desktop/src/lib/utils.ts`
- `apps/desktop/components.json`
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/AudioPlayer.tsx`
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/capabilities/default.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/resources/seed-voices/tony-hoang/manifest.json`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src/lib/update-check.ts`
- `apps/desktop/src/lib/sidecar.ts`
- `docs/desktop-local-api.md`
- `apps/desktop/src/lib/diagnostics.ts`
- `.github/workflows/release.yml`
- `release.md`
- `apps/web/package.json`
- `apps/web/app/(default)/layout.tsx`
- `apps/web/app/(default)/page.tsx`
- `apps/web/app/[locale]/layout.tsx`
- `apps/web/app/[locale]/page.tsx`
- `apps/web/app/[locale]/changelog/page.tsx`
- `apps/web/app/[locale]/features/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/lib/changelog.ts`
- `apps/web/lib/releases.ts`
- `apps/web/next.config.ts`
- `apps/web/test/changelog.test.mjs`
- `apps/web/test/mock-github.mjs`
- `changelog.md`
- `apps/web/lib/site-copy.ts`
- `apps/web/postcss.config.mjs`
