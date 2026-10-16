# VieNeu preset seed pack — implementation plan

## Approved design

[VieNeu preset seed pack](design.md)

## Global Constraints

- Seeding starts only from the explicit Voice Profiles action and reads the
  validated local VieNeu manifest; it never starts at app launch or downloads
  model assets.
- Generate the exact Vietnamese transcript
  `Xin chào. Đây là mẫu giọng được tạo để lưu vào thư viện giọng nói của bạn.`
  for each preset and store its WAV with profile assets, outside Audio History.
- Repeated and concurrent seed actions converge on one profile identity and
  one WAV per preset. Reuse valid audio, preserve ambiguous/name-conflicting
  profiles, and keep successful records when another preset fails or the batch
  is cancelled.
- Keep one profile per seeded voice. VieNeu selects the preset ID when present;
  OmniVoice selects the saved WAV and transcript when present. Pure preset
  profiles fail clearly on OmniVoice. Do not add implicit provider fallback or
  change MCP tool signatures; standalone CLI stays OmniVoice-only.
- Migrate SQLite v4 to v5 transactionally while preserving profile rows and
  files, installed seed metadata, and audio history. Keep pure preset rows and
  Clone/Design replacement behavior valid. Older binaries continue to reject
  schema v5.
- Deleting a seeded profile removes its profile metadata and generated WAV,
  while preserving VieNeu model and preset assets.

## Impact map

Entry: `apps/desktop/src/App.tsx::seedVieNeuVoices`, `App.deleteProfile`; `Engine.delete_voice`
Flow: Voice Profiles seed button → `SidecarClient.request` → JSONL `run_protocol` worker → `dispatch_request` → validated VieNeu manifest and `VieNeuProvider.synthesize` → `Engine.save_vieneu_seed_reference` → desktop/MCP/CLI provider routing; Voice Profiles delete → desktop sidecar, CLI, or MCP → `Engine.delete_voice` → owned profile WAV and SQLite row
State changes: SQLite schema v5 stores seeded preset ID, reference WAV, and transcript on one profile; deletion removes that row and only its owned WAV; existing profile and audio-history state is preserved
External effects: Local CPU synthesis through `audiocpp_cli`; WAV and profile metadata writes under app data; no model downloads or Audio History writes; deletion unlinks the profile-owned WAV
Change candidates: `src/tts_mcp/engine.py`, `src/tts_mcp/desktop.py`, `src/tts_mcp/server.py`, `src/tts_mcp/cli.py`, `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/sidecar.ts`, `apps/desktop/src/lib/i18n.ts`, `tests/test_engine.py`, `tests/test_desktop.py`, `tests/test_server.py`, `tests/test_cli.py`, `docs/llm/workflows/desktop-vieneu.md`, `docs/llm/workflows/mcp-voice-library.md`
Verification: Full unittest suite; Python compile check; desktop build; Cargo check; targeted unlink-failure regression test; manual seed, retry, collision, cancellation, deletion, and provider-switch flows
Verified at: `190055a8396547eaaa21e0fb38de8d6cd664edf5`

## Tasks

### Task 1 — Migrate profile storage and persist seeded references

Files:

- `src/tts_mcp/engine.py::DB_SCHEMA_VERSION`, `_open_database`, `Engine.save_vieneu_seed_reference`, `Engine.list_voices`, and `Engine.delete_voice`
- `tests/test_engine.py::EngineTests`

Interfaces: Advance the profile database to schema v5. Add
`Engine.save_vieneu_seed_reference(preset_id, stable_name, wav_path, ref_text) -> str`.
It rechecks the preset ID inside a write transaction, adopts the single
existing preset profile when present, creates the deterministic ID-derived
profile name when absent, and returns the resolved profile name. It rejects
multiple matching preset rows and Clone/Design name collisions without
modifying them. Repeated saves use the same profile-scoped `reference.wav`
destination and return the same profile identity. `Engine.list_voices` exposes
the preset ID, reference WAV, and transcript on the same `vieneu_preset` row.

