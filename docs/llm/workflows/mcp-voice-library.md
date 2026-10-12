# MCP voice library

## Requirements

### VLIB-default-provider

The MCP server SHALL default `speak` and `clone` to OmniVoice and reject
provider IDs other than `omnivoice` and `vieneu`.

#### Scenario: provider omitted

- GIVEN an MCP caller omits `provider`
- WHEN it calls `speak` or `clone`
- THEN the request uses OmniVoice

Evidence: `src/tts_mcp/server.py`, `tests/test_server.py`

### VLIB-explicit-model-preparation

The MCP server SHALL prepare model assets only when the caller invokes
`prepare_model` for a selected provider.

#### Scenario: status before preparation

- GIVEN a provider's assets are not prepared
- WHEN the caller invokes `status`
- THEN status reports readiness without downloading assets

Evidence: `src/tts_mcp/server.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_server.py`

### VLIB-no-provider-fallback

The MCP server SHALL return an error for an unavailable explicit VieNeu request
instead of substituting OmniVoice.

#### Scenario: VieNeu runtime is unavailable

- GIVEN an MCP caller explicitly selects VieNeu and the runtime is unavailable
- WHEN the caller requests synthesis
- THEN the request fails and OmniVoice is not invoked

Evidence: `src/tts_mcp/server.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_server.py`

### VLIB-omnivoice-profile

OmniVoice MCP `clone` SHALL resolve a saved Clone profile to its prompt or a
saved Design profile to its instruction, with `voice` taking precedence over
`ref_audio_path`.

#### Scenario: saved profile and reference are both supplied

- GIVEN a valid saved profile name and a reference audio path
- WHEN the caller invokes `clone` with both
- THEN the server uses the saved profile

Evidence: `src/tts_mcp/server.py`, `src/tts_mcp/engine.py`, `tests/test_server.py`

### VLIB-profile-delete

The MCP `delete_voice` tool SHALL remove the named profile and its Clone-owned
files, and report when the name is not present.

#### Scenario: delete a saved profile

- GIVEN a Clone profile exists in the selected store
- WHEN the caller invokes `delete_voice` with its name
- THEN its database row and profile files are removed

Evidence: `src/tts_mcp/server.py`, `src/tts_mcp/engine.py`, `tests/test_engine.py`

### VLIB-profile-list

The MCP `list_voices` tool SHALL return saved profile names, kinds, languages,
and the details relevant to each current profile kind.

#### Scenario: Clone and Design profiles listed

- GIVEN the selected store contains a Clone and a Design profile
- WHEN the caller invokes `list_voices`
- THEN each entry includes its kind and the Clone reference or Design instruction

Evidence: `src/tts_mcp/server.py`, `src/tts_mcp/engine.py`, `tests/test_server.py`

### VLIB-profile-save

The MCP `save_voice` tool SHALL save reference audio as a reusable Clone profile
in the selected data store, replacing an existing Clone or Design profile with
the same name and rejecting a name already used by a VieNeu preset; the MCP
`design` tool generates audio without saving a Design profile.

#### Scenario: save a Clone profile

- GIVEN a valid reference audio file and profile name
- WHEN the caller invokes `save_voice`
- THEN the reference audio and profile metadata are stored for later use

#### Scenario: preset profile name is reserved

- GIVEN a VieNeu preset profile already uses the requested name
- WHEN the caller invokes `save_voice` with that name
- THEN the save fails and the preset profile and its metadata remain unchanged

Evidence: `src/tts_mcp/server.py`, `src/tts_mcp/engine.py`, `tests/test_engine.py`

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

### VLIB-shared-store

The MCP server SHALL use the directory selected by `TTS_MCP_DATA_DIR` for its
SQLite database and voice files, falling back to `~/.tts-mcp` when unset.

#### Scenario: MCP and desktop share app data

- GIVEN MCP's `TTS_MCP_DATA_DIR` equals Volo AI's app-data directory
- WHEN either app or MCP lists or changes profiles
- THEN both use the same local voice library

Evidence: `src/tts_mcp/engine.py`, `src/tts_mcp/desktop.py`, `apps/desktop/src/lib/sidecar.ts`

### VLIB-vieneu-language-output

