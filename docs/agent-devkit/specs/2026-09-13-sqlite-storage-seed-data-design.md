# Volo AI SQLite Storage and Bundled Seed Data

## Status

Approved by the user on 2026-09-13 for production-oriented implementation.

## Related context

- [Architecture overview](../../llm/architecture/overview.md)

## Product intent

Make Volo AI's persistent app data portable and production-safe. Voice
metadata and seed state should live in a local SQLite database, while large
model and audio artifacts remain ordinary files. Built-in voices should be
shipped as versioned seed folders and copied into app data during setup so the
installed app never depends on `/Users/nus/projects/Asta/...`.

## Decisions

- Use Python's standard-library `sqlite3` in the existing sidecar. Do not add a
  second database boundary or a frontend SQL plugin for this feature.
- Store the database at `${TTS_MCP_DATA_DIR}/volo.db`.
- Add `voice_profiles` for profile metadata and `app_seeds` for idempotent
  seed records. The existing `save_voice`, `list_voices`, and `delete_voice`
  operations remain the UI's profile contract; a sidecar-only
  `import_seed_voices` operation owns seed-folder discovery and idempotency.
- Store profile language and a per-language `is_default` flag. A seed can
  claim the default only when that language has no existing default; user
  choices are never overwritten by a later app launch or seed version.
- Keep model weights, generated audio, clone prompts, and copied reference
  recordings on the filesystem. SQLite stores their paths and text metadata,
  never the binary blobs.
- When any profile is saved, copy its reference recording into the app's
  `voices/` directory before creating the clone prompt. Metadata points to the
  copied file, so saved profiles remain usable if the original is moved.
- Bundle a versioned seed folder under the app repository. Its manifest
  contains the stable seed id, profile name, language, default flag, optional
  transcript, and a relative audio filename. Resolve the bundled seed-folder
  root at runtime and pass it to `import_seed_voices`; the sidecar validates
  the manifest, copies each audio file into app data, and stores only
  app-local relative paths.
- Migrate legacy `voices/*.json` metadata and existing `*.pt` prompts into the
  database on first access. If a legacy reference file still exists, copy it
  into app data; if it does not, retain the path only as legacy metadata while
  the already-created prompt remains usable.
- A successfully processed seed version is recorded in `app_seeds`, so
  deleting the demo profile later does not recreate it automatically.

## Scope

### Database

Create the database with an explicit schema version and ordered migrations.
Enable foreign keys, WAL journaling, a busy timeout, and parameterized SQL.
The profile table contains the validated profile name, language, local
reference path, optional transcript, clone-prompt path, default flag, and
timestamps. The seed table contains a stable seed key, version, and
timestamp. Profile-name and per-language-default uniqueness are enforced by
the database as well as application validation.

### Profile lifecycle

`save_voice` validates the source audio, copies it into a profile-owned app-data
directory, creates the prompt from that local copy, and commits metadata.
`list_voices` reads the database and returns the existing JSON shape plus
language/default fields. `delete_voice` removes the DB row, prompt, copied
reference file, and any legacy metadata file for that profile.

### First-run seed

The desktop resolves the bundled `resources/seed-voices` directory after the
model is ready and calls `import_seed_voices`. The first folder is:

```text
seed-voices/omnivoice-demo/
  manifest.json
  reference.wav
```

Its manifest declares seed key `omnivoice-demo`, version `1`, profile name
`OmniVoice-Demo`, language `vi`, default `true`, the supplied Vietnamese
reference transcript, and `reference.wav` as its audio file.

Missing resources or seed errors are logged and do not fail model setup.

### Compatibility and non-goals

- Keep the current Tauri/React/JSONL boundaries and extend the profile
  response shape only with `language` and `is_default`.
- Keep generated outputs and model caches outside the database.
- Do not add cloud sync, authentication, or a remote database in this change.
- Do not depend on the developer's absolute sample path at runtime.

## Affected files

- `src/tts_mcp/engine.py` — SQLite schema, legacy migration, profile file
  copying, and profile CRUD.
- `src/tts_mcp/desktop.py` — `import_seed_voices` request dispatch and response.
- `apps/desktop/src/App.tsx` — resolve the bundled resource and call the seed
  operation after model readiness.
- `apps/desktop/src/lib/sidecar.ts` — update the `VoiceProfile` type with
  language/default fields.
- `apps/desktop/src-tauri/tauri.conf.json` — bundle the seed WAV resource.
- `apps/desktop/src-tauri/capabilities/default.json` — retain only permissions
  needed by the resulting resource/data flow.
- `apps/desktop/src-tauri/resources/seed-voices/omnivoice-demo/manifest.json`
  — versioned demo voice manifest.
- `apps/desktop/src-tauri/resources/seed-voices/omnivoice-demo/reference.wav`
  — bundled demo reference audio copied from the user-provided source.
- `tests/test_engine.py` and `tests/test_desktop.py` — database, migration,
  copy, idempotency, and protocol coverage.

## Verification

- Unit tests prove schema migration, profile persistence, legacy migration,
  reference-file copying, manifest validation, per-language default behavior,
  seed idempotency, and structured sidecar errors.
- `python -m unittest discover -s tests -v`
- `python -m compileall -q src tests`
- `npm --prefix apps/desktop run format:check`
- `npm --prefix apps/desktop run build`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `npm --prefix apps/desktop run tauri build -- --bundles app`
- Manual packaged-app smoke confirms the seeded profile remains present after
  the source sample path is unavailable and that the profile card shows the
  app-local copied filename, language, and default badge.

## Execution

Execution plan: [Volo AI SQLite Storage and Bundled Seed Data plan](../plans/2026-09-13-sqlite-storage-seed-data-plan.md)
