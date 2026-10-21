Issue: #2
Branch: `feat/2-audio-history-rename-copy-path`

# Audio History Rename and Copy Path

## Goal

Let users rename generated audio files from Audio History and copy the exact local path of an item.

## Scope

- Rename actual WAV/MP3 files directly under the app-data `outputs` directory.
- Preserve each file's extension and existing synthesis metadata. Legacy files without metadata remain supported.
- Add Copy path to each Audio History item. The copied value is a local filesystem path, not a public URL.
- Keep current Workspace takes and its active player valid when a file is renamed.
- Do not add a database schema migration, cloud storage, bulk rename, or saved voice-profile rename.

## Behavior

- Each History row offers Rename and Copy path actions.
- Rename edits only the filename stem; the original `.wav` or `.mp3` extension is retained.
- Trim surrounding whitespace. Reject an empty stem, `.` or `..`, path separators, control characters, Windows-reserved filename characters, Windows device names, and stems ending in a dot or space. Preserve Unicode names.
- Never overwrite a file. A destination collision returns a visible error and leaves the original file and metadata unchanged.
- A successful filesystem rename updates the SQLite `audio_history.file_name` key when a metadata row exists. All other metadata remains unchanged. A legacy file without a metadata row is renamed without creating metadata.
- If the metadata update fails after the file rename, attempt to restore the original filename. If restoration also fails, report the actual filename so directory scanning can still discover the audio; do not delete either file.
- After success, reset paginated History to its first page because the filename is part of the cursor ordering. Update matching Workspace take and active-result paths without discarding the audio.
- Copy path writes the item's absolute `audio_path` to the system clipboard and displays localized success feedback.

## Edge cases

- Reject a missing file, a symbolic link, an item outside `outputs`, a malformed filename, and an existing destination without modifying unrelated files.
- A metadata-free legacy output can be renamed and remains metadata-free.
- A database failure must not lose the audio or its previous metadata; filesystem rollback is attempted and any rollback failure is surfaced.
- Renaming an item on a later History page must refresh pagination so cursors do not skip or duplicate items.
- If the renamed file is the active Workspace result or one of the five session takes, update those in-memory paths so playback continues.
- Clipboard failure leaves the file untouched and reports that copying failed.

## Interfaces

- Add a JSONL `rename_audio_history` sidecar operation with `file_name` and `new_name` fields. `new_name` is a filename stem without an extension. Return the renamed basename and absolute audio path.
- Add `Engine.rename_audio_history(old_file_name, new_file_name)` to change the metadata primary-key value while preserving the row's metadata; return whether a row was present and updated.
- Add a safe `_rename_audio_history` operation in `src/tts_mcp/desktop.py` that validates both names, verifies the source is a regular direct child of `OUTPUT_DIR`, rejects symlinks and collisions, renames the file, updates metadata, and attempts rollback on metadata failure.
- Add a typed `SidecarClient` response and the Rename/Copy path actions to `AudioHistoryView`. Keep the existing synthesis response unchanged.

## Verification

- Add engine and desktop-sidecar tests for metadata-preserving rename, legacy-file rename, invalid names, path traversal, symlinks, collision, missing source, file-operation failure, and metadata-update/rollback failure.
- Build the desktop app and manually verify rename, replay, copy-path feedback, pagination refresh, and Workspace playback for both a metadata-backed file and a legacy file.
- Update the architecture wiki only after the current source and tests establish the behavior.

## Related context

- [Architecture overview](../../../../llm/architecture/overview.md)
