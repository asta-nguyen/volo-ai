# Saved VieNeu preset profiles — implementation plan

## Approved design

[Saved VieNeu preset profiles](design.md)

## Global Constraints

- Persist a `vieneu_preset` profile as its profile name and validated `preset_id` only; do not copy VieNeu model assets or create audio files.
- Keep Clone profiles usable with OmniVoice and VieNeu when they contain reference audio; keep Design profiles OmniVoice-only and VieNeu preset profiles VieNeu-only.
- Keep profile names globally unique; a saved preset must not overwrite an existing profile, and Clone/Design saves must not replace a VieNeu preset.
- Keep current default selection, the direct VieNeu `speak(voice="preset", preset_id=...)` contract, and existing MCP tool names and parameters unchanged.

## Impact map

Entry: `apps/desktop/src/App.tsx::VoiceProfilesView`, `apps/desktop/src/App.tsx::saveProfile`, and `src/tts_mcp/server.py::clone` / `list_voices`
Flow: Profile form → SidecarClient JSONL → `desktop.py::dispatch_request` → `Engine.save_vieneu_preset` → SQLite; profile Use → workspace profile request → sidecar resolves the stored ID to the existing VieNeu preset request → `VieNeuProvider._synthesize` → existing preset assets and `audiocpp_cli`; MCP list/clone reads the same store when configured with the app-data path
State changes: SQLite schema v3→v4; existing profiles and related files stay intact; new preset rows store only a profile name and manifest `preset_id`
External effects: Local manifest read and SQLite writes when saving; existing local VieNeu assets, audio.cpp process, and output-file write when synthesizing; no model download or asset deletion from profile save/delete
Change candidates: `src/tts_mcp/engine.py`, `src/tts_mcp/desktop.py`, `src/tts_mcp/server.py`, `src/tts_mcp/cli.py`, `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/sidecar.ts`, `apps/desktop/src/lib/i18n.ts`, `tests/test_engine.py`, `tests/test_desktop.py`, `tests/test_server.py`, `tests/test_cli.py`, `README.md`
Verification: Focused engine, desktop sidecar/provider, MCP, and CLI tests; full Python unit suite; Python compile check; desktop frontend build; manual save/use/delete and Tony-Hoang provider-switch scenarios
Verified at: `abc7680fefb68828aebb017bc1dcd8b05ab06f06`

### Task 1 — Add schema v4 and persisted preset references

Files:

- `src/tts_mcp/engine.py::DB_SCHEMA_VERSION`, `_open_database`,
  `Engine.save_vieneu_preset`, `Engine.save_voice`,
  `Engine.save_design_voice`, `Engine.load_voice_profile`,
  `Engine.list_voices`, and `Engine.delete_voice`
- `tests/test_engine.py::EngineTests`

Interfaces: Add profile kind `vieneu_preset` with `preset_id`,
`language=None`, and `is_default=False` to `Engine.list_voices`. Keep existing
Clone and Design return fields unchanged.

Change: Migrate schema v3 to v4 transactionally with kind-specific checks. A
failed rebuild rolls back and leaves the v3 database usable. Preserve every
existing profile row and file, app-seed row, audio-history row, and Clone
default. Add create-only `save_vieneu_preset(name, preset_id)` using the
existing profile-name validation. Reject invalid IDs, name collisions, and
Clone/Design attempts to replace a preset. Keep current Clone/Design replacement
semantics. Loading a VieNeu preset through OmniVoice raises an actionable
provider error. Deleting one removes its row only.

Verify:

- `test_schema_v3_migrates_profiles_seeds_audio_history_and_preserves_files` —
  a v3 store with Clone, Design, seed, audio-history, and profile files opens as
  v4 with all existing state unchanged.
- `test_schema_v3_migration_failure_keeps_original_database` — an injected
  rebuild failure leaves schema version 3 and every original profile row intact.
- `test_save_vieneu_preset_persists_without_profile_files` — a valid name and
  ID create a listed preset row without creating a profile directory.
- `test_save_vieneu_preset_rejects_invalid_id_and_duplicate_name` — invalid
  input or an existing Clone/Design name leaves the old row and files intact.
- `test_clone_and_design_saves_cannot_replace_vieneu_preset` — saving Clone or
  Design under a preset name fails and preserves its ID.
