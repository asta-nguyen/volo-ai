# MCP VieNeu-TTS support implementation plan

## Approved design

[VieNeu-TTS support in the MCP server](../specs/2026-10-08-mcp-vieneu-provider-design.md)

## Global Constraints

- Add `provider` to MCP `speak` and `clone`, defaulting to `omnivoice` so
  existing calls retain their behavior.
- Expose the manifest-derived VieNeu preset catalog from `status`; download
  VieNeu assets only through an explicit `prepare_model(provider="vieneu")`.
- Use `voice: "preset"` with `preset_id` for preset speech. Use saved Clone
  profiles or `ref_audio_path` for VieNeu cloning; reject Design profiles and
  `ref_text` for VieNeu.
- Do not change CLI behavior, the saved-profile schema, or the default
  `TTS_MCP_DATA_DIR`.
- Never silently fall back to OmniVoice when VieNeu is selected.
- Keep desktop JSONL requests unchanged; when no explicit output path is passed
  to `VieNeuProvider`, preserve its generated UUID output naming.
- Keep VieNeu dependencies optional and use `TTS_MCP_AUDIOCPP_PATH` for the MCP
  process's native runtime.

## Tasks

### Task 1 — Preserve MCP output paths and serialize VieNeu inference

Files:

- `src/tts_mcp/desktop_vieneu.py::VieNeuProvider.synthesize`
- `tests/test_desktop_vieneu.py::VieNeuSynthesisTests`

Interfaces: MCP passes the caller's `output_path` to the shared VieNeu
provider. Desktop sidecar requests continue calling `synthesize` without an
explicit path and receive the current UUID-named output. A provider instance
serializes synthesis calls so concurrent MCP requests do not start overlapping
CPU model processes or initialize the CAM++ encoder concurrently.

Change: Add an optional explicit output path to `synthesize`. Validate that it
uses the selected supported format (`wav` or `mp3`), save to that exact path,
and keep existing incomplete-output cleanup. Keep the current generated path
when no explicit destination is supplied. Add a per-instance synthesis lock
around reference preprocessing, lazy encoder access, and native inference.

Verify: `rtk .venv/bin/python -m unittest discover -s tests -p test_desktop_vieneu.py -v`.

- `test_synthesize_respects_explicit_output_path`: explicit WAV or MP3 path →
  the returned path is exact and the file is written there.
- Existing random-output tests: no explicit path → UUID-named file under the
  supplied output directory.
- `test_concurrent_synthesis_is_serialized`: two overlapping calls on one
  provider instance → only one native synthesis section runs at a time.
- Existing native failure tests: process failure → incomplete output removed.

### Task 2 — Expose VieNeu status, preparation, and synthesis through MCP

Files:

- `src/tts_mcp/server.py::speak`
- `src/tts_mcp/server.py::clone`
- `src/tts_mcp/server.py::status`
- `src/tts_mcp/server.py::prepare_model`
- `tests/test_server.py::ServerTests`
- `tests/test_server.py::MCPProtocolTests`

Interfaces: A shared `VieNeuProvider(DATA_DIR)` supplies MCP status,
preparation, and synthesis. `status` and `prepare_model` return structured MCP
objects. `speak` and `clone` accept `provider="omnivoice"` by default and keep
their existing output-path result strings.

Change:

1. Add `status()` with `providers.omnivoice` and `providers.vieneu` readiness,
   runtime, preprocessing, and unavailable-reason fields. Include VieNeu's
   manifest-derived `preset_voices` and `default_voice`; invalid or absent
   manifests return an empty list and null default.
2. Add `prepare_model(provider)` for `omnivoice` and `vieneu`. Route to the
   existing `Engine.ensure_model` or `VieNeuProvider.ensure_model`; reject
   unknown providers before either provider is called.
3. Add `provider`, `voice`, `preset_id`, and optional `language` to `speak`.
   Preserve OmniVoice defaults. For VieNeu require `voice="preset"` and a
   manifest-listed `preset_id`; default an omitted target language to English.
   Reject non-default OmniVoice speed, steps, or normalization settings for
   VieNeu. Derive VieNeu format from `.wav` or `.mp3` in `output_path` and pass
   that exact path to the provider.
4. Add `provider` and optional `language` to `clone`. Preserve OmniVoice's
   saved-profile precedence and reference transcript behavior. For VieNeu,
   route a saved Clone profile or reference file to the provider, default the
   target language to English, reject Design profiles and supplied `ref_text`,
   and reject non-default speed, steps, or normalization settings.
5. Keep `design`, profile-management tools, and `list_voices` behavior
   unchanged; packaged presets remain visible through `status`, not
   `list_voices`.

Verify: `rtk .venv/bin/python -m unittest discover -s tests -p test_server.py -v`.

- `test_speak_defaults_to_omnivoice`: old call shape → same `Engine.generate`
  arguments and saved output path as before.
- `test_status_reports_provider_state_and_manifest_voices`: mocked provider
  status → structured provider records and preset/default metadata.
- `test_prepare_model_routes_only_selected_provider`: each valid provider →
  only its `ensure_model` is called; unknown ID → neither is called.
- MCP protocol tool discovery → existing six tools plus `status` and
  `prepare_model`.
