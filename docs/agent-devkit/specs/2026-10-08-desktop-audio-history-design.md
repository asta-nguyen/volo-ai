# Desktop Audio History

## Approval

The user approved the Audio History feature direction in this conversation:
keep generated audio locally, show only the five latest takes in the workspace,
provide a persistent history to replay and delete older audio, require
confirmation before deletion, and do not automatically remove audio or impose
a paid-tier limit.

## Problem

Desktop synthesis writes uniquely named WAV and MP3 files under the app's
`outputs` directory. The workspace take list lives only in React state, so it
disappears when the app restarts, and there is no screen to browse or remove
the files that remain on disk.

## Product behavior

- Add an Audio History view in the desktop sidebar. It lists playable WAV and
  MP3 files directly under the configured app-data `outputs` directory, newest
  first, and remains available after app restart.
- Keep the workspace take strip to the five latest takes in the current app
  session. Replacing its visible list never deletes an audio file.
- For synthesis completed after this feature is installed, retain the text,
  provider, voice label, format, and UTC creation time in local SQLite metadata.
- Include audio files already in `outputs` when the view first opens. Their
  creation time comes from the file modification time; because old synthesis
  metadata was not recorded, show their filename and date without inventing
  text, provider, or voice details.
- Reuse the existing `AudioPlayer` and confirmation dialog patterns. A user
  must confirm a delete; confirming removes the selected audio file and its
  matching metadata. Canceling leaves both intact.
- Do not cap stored audio, prune it automatically, add cloud sync, or add paid
  tier behavior. If the metadata write fails after synthesis, keep and return
  the generated file; directory scanning still makes it discoverable with
  file-only details.
- Restrict listing and deletion to regular WAV/MP3 files directly inside the
  app-data `outputs` directory. A missing output file is omitted from the
  playable list. A failed file deletion leaves the visible entry and metadata
  available for retry.
- Show localized English and Vietnamese labels, loading, empty, error, retry,
  and delete-confirmation states. A history read failure must not appear as an
  empty history.

## Data and sidecar contract

- Bump the existing SQLite `user_version` from 2 to 3 and add `audio_history`
  with the output filename as its key, plus provider, voice label, format,
  text, and UTC creation time. Do not store audio bytes or absolute paths in
  the database.
- Add JSONL `list_audio_history` and `delete_audio_history` operations. Listing
  merges rows in `audio_history` with eligible files found in `outputs`, using
  file modification time and null synthesis metadata for files without a row.
  Each item includes a basename ID, resolved audio path, format, creation
  time, nullable provider/voice/text metadata, and whether metadata is
  available.
- Deletion accepts `file_name` containing only an item basename returned by
  listing. The JSONL envelope keeps its reserved `id` request-correlation
  field. Resolve the item beneath `outputs`, reject path traversal and
  symlinks, remove the audio file, then remove its metadata row. Synthesis
  continues returning the existing `{audio_path, format}` result.
- Register history metadata only after either provider has successfully
  produced its output. Store a profile name for profile synthesis, a preset ID
  for preset synthesis, and stable generic labels for auto, design, and
  one-off reference modes; do not persist a one-off reference file path.

## Affected areas

- `src/tts_mcp/engine.py` and `tests/test_engine.py`: schema migration and
  local metadata CRUD.
- `src/tts_mcp/desktop.py` and `tests/test_desktop.py`: JSONL list/delete,
  output-directory reconciliation, synthesis metadata registration, and safe
  file deletion.
- `apps/desktop/src/lib/sidecar.ts`: history response types and client usage.
- `apps/desktop/src/App.tsx`: sidebar navigation, history view, playback,
  confirmed deletion, and five-item workspace take limit.
- `apps/desktop/src/lib/i18n.ts`: English and Vietnamese history copy.

## Verification approach

- Test fresh schema creation, v2-to-v3 migration with existing voice data
  preserved, metadata round-trip, and metadata deletion.
- Test OmniVoice and VieNeu history registration, legacy file discovery,
  directory/path validation, delete confirmation contract, failed metadata
  writes, and structured sidecar errors.
- Build the desktop UI and manually verify generation, app restart, all-history
  playback, the five-take workspace limit, cancel/confirm deletion, and local
  file removal.

## Related context

- [Architecture overview](../../llm/architecture/overview.md)
- [Desktop speech providers](../../llm/workflows/desktop-vieneu.md)

## Sources

- `src/tts_mcp/desktop.py`
- `src/tts_mcp/engine.py`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/AudioPlayer.tsx`
- `apps/desktop/src/components/ui.tsx`
- `apps/desktop/src/lib/sidecar.ts`
- `apps/desktop/src/lib/i18n.ts`
- `tests/test_desktop.py`
- `tests/test_engine.py`
- `docs/llm/architecture/overview.md`
- `docs/llm/workflows/desktop-vieneu.md`

## Impact map

Entry: `src/tts_mcp/desktop.py::dispatch_request`; `apps/desktop/src/App.tsx::synthesize` and desktop view routing
Flow: React `synthesize` → `SidecarClient.request` → desktop JSONL `dispatch_request` → OmniVoice `_synthesize` or `VieNeuProvider.synthesize` → `OUTPUT_DIR`; planned `list_audio_history`/`delete_audio_history` sidecar operations → React Audio History view
State changes: SQLite `volo.db` schema v3 adds synthesis metadata; audio remains in the existing app-data `outputs` directory; no automatic audio deletion
External effects: local SQLite writes; local file discovery, playback, and confirmed deletion; no network effect
Change candidates: `src/tts_mcp/engine.py`, `src/tts_mcp/desktop.py`, `tests/test_engine.py`, `tests/test_desktop.py`, `apps/desktop/src/lib/sidecar.ts`, `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/i18n.ts`
Verification: focused engine and desktop sidecar tests; full Python unit suite; Python compile check; desktop UI build; manual local generation/history/delete check
Verified at: `8a4205feba8f656ee61b6a3d8921c78e86406037`

## Execution

Plan: [Desktop Audio History implementation](../plans/2026-10-08-desktop-audio-history-plan.md) — approved by the user on 2026-10-08.