VieNeu MCP synthesis SHALL accept English or Vietnamese, default an omitted
language to English, support WAV or MP3, and reject unsupported OmniVoice
generation controls.

#### Scenario: default language and supported output

- GIVEN a VieNeu request omits its language and selects a WAV or MP3 path
- WHEN the request is synthesized
- THEN it uses English and writes the selected supported format

Evidence: `src/tts_mcp/server.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_server.py`, `tests/test_desktop_vieneu.py`

### VLIB-vieneu-preset

VieNeu MCP `speak` SHALL require `voice="preset"` and a preset ID from the
validated local manifest exposed by `status`.

#### Scenario: select a manifest preset

- GIVEN the VieNeu manifest is available and lists a preset ID
- WHEN the caller invokes `speak` with `provider="vieneu"`, `voice="preset"`,
  and that ID
- THEN VieNeu synthesizes with the corresponding preset assets

Evidence: `src/tts_mcp/server.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_server.py`, `tests/test_desktop_vieneu.py`

### VLIB-vieneu-reference-clone

VieNeu MCP `clone` SHALL accept a saved Clone profile or external reference
audio, and reject Design profiles and supplied `ref_text`.

#### Scenario: use a saved Clone profile

- GIVEN the selected store contains a valid Clone profile
- WHEN the caller invokes `clone` with `provider="vieneu"` and its name
- THEN VieNeu uses the profile's reference audio without a transcript

Evidence: `src/tts_mcp/server.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_server.py`, `tests/test_desktop_vieneu.py`

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

## Flow

1. Point the MCP process at Volo AI's app-data directory with
   `TTS_MCP_DATA_DIR` when shared profile access is wanted. The desktop sidecar
   already uses that directory.
2. Call `status` to inspect OmniVoice and VieNeu readiness. VieNeu's valid local
   manifest supplies `preset_voices` and `default_voice`. On a fresh setup,
   call `prepare_model(provider="vieneu")`, then call `status` again to read the
   downloaded catalog. `prepare_model` is the MCP operation that downloads
   model assets.
3. Call `list_voices` to inspect saved profile names, kinds, languages, and
   kind-specific details. A saved VieNeu preset is labeled with its `preset_id`.
4. For OmniVoice, call `speak` for automatic voice or `clone` with a saved
   Clone or Design profile. A seeded VieNeu profile also works with `clone`:
   the server uses its saved WAV and transcript. If both `voice` and
   `ref_audio_path` are given, the saved profile takes precedence. The server
   resolves profiles through `Engine.load_voice_profile`, maps Clone prompts
   to `voice_clone_prompt`, seeded references to `ref_audio`/`ref_text`, and
   Design instructions to `instruct`, then writes to `output_path`. Create
   Design profiles in the desktop library; the MCP `design` tool only
   generates audio.
5. For a VieNeu preset, call `speak` with `provider="vieneu"`,
   `voice="preset"`, and a manifest `preset_id`. A saved seeded profile uses
   that ID with VieNeu; with OmniVoice it uses the profile WAV and transcript.
   Preset-only profiles have no OmniVoice reference and return an error there.
   For VieNeu reference cloning, call `clone` with a saved Clone name or
   `ref_audio_path`. The server routes the request to `VieNeuProvider`, which
   validates the preset or reference audio, normalizes reference audio when
   needed, computes or reuses a CAM++ embedding, and invokes `audiocpp_cli`.
6. For OmniVoice external-reference cloning, call `clone` with `ref_audio_path`
   and optional `ref_text`. VieNeu does not use `ref_text`.

## State changes

Generation writes an audio file at `output_path`. `prepare_model` downloads
selected provider assets under the data root; VieNeu speaker embeddings for
reference cloning are cached under `models/vieneu` by source audio content hash.
The shared database migrates v4 to v5 transactionally; older binaries reject a
database whose schema version is newer than they support. MCP `save_voice`
stores Clone metadata in SQLite and copies reference audio and the prepared
prompt below `voices/<name>/`. Volo AI preset-only profiles store a name and
preset ID; seeded profiles also store a generated WAV and transcript below the
profile directory. `delete_voice` removes the matching row and owned Clone or
seeded-profile audio while preserving VieNeu model files. With a shared data
directory, profile writes and deletions affect the desktop library too.

## Side effects

