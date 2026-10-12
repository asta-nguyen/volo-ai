# VieNeu preset seed pack

## Classification

Architectural: a desktop batch operation will create durable clone audio for
VieNeu presets and extend shared profile storage and provider routing.

## Problem

Saved VieNeu preset profiles currently store only a preset ID. They work with
VieNeu, while OmniVoice needs reference audio and its transcript. Users would
otherwise have to create a separate audio-backed profile for each preset.

## Goal

Let a user seed every preset in the installed VieNeu manifest from Voice
Profiles. Each voice remains one saved profile that can use its native
VieNeu preset ID or its generated Clone reference audio, according to the
selected provider.

## Approved direction

- Add an explicit **Seed VieNeu voices** action to Voice Profiles. It reads the
  validated local manifest at run time; it does not seed automatically when the
  app opens and does not use a hard-coded catalog.
- For each manifest preset, synthesize one fixed Vietnamese reference sentence
  through that preset:
  `Xin chào. Đây là mẫu giọng được tạo để lưu vào thư viện giọng nói của bạn.`
  Store the resulting WAV and the exact transcript with the profile assets,
  outside Audio History.
- Keep one library record per seeded preset. The record contains the validated
  `preset_id` and optional Clone reference audio/transcript. Reuse a single
  existing saved preset profile when its ID matches. If multiple existing
  profiles match the same ID, report an ambiguity and leave them unchanged. If
  no profile matches, create one with a stable name derived from the preset ID.
  Display the human-readable name and label from the manifest beside the stable
  profile name and ID. Never replace a Clone or Design profile when a generated
  name collides.
- Derive the generated profile name and profile-scoped WAV path deterministically
  from the preset ID; do not append a suffix when that name collides. Repeated
  or concurrent seed actions must converge on the same profile row and one WAV,
  enforced by storage writes rather than only by disabling the UI button. Make
  same-ID writes safe to race and publish WAVs atomically. Reuse a valid saved
  WAV; regenerate only a missing or unreadable reference. Preserve successful
  profiles when another preset fails or the batch is cancelled. Report progress
  and per-preset outcomes, continue after individual failures, and allow a retry
  to finish missing entries.
- Seed only when the VieNeu model, preprocessing, and `audio.cpp` runtime are
  ready. When they are unavailable, show the existing preparation or runtime
  guidance; the seed action does not silently download model assets.
- Choose the provider-specific asset when using a saved profile:
  - VieNeu uses a valid saved `preset_id`.
  - VieNeu uses reference audio for an existing Clone profile with no preset ID.
  - OmniVoice uses the saved reference WAV and transcript when present.
  - A preset-only profile has no OmniVoice asset and returns a clear error.
    Never fall back to a different provider implicitly.
- Keep existing saved profile names, direct preset requests, and MCP tool
  signatures. MCP reads the same profile and routes it by its selected
  provider; the standalone CLI remains OmniVoice-only and uses the WAV.
- Deleting a seeded profile removes its generated WAV and profile metadata,
  while keeping VieNeu model and preset assets intact.

The WAV is a VieNeu-generated reference sample, not a source recording. Its
voice may sound different when OmniVoice clones it.

## Persistence and compatibility

- Upgrade the SQLite profile schema from v4 to v5 so a `vieneu_preset` row can
  also own Clone reference audio and its transcript. Use the existing profile
  audio fields; do not add a second profile for the same voice.
- Keep pure VieNeu preset rows valid with no reference audio. Keep existing
  Clone and Design profiles and their replacement behavior unchanged.
- Migrate transactionally and preserve profile rows and files, installed seed
  metadata, and audio-history rows. If migration fails, retain the original
  v4 store.
- Older desktop or MCP binaries reject schema v5. Every app sharing the store
  must be updated before using the migrated database.

## Errors and limits

- An unavailable or invalid manifest, unprepared VieNeu model, unavailable
  preprocessing, or missing `audio.cpp` runtime prevents seeding and gives an
  actionable error without changing profile data.
- An ID absent from the current manifest is not synthesized. A prior profile's
  WAV remains usable by OmniVoice, while a stale ID fails through the existing
  VieNeu input-error path without provider fallback.
- A preset-generation error is reported against that preset ID; other presets
  continue. Completed entries survive cancellation and a later run skips them.
- A profile-name collision with a Clone or Design profile preserves the
  existing profile and reports that preset as unresolved.

## Scope

Included: schema v5 migration, idempotent seed identity, VieNeu batch
synthesis and progress/cancellation, profile WAV storage and deletion,
provider-aware desktop/MCP/CLI reuse, Voice Profiles UI and localization,
focused verification, and refresh of the desktop-provider and shared-library
wiki requirements.

Excluded: seeding on app startup, automatic model downloads from the seed
action, a new MCP seed tool, a second record per seeded voice, changes to
VieNeu model assets, and changes to unrelated Clone/Design profiles.

## Related context

- [Desktop speech providers](../../../llm/workflows/desktop-vieneu.md)
- [MCP voice library](../../../llm/workflows/mcp-voice-library.md)

## Previous work

- [Saved VieNeu preset profiles design](../archive/2026-10-10-vieneu-preset-voice-profiles/design.md)
- [Saved VieNeu preset profiles plan](../archive/2026-10-10-vieneu-preset-voice-profiles/tasks.md)
- [Saved VieNeu preset profiles wiki delta](../archive/2026-10-10-vieneu-preset-voice-profiles/delta.md)

## Verification approach

Verify the v4→v5 migration preserves existing rows and files; a batch seeds
every manifest preset with one profile and a stored WAV/transcript; repeated
and concurrent actions do not add duplicate profiles or assets; name
collisions do not overwrite user profiles; a failed preset and cancellation
preserve completed entries and can be retried; deletion removes only profile
assets; VieNeu uses the preset ID and Clone audio without an ID; OmniVoice,
MCP, and CLI use generated reference audio where available; preset-only
OmniVoice requests fail clearly; and generated reference WAVs do not appear in
Audio History. Check English and Vietnamese UI copy and the desktop build.

## Impact map

Entry: no existing source; planned entry: `apps/desktop/src/App.tsx::seedVieNeuVoices`
Flow: no existing flow; planned flow: Voice Profiles click → SidecarClient JSONL batch request → `desktop.py::dispatch_request` → validated VieNeu manifest and `VieNeuProvider.synthesize` → profile WAV and transcript persisted by `Engine` → selected-provider routing in desktop, MCP, and CLI
State changes: SQLite schema v4→v5; each manifest preset has at most one seeded profile identity and a profile-owned WAV/transcript; existing profile and audio-history state is preserved
External effects: Local CPU synthesis through `audiocpp_cli`; WAV and profile metadata writes under app data; no model downloads or Audio History writes
Change candidates: `src/tts_mcp/engine.py`, `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_vieneu.py`, `src/tts_mcp/server.py`, `src/tts_mcp/cli.py`, `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/sidecar.ts`, `apps/desktop/src/lib/i18n.ts`, `tests/test_engine.py`, `tests/test_desktop.py`, `tests/test_desktop_vieneu.py`, `tests/test_server.py`, `tests/test_cli.py`, `docs/llm/workflows/desktop-vieneu.md`, `docs/llm/workflows/mcp-voice-library.md`, `docs/llm/INDEX.md`
Verification: Focused storage, batch, provider-routing, MCP, CLI, and desktop tests; Python compile check; desktop build; manual seed, retry, collision, deletion, and provider-switch flows
Verified at: `abc7680fefb68828aebb017bc1dcd8b05ab06f06`