Change: Rebuild `voice_profiles` transactionally for v5 so a
`vieneu_preset` row may have either no reference fields or both a reference WAV
path and transcript, while keeping its language, prompt, design, default, and
seed constraints. Preserve rows/files, `app_seeds`, and `audio_history` through
the v4 migration; keep earlier migration paths working. Store the WAV through
the existing profile staging/atomic-file pattern and serialize same-ID row
writes so concurrent calls resolve to one primary-key row and one final WAV.
Update deletion to remove the seeded row and only its owned WAV; leave unrelated
profile-directory files and VieNeu model assets intact. Keep pure presets and
Clone/Design save behavior unchanged.

Verify:

- `test_schema_v4_migrates_preset_profiles_and_preserves_all_state` — a v4
  database with Clone, Design, preset, seed, audio-history, and profile-file
  data opens as v5 with rows and files preserved.
- `test_schema_v4_migration_failure_keeps_original_database` — an injected
  migration failure leaves the v4 version and original rows intact.
- `test_save_vieneu_seed_reference_keeps_id_audio_and_transcript_together` —
  a WAV and transcript are exposed on the matching preset profile row.
- `test_save_vieneu_seed_reference_is_idempotent_and_concurrent` — repeated
  and concurrent saves for one ID leave one profile row and one valid WAV.
- `test_save_vieneu_seed_reference_preserves_ambiguous_and_name_conflicts` —
  multiple matching IDs or a Clone/Design name collision leave those rows and
  files unchanged.
- `test_delete_seeded_vieneu_profile_removes_only_owned_wav` — deletion removes
  the generated WAV and metadata but leaves unrelated files and model assets.
- `test_delete_seeded_vieneu_profile_preserves_metadata_when_wav_unlink_fails` —
  an unlink error leaves the profile row and WAV available for retry.
- Run `rtk python -m unittest discover -s tests -p test_engine.py -v`.

Progress: done
Result: `rtk .venv/bin/python -m unittest discover -s tests -p test_engine.py -v` — 30 tests passed, including rollback after a failed database delete (backfilled).

Files inspected, no change:

- `src/tts_mcp/desktop_vieneu.py::VieNeuProvider.status` — validated manifest
  supplies unique preset IDs and display names.
- `src/tts_mcp/desktop.py::dispatch_request` — next task consumes the storage
  API through the sidecar boundary.

### Task 2 — Add the cancellable VieNeu batch operation

Files:

- `src/tts_mcp/desktop.py::dispatch_request` and `run_protocol`
- `tests/test_desktop.py::DesktopWorkerTests`

Interfaces: Add the sidecar request
`{"type":"seed_vieneu_voices"}`. Emit progress events with
`phase: "seed_vieneu"`, `preset_id`, `current`, `total`, and `message`. Return
`profiles: [{preset_id, name, status}]`,
`failed: [{preset_id, message}]`, `unfinished: [preset_id]`, and
`cancelled: boolean`. `status` is `created`, `updated`, or `reused`. The
operation consumes Task 1's `Engine.save_vieneu_seed_reference` and
`Engine.list_voices` interfaces. `cancel` targets the seed request ID using the
existing JSONL control message.

Change: Check the VieNeu manifest, model, preprocessing, and runtime readiness
before any profile writes; return actionable guidance without calling model
preparation when unavailable. For each validated manifest row, reuse a
readable saved WAV or synthesize the fixed sentence in Vietnamese through the
existing preset path, persist it through Task 1, emit progress, and continue
after per-preset errors. Write generated files to temporary/profile storage,
never `OUTPUT_DIR`, and do not record Audio History. Run seed requests in
cancellable workers so concurrent requests reach the idempotent storage path.
Honor cancellation at preset boundaries: finish and persist the active preset,
then stop scheduling work and return all unattempted IDs as `unfinished`.