- `test_speak_routes_vieneu_preset_to_requested_path`: valid VieNeu preset →
  selected language, format, and exact output path reach `VieNeuProvider`.
- `test_clone_routes_vieneu_saved_clone_and_reference`: saved Clone →
  provider receives the profile reference; one-off file → provider receives
  that file and target language.
- VieNeu Design profile, supplied `ref_text`, invalid language, unknown
  provider/preset, unsupported output format, and non-default OmniVoice
  controls → MCP tool error and no provider fallback.
- VieNeu assets not prepared or runtime/preprocessing unavailable → actionable
  MCP error; no download, engine fallback, or native inference starts.
- Invalid or unreadable reference audio and provider preparation failure → MCP
  tool error; valid cached assets remain available for retry.
- Existing OmniVoice Clone/Design and reference-audio tests → unchanged
  behavior when provider is omitted.

### Task 3 — Add the MCP VieNeu setup and usage guide

Files:

- `README.md::Use the MCP server`

Interfaces: The guide matches the tool names and parameters from Task 2 and
the environment variables and optional extras already present in the project.

Change: Document installation with the existing `desktop-vieneu` extra and,
for MP3, the `mp3` extra. Show `TTS_MCP_AUDIOCPP_PATH`, `TTS_MCP_DATA_DIR`, and
`TTS_MCP_FFMPEG_PATH` configuration, then give the `status` →
`prepare_model(provider="vieneu")` → `status` preset lookup → `speak` flow
because the manifest catalog is empty before first preparation. Add saved-Clone
and one-off `ref_audio_path` examples for `clone`, including a Vietnamese
language example. State that an omitted provider keeps OmniVoice, VieNeu does
not auto-download or fall back, and VieNeu does not consume `ref_text` or
Design profiles.

Verify: Review every README example against MCP tool schemas and assert that
all named environment variables and extras exist in `src/tts_mcp` or
`pyproject.toml`.

## Files inspected, no change

- `src/tts_mcp/engine.py::Engine.generate`, `Engine.model_status`,
  `Engine.ensure_model`, `Engine.list_voices`, and `DATA_DIR` — reuse existing
  generation, preparation, profile listing, and data-root behavior.
- `src/tts_mcp/desktop.py::dispatch_request` — confirm the shared provider's
  existing JSONL status, preparation, and synthesis calls remain unchanged.
- `pyproject.toml::[project.optional-dependencies]` — reuse the current
  `desktop-vieneu` and `mp3` extras; do not add a base dependency.
- `tests/test_desktop.py::DesktopWorkerTests` — desktop JSONL contract remains
  unchanged.

## Workspace note

Existing user edits in `apps/desktop/src-tauri/tauri.conf.json`,
`apps/desktop/src/App.tsx`, `apps/desktop/src/lib/i18n.ts`,
`apps/desktop/src/lib/sidecar.ts`, `apps/desktop/src/styles.css`, and the untracked
`apps/desktop/src/components/AudioPlayer.tsx` are outside this plan and must
remain untouched.

## Final verification

Run all repository verification commands from `AGENTS.md`:

```sh
rtk .venv/bin/python -m unittest discover -s tests -v
rtk .venv/bin/python -m compileall -q src tests
rtk npm --prefix apps/desktop run build
rtk cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

When a runnable `audiocpp_cli` and prepared VieNeu assets are available, also
call the MCP tools through a real stdio client: inspect status, explicitly
prepare VieNeu, synthesize a preset to the requested WAV path, and synthesize
through a saved Clone profile. If those runtime prerequisites are unavailable,
use the protocol tests and provider fixtures and report that real inference
could not be established.

## Wiki handoff

After implementation verification, invoke `document-wiki` to update
`docs/llm/architecture/overview.md`,
`docs/llm/workflows/mcp-voice-library.md`, and `docs/llm/INDEX.md` from current
source and tests. Refresh `docs/llm/workflows/desktop-vieneu.md` too because
its existing OmniVoice-only MCP statement becomes stale after this change.

## Impact map

Entry: `src/tts_mcp/server.py::speak`, `src/tts_mcp/server.py::clone`; planned entries `src/tts_mcp/server.py::status`, `src/tts_mcp/server.py::prepare_model`
Flow: MCP client → `server.py` tool → `VieNeuProvider.status` / `ensure_model` / `synthesize` → `audiocpp_cli` → exact MCP output path; saved Clone references resolve through `Engine.list_voices`
State changes: VieNeu assets under `TTS_MCP_DATA_DIR/models/vieneu`; derived speaker embeddings under the same model directory; generated audio at requested output path; voice-profile schema unchanged
External effects: Hugging Face asset downloads on explicit preparation; audio.cpp and FFmpeg processes for VieNeu synthesis; local audio writes
Change candidates: `src/tts_mcp/server.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_server.py`, `tests/test_desktop_vieneu.py`, `README.md`; relevant docs wiki updates through `document-wiki` after verification
Verification: targeted MCP and VieNeu provider tests; full Python unit suite; `python -m compileall -q src tests`; frontend build; Tauri cargo check; MCP stdio synthesis when runtime prerequisites are available
Verified at: `8a4205feba8f656ee61b6a3d8921c78e86406037`

## Approval Gate

Required: yes
Reason: Adds a public MCP API and changes several source, test, and user-guide files.
Status: approved

## Decision Log

None.
