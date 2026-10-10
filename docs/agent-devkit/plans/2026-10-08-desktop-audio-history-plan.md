# Desktop Audio History implementation plan

## Approved design

[Desktop Audio History](../specs/2026-10-08-desktop-audio-history-design.md)

## Global Constraints

- Keep generated audio in the app-data `outputs` directory; do not store audio
  bytes or absolute paths in SQLite.
- Keep only the five latest session takes visible in Workspace; changes to that
  list never delete files.
- Keep all audio local, with no automatic pruning, cloud sync, or paid-tier
  limit.
- Include existing WAV/MP3 files in History with filename and file date when
  synthesis metadata is unavailable.
- Require user confirmation before deletion and restrict delete operations to
  regular files directly under `outputs`.
- Keep the existing synthesis response `{audio_path, format}` unchanged.
- Register metadata only after a successful output; a metadata-write failure
  must not remove or hide the generated audio file.

## Tasks

### Task 1 — Add persistent audio metadata storage

Files:

- `src/tts_mcp/engine.py::DB_SCHEMA_VERSION`, `_open_database`, `Engine`
- `tests/test_engine.py::EngineTests`

Interfaces: Add `Engine.record_audio_history(file_name, provider, voice_name,
format, text, created_at)`, `Engine.list_audio_history()`, and
`Engine.delete_audio_history(file_name)`. Store only the basename and metadata;
`file_name` is the primary key and must be a WAV or MP3 basename before it is
written.

Change: Migrate fresh and existing schema-v2 databases to schema v3 by adding
`audio_history(file_name, provider, voice_name, format, text, created_at)`.
Keep existing `voice_profiles` and `app_seeds` rows and migration behavior
intact. Use parameterized SQL and the existing storage lock/connection
patterns. Add coverage for a fresh database, a v2 database with existing voice
rows, metadata round-trip, and metadata deletion.

Verify: `rtk python -m unittest discover -s tests -p test_engine.py -v`.

- Fresh database → `PRAGMA user_version` is 3 and the audio metadata table
  exists.
- Existing v2 database with profile and seed rows → opens at v3 with those
  rows unchanged.
- Recording then listing a valid item → all metadata fields match; deleting
  its filename → the metadata row is absent.
- Invalid provider, format, or basename → no metadata row is written.

### Task 2 — Extend desktop sidecar history and safe file operations

Files:

- `src/tts_mcp/desktop.py::_synthesize`, `dispatch_request`
- `tests/test_desktop.py::DesktopWorkerTests`

Interfaces: Keep `synthesize` returning `{audio_path, format}`. Add
`list_audio_history` returning `items` with `id`, `audio_path`, `format`,
`created_at`, nullable `provider`, `voice_name`, and `text`, plus
`metadata_available`. Add `delete_audio_history(file_name)` returning
`deleted`; the desktop sends the listed item `id` as `file_name` because JSONL
reserves its top-level `id` for request correlation. Use
`Engine.record_audio_history`, `Engine.list_audio_history`, and
`Engine.delete_audio_history` from Task 1.

Change:

1. After either OmniVoice or VieNeu synthesis succeeds, record the output
  basename, provider, stable voice label, input text, format, and UTC
  timestamp. Use a profile name for profile mode, the preset ID for preset
  mode, and stable generic labels for auto, design, and reference-file modes;
  do not store the one-off reference path.
2. If recording metadata fails, keep the completed audio and return the
  existing successful synthesis response. The list operation discovers the
  unmatched output file and returns file-only metadata for it.
3. List regular `.wav` and `.mp3` files directly in `OUTPUT_DIR`, newest first.
  Merge matching metadata rows; use the file modification time for files with
  no row, and do not show rows whose audio file is missing.
4. For delete, require a basename with an allowed extension, resolve it as a
  direct child of `OUTPUT_DIR`, reject traversal and symlinks, unlink the file,
  then remove its metadata row. A file-system failure returns a structured
  sidecar error and preserves the entry for retry.

Verify: `rtk python -m unittest discover -s tests -p test_desktop.py -v`.

- Successful OmniVoice and VieNeu synthesis → one metadata record with the
  matching provider, mode-specific voice label, text, format, and timestamp.
- Metadata database failure after output creation → synthesis still succeeds
  and a subsequent list returns the file with `metadata_available: false`.
- Pre-existing WAV/MP3 output files → list includes them with file date and
  null synthesis metadata, sorted newest first.
- Unsupported extensions, symlinks, missing files, and traversal IDs → no
  outside or unrelated file is removed; return a structured error where the
  requested item is invalid or missing.
- Confirmed delete request → selected output and metadata are removed;
  simulated unlink failure → metadata remains available for retry.

### Task 3 — Add the Audio History UI

Files:

- `apps/desktop/src/lib/sidecar.ts::SidecarClient`
- `apps/desktop/src/App.tsx::AppView`, `Workspace`, `synthesize`, desktop view routing
- `apps/desktop/src/lib/i18n.ts::createUiCopy`

Interfaces: Add a typed history item matching Task 2's JSON response. The new
view uses the existing `SidecarClient`, `AudioPlayer`, `ConfirmDialog`, and
`convertFileSrc`; no new dependency or persistence layer is introduced.

