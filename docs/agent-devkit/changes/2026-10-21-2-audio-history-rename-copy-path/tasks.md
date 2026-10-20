# Audio History Rename and Copy Path tasks

Issue: #2
Branch: `feat/2-audio-history-rename-copy-path`

## Design

[Audio History Rename and Copy Path](design.md)

## Global Constraints

- Keep audio files directly under the app-data `outputs` directory; SQLite stores basenames and metadata only.
- Preserve WAV/MP3 extensions and synthesis metadata when renaming; do not add a schema migration.
- Reject invalid names, symlinks, traversal, missing files, and destination collisions; never overwrite another output.
- If a metadata update fails, attempt filesystem rollback and preserve a discoverable audio file.
- Reset History pagination and update Workspace paths after a successful rename.
- Copy a local filesystem path, not a public URL.

## Impact map

Entry: `src/tts_mcp/desktop.py::dispatch_request`; `apps/desktop/src/App.tsx::AudioHistoryView`
Flow: React Audio History → `SidecarClient.request` → JSONL `dispatch_request` → planned `_rename_audio_history` → output file and `Engine.rename_audio_history`; Copy path → system clipboard; planned success update → History pages and Workspace take/result state
State changes: output basename changes; matching SQLite `audio_history.file_name` primary key changes while other metadata remains intact; matching in-memory Workspace paths change; no schema migration
External effects: local filesystem rename, local SQLite update, system clipboard write; no network effect
Change candidates: `src/tts_mcp/engine.py::Engine`, `src/tts_mcp/desktop.py::dispatch_request`, `tests/test_engine.py`, `tests/test_desktop.py`, `apps/desktop/src/lib/sidecar.ts::SidecarClient`, `apps/desktop/src/App.tsx::AudioHistoryView`, `apps/desktop/src/lib/i18n.ts`, `docs/llm/architecture/overview.md`, `docs/llm/INDEX.md`
Verification: focused engine and desktop sidecar tests; full Python suite; Python compile check; desktop build; manual metadata-backed and legacy rename/play/copy checks
Verified at: `2a96ee839635f5ca76126eddcd2731c436a63158`

## Tasks

### Task 1 — [Python] Rename output safely and keep metadata linked

Files: `src/tts_mcp/engine.py::Engine.rename_audio_history`, `src/tts_mcp/desktop.py::_rename_audio_history`, `src/tts_mcp/desktop.py::dispatch_request`, `tests/test_engine.py::EngineTests`, `tests/test_desktop.py::DesktopWorkerTests`

Interfaces: Add `Engine.rename_audio_history(old_file_name, new_file_name)` and the `rename_audio_history` JSONL operation with `file_name` and `new_name` (stem only); return the final basename and absolute audio path.

Change: Validate a WAV/MP3 basename directly under `OUTPUT_DIR`; reject empty, dot, separator, control, Windows-reserved, trailing-dot/space, symlink, missing-source, and existing-target cases. Rename without overwriting. Update the metadata filename key without changing other fields; do not create a row for legacy files. If the metadata update fails, attempt to restore the old filename and return a structured error while preserving a discoverable file.

Verify: `rtk .venv/bin/python -m unittest discover -s tests -p test_engine.py -v` and `rtk .venv/bin/python -m unittest discover -s tests -p test_desktop.py -v` pass. Cases: recorded item → same metadata under new basename; legacy item → renamed and still file-only; invalid/traversal/symlink/missing/collision → no unrelated file changes; injected metadata failure → original filename restored; injected restore failure → actual new filename remains listable and is reported.

Progress: todo
Result: none

### Task 2 — [Desktop UI] Rename history items and copy paths

Files: `apps/desktop/src/lib/sidecar.ts::SidecarClient`, `apps/desktop/src/App.tsx::AudioHistoryView`, `apps/desktop/src/App.tsx::deleteHistoryMutation`, `apps/desktop/src/lib/i18n.ts::createUiCopy`

Interfaces: Add the typed sidecar rename request/result. Add row actions for Rename and Copy path with localized labels, validation feedback, collision/error feedback, and copied feedback.

Change: Submit only the new stem and preserve the displayed file extension. On success, reset the infinite History query to the first page and update matching Workspace take and active-result paths. Keep the existing file playback and confirmed-delete behavior intact. Copy the absolute local path from the selected history item.

Verify: `rtk npm --prefix apps/desktop run build` passes. Manual desktop QA renames an item on a later page and verifies the new name/order, playback, Workspace take/player, metadata display, and copy feedback; a rejected collision leaves the old row and file intact.

Progress: todo
Result: none

### Task 3 — [Docs] Update verified Audio History coverage

Files: `docs/llm/architecture/overview.md::Audio History`, `docs/llm/INDEX.md::Feature inventory`

Interfaces: None.

Change: After Tasks 1–2 pass, update only the existing Audio History behavior and sources to describe safe rename, metadata preservation, copy-path behavior, and pagination refresh. Keep the wiki source-grounded; do not document planned or unverified behavior.

Verify: Run the `document-wiki` task-update procedure and its wiki validator; confirm every source path exists and the architecture/index links resolve.

Progress: todo
Result: none

## Files inspected, no change

- `docs/agent-devkit/specs/2026-10-08-desktop-audio-history-design.md` — existing History scope and safety contract.
- `docs/agent-devkit/plans/2026-10-08-desktop-audio-history-plan.md` — implemented History and pagination boundaries.
- `apps/desktop/src/components/AudioPlayer.tsx` — existing local path copy behavior in Workspace.
- `docs/llm/architecture/overview.md` — current app-data and Audio History behavior.

## Baseline

- 2026-10-21 before feature code: `.venv/bin/python -m unittest discover -s tests -v` passed all 152 tests; `.venv/bin/python -m compileall -q src tests` passed; desktop production build passed with the existing large-chunk warning.
- The shell's global Python 3.10 has `mcp==1.27.2` and fails to collect `tests/test_server.py`; use the repository `.venv` for Python checks.

## Approval Gate

Status: approved

## Decision Log

None.
