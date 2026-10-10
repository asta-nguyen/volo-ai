# VieNeu-TTS support in the MCP server

## Problem

The desktop sidecar already exposes VieNeu-TTS through `VieNeuProvider`, while
the MCP server exposes only OmniVoice generation. MCP clients cannot inspect
VieNeu readiness or presets, explicitly prepare its model assets, or select
VieNeu for synthesis.

## Goals and scope

- Add VieNeu as an opt-in provider for MCP `speak` and `clone`.
- Keep existing MCP calls on OmniVoice when `provider` is omitted.
- Expose provider readiness and VieNeu's manifest-derived preset catalog.
- Download VieNeu assets only after an explicit `prepare_model` call.
- Reuse the existing `VieNeuProvider`, local voice library, and pinned model
  assets; do not add a second inference implementation.
- Keep CLI behavior OmniVoice-only. `design` remains an OmniVoice-only tool.
- Do not change the profile database schema or default data directory.

## Decisions

### D1 — Add provider selection to existing MCP synthesis tools

Question: Should VieNeu use the current synthesis tools or add a parallel set
of VieNeu-specific tools?

Decision: Add `provider` to `speak` and `clone`, defaulting to `omnivoice`.
Add generic `status` and `prepare_model(provider)` tools. VieNeu presets use
`voice: "preset"` with `preset_id`; `clone` continues to accept saved profile
names or `ref_audio_path` for cloning.

Impact: Existing MCP tool names and calls remain compatible; the new provider
can be selected without overloading the existing `clone.voice` profile-name
behavior for OmniVoice.

Confirmed by user: 2026-10-08

### D2 — Keep VieNeu setup explicit

Decision: `status` is read-only. Only `prepare_model(provider="vieneu")`
downloads VieNeu assets. Synthesis on an unprepared model returns an actionable
error and never falls back to OmniVoice.

Impact: Network downloads remain user-triggered, and partial or failed asset
downloads can be retried through the existing provider implementation.

Confirmed by user: 2026-10-08

### D3 — Keep VieNeu synthesis within its supported modes

Decision: `speak` supports a VieNeu manifest preset selected with
`voice: "preset"` and `preset_id`. `clone` supports a saved Clone profile or
one-off reference audio. VieNeu rejects Design profiles and `ref_text`, and
does not apply OmniVoice speed, step, or normalization settings.

Impact: Preset metadata comes from the local manifest; saved Clone profiles
reuse their reference audio without loading OmniVoice clone prompts. Unsupported
inputs fail clearly.

Confirmed by user: 2026-10-08

## MCP behavior

### Provider status and preparation

- `status()` returns a structured result with `providers.omnivoice` and
  `providers.vieneu`. Both include model readiness, runtime availability,
  preprocessing availability, and an actionable unavailable reason. VieNeu
  also includes `preset_voices` (`id`, `name`, `label`) and `default_voice`
  from its validated local manifest. Invalid or absent manifests expose an
  empty preset list and a null default.
- `prepare_model(provider)` accepts `omnivoice` or `vieneu` and calls the
  existing provider's `ensure_model`. Unknown providers fail before provider
  work. VieNeu downloads remain pinned to the asset revision in the existing
  desktop provider.
- Status and preparation do not alter voice profiles. `list_voices` continues
  to list saved user profiles only; packaged presets remain in `status`.

### Speech generation

- `speak` adds `provider` (default `omnivoice`), `voice` (default `auto`),
  `preset_id`, and `language`. Existing OmniVoice calls keep their current
  defaults and output behavior. VieNeu requires `voice: "preset"`, a preset ID
  present in the validated manifest, a supported `en` or `vi` language, and a
  `.wav` or `.mp3` output path.
- `clone` adds `provider` (default `omnivoice`) and optional `language`.
  OmniVoice retains its current saved-profile and reference-audio behavior,
  including saved-profile precedence if both are supplied; an omitted language
  leaves its current engine default unchanged. VieNeu accepts a saved Clone
  profile or a one-off `ref_audio_path`, uses English when language is omitted,
  and accepts English or Vietnamese when supplied. It rejects saved Design
  profiles and any supplied `ref_text`, because its speaker embedding path does
  not consume a transcript. VieNeu uses `.wav` or `.mp3` output paths.
- VieNeu continues to normalize reference audio to 48 kHz WAV with FFmpeg,
  compute or reuse the CAM++ embedding, and invoke `audiocpp_cli`. It writes to
  the exact MCP `output_path`; the desktop sidecar keeps its existing generated
  output naming when it does not provide an explicit path.
- VieNeu does not support `speed`, `steps`, or text normalization. Their
  existing defaults are accepted for backward-compatible tool schemas; any
  non-default values fail instead of being silently ignored.
- Missing runtime, preprocessing packages, model assets, invalid text or
  language, unsupported output format, unknown preset/profile, unreadable
  reference audio, and native-process failures return MCP tool errors without
  provider fallback. Incomplete output files are removed on failure.
- VieNeu synthesis calls are serialized per MCP process so concurrent clients
  do not load multiple CPU inference processes or race lazy CAM++ initialization.

