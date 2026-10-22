# Linux media reliability — Issue #9 tasks

Issue: #9

## Design

[Linux media reliability — Issue #9](design.md)

## Global Constraints

- Limit the changed playback source behavior to Linux; keep Windows and macOS on the existing asset-protocol path.
- Keep filesystem reads limited to app-managed audio and paths explicitly selected in the active file dialog; do not grant renderer read access to all of `$HOME/**`.
- Do not change the sidecar protocol, Python API, database schema, or persisted data.
- Keep the GStreamer bundle setting limited to the Linux AppImage.

## Impact map

Entry: `apps/desktop/src/App.tsx::SynthesizeView`, `VoiceProfilesView`, `AudioHistoryView`; shared media entry points: `apps/desktop/src/components/AudioPlayer.tsx::AudioPlayer`, `InlineAudioPreview`
Flow: `App.tsx audio callers → AudioPlayer.tsx shared media components → @tauri-apps/plugin-fs.readFile → Blob URL → HTMLAudioElement`; `tauri.conf.json → Tauri Linux AppImage bundler → GStreamer plugins`
State changes: none; generated audio and saved voice references remain in existing app-data storage
External effects: reads a selected local audio file into WebView memory on Linux playback; creates and revokes Blob URLs; packages GStreamer media files into Linux AppImage, increasing its size
Change candidates: `apps/desktop/src/App.tsx`, `apps/desktop/src/components/AudioPlayer.tsx`, `apps/desktop/src-tauri/capabilities/default.json`, `apps/desktop/src-tauri/tauri.conf.json`, `docs/llm/architecture/overview.md`
Verification: desktop TypeScript/Vite build; Ubuntu 24.04 Tauri package build and AppImage contents inspection; Linux runtime playback smoke checks for all four audio surfaces and three package formats; Windows/macOS playback regression check
Verified at: `47e9b32232badb104b3c40735ed7215b2f4ce6f9`

## Tasks

### Task 1 — Bundle GStreamer in the Linux AppImage

Files: `apps/desktop/src-tauri/tauri.conf.json::bundle.linux.appimage`
Interfaces: Existing Tauri bundle configuration and Ubuntu 24.04 release workflow
Change: Enable `bundleMediaFramework` for the AppImage only so it carries the GStreamer plugins and scanner WebKitGTK needs. Keep `.deb` and `.rpm` on system GStreamer. Carry this one-file fix from PR #10 only after its branch/base scope is reconciled.
Verify: `npm --prefix apps/desktop run tauri build` on Ubuntu 24.04 produces the Linux AppImage; inspect the AppImage for GStreamer plugins/scanner; launch it and open Voice Profiles repeatedly without a WebKit process abort.
Progress: todo
Result: `tauri.conf.json` sets `bundle.linux.appimage.bundleMediaFramework: true`; `.deb`/`.rpm` config remains unchanged. In an Ubuntu 24.04 amd64-emulation Docker container, the Linux Rust app build and `.deb`/`.rpm` bundle steps passed using temporary placeholder sidecars. AppImage bundling failed in `linuxdeploy-plugin-appimage --plugin-api-version` with exit code 2 before producing an AppImage; the temporary AppDir had no GStreamer files to inspect. The container could not establish the required AppImage contents or Voice Profiles runtime behavior.

### Task 2 — Add scoped Linux Blob playback to all local audio surfaces

Files: `apps/desktop/src/App.tsx::SynthesizeView`, `VoiceProfilesView`, `AudioHistoryView`; `apps/desktop/src/components/AudioPlayer.tsx::AudioPlayer`, `InlineAudioPreview`; `apps/desktop/src-tauri/capabilities/default.json::permissions`
Interfaces: Task 1 package runtime; existing `@tauri-apps/plugin-fs`; internal audio component props
Change: Pass local file paths to the shared audio components. On Linux, read a file lazily when an inline preview is played, create a typed Blob URL, and revoke it when the path changes or component unmounts. Preserve `convertFileSrc` on Windows/macOS. Add `fs:allow-read-file` scoped to app data and picker-authorized paths; remove `$HOME/**` from the global filesystem scope and retain any needed save/copy access through command-specific scopes so the new read command cannot read the whole home directory. Handle failed reads by leaving playback stopped and logging through the existing path.
Verify: `npm --prefix apps/desktop run build` succeeds. On Linux Tauri runtime, generate/play a take and preview a saved profile, selected clone reference, and Audio History file; verify all available WAV/MP3/FLAC/OGG sources play. Verify cancelling the file picker leaves selection unchanged, and a missing or denied path leaves the control stopped. On Windows/macOS, verify existing asset-protocol playback still works.
Progress: todo
Result: `npm --prefix apps/desktop run build` and macOS `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed. The Ubuntu 24.04 container also built the Linux Rust app with placeholder sidecars. `AudioPlayer`/`InlineAudioPreview` now take local `audioPath` props; on Linux they read via `fs.readFile` into a MIME-typed Blob URL (lazy on play for inline previews, revoked on path change/unmount), while Windows/macOS keep `convertFileSrc`. `fs:allow-read-file` is scoped to `$APPDATA`/`$APPDATA/**`; the global `$HOME/**` scope is removed and save/export rely on dialog session grants plus the retained `$APPDATA/outputs/**` scope. No UI runtime or audio playback check was run in the container; picker-cancel, denied/missing-path behavior, and Windows/macOS asset-protocol playback remain unverified.

### Task 3 — Validate packaged Linux playback and update the wiki

Files: `docs/llm/architecture/overview.md`
Interfaces: Tasks 1 and 2; Linux package artifacts from the existing release workflow
Change: Update the architecture overview with verified Linux audio-source behavior and AppImage GStreamer packaging. Smoke-test playback in AppImage, `.deb`, and `.rpm`, including Synthesize, saved profile, selected-reference, and Audio History paths. Confirm the AppImage opens Voice Profiles without crashing and check Blob URL cleanup when a preview unmounts or changes source.
Verify: Record successful Ubuntu 24.04 package build and runtime results for all three Linux formats; confirm the wiki describes only behavior reproduced from those artifacts. If a package/runtime cannot be exercised, record that exact verification limit rather than claiming full coverage.
Progress: todo
Result: `docs/llm/architecture/overview.md` documents source-verified platform playback paths, the app-data read scope with dialog session grants, and the AppImage `bundleMediaFramework` setting. The wiki validator passed. AppImage packaging stopped in `linuxdeploy-plugin-appimage` under amd64 emulation before an image was produced, and no UI runtime checks were run; the page marks these outcomes `[~]` as a verification limit.

## Files inspected, no change

- `apps/desktop/src-tauri/src/lib.rs` — confirms the filesystem plugin is already registered.
- `apps/desktop/package.json` — confirms `@tauri-apps/plugin-fs` is already installed and the frontend has no test runner.
- `src/tts_mcp/engine.py` — confirms saved voice references are copied into app-managed voice storage.
- `.github/workflows/release.yml` — confirms Linux release builds run on Ubuntu 24.04.
- `docs/llm/INDEX.md` — confirms the architecture overview is the current verified wiki context.

## Approval Gate

Status: approved

Approval: 2026-10-22 — User authorized fixing issue #9 via Devin CLI after choosing Linux-only playback behavior.

Baseline before source edits: `npm --prefix apps/desktop run build` passed; `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passed.

## Decision Log

- 2026-10-22: Scope the Blob playback path to Linux; Windows and macOS retain `convertFileSrc` behavior, per user choice.