- `test_delete_vieneu_preset_keeps_model_assets` — deletion removes the profile
  row and leaves the model asset tree unchanged.
- Update existing migration assertions for schema version 4.

Files inspected, no change:

- `src/tts_mcp/desktop_vieneu.py::VieNeuProvider.status` — existing local
  manifest catalog supplies the preset IDs used by the sidecar boundary.
- `src/tts_mcp/desktop.py::dispatch_request` — consumes the Engine profile
  fields in the next task.

### Task 2 — Validate sidecar saves and route saved preset synthesis

Files:

- `src/tts_mcp/desktop.py::dispatch_request`
- `tests/test_desktop.py::DesktopWorkerTests`

Interfaces: Add JSONL operation `save_vieneu_preset` with `name` and
`preset_id`. Its success response returns the saved profile name and kind.
Synthesis continues to use the current `voice="profile"` and `voice_name`
request from the UI.

Change: Check the requested ID against the VieNeu provider's validated local
catalog before calling the engine; reject when the catalog is unavailable or
the ID is absent. For a VieNeu `profile` synthesis request, resolve a
`vieneu_preset` row to the existing `voice="preset"` request with its
`preset_id` before calling the provider. Preserve the current saved Clone
reference-audio and one-off-file paths, Design rejection, and output contract.
Saving must not prepare/download model assets.

Verify:

- `test_save_vieneu_preset_uses_manifest_catalog_without_downloading` — a
  listed ID is saved, while provider preparation is not called.
- `test_save_vieneu_preset_rejects_missing_catalog_or_unknown_id` — invalid
  selections return a structured error and do not call the engine.
- `test_vieneu_saved_preset_profile_routes_to_preset_request` — a listed
  profile name becomes the existing direct preset request with its stored ID.
- Existing saved Clone, one-off file, invalid preset, and Design rejection
  cases retain their current expected results.

Files inspected, no change:

- `src/tts_mcp/engine.py::Engine.list_voices` and
  `Engine.save_vieneu_preset` — profile data contract from Task 1.
- `src/tts_mcp/desktop_vieneu.py::VieNeuProvider._synthesize` — it already
  implements validated manifest preset synthesis.

### Task 3 — Reuse saved presets through MCP and label CLI entries

Files:

- `src/tts_mcp/server.py::clone` and `list_voices`
- `src/tts_mcp/cli.py::cmd_voices`
- `tests/test_server.py::ServerTests`
- `tests/test_cli.py::CliTests`
- `README.md:118-176`

Interfaces: Keep existing MCP tool names and arguments. `clone(provider="vieneu",
voice=<profile name>)` accepts a `vieneu_preset` entry; `list_voices` displays
its kind and `preset_id`. No MCP operation for creating profiles is added.

Change: Route a saved VieNeu preset profile through the provider's preset path.
An OmniVoice request with that profile fails with a clear instruction to select
VieNeu. Keep direct `speak` calls and Clone/Design and reference-audio routes
unchanged. Format CLI voice-list entries by profile kind so preset rows show
their provider and ID without claiming they have reference audio. Update the
README with a saved-preset `clone` example alongside the existing direct
`speak` example.

Verify:

- `test_clone_routes_saved_vieneu_preset_and_rejects_omnivoice` — a shared
  store's preset ID routes to VieNeu and the default OmniVoice provider returns
  a clear error.
- `test_list_voices_formats_saved_vieneu_preset` — the result includes the
  kind and ID without reference-audio details.
- `test_cli_lists_vieneu_preset_without_clone_audio_fields` — CLI output marks
  the row VieNeu-only and prints its preset ID.
- Review every README example against the unchanged MCP tool signatures and
  the existing `TTS_MCP_DATA_DIR` shared-store setup.

Files inspected, no change:

- `src/tts_mcp/desktop_vieneu.py::VieNeuProvider._synthesize` — MCP routes
  saved profile IDs into its existing validated preset path.
- `apps/desktop/src/lib/sidecar.ts::SidecarClient` — existing shared-store
  configuration remains unchanged.

### Task 4 — Add VieNeu presets to the desktop profile library

Files:

- `apps/desktop/src/App.tsx::VoiceProfilesView`,
  `apps/desktop/src/App.tsx::SetupScreen`, `apps/desktop/src/App.tsx::App`, and
  `apps/desktop/src/App.tsx::WorkspaceView`
