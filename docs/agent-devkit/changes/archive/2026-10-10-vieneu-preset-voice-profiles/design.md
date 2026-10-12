# Saved VieNeu preset profiles

## Classification

Architectural: add a third persisted voice-profile kind across SQLite, the
desktop sidecar/UI, and MCP consumers.

## Problem

VieNeu's manifest presets can be selected in a synthesis session but are not
saved in the shared voice library. Users who want to reuse a preset must find
and select its manifest entry each time.

## Goal

Let users save a VieNeu manifest preset as a named profile, select it again
from Volo AI, and reuse it through MCP when MCP points at the same data store.
Keep audio-backed Clone profiles, including Tony-Hoang, usable with either
provider.

## Approved direction

Add the profile kind `vieneu_preset` with a validated `preset_id`. Save only a
named database reference to the VieNeu manifest entry; do not copy model assets
or create audio files. The Voice Profiles page gets a third creation option
whose preset selector comes from VieNeu's existing status catalog. If that
catalog is unavailable, the UI explains that VieNeu must be prepared to load
the catalog. Users can open Voice Profiles from the setup screen even when the
selected provider is not ready, so stored profiles remain inspectable and
deletable.

Show Clone, Design, and VieNeu preset as distinct profile types. Clone profiles
continue to work on OmniVoice and VieNeu when they contain reference audio.
Design profiles remain OmniVoice-only. VieNeu preset profiles are VieNeu-only;
using one from the profile library switches the workspace to VieNeu and selects
that saved profile. The saved profile has no language restriction or default
flag; the synthesis language remains the current workspace language.

## Persistence and compatibility

- Raise the SQLite schema to version 4 and add `preset_id` plus the
  `vieneu_preset` kind. A preset row has no reference audio, clone prompt, or
  design instruction; its language is null and it cannot be a default.
- Migrate existing Clone and Design rows without changing names, language,
  default flags, timestamps, reference files, clone prompts, installed seed
  records, or audio-history rows.
- Keep profile names globally unique. Saving a VieNeu preset under an existing
  profile name fails without replacing that profile. Clone and Design saves
  keep their current replacement behavior for Clone/Design names, but cannot
  replace a VieNeu preset.
- Validate the selected ID against the current valid local VieNeu manifest
  before saving. Validate it against the manifest again when synthesizing.
- Deleting a VieNeu preset removes only its profile row; it does not delete any
  VieNeu model or preset assets.
- Keep existing default selection, direct VieNeu preset synthesis, and MCP
  tool signatures unchanged.

## Upgrade compatibility

The v3→v4 migration is forward-only. Older desktop or MCP binaries reject a
schema v4 database, so users must update every app that shares
`TTS_MCP_DATA_DIR` before reusing the upgraded store. Run the table rebuild
transactionally; if it fails, keep the original v3 database and its profile
files intact.

## Provider and MCP behavior

Volo AI lists the saved preset with its profile name, preset ID, and a VieNeu
badge. Its Use action selects the saved profile in the VieNeu workspace. The
workspace continues to offer the existing direct manifest-preset selector.

MCP `list_voices` reports the new kind and `preset_id`. Reuse an existing saved
preset with `clone(provider="vieneu", voice="<profile name>")`. That call
resolves to the matching manifest preset. The same profile with the default
OmniVoice provider returns a clear unsupported-provider error. Existing
`speak(provider="vieneu", voice="preset", preset_id=...)` calls remain
unchanged. Create saved preset profiles in Volo AI; do not add an MCP save
tool.

The CLI remains OmniVoice-only and displays saved VieNeu preset entries as
VieNeu-only references rather than as Clone audio.

## Errors and limits

- A missing catalog or an ID absent from the validated manifest prevents
  saving and leaves the profile store unchanged.
- An invalid profile name or a conflicting name returns a clear error and
  preserves the existing profile and its files.
- A missing or stale preset ID at synthesis fails through the existing
  structured input-error path; it never falls back to OmniVoice.
- Saving and deleting preset references do not download or remove model assets.
- VieNeu still requires its existing runtime and prepared model assets before
  synthesis.

## Scope

Included: schema migration, preset-profile persistence and listing, desktop
sidecar save and synthesis routing, Voice Profiles UI, provider-aware MCP
reuse/list output, CLI list formatting, focused tests, and README guidance.

Excluded: model download changes, voice-training or reference-audio creation,
MCP profile-creation tools, provider-specific defaults, aliases or duplicate
preset rows, and changes to Tony-Hoang's Clone profile.

