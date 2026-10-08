# MCP voice library

## Business rules

- `clone` accepts either a saved voice name or `ref_audio_path`; when both are
  supplied, the saved `voice` branch takes precedence.
- Saved Clone profiles use a prepared clone prompt. Saved Design profiles use
  their stored design instruction.
- MCP sees the desktop voice library only when its `TTS_MCP_DATA_DIR` points to
  the same directory shown under Volo AI **Settings → Storage**. Otherwise it
  uses the default `~/.tts-mcp` store.
- MCP `save_voice` creates a Clone profile from reference audio. Create Design
  profiles in the desktop library; the MCP `design` tool generates audio but
  does not save a profile.

## Flow

1. Configure the MCP process with the Volo AI app-data directory when shared
   access is wanted; the desktop sidecar already uses this directory.
2. Call `list_voices` to get saved profile names, kinds, languages, and
   kind-specific details.
3. Call `clone` with `voice` to reuse a saved Clone or Design profile. The
   server resolves it with `Engine.load_voice_profile`, maps Clone prompts to
   `voice_clone_prompt` and Design instructions to `instruct`, then sends the
   audio to `save_audio` at `output_path`.
4. To use an external recording, call `clone` with `ref_audio_path` and
   optionally `ref_text`; the server forwards those values to the engine.

## State changes

Generation writes an audio file at the requested output path. `save_voice`
stores Clone metadata in SQLite and copies reference audio and the prepared
prompt below `voices/<name>/`. A Design profile stores its instruction in
SQLite and needs no voice files. `delete_voice` removes the matching database
row and any Clone profile files. With a shared data directory, these writes
and deletions affect the desktop library too.

## Side effects

- The engine reads its data root from `TTS_MCP_DATA_DIR`; without it, the root
  is `~/.tts-mcp`.
- The desktop sidecar sets the same environment variable to Tauri's app-data
  directory. Volo AI Settings → Storage displays that directory for MCP setup.
- `save_voice` with an existing name replaces that profile. `delete_voice`
  removes the profile from the shared store.
- Speech generation writes WAV, FLAC, OGG, or MP3 output through `save_audio`;
  MP3 uses the existing FFmpeg/pydub conversion path.

## Authorization & constraints

- The server runs as an MCP stdio process and uses the local engine store.
- A profile name must start with an ASCII letter or digit, then contain only
  ASCII letters, digits, underscores, or hyphens, and may be at most 64
  characters.
- `clone` requires either a truthy `voice` or `ref_audio_path`.
- Engine profile loading supports `clone` and `design`; unsupported kinds,
  missing Clone files, and malformed Design instructions raise errors.

## Error paths

- If neither a voice name nor reference path is supplied, `clone` raises
  `ValueError`.
- Invalid profile names fail engine validation. A missing saved profile raises
  `FileNotFoundError`; an unsupported stored kind raises `ValueError`.
- A Design profile without a non-empty instruction raises `RuntimeError`.
- `delete_voice` returns a not-found message when no profile or legacy files
  exist under the requested name.

## Tests

- `tests/test_server.py` checks MCP tool discovery, saved Clone/Design dispatch,
  external reference forwarding, and profile-list formatting.
- `tests/test_engine.py` checks Clone and Design persistence, profile loading,
  and profile deletion.

## Related

- [Architecture overview](../architecture/overview.md)

## Sources

- `src/tts_mcp/server.py`
- `src/tts_mcp/engine.py`
- `src/tts_mcp/convert.py`
- `apps/desktop/src/lib/sidecar.ts`
- `apps/desktop/src/App.tsx`
- `tests/test_server.py`
- `tests/test_engine.py`
- `README.md`
