# Delta

Merged into docs/llm/: 2026-10-10

## MODIFIED Requirements

### VLIB-profile-save

Page: `docs/llm/workflows/mcp-voice-library.md`
Search: checked every page using the VLIB prefix; the existing save requirement did not describe the reserved-name behavior for VieNeu preset profiles.

Requirement:

````md
### VLIB-profile-save

The MCP `save_voice` tool SHALL save reference audio as a reusable Clone
profile in the selected data store, replacing an existing Clone or Design
profile with the same name and rejecting a name already used by a VieNeu preset;
the MCP `design` tool generates audio without saving a Design profile.

#### Scenario: save a Clone profile

- GIVEN a valid reference audio file and profile name
- WHEN the caller invokes `save_voice`
- THEN the reference audio and profile metadata are stored for later use

#### Scenario: preset profile name is reserved

- GIVEN a VieNeu preset profile already uses the requested name
- WHEN the caller invokes `save_voice` with that name
- THEN the save fails and the preset profile and its metadata remain unchanged

Evidence: `src/tts_mcp/server.py`, `src/tts_mcp/engine.py`, `tests/test_engine.py`
````

## ADDED Requirements

### VLIB-schema-compatibility

Page: `docs/llm/workflows/mcp-voice-library.md`
Search: checked every page using the VLIB prefix; no existing requirement covers forward-only profile-store schema migrations and newer-schema rejection.

Requirement:

````md
### VLIB-schema-compatibility

The shared voice database SHALL migrate supported earlier schemas
transactionally and reject a schema newer than the running app supports.

#### Scenario: migrate an existing profile store

- GIVEN a valid schema v3 store with profiles and related state
- WHEN the current app opens it
- THEN it migrates to schema v4 while preserving existing rows and profile files

Evidence: `src/tts_mcp/engine.py`, `tests/test_engine.py`
````

### VLIB-vieneu-saved-presets

Page: `docs/llm/workflows/mcp-voice-library.md`
Search: checked every page using the VLIB prefix; no existing requirement covers saving and reusing a VieNeu preset through the shared voice library.

Requirement:

````md
### VLIB-vieneu-saved-presets

The shared voice library SHALL persist a named reference to a validated VieNeu
manifest preset and expose its ID to Volo AI and MCP for VieNeu synthesis,
without copying preset model assets.

#### Scenario: save and reuse a VieNeu preset

- GIVEN the local VieNeu manifest lists a preset and the profile name is unused
- WHEN the user saves the preset in Volo AI and selects it in the workspace or
  MCP calls `clone` with `provider="vieneu"` and the saved profile name
- THEN synthesis uses the saved `preset_id` through VieNeu and leaves model
  assets unchanged

#### Scenario: list a saved VieNeu preset through MCP

- GIVEN the shared store contains a named VieNeu preset profile
- WHEN the caller invokes `list_voices`
- THEN the result identifies it as a VieNeu preset and shows its `preset_id`

Evidence: `src/tts_mcp/engine.py`, `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_vieneu.py`, `src/tts_mcp/server.py`, `apps/desktop/src/App.tsx`, `tests/test_engine.py`, `tests/test_desktop.py`, `tests/test_desktop_vieneu.py`, `tests/test_server.py`
````
