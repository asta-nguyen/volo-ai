# Volo AI SQLite Storage and Bundled Seed Data plan

## Approved design

[Volo AI SQLite Storage and Bundled Seed Data](../specs/2026-09-13-sqlite-storage-seed-data-design.md)

The user approved a production-oriented SQLite storage layer, versioned seed
folders, app-local asset copies, and per-language default voices on
2026-09-13.

## Approval Gate

Required: yes
Reason: this adds a persistent database schema, a new sidecar operation, a
bundled application resource, profile response fields, and migration behavior.
Status: approved

## Decision Log

- 2026-09-13 — This is production-oriented work, not an MVP shortcut.
- 2026-09-13 — Use Python standard-library `sqlite3` in the sidecar; do not
  add a second Tauri/frontend database boundary.
- 2026-09-13 — Seed voices are versioned folders containing a manifest and
  reference audio; setup imports the bundled folder instead of using an
  external absolute path.
- 2026-09-13 — Seed defaults are per language. A seed never overwrites an
  existing user/default profile, and deleting a seeded profile does not cause
  it to be recreated.
- 2026-09-13 — Keep Auto voice as the initial workspace mode; when the user
  chooses Saved Profile for a language, select that language's default profile
  when one exists.
- 2026-09-13 — The packaged installer must include the complete seed folder and
  sidecar resource flow so a user can install and use the default voice without
  the source repository or the developer's filesystem path.
- 2026-09-13 — Expose seed import in the Voice Profiles view. The user selects
  a root folder containing one subfolder per seed; each seed keeps the existing
  `manifest.json` plus declared audio contract. Import remains best-effort and
  refreshes the local profile library with imported, skipped, and error counts.

## Tasks

### Task 1 — Add the production SQLite schema and connection boundary

Files:

- `src/tts_mcp/engine.py` — add `DB_PATH`, schema version, connection setup,
  ordered migration, parameterized query helpers, and relative app-data path
  resolution near the existing data-directory constants and profile methods.
- `tests/test_engine.py` — add isolated temporary-data tests for schema
  creation, SQLite pragmas, profile columns, and the per-language default
  uniqueness rule.

Files inspected, no change:

- `src/tts_mcp/desktop.py` — current sidecar dispatch imports `DATA_DIR` and
  delegates profile operations to `Engine`.
- `src/tts_mcp/cli.py` — current CLI calls `Engine.save_voice` and
  `Engine.list_voices`.
- `src/tts_mcp/server.py` — current MCP profile tools call the same engine.

Interfaces:

- Later tasks use `Engine` as the only persistence boundary.
- `DATA_DIR`, `VOICES_DIR`, and existing profile method names remain available
  to current callers.

Change:

1. Write a failing test that patches the engine data/database paths to a
   temporary directory, calls the new database initializer, and asserts that
   `volo.db` contains `voice_profiles` and `app_seeds`.
2. Add schema version `1` using `PRAGMA user_version`, with ordered migration
   code that enables `foreign_keys=ON`, `journal_mode=WAL`, and
   `busy_timeout=5000` for each connection.
3. Create `voice_profiles` with validated name primary key, `language`, local
   reference path, prompt path, optional transcript, `is_default`, optional
   seed key/version, and created/updated timestamps. Add a partial unique index
   allowing at most one default per language.
4. Create `app_seeds` with seed key primary key, version, and installed time.
   Use parameterized SQL and commit schema changes atomically.
5. Run the targeted engine tests and keep the database initializer reusable by
   all profile operations.

Verify:

- `rtk python -m unittest tests.test_engine.EngineTests -v`

### Task 2 — Persist profiles and migrate legacy files without external paths

Files:

- `src/tts_mcp/engine.py` — replace JSON profile reads/writes with SQLite
  persistence, copy reference files into profile-owned app-data directories,
  save prompts beside them, and migrate legacy `voices/*.json`/`*.pt` files.
- `tests/test_engine.py` — cover profile save, local reference copy, list/load,
  delete cleanup, and legacy migration.

Interfaces:

- `save_voice(name, ref_audio, ref_text=None, language="en", *, seed_key=None,
  seed_version=None, is_default=False)` remains backward-compatible for CLI and
  MCP callers while allowing desktop/seed metadata.
- `list_voices()` returns the current `name`, `ref_audio`, and `ref_text`
  fields plus `language` and `is_default`.