## Runtime configuration

- VieNeu preprocessing remains optional; MCP users install the existing
  `desktop-vieneu` extra. No VieNeu dependency is added to the base install.
- MCP users configure `TTS_MCP_AUDIOCPP_PATH` to a runnable CPU
  `audiocpp_cli` binary. The Python sidecar release packaging is not changed by
  this feature.
- `TTS_MCP_DATA_DIR` continues to select model assets, voice profiles, and
  generated audio. Setting it to the directory shown in Volo AI Settings →
  Storage lets MCP reuse the app's downloaded VieNeu assets and saved Clone
  profiles; otherwise MCP uses `~/.tts-mcp`.
- Reference cloning requires FFmpeg through `PATH` or
  `TTS_MCP_FFMPEG_PATH`. MP3 output also requires the existing `mp3` extra.
- `prepare_model` may take a long time and uses the existing downloader's
  retry-safe partial-file validation. MCP does not expose desktop JSONL
  cancellation in this slice.

## README guide

Update the MCP setup section in `README.md` with a complete VieNeu guide:

1. Show installing the existing `desktop-vieneu` extra and the optional `mp3`
   extra when MP3 export is needed.
2. Show configuring `TTS_MCP_AUDIOCPP_PATH`, `TTS_MCP_DATA_DIR`, and, when
   FFmpeg is not on `PATH`, `TTS_MCP_FFMPEG_PATH` in the MCP client's server
   environment.
3. Show the call order: inspect `status`, explicitly call
   `prepare_model(provider="vieneu")` when assets are missing, inspect `status`
   again to read the downloaded manifest preset catalog, then call
   `speak(provider="vieneu", voice="preset", preset_id=...)`.
4. Show `clone(provider="vieneu", language="vi")` with a saved Clone profile
   and with `ref_audio_path`, and state that VieNeu does not consume `ref_text`
   or Design profiles.
5. State that omitting `provider` keeps current OmniVoice behavior and that
   VieNeu synthesis does not auto-download or fall back to OmniVoice.

## Errors and recovery

- Invalid provider values are rejected before engine or provider work.
- VieNeu preset IDs are checked against the validated manifest before native
  inference starts.
- A request made before VieNeu assets are ready reports that the caller must
  run `prepare_model(provider="vieneu")`; it does not start a download itself.
- A missing `audiocpp_cli` or preprocessing package is visible in `status` and
  produces an actionable synthesis error.
- Download failures leave the model not-ready; a later `prepare_model` call
  reuses valid files and retries missing or invalid assets.
- VieNeu's supported output formats remain WAV and MP3. Other formats continue
  to work only with OmniVoice.

## Verification approach

- Add MCP protocol tests for the unchanged OmniVoice defaults, provider-aware
  `speak` and `clone`, structured `status`, explicit preparation, preset
  metadata, errors, and exact output-path handling.
- Verify VieNeu preset, saved Clone, one-off reference, unsupported Design and
  transcript cases through the existing `VieNeuProvider` test fixtures.
- Run the repository's Python unit suite and compile check, then verify the
  README guide's install and call examples against source and test behavior.
- Manually configure an MCP client with a local `audiocpp_cli`, prepare assets,
  synthesize with a manifest preset and a saved Clone profile, and confirm
  OmniVoice remains the default when `provider` is omitted.

## Related context

- [MCP voice library](../../llm/workflows/mcp-voice-library.md)
- [Desktop speech providers](../../llm/workflows/desktop-vieneu.md)

## Sources

- `src/tts_mcp/server.py`
- `src/tts_mcp/engine.py`
- `src/tts_mcp/desktop_vieneu.py`
- `src/tts_mcp/convert.py`
- `tests/test_server.py`
- `tests/test_desktop_vieneu.py`
- `README.md`
- `pyproject.toml`

## Impact map

Entry: `src/tts_mcp/server.py::speak`, `src/tts_mcp/server.py::clone`; planned entries `src/tts_mcp/server.py::status`, `src/tts_mcp/server.py::prepare_model`
Flow: MCP client → `server.py` tool → `VieNeuProvider.status` / `ensure_model` / `synthesize` → `audiocpp_cli` → exact MCP output path; saved Clone references resolve through `Engine.list_voices`
State changes: VieNeu assets under `TTS_MCP_DATA_DIR/models/vieneu`; derived speaker embeddings under the same model directory; generated audio at requested output path; voice-profile schema unchanged
External effects: Hugging Face asset downloads on explicit preparation; audio.cpp and FFmpeg processes for VieNeu synthesis; local audio writes
Change candidates: `src/tts_mcp/server.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_server.py`, `tests/test_desktop_vieneu.py`, `README.md`, and verified MCP wiki pages after implementation
Verification: targeted MCP and VieNeu provider tests; full Python unit suite; `python -m compileall -q src tests`; README configuration review; manual MCP-client preset and saved-Clone synthesis
Verified at: `8a4205feba8f656ee61b6a3d8921c78e86406037`

## Execution

Plan: [MCP VieNeu support implementation](../plans/2026-10-08-mcp-vieneu-provider-plan.md) — approved for implementation.