- The engine reads its data root from `TTS_MCP_DATA_DIR`; without it, the root
  is `~/.tts-mcp`.
- The desktop sidecar sets the same environment variable to Tauri's app-data
  directory. Volo AI Settings → Storage displays that directory for MCP setup.
- VieNeu MCP synthesis needs the optional `desktop-vieneu` extra and an
  `audiocpp_cli` binary configured with `TTS_MCP_AUDIOCPP_PATH`.
- VieNeu reference cloning uses FFmpeg from `PATH` or
  `TTS_MCP_FFMPEG_PATH`. MP3 output also requires the existing `mp3` extra.
- Clone and Design saves replace an existing same-named Clone/Design profile;
  they reject a name already used by a VieNeu preset. `delete_voice` removes
  the profile from the shared store.
- OmniVoice output supports WAV, FLAC, OGG, and MP3 through `save_audio`;
  VieNeu supports WAV and MP3 at 48 kHz.

## Authorization & constraints

- The server runs as an MCP stdio process and uses the local engine store.
- `prepare_model` accepts only `omnivoice` or `vieneu`; status does not
  download assets.
- A profile name must start with an ASCII letter or digit, then contain only
  ASCII letters, digits, underscores, or hyphens, and may be at most 64
  characters.
- `clone` requires either a truthy `voice` or `ref_audio_path`.
- VieNeu preset IDs must exist in the validated manifest. VieNeu `clone`
  accepts Clone profiles, saved VieNeu preset profiles, or external reference
  audio and does not consume a transcript. Saved preset IDs are checked again
  against the manifest during synthesis. With OmniVoice, seeded preset profiles
  use their saved WAV and transcript; preset-only profiles return guidance to
  use VieNeu or seed the preset.
- Engine profile loading supports `clone`, `design`, and `vieneu_preset`;
  unsupported kinds, missing Clone files, and malformed Design instructions
  raise errors.

## Error paths

- If neither a voice name nor reference path is supplied, `clone` raises
  `ValueError`.
- Unknown providers, invalid languages, VieNeu Design profiles, attempts to
  overwrite a saved VieNeu preset, unsupported VieNeu output formats, or
  non-default VieNeu generation controls fail before provider inference. An
  unprepared VieNeu model reports that the caller must run
  `prepare_model(provider='vieneu')`.
- A pure VieNeu preset profile has no OmniVoice clone asset and fails with
  provider guidance. A stale preset ID fails through VieNeu validation without
  falling back to OmniVoice.
- Invalid profile names fail engine validation. A missing saved profile raises
  `FileNotFoundError`; an unsupported stored kind raises `ValueError`.
- An older app fails to open a database whose schema version is newer than its
  supported version.
- A Design profile without a non-empty instruction raises `RuntimeError`.
- `delete_voice` returns a not-found message when no profile or legacy files
  exist under the requested name.

## Tests

- `tests/test_server.py` checks MCP tool discovery, saved Clone/Design and
  seeded-profile dispatch,
  external reference forwarding, OmniVoice defaults, provider status and
  preparation routing, VieNeu preset, Clone, and saved preset routing,
  rejection paths, and profile-list formatting through direct calls and the
  MCP client.
- `tests/test_desktop_vieneu.py` checks explicit output paths, output cleanup,
  inference serialization, asset readiness, VieNeu preset and reference
  synthesis, and native failure handling.
- `tests/test_engine.py` checks Clone, Design, and VieNeu preset persistence,
  seeded WAV persistence, profile loading, v4-to-v5 schema migration,
  overwrite protection, and deletion.

## Related

- [Architecture overview](../architecture/overview.md)
- [Desktop speech providers](desktop-vieneu.md)

## Sources

- `src/tts_mcp/server.py`
- `src/tts_mcp/desktop_vieneu.py`
- `src/tts_mcp/desktop.py`
- `src/tts_mcp/engine.py`
- `src/tts_mcp/cli.py`
- `src/tts_mcp/convert.py`
- `pyproject.toml`
- `README.md`
- `apps/desktop/src/lib/sidecar.ts`
- `apps/desktop/src/App.tsx`
- `tests/test_server.py`
- `tests/test_desktop.py`
- `tests/test_desktop_vieneu.py`
- `tests/test_engine.py`
- `tests/test_cli.py`