- `load_voice(name)` resolves the prompt path from SQLite, not from the
  developer's original filesystem path.

Change:

1. Write a failing test with a valid temporary WAV and a fake clone prompt
   object whose `save()` writes a file; assert that saving creates
   `voices/<profile>/reference.wav`, `voices/<profile>/prompt.pt`, and a DB row
   whose paths are app-local.
2. Implement atomic reference copying into the profile directory before prompt
   creation. Validate the profile name, language, extension, and source file at
   the existing trust boundary; never construct a destination from an
   unvalidated name.
3. Save prompt and metadata in one profile transaction. On a failed DB commit,
   remove only files created by that attempt and leave any previous profile
   intact.
4. Make `list_voices` query SQLite and return absolute paths resolved from the
   stored app-relative paths so existing UI filename rendering continues to
   work.
5. Make `load_voice` query the stored prompt path and `delete_voice` remove the
   DB row plus profile-owned prompt/reference files and any matching legacy
   metadata. Missing cleanup files are harmless; unrelated paths are never
   deleted.
6. On first database access, migrate legacy JSON metadata and prompts. Copy a
   still-existing reference into the profile-owned directory; if the old
   reference is unavailable, store a null reference path while preserving the
   existing prompt. Keep migration idempotent and leave legacy files untouched
   until the corresponding profile is explicitly deleted.
7. Run the targeted engine tests.

Verify:

- `rtk python -m unittest tests.test_engine.EngineTests -v`

### Task 3 — Add the seed-folder importer and sidecar contract

Files:

- `src/tts_mcp/engine.py` — add manifest validation, safe seed-folder scan,
  per-language default selection, and `import_seed_voices()`.
- `src/tts_mcp/desktop.py` — dispatch `import_seed_voices` and return imported,
  skipped, and per-folder error results.
- `tests/test_engine.py` — cover valid/invalid manifests, path traversal,
  duplicate defaults, seed idempotency, and no-overwrite behavior.
- `tests/test_desktop.py` — cover the JSONL request/result contract and
  structured invalid-input/not-found errors.

Interfaces:

- `import_seed_voices(seed_dir: str) -> dict[str, list[dict[str, str]]]`
  consumes a directory containing one subdirectory per seed. Each subdirectory
  must contain `manifest.json` and the declared audio file.
- The desktop request is `{ "type": "import_seed_voices", "seed_dir": path }`.
  The response contains `imported`, `skipped`, and `errors`; one bad seed does
  not prevent other valid seeds from importing.

Change:

1. Write failing tests for a manifest containing `id`, `version`, `name`,
   `language`, `default`, `ref_text`, and relative `audio`; reject missing
   fields, unsupported languages/extensions, unreadable audio, absolute audio
   paths, and `..` traversal.
2. Implement deterministic sorted folder discovery and stable seed keys. Record
   a seed version in `app_seeds` only after the profile copy, prompt creation,
   and profile transaction succeed.
3. Skip already-installed seed versions. If a profile name already exists or a
   user has already chosen a default for the language, keep the existing data
   and record the seed as processed without overwriting it.
4. For `default: true`, set `is_default=1` only when the language has no
   default. User-created profiles default to `0` unless explicitly changed by
   this importer.
5. Add the sidecar dispatch branch with existing structured error handling and
   add tests for success and malformed requests.
6. Run both targeted test modules.

Verify:

- `rtk python -m unittest tests.test_engine.EngineTests tests.test_desktop.DesktopWorkerTests -v`

### Task 4 — Ship seed folders as Tauri resources and import after setup

Files:

- `apps/desktop/src-tauri/resources/seed-voices/omnivoice-demo/manifest.json`
  — add the versioned manifest with `OmniVoice-Demo`, language `vi`, default
  true, exact supplied transcript, and `reference.wav`.
- `apps/desktop/src-tauri/resources/seed-voices/omnivoice-demo/reference.wav`
  — copy the user-provided sample into the repository resource bundle.
- `apps/desktop/src-tauri/tauri.conf.json` — include `resources/seed-voices`
  in the bundle resource list.
- `apps/desktop/src-tauri/capabilities/default.json` — remove permissions that
  were only needed to probe the old external absolute path and retain the
  minimal existing app-data/resource permissions.
- `apps/desktop/src/App.tsx` — resolve the bundled seed directory and invoke
  the importer after model readiness; remove the hard-coded developer path and
  WebView seed marker.