- `apps/desktop/src/lib/sidecar.ts::VoiceKind`, `VoiceProfile`, and
  `ProviderStatus`
- `apps/desktop/src/lib/i18n.ts::createUiCopy`
- `tests/test_build_sidecar.py::SidecarBuildTests`

Interfaces: Extend `VoiceKind` with `vieneu_preset` and `VoiceProfile` with
nullable language and optional `preset_id`. Use the Task 2 save operation and
the existing `synthesize` profile request.

Change: Add a third profile-form option that selects from VieNeu's status
catalog and asks for a profile name. When the catalog is absent, explain that
VieNeu preparation loads the choices; do not trigger preparation on save.
Show a VieNeu preset badge and ID, without Clone audio preview or Design text.
The Use action switches to VieNeu and selects the saved profile. In the
workspace, show saved preset profiles alongside the existing Clone profiles
when VieNeu is selected, and hide them for OmniVoice. Keep Clone profiles
visible on both providers, Design profiles OmniVoice-only, and never mark a
preset profile as the default. Load the profile list when the sidecar is online
even if the selected provider's model/runtime is not ready, so users can still
inspect or delete saved profiles. Expose the Voice Profiles view from the setup
screen while a provider is not ready. Localize the new labels and errors in
English and Vietnamese.

Verify:

- `rtk npm --prefix apps/desktop run build` completes with the extended profile
  types and UI.
- The sidecar packaging test expects the already-required `sea_g2p` runtime
  collection used by VieNeu preprocessing.
- Manual flow: prepare VieNeu, save a named manifest preset, close and reopen
  the app, confirm the profile remains listed with its ID, choose Use and
  confirm the workspace selects VieNeu and the same preset, synthesize in
  English and Vietnamese, then delete the profile and confirm model assets
  remain.
- Manual compatibility flow: use Tony-Hoang with OmniVoice and VieNeu; confirm
  Design remains unavailable under VieNeu and existing direct preset selection
  still works.
- Manual failure flow: the UI explains how to load a missing catalog and shows
  a duplicate-name error without replacing an existing profile; Task 2's
  protocol check rejects an unknown ID without writing a profile.

Files inspected, no change:

- `apps/desktop/src-tauri/resources/seed-voices/tony-hoang/manifest.json` —
  Tony-Hoang remains an audio-backed Clone profile.
- `apps/desktop/src/lib/sidecar.ts::SidecarClient` — preserve the current JSONL
  request mechanism and app-data path.

### Task 5 — Refresh the selected wiki requirement after implementation

Files:

- `docs/llm/workflows/mcp-voice-library.md:1-263` — merge the approved requirement
  from this change's `delta.md` only after source and test verification.
- `docs/llm/workflows/desktop-vieneu.md` — convert its legacy business rules to
  Requirements and update the shared-profile schema claim and desktop preset
  routing from verified implementation behavior.
- `docs/llm/INDEX.md:1-67` — register the `DVP` prefix and keep both page summaries
  accurate.

Interfaces: The `VLIB-vieneu-saved-presets` delta requirement must match the
implemented shared-library and MCP/UI flows. Desktop provider requirements use
the separate `DVP` prefix and must not duplicate the shared-library behavior.

Change: Run `document-wiki` after implementation verification to update both
selected pages from source and tests. Convert the Desktop speech providers page
to Requirements, register `DVP` in the index, and document saved-preset
routing there. Do not add new behavior to either wiki page before it is
verified.

Verify:

- The `document-wiki` validator reports both pages' requirement IDs, source
  paths, registered prefixes, and internal links valid.
- `rtk git diff --check` passes; `docs/llm/LOG.md` remains unchanged.

Files inspected, no change:

- `docs/llm/workflows/desktop-vieneu.md` — its current source and test claims
  were reviewed; this task now owns its selected conversion and refresh.

## Approval Gate

Required: yes
Reason: Changes the SQLite data schema, saved-profile semantics, shared MCP behavior, and more than a small set of files.
Status: approved
Approved by user: 2026-10-10 ("ok" to include the Desktop speech providers wiki page).

## Decision Log

- [Decision D1](decisions.md#d1--select-desktop-speech-providers-wiki-page) — include the Desktop speech providers page in the selected wiki conversion and refresh.