## Affected files

- `src/tts_mcp/engine.py` — schema v4, preset reference persistence, listing,
  deletion, and protection from accidental replacement by Clone/Design saves.
- `src/tts_mcp/desktop.py` — validated sidecar save and routing for a saved
  preset profile through the existing direct preset request.
- `src/tts_mcp/server.py` — MCP listing and reuse of a saved preset profile.
- `src/tts_mcp/cli.py` — label saved preset rows as VieNeu-only.
- `apps/desktop/src/App.tsx` — third profile kind, manifest selection, saved
  preset display, and provider-aware Use action.
- `apps/desktop/src/lib/sidecar.ts` and `apps/desktop/src/lib/i18n.ts` —
  profile/status contract and English/Vietnamese copy.
- `tests/test_engine.py`, `tests/test_desktop.py`, `tests/test_server.py`,
  and `tests/test_cli.py` — migration, validation, dispatch, and compatibility
  coverage.
- `README.md` — saved VieNeu preset MCP usage.
- `docs/llm/workflows/mcp-voice-library.md`,
  `docs/llm/workflows/desktop-vieneu.md`, and `docs/llm/INDEX.md` — verified
  requirements and registered domain prefixes after implementation.

## Related context

- [MCP voice library](../../../../llm/workflows/mcp-voice-library.md)
- [Desktop speech providers](../../../../llm/workflows/desktop-vieneu.md)
- [Architecture overview](../../../../llm/architecture/overview.md)

## Previous work

- [Voice Studio and Design Profiles design](../../../specs/2026-09-14-voice-studio-design-profiles-design.md)
- [MCP shared voice library plan](../../../plans/2026-09-27-mcp-shared-app-voice-library-plan.md)
- [Desktop VieNeu provider plan](../../../plans/2026-10-08-desktop-audiocpp-vieneu-plan.md)
- [MCP VieNeu provider plan](../../../plans/2026-10-08-mcp-vieneu-provider-plan.md)

## Wiki selection

The selected legacy page [MCP voice library](../../../../llm/workflows/mcp-voice-library.md)
was converted to Requirements before this delta was written. The legacy
[Desktop speech providers](../../../../llm/workflows/desktop-vieneu.md) page is
also selected for conversion and refresh after implementation verification,
because it says the shared voice-profile schema is unchanged. Register a
separate `DVP` requirement prefix for the desktop provider workflow; keep the
`VLIB` delta scoped to the shared library and MCP behavior.

## Verification approach

Cover schema migration and preservation, preset-profile save/list/delete,
unknown and duplicate ID/name rejection, direct preset compatibility, saved
Clone/Design compatibility, desktop selection and synthesis, MCP saved-preset
routing, CLI labeling, and both frontend localization/build behavior. Verify
that saving or deleting a preset reference does not modify model asset files.

## Impact map

Entry: `apps/desktop/src/App.tsx::VoiceProfilesView`, `apps/desktop/src/App.tsx::saveProfile`, and `src/tts_mcp/server.py::clone` / `list_voices`
Flow: Profile form → SidecarClient JSONL → `desktop.py::dispatch_request` → `Engine.save_vieneu_preset` → SQLite; profile Use → workspace profile request → sidecar resolves the stored ID to the existing VieNeu preset request → `VieNeuProvider._synthesize` → existing preset assets and `audiocpp_cli`; MCP list/clone reads the same store when configured with the app-data path
State changes: SQLite schema v3→v4; existing profiles and related files stay intact; new preset rows store only a profile name and manifest `preset_id`
External effects: Local manifest read and SQLite writes when saving; existing local VieNeu assets, audio.cpp process, and output-file write when synthesizing; no model download or asset deletion from profile save/delete
Change candidates: `src/tts_mcp/engine.py`, `src/tts_mcp/desktop.py`, `src/tts_mcp/server.py`, `src/tts_mcp/cli.py`, `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/sidecar.ts`, `apps/desktop/src/lib/i18n.ts`, `tests/test_engine.py`, `tests/test_desktop.py`, `tests/test_server.py`, `tests/test_cli.py`, `README.md`
Verification: Focused engine, desktop sidecar/provider, MCP, and CLI tests; full Python unit suite; Python compile check; desktop frontend build; manual save/use/delete and Tony-Hoang provider-switch scenarios
Verified at: `abc7680fefb68828aebb017bc1dcd8b05ab06f06`
