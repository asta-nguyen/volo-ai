# MCP voice library

## Business rules

- `speak` and `clone` default to OmniVoice. Both accept `provider="vieneu"`
  to select VieNeu explicitly; an unknown provider is rejected.
- OmniVoice `clone` accepts either a saved profile name or `ref_audio_path`;
  when both are supplied, the saved `voice` branch takes precedence. Saved
  Clone profiles use a prepared clone prompt, and saved Design profiles use
  their stored design instruction.
- VieNeu `speak` requires `voice="preset"` and a `preset_id` from the manifest
  listed by `status`. VieNeu `clone` accepts a saved Clone profile or
  `ref_audio_path`; it rejects Design profiles and supplied `ref_text`.
- VieNeu defaults an omitted synthesis language to English and accepts `en` or
  `vi`. It supports WAV and MP3 output and rejects non-default OmniVoice speed,
  step, and normalization controls.
- VieNeu assets download only when `prepare_model(provider="vieneu")` is
  called. VieNeu synthesis does not silently fall back to OmniVoice.
- MCP sees the desktop voice library only when its `TTS_MCP_DATA_DIR` points to
  the same directory shown under Volo AI **Settings → Storage**. Otherwise it
  uses the default `~/.tts-mcp` store.
- MCP `save_voice` creates a Clone profile from reference audio. Create Design
  profiles in the desktop library; the MCP `design` tool generates audio but
  does not save a profile.

## Flow

1. Configure the MCP process with the Volo AI app-data directory when shared
   access is wanted; the desktop sidecar already uses this directory.
2. Call `status` to inspect OmniVoice/VieNeu readiness and runtime availability.
   VieNeu's validated local manifest supplies `preset_voices` and
   `default_voice` after the manifest is present. On a fresh VieNeu setup,
   explicitly call `prepare_model(provider="vieneu")`, then call `status` again
   to read the downloaded preset catalog. `prepare_model` is the only MCP
   operation that prepares models.
3. Call `list_voices` for saved profile names, kinds, languages, and details.
   Packaged VieNeu presets are reported by `status`, not mixed into this list.
4. For OmniVoice, call `speak` for automatic-voice synthesis, or `clone` with
   `voice` to reuse a saved Clone or Design profile. The server resolves saved
   profiles with `Engine.load_voice_profile`, maps Clone prompts to
   `voice_clone_prompt` and Design instructions to `instruct`, then writes
   through `save_audio` at `output_path`.
5. For a VieNeu preset, call `speak` with `provider="vieneu"`,
   `voice="preset"`, and the selected `preset_id`. For VieNeu cloning, call
   `clone` with a saved Clone name or `ref_audio_path`. The server routes the
   request to `VieNeuProvider`, which validates the preset/profile, normalizes
   reference audio when needed, computes or reuses a CAM++ embedding, and calls
   `audiocpp_cli`.
6. For OmniVoice external-reference cloning, call `clone` with
   `ref_audio_path` and optionally `ref_text`; the server forwards them to the
   engine. VieNeu does not use `ref_text`.

## State changes

Generation writes an audio file at the requested `output_path`. `prepare_model`
downloads selected provider assets under the data root; VieNeu speaker
embeddings for reference cloning are cached under `models/vieneu` by source
audio content hash. `save_voice` stores Clone metadata in SQLite and copies
reference audio and the prepared prompt below `voices/<name>/`. A Design
profile stores its instruction in SQLite and needs no voice files.
`delete_voice` removes the matching database row and any Clone profile files.
With a shared data directory, profile writes and deletions affect the desktop
library too.

## Side effects

- The engine reads its data root from `TTS_MCP_DATA_DIR`; without it, the root
  is `~/.tts-mcp`.
- The desktop sidecar sets the same environment variable to Tauri's app-data
  directory. Volo AI Settings → Storage displays that directory for MCP setup.
- VieNeu MCP synthesis needs the optional `desktop-vieneu` extra and an
  `audiocpp_cli` binary configured with `TTS_MCP_AUDIOCPP_PATH`.
- VieNeu reference cloning uses FFmpeg from `PATH` or
  `TTS_MCP_FFMPEG_PATH`. MP3 output also requires the existing `mp3` extra.
- `save_voice` with an existing name replaces that profile. `delete_voice`
  removes the profile from the shared store.
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
- VieNeu preset IDs must exist in the validated manifest. VieNeu profile
  cloning accepts Clone profiles only and does not consume a transcript.
- Engine profile loading supports `clone` and `design`; unsupported kinds,
  missing Clone files, and malformed Design instructions raise errors.

## Error paths

- If neither a voice name nor reference path is supplied, `clone` raises
  `ValueError`.
- Unknown providers, invalid languages, VieNeu Design profiles, unsupported
  VieNeu output formats, or non-default VieNeu generation controls fail before
  provider inference. An unprepared VieNeu model reports that the caller must
  run `prepare_model(provider='vieneu')`.
- Invalid profile names fail engine validation. A missing saved profile raises
  `FileNotFoundError`; an unsupported stored kind raises `ValueError`.
- A Design profile without a non-empty instruction raises `RuntimeError`.
- `delete_voice` returns a not-found message when no profile or legacy files
  exist under the requested name.

## Tests

- `tests/test_server.py` checks MCP tool discovery, saved Clone/Design dispatch,
  external reference forwarding, OmniVoice defaults, provider status and
  preparation routing, VieNeu preset and Clone routing, rejection paths, and
  profile-list formatting through both direct calls and the MCP client.
- `tests/test_desktop_vieneu.py` checks explicit output paths, output cleanup,
  inference serialization, asset readiness, VieNeu preset and reference
  synthesis, and native failure handling.
- `tests/test_engine.py` checks Clone and Design persistence, profile loading,
  and profile deletion.

## Related

- [Architecture overview](../architecture/overview.md)

## Sources

- `src/tts_mcp/server.py`
- `src/tts_mcp/desktop_vieneu.py`
- `src/tts_mcp/engine.py`
- `src/tts_mcp/convert.py`
- `pyproject.toml`
- `apps/desktop/src/lib/sidecar.ts`
- `apps/desktop/src/App.tsx`
- `tests/test_server.py`
- `tests/test_desktop_vieneu.py`
- `tests/test_engine.py`
- `README.md`