Verify:

- `test_seed_vieneu_voices_requires_ready_manifest_and_runtime` — unavailable
  or invalid readiness returns an actionable error and performs no profile
  writes or model download.
- `test_seed_vieneu_voices_synthesizes_every_manifest_preset` — two manifest
  entries produce two calls with the fixed Vietnamese sentence, two profile
  records, and progress events.
- `test_seed_vieneu_voices_reuses_valid_and_regenerates_missing_audio` — a
  readable existing WAV is reused and only a missing/unreadable WAV is
  synthesized.
- `test_seed_vieneu_voices_continues_after_item_failure` — one preset failure
  is listed by ID while later presets still complete.
- `test_seed_vieneu_voices_cancellation_keeps_completed_and_reports_unfinished`
  — after one saved item, cancellation preserves it and lists remaining IDs.
- `test_protocol_cancels_seed_request` — cancel targets the active request,
  completed profile rows remain, and unattempted IDs are returned.
- `test_protocol_accepts_concurrent_seed_requests` — two same-ID requests
  finish with one stored row and WAV.
- `test_seed_vieneu_voices_does_not_record_audio_history` — the history table
  remains unchanged after seeding.
- Run `rtk python -m unittest discover -s tests -p test_desktop.py -v`.

Progress: done
Result: `rtk .venv/bin/python -m unittest discover -s tests -p test_desktop.py -v` — 42 tests passed (backfilled).

Files inspected, no change:

- `src/tts_mcp/desktop_vieneu.py::VieNeuProvider.status` and `synthesize` —
  existing readiness, manifest-preset synthesis, WAV validation, and explicit
  output-path behavior are reused.
- `tests/test_desktop_vieneu.py::VieNeuSynthesisTests` — existing provider
  tests cover preset synthesis and output-path behavior.

### Task 3 — Route seeded profiles through their provider assets

Files:

- `src/tts_mcp/engine.py::Engine.load_voice_profile`
- `src/tts_mcp/desktop.py::_synthesize`
- `src/tts_mcp/server.py::clone` and `list_voices`
- `src/tts_mcp/cli.py::cmd_clone`
- `tests/test_desktop.py::DesktopWorkerTests`
- `tests/test_server.py::ServerTests`
- `tests/test_cli.py::CliTests`

Interfaces: Keep the existing MCP signatures and `VoiceProfile` kind. Extend
`Engine.load_voice_profile` for an audio-backed `vieneu_preset` to return its
`preset_id`, `ref_audio`, and `ref_text` alongside its kind. Existing Clone
profiles continue to return their OmniVoice prompt; pure VieNeu presets return
no reference fields.

Change: When provider is VieNeu, route a saved preset profile by ID even when
it also has audio, and route a Clone profile without an ID through its
reference audio. When provider is OmniVoice, use an audio-backed preset's WAV
and transcript; reject a preset-only profile with clear provider guidance.
Apply the same rules to MCP `clone` and its `list_voices` output. Keep the
standalone CLI OmniVoice-only: `tts clone --voice` uses saved WAV/transcript
for seeded presets, retains prompt loading for Clone profiles, and rejects
preset-only and Design profiles. Stale preset IDs keep the existing VieNeu
input-error path without provider fallback.

Verify:

- `test_omnivoice_seeded_preset_uses_reference_and_pure_preset_fails` — an
  audio-backed preset sends WAV/transcript to OmniVoice; a pure preset returns
  provider guidance.
- `test_vieneu_seeded_preset_uses_id_and_clone_without_id_uses_audio` — the
  seeded profile uses its ID and a regular Clone keeps reference-audio routing.
- `test_mcp_clone_routes_seeded_profile_for_both_providers` — OmniVoice uses
  WAV/transcript and VieNeu uses preset ID without changing tool parameters.
