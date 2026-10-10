# Desktop speech providers

## Business rules

- The desktop sidecar and MCP server support OmniVoice and VieNeu-TTS. The CLI
  remains OmniVoice-only; MCP provider setup and tool behavior are documented
  in the [MCP voice library workflow](mcp-voice-library.md).
- `prepare_model` and `synthesize` require `provider: "omnivoice"` or
  `provider: "vieneu"`; the sidecar does not silently switch providers.
- `status` reports model-asset readiness separately from runtime and
  preprocessing availability. VieNeu presets and the default voice are read
  from its valid local manifest.
- The UI stores the selected provider in `localStorage`, defaults to
  OmniVoice, and downloads model assets only after an explicit prepare action.
- VieNeu accepts a manifest preset, a saved Clone profile, or one-off reference
  audio. It rejects saved Design profiles. Its synthesis request does not use
  OmniVoice speed or generation settings and applies no speed post-processing.

## Flow

1. The UI asks the sidecar for `status` and shows both provider records. The
   selected provider is persisted as `volo-ai.provider`.
2. An explicit setup action sends `prepare_model` with the selected provider.
   OmniVoice uses `Engine.ensure_model`; VieNeu downloads its pinned GGUF,
   manifest, every manifest-listed preset asset, and CAM++ speaker encoder.
   Progress is emitted on the JSONL stream and cancellation raises a
   `cancelled` response.
3. Synthesis sends the selected provider with the request. For VieNeu presets,
   the sidecar validates `preset_id`, phonemizes text, and passes the preset's
   reference-code and speaker-embedding files to `audiocpp_cli` with the `tts`
   task. For a saved Clone, it resolves the profile's reference audio from the
   existing voice library; for a one-off file, it normalizes the selected
   recording. Both clone paths compute or reuse a CAM++ speaker embedding and
   invoke the VieNeu `tts` task with `--voice-ref`.
4. The sidecar requires a readable 48 kHz WAV from audio.cpp, then writes WAV
   or MP3 through the existing `save_audio` conversion path and returns the
   existing `{audio_path, format}` result.

## State changes

- Provider preference is stored in the desktop browser's local storage.
- VieNeu model assets are stored below `models/vieneu`; derived speaker
  embeddings are cached below `models/vieneu/speaker-embeddings` by source
  audio content hash.
- Generated files are stored below the configured data directory's `outputs`.
- Saved profiles remain in the existing SQLite-backed voice library. Selecting
  a one-off reference does not add a profile.

## Side effects

- VieNeu preparation downloads from the pinned Hugging Face repository and
  revision declared in `desktop_vieneu.py`.
- Reference files are normalized by FFmpeg to mono, 48 kHz PCM WAV in a
  temporary directory. The temporary normalized file is removed after the CLI
  call.
- Each VieNeu synthesis starts the bundled or configured native CPU
  `audiocpp_cli`. The desktop release packages it beside the Python sidecar.
- Synthesis writes a new output file. MP3 conversion uses the existing FFmpeg
  and pydub path and keeps the 48 kHz source rate.

## Authorization & constraints

- The desktop sidecar is a local JSONL process; it has no account or remote
  authorization layer.
- The supported languages are English and Vietnamese. Outputs are WAV or MP3;
  reference files may be WAV, MP3, FLAC, or OGG.
- VieNeu readiness requires a valid GGUF, valid local manifest, all listed
  preset reference-code and speaker-embedding files, and the CAM++ encoder.
  Runtime and preprocessing availability are reported separately.
- Preset IDs are validated against the manifest. Saved voice synthesis accepts
  Clone profiles only; the shared library schema is unchanged.
- VieNeu output is 48 kHz. The UI hides OmniVoice speed and advanced settings
  for that provider; OmniVoice retains its existing controls.

## Error paths

- Missing or unknown provider IDs return `invalid_input` before provider work.
- Invalid manifests expose no preset list. Invalid or incomplete assets remain
  not-ready and can be retried; cancellation leaves valid partial files for
  reuse on retry.
- Missing audio.cpp runtime or VieNeu preprocessing is reported in provider
  status. A missing audio.cpp output or non-48 kHz WAV fails synthesis, and an
  incomplete final output is removed.
- Unknown presets, missing references, unsupported Design profiles, and
  invalid language or format return structured input or operation errors.

## Tests

- `tests/test_desktop.py` checks provider status, required provider IDs,
  OmniVoice routing, VieNeu routing and Design-profile rejection, and
  preparation cancellation over JSONL.
- `tests/test_desktop_vieneu.py` checks pinned asset validation, manifest
  presets/default, cancellation and retry, runtime reporting, preset and Clone
  synthesis, one-off reference normalization, output cleanup, and 48 kHz WAV
  and MP3 paths.
- `tests/test_build_sidecar.py` checks target-named Python and audio.cpp binary
  staging and PyInstaller collection of the optional VieNeu packages.

## Related

- [Architecture overview](../architecture/overview.md)
- [MCP voice library](mcp-voice-library.md)

## Sources

- `src/tts_mcp/desktop.py`
- `src/tts_mcp/desktop_vieneu.py`
- `src/tts_mcp/server.py`
- `src/tts_mcp/engine.py`
- `src/tts_mcp/convert.py`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src/lib/sidecar.ts`
- `apps/desktop/src-tauri/tauri.conf.json`
- `scripts/build_sidecar.py`
- `pyproject.toml`
- `tests/test_desktop.py`
- `tests/test_desktop_vieneu.py`
- `tests/test_server.py`
- `tests/test_build_sidecar.py`
- `docs/desktop-development.md`