Change:

1. Add Audio History to sidebar navigation. Load the list when the view opens;
   show loading, retryable error, and empty states separately.
2. Show all returned items newest first with playback and available text,
   provider, voice, format, and date metadata. For legacy files, show filename
   and date only.
3. Require confirmation before sending `delete_audio_history`. On success,
   remove the row and any matching workspace take; clear the workspace player
   if it points to that file. On failure, keep the row and show the error.
4. Cap the session-only workspace take list at five while leaving all files in
   History.
5. Add the navigation, metadata, empty/error/loading, retry, and confirmation
   copy in English and Vietnamese.

Verify: `rtk npm --prefix apps/desktop run build`.

- TypeScript/Vite build → succeeds with the added request types and view.
- Manual desktop check: generate at least six outputs across both providers →
  Workspace shows five and History shows all six after navigating away and
  reopening the view.
- Restart the app → History still lists the files and plays a selected item;
  legacy files show filename/date without fabricated synthesis details.
- Cancel deletion → file and list item remain. Confirm deletion → file and
  history metadata are removed. A failed delete → row remains with a visible
  error.

## Files reviewed during planning

- `docs/llm/architecture/overview.md` — confirms app-data paths, SQLite, and
  sidecar boundaries.
- `docs/llm/workflows/desktop-vieneu.md` — confirms provider routing and
  generated-output behavior.
- `apps/desktop/src/components/AudioPlayer.tsx` — existing playback and local
  audio path handling.
- `apps/desktop/src/components/ui.tsx` — existing cards, buttons, and
  confirmation dialog primitives.
- `tests/test_desktop_vieneu.py` — VieNeu provider output behavior remains
  unchanged.

## Implementation record

Tasks 1–3 are implemented. Focused verification passed:

- Engine: 16 tests passed.
- Desktop sidecar: 28 tests passed.
- Desktop TypeScript/Vite production build passed.
- Python compile check and Tauri `cargo check` passed.
- `git diff --check` passed.
- The rebuilt debug `.app` launched and showed the History entry from the
  first-run screen while models were still being checked.
- The reported `Unknown operation: list_audio_history` came from a stale
  target-named PyInstaller sidecar: a direct JSONL request to that binary
  reproduced the error even though `src/tts_mcp/desktop.py` already handled
  the operation. Rebuilding the sidecar and the debug `.app` resolved it.
- The sidecar inside the rebuilt `.app` matches the staged target binary by
  SHA-256. A direct request to the bundled sidecar with a fresh temporary data
  directory returned `{"id":"probe","ok":true,"result":{"items":[]}}`.
  Opening the rebuilt `.app` and selecting History loaded 10 existing audio
  files without the operation error.
- A standalone first launch of the packaged sidecar took about 95 seconds; a
  60-second probe timed out, while the same probe with a longer timeout
  succeeded. The app UI successfully loaded the history once its sidecar was
  ready.
- The sidecar build helper invocation exited after copying the rebuilt worker
  because its `--audiocpp` source was also the destination (`SameFileError`).
  The bundled worker and app were then built and verified independently; use a
  separate audio.cpp CLI source path for a clean helper exit.
- `docs/desktop-development.md` now states that Tauri packages the existing
  target-named worker and that developers must rebuild it after sidecar changes.
- The wiki architecture map and feature inventory now include Audio History;
  a dedicated workflow page was not added.

The full Python suite ran 70 tests but is not green in the current working
tree: `test_builder_stages_both_binaries_for_target` expects the staged
packager's older package list, and `test_server` cannot import
`mcp.client.Client` from the installed MCP SDK. `tauri build --debug --bundles
app` produced the debug `.app`; the default all-bundles command still fails
when its `bundle_dmg.sh` step creates a `.dmg`. The six-output cross-provider
desktop restart/playback/delete QA remains unrun.

## Approval Gate

Required: yes
Reason: Adds a SQLite schema migration, two sidecar operations, and changes
across the engine, sidecar, and desktop UI.
Status: approved

## Decision Log

None.

## Impact map

Entry: `src/tts_mcp/desktop.py::dispatch_request`; `apps/desktop/src/App.tsx::synthesize` and desktop view routing
Flow: React `synthesize` → `SidecarClient.request` → desktop JSONL `dispatch_request` → OmniVoice `_synthesize` or `VieNeuProvider.synthesize` → `OUTPUT_DIR`; `list_audio_history`/`delete_audio_history` sidecar operations → React Audio History view
State changes: SQLite `volo.db` schema v3 adds synthesis metadata; audio remains in the existing app-data `outputs` directory; no automatic audio deletion
External effects: local SQLite writes; local file discovery, playback, and confirmed deletion; no network effect
Change candidates: `src/tts_mcp/engine.py`, `src/tts_mcp/desktop.py`, `tests/test_engine.py`, `tests/test_desktop.py`, `apps/desktop/src/lib/sidecar.ts`, `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/i18n.ts`
Verification: focused engine and desktop sidecar tests; full Python unit suite; Python compile check; desktop UI build; manual local generation/history/delete check
Verified at: `8a4205feba8f656ee61b6a3d8921c78e86406037`
