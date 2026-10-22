# Linux media reliability — Issue #9

Issue: #9

## Goal

On Linux desktop builds, opening Voice Profiles must not abort `WebKitWebProcess`, and all local audio surfaces must play. Windows and macOS keep their current audio source behavior.

## Scope

- Enable Tauri's GStreamer media framework bundle for the Linux AppImage. This is the packaging fix already proposed by [PR #10](https://github.com/az-forge/volo-ai/pull/10).
- Use the existing Tauri filesystem plugin to create Blob URLs for Linux playback in Synthesize, Voice Profiles, Audio History, and the selected reference-audio preview. Load bytes when playback is requested; release Blob URLs when their source changes or component unmounts.
- Keep `convertFileSrc` for Windows and macOS.
- Grant file reads only for app-managed audio and the specific paths selected through the native file picker. Do not let the existing global `$HOME/**` scope become a general renderer read permission. Preserve the current save/export behavior with appropriately scoped existing write/copy permissions.
- Update the verified architecture wiki after the runtime behavior is confirmed. No `delta.md` is needed because the wiki has no formal requirement for this behavior.

Out of scope: the separate startup “Unavailable” badges and cancel/change-model requests in comments on issue #9; they are not media defects.

Delivery note: as of 2026-10-22, PR #10 is `CONFLICTING`/`DIRTY` and its comparison contains both the GStreamer fix and the unrelated feature #6 commit. Resolve its base/diff scope before merging; this plan does not authorize merging it.

## Behavior

1. The Linux AppImage includes the GStreamer plugins and scanner required by WebKitGTK. Debian and RPM packages continue to use their system GStreamer installation.
2. Audio components receive a local file path. On Linux they read the file through the existing `@tauri-apps/plugin-fs`, create a Blob URL with the matching audio MIME type, and use that URL for playback. The read is lazy for inline previews so opening a long Audio History list does not load every audio file into memory.
   The shared component uses the Linux platform string exposed by the Tauri WebKit user agent; this avoids adding an OS plugin just for platform detection.
3. On Windows and macOS the components continue to use Tauri asset-protocol URLs without filesystem reads.
4. A read failure leaves playback stopped and is reported through the existing error logging path. A created Blob URL is revoked when its source changes or its component unmounts.
5. `fs:allow-read-file` is scoped to app data. A native file picker may add the selected unsaved reference path to the runtime filesystem scope. Saved voice-profile references are copied into app data by the existing engine flow, so later previews do not require a persistent grant to arbitrary home-directory files. Tauri filesystem permissions require both an enabled command and a path scope; the dialog's selected path scope is temporary for the current run. See [Tauri filesystem permissions](https://v2.tauri.app/plugin/file-system/), [Tauri dialog scope behavior](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/dialog/guest-js/index.ts), and [Tauri AppImage media support](https://tauri.app/distribute/appimage/).

## Edge cases

- Cancelling the reference-file picker leaves the current selection and preview behavior unchanged.
- Missing, denied, or unreadable audio files do not create a Blob URL and do not leave the play control in a playing state.
- Changing the audio path or unmounting a preview revokes its prior Blob URL.
- WAV, MP3, FLAC, and OGG paths retain a media type the WebView can decode.
- A saved profile preview after an app restart reads its copied app-data reference; an unsaved external reference is readable only while its picker grant is active.
- Windows and macOS continue using `convertFileSrc`; no new filesystem read is made on those platforms.

## Interfaces

- No sidecar protocol, Python API, database schema, or persisted data changes.
- `App.tsx` passes local paths to the existing `AudioPlayer` and `InlineAudioPreview` components instead of precomputing every audio URL.
- `AudioPlayer.tsx` owns platform-specific source creation and Blob URL lifecycle for both audio components.
- `capabilities/default.json` scopes the filesystem read command and preserves existing selected-file save/export operations.
- `tauri.conf.json` changes only Linux AppImage media bundling.
- No new dependency; `@tauri-apps/plugin-fs` is already installed and registered.

## Verification

- `npm --prefix apps/desktop run build` succeeds.
- Build the Linux packages on the existing Ubuntu 24.04 release runner. Inspect the AppImage for GStreamer plugins/scanner and verify opening Voice Profiles repeatedly does not abort WebKit.
- On Linux, generate and play a take; preview a saved profile, a newly selected reference file, and an Audio History item. Cover WAV, MP3, FLAC, and OGG where available. Repeat the playback checks with AppImage, `.deb`, and `.rpm` packages.
- Verify denied/missing file reads leave controls stopped and that changing/unmounting a preview releases its Blob URL.
- Verify Windows and macOS still use the asset URL path and play normally.
- The desktop package has no frontend test runner; this plan adds none. The decisive verification is packaged Linux runtime testing.

## Related context

- [Architecture overview](../../../llm/architecture/overview.md)