- `test_mcp_list_voices_includes_seeded_reference_details` — the shared
  library listing exposes the preset ID, reference WAV, and transcript.
- `test_cli_clone_uses_seeded_reference_and_rejects_preset_only` — saved WAV
  and transcript are passed to OmniVoice; a profile without WAV fails clearly.
- Run `rtk python -m unittest discover -s tests -p test_desktop.py -v`,
  `rtk python -m unittest discover -s tests -p test_server.py -v`, and
  `rtk python -m unittest discover -s tests -p test_cli.py -v`.

Progress: done
Result: Desktop (42), server (20), and CLI (5) suites passed using the project virtualenv (backfilled).

Files inspected, no change:

- `src/tts_mcp/desktop_vieneu.py::VieNeuProvider.synthesize` — it already
  accepts preset IDs and saved Clone reference audio.
- `docs/llm/workflows/desktop-vieneu.md` and
  `docs/llm/workflows/mcp-voice-library.md` — the delta adds seeded-profile
  behavior, updates provider routing and schema requirements, then merges them
  after source verification.

### Task 4 — Add the Voice Profiles seed workflow and final verification

Files:

- `apps/desktop/src/App.tsx::VoiceProfilesView`, `App`, and `seedVieNeuVoices`
- `apps/desktop/src/lib/sidecar.ts::ProgressEvent` and `SidecarClient`
- `apps/desktop/src/lib/i18n.ts::resources`

Interfaces: Add typed seed result/progress fields matching Task 2. Track and
cancel the active seed request by ID, give the batch the existing long-operation
timeout, and keep its progress separate from model-download progress. Pass the
manifest catalog to profile rows so a seeded row displays manifest name and
label beside its stable profile name and preset ID.

Change: Add the explicit **Seed VieNeu voices** action in Voice Profiles,
disable it while a seed request is active, and show per-preset progress,
completion/reuse counts, failed or unfinished IDs, and actionable readiness
errors. Add cancellation and refresh the profile list after success, partial
failure, or cancellation. A later click retries missing/invalid references.
Keep existing audio-file and seed-folder actions independent. Add matching
English and Vietnamese copy. Filter seed progress away from the existing model
preparation progress UI. Do not add a front-end test framework; this package has
no test script.

Verify:

- `rtk npm --prefix apps/desktop run build` — TypeScript and Vite build pass.
- `rtk python -m compileall -q src tests` — Python modules compile.
- `rtk python -m unittest discover -s tests -v` — full Python suite passes.
- Manual ready-provider flow — seed every manifest preset, see each manifest
  name/label and ID, switch provider, and confirm VieNeu uses the ID while
  OmniVoice uses the saved WAV/transcript.
- Manual idempotency flow — seed twice and trigger two same-ID requests; the
  library still has one profile and one profile WAV for that preset.
- Manual recovery flow — a name collision leaves the existing Clone/Design
  row unchanged; an item failure or cancellation preserves completed items and
  a retry fills only missing entries.
- Manual storage flow — seeded WAVs do not appear in Audio History; deleting a
  seeded profile removes its WAV and row but leaves model assets intact.
- Manual readiness flow — missing model/runtime shows preparation/runtime
  guidance and seeding does not start a download.

Progress: done
Result: Full suite (121 tests), compileall, desktop build, and Cargo check passed; user confirmed the manual QA flows (backfilled).

Files inspected, no change:

- `src/tts_mcp/desktop.py::run_protocol` — Task 2 supplies the request and
  progress contract used by the UI.
- `docs/llm/workflows/desktop-vieneu.md` and
  `docs/llm/workflows/mcp-voice-library.md` — their approved requirements are
  represented by the sibling `delta.md` and are merged after final review.

## Approval Gate

Required: yes
Reason: SQLite schema v5 migration plus changes across storage, sidecar, MCP,
CLI, desktop UI, and shared provider behavior.
Status: approved

## Decision Log

None.
