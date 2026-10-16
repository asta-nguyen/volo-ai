# Delta

Merged into docs/llm/: 2026-10-13

## ADDED Requirements

### DVP-vieneu-seed-pack

Page: `docs/llm/workflows/desktop-vieneu.md`
Search: checked every page using prefix DVP; no existing requirement covers batch-seeding the VieNeu catalog as clone-capable profiles.

Requirement:

````md
### DVP-vieneu-seed-pack

Volo AI SHALL let the user seed every preset in the validated local VieNeu manifest as one saved profile containing its preset ID and a generated Clone reference WAV with its transcript, and show the preset's human-readable manifest name in Voice Profiles.

#### Scenario: seed the VieNeu catalog

- GIVEN VieNeu's model, preprocessing, runtime, and manifest are ready and no preset ID or generated profile name is ambiguous
- WHEN the user starts Seed VieNeu voices
- THEN the app saves one provider-capable profile per manifest preset, reports per-preset progress, and stores generated WAVs outside Audio History

#### Scenario: repeat or resume a seed run

- GIVEN a previous run already saved valid profiles for some preset IDs
- WHEN the user starts Seed VieNeu voices again
- THEN the app reuses those profiles and WAVs, creates no duplicate profile or WAV, and retries only missing or invalid entries

#### Scenario: concurrent seed requests for one preset

- GIVEN no saved profile exists for a manifest preset
- WHEN two Seed VieNeu voices requests process that preset concurrently
- THEN both requests resolve to the same profile identity and only one profile and one valid WAV are persisted

#### Scenario: continue after a preset failure

- GIVEN generating one preset's reference WAV fails or the batch is cancelled
- WHEN the seed operation returns
- THEN successful profiles remain saved and the result identifies failed or unfinished preset IDs for a later retry

#### Scenario: preserve a conflicting profile

- GIVEN a Clone or Design profile already uses the stable name for a preset
- WHEN the user seeds the catalog
- THEN the existing profile remains unchanged and the preset is reported as unresolved without adding a duplicate profile

Evidence: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/sidecar.ts`, `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_desktop.py`, `tests/test_desktop_vieneu.py`
````

### VLIB-vieneu-seeded-profiles

Page: `docs/llm/workflows/mcp-voice-library.md`
Search: checked every page using prefix VLIB; no existing requirement covers one saved profile carrying both a VieNeu preset ID and generated Clone reference audio.

Requirement:

````md
### VLIB-vieneu-seeded-profiles

The shared voice library SHALL expose a seeded VieNeu profile's preset ID and reference WAV/transcript and select the matching asset for the requested provider.

#### Scenario: use a seeded profile with VieNeu

- GIVEN a saved seeded profile has a preset ID from the current VieNeu manifest
- WHEN the caller uses that profile with provider `vieneu`
- THEN VieNeu synthesizes with the saved preset ID

#### Scenario: use a seeded profile with OmniVoice

- GIVEN a saved seeded profile has a generated reference WAV and transcript
- WHEN the caller uses that profile with provider `omnivoice`
- THEN OmniVoice clones from that WAV and transcript

#### Scenario: use a Clone profile with VieNeu

- GIVEN a saved Clone profile has reference audio and no VieNeu preset ID
- WHEN the caller uses that profile with provider `vieneu`
- THEN VieNeu continues to clone from the reference audio

Evidence: `src/tts_mcp/engine.py`, `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_vieneu.py`, `src/tts_mcp/server.py`, `src/tts_mcp/cli.py`, `apps/desktop/src/App.tsx`, `tests/test_engine.py`, `tests/test_desktop.py`, `tests/test_server.py`, `tests/test_cli.py`
````

## MODIFIED Requirements

### DVP-saved-preset-routing

Page: `docs/llm/workflows/desktop-vieneu.md`

Baseline:

````md
### DVP-saved-preset-routing

The desktop sidecar SHALL resolve a saved `vieneu_preset` profile to its
stored preset ID for VieNeu synthesis and reject that profile for OmniVoice.

#### Scenario: synthesize with a saved VieNeu preset

- GIVEN the shared voice library contains a VieNeu preset profile
- WHEN the desktop sends that profile to the VieNeu provider
- THEN the sidecar invokes the existing manifest-preset path with its stored ID

#### Scenario: saved VieNeu preset selected with OmniVoice

- GIVEN the shared voice library contains a VieNeu preset profile
- WHEN the desktop sends that profile to OmniVoice
- THEN the sidecar returns an error directing the caller to use VieNeu

Evidence: `src/tts_mcp/desktop.py`, `src/tts_mcp/engine.py`, `tests/test_desktop.py`
````

Replacement:

````md
### DVP-saved-preset-routing

The desktop sidecar SHALL route a saved VieNeu preset profile to its stored
preset ID for VieNeu and use its saved reference WAV and transcript for
OmniVoice when present.

#### Scenario: synthesize a seeded profile with VieNeu

- GIVEN a saved VieNeu profile has a preset ID and generated reference audio
- WHEN the desktop selects the VieNeu provider
- THEN the sidecar invokes the manifest-preset path with its stored ID

#### Scenario: synthesize a seeded profile with OmniVoice

- GIVEN a saved VieNeu profile has reference audio and its transcript
- WHEN the desktop selects OmniVoice
- THEN the sidecar generates from that audio and transcript

#### Scenario: use a preset-only profile with OmniVoice

- GIVEN a saved VieNeu profile has no reference audio
- WHEN the desktop selects OmniVoice
- THEN the sidecar returns guidance to use VieNeu or seed the profile

Evidence: `src/tts_mcp/desktop.py`, `src/tts_mcp/engine.py`, `tests/test_desktop.py`
````

### VLIB-schema-compatibility

Previously: the existing migration scenario covered schema v3→v4.

Baseline:

````md
### VLIB-schema-compatibility

The shared voice database SHALL migrate supported earlier schemas
transactionally and reject a schema newer than the running app supports.

#### Scenario: migrate an existing profile store

- GIVEN a valid schema v3 store with profiles and related state
- WHEN the current app opens it
- THEN it migrates to schema v4 while preserving all existing rows and profile
  files

Evidence: `src/tts_mcp/engine.py`, `tests/test_engine.py`
````

Replacement:

````md
### VLIB-schema-compatibility

The shared voice database SHALL migrate supported earlier schemas
transactionally and reject a schema newer than the running app supports.

#### Scenario: migrate an existing profile store

- GIVEN a valid schema v4 store with profiles, installed seed metadata, and
  audio history
- WHEN the current app opens it
- THEN it migrates to schema v5 while preserving all existing rows and profile
  files

Evidence: `src/tts_mcp/engine.py`, `tests/test_engine.py`
````