- `apps/desktop/src/lib/sidecar.ts` — extend `VoiceProfile` with `language`
  and `is_default`.
- `apps/desktop/src/lib/i18n.ts` — add localized seed import log/default badge
  labels.

Interfaces:

- `App` passes only the resolved bundled resource path to the sidecar.
- No persisted profile metadata contains the external Asta source path.
- Setup remains best-effort: a missing resource or import error is logged and
  does not make a ready model unusable.

Change:

1. Add the manifest and copy the exact WAV as a binary repository resource.
2. Configure Tauri to bundle the complete `seed-voices` directory.
3. Replace `ensureDefaultVoiceProfile` with a call to `resolveResource` and
   `import_seed_voices` after both ready-state detection and model download.
   Refresh voices after the importer returns; do not write a localStorage seed
   marker.
4. Remove the old `exists` permission/import and keep the sidecar request path
   independent of the source project directory.
5. Update TypeScript profile fields and localized operation/default labels.
6. Run the frontend type/build check before packaging.

Verify:

- `rtk npm --prefix apps/desktop run build`
- `rtk cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

### Task 5 — Make default voices visible and selected by language

Files:

- `apps/desktop/src/App.tsx` — sort/default-select profiles by synthesis
  language and display default/language metadata.
- `apps/desktop/src/lib/i18n.ts` — add English/Vietnamese copy for language
  labels, default voice badges, and seed import operation text.
- `src/tts_mcp/cli.py` — add an optional `--language {en,vi}` to `save-voice`
  and pass it to the engine.
- `src/tts_mcp/server.py` — expose an optional `language="en"` parameter on
  `save_voice` and document it.
- `tests/test_desktop.py` and `tests/test_engine.py` — verify language reaches
  saved profiles and old callers still default to English.

Interfaces:

- `VoiceProfile.language` and `VoiceProfile.is_default` are the source of
  truth for UI selection and badges.
- The workspace remains initially in Auto voice. Switching to Saved Profile
  or changing synthesis language selects that language's default profile when
  available, otherwise the first compatible profile, otherwise no profile.

Change:

1. Add failing tests for default profile selection and language persistence.
2. Send the current synthesis language when saving a profile from the desktop.
3. Add the default-selection helper and invoke it when voices, mode, or
   synthesis language changes without overriding an explicit compatible user
   selection.
4. Show language and `Default`/`Mặc định` badges in the profile library and
   saved-profile selector.
5. Add CLI/MCP optional language forwarding with `en` compatibility default.
6. Run the focused frontend/backend checks.

Verify:

- `rtk python -m unittest tests.test_engine.EngineTests tests.test_desktop.DesktopWorkerTests -v`
- `rtk npm --prefix apps/desktop run format:check`
- `rtk npm --prefix apps/desktop run build`

### Task 6 — Review, package, verify, and refresh source-grounded docs

Files:

- `docs/llm/INDEX.md` — update the feature inventory for SQLite profiles and
  bundled seed folders.
- `docs/llm/architecture/overview.md` — document DB/file boundaries,
  migrations, app-local profile assets, and seed import.
- `docs/llm/LOG.md` — record the verified source paths and behavior.

Interfaces:

- Documentation describes only behavior verified against the final source and
  packaged artifact.

Change:

1. Run the complete repository checks from `AGENTS.md` plus frontend format,
   package the macOS app, and inspect the final diff for stale external-path
   references.
2. Launch the packaged app, wait for model readiness, open Voice Profiles, and
   confirm `OmniVoice-Demo` shows `reference.wav`, language `vi`, and the
   default badge. Confirm the profile DB row points under app data.
3. Update the wiki only after the source and artifact checks pass.
4. Run the final review checklist and leave all changes uncommitted.

Verify:

- `rtk python -m unittest discover -s tests -v`
- `rtk python -m compileall -q src tests`
- `rtk npm --prefix apps/desktop run format:check`
- `rtk npm --prefix apps/desktop run build`
- `rtk cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `rtk npm --prefix apps/desktop run tauri build -- --bundles app`
- `rtk git diff --check`
- `rtk rg -n "/Users/nus/projects/Asta|default-voice-profile-seeded" src apps/desktop docs/llm`

## Spec gaps

None. The plan covers the approved production storage, migration, bundled
seed-folder, per-language default, and portability requirements.
