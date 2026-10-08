# Desktop audio.cpp VieNeu implementation plan

## Approved design

[Desktop VieNeu-TTS provider using audio.cpp](../specs/2026-10-08-desktop-audiocpp-vieneu-design.md)

## Global Constraints

- Keep the feature in the Volo AI desktop app; CLI and MCP remain OmniVoice-only.
- Build a CPU-capable `audiocpp_cli` from audio.cpp `v0.9.0` for each Tauri desktop target.
- Fetch VieNeu model assets only from `pnnbao-ump/VieNeu-TTS-v3-Turbo` revision `61b85e3d937fbbacb387714180e8182823512523`; the manifest controls preset IDs and the default `minh_quan_pro`.
- VieNeu is ready only when the GGUF, manifest, every manifest-listed preset file, and CAM++ speaker encoder are present and validated.
- Python VieNeu components provide only SEA-G2P phonemization and CAM++ embeddings; VieNeu TTS and codec inference run through audio.cpp.
- Start the target-native `audiocpp_cli` for each VieNeu synthesis request; do not add an HTTP server or warm-process lifecycle.
- Require provider IDs `omnivoice` or `vieneu` on `prepare_model` and `synthesize`; status reports both providers, with no silent fallback.
- Use `voice: "preset"` with `preset_id` for VieNeu presets, `voice: "profile"` with `voice_name` for saved Clone profiles, and `voice: "file"` with `ref_audio` for one-off references. Reject VieNeu Design profiles.
- Keep the provider preference in `localStorage`, default existing installs to OmniVoice, and wait for an explicit user action before downloading model assets.
- Store provider assets and derived embeddings under the app data directory. Do not change the voice-profile database schema.
- Write VieNeu WAV at 48 kHz and preserve that rate for MP3 export. Do not apply speed post-processing to VieNeu audio.

## Tasks

### Task 1 — Add VieNeu asset lifecycle and readiness

Files:

- `src/tts_mcp/desktop_vieneu.py::VieNeuProvider` (new)
- `pyproject.toml::[project.optional-dependencies]`
- `tests/test_desktop_vieneu.py::VieNeuAssetTests` (new)

Interfaces: `VieNeuProvider.status()` reports model, runtime, and preprocessing availability plus manifest-derived presets and default. `VieNeuProvider.ensure_model(on_progress, should_cancel)` downloads or reuses the pinned assets and returns readiness for the desktop dispatcher.

Change: Add `desktop-vieneu = ["vieneu>=3.8.3,<4"]` as an optional desktop extra. Download the pinned GGUF, manifest, every preset's reference codes and speaker embedding, and `speaker_encoder.onnx`. Validate the manifest structure and required files; expose no presets before a valid local manifest exists. Resolve the native CLI through `TTS_MCP_AUDIOCPP_PATH` or the bundled sibling binary and report a missing/non-runnable CLI through `runtime_available`. Keep `model_ready` independent from runtime/preprocessing availability; set `unavailable_reason` to null only when the runtime and preprocessing are available, and otherwise report an actionable reason. Emit preparation progress, honor cancellation, keep partial downloads not-ready, and reuse valid files on retry.

Verify: `python -m unittest discover -s tests -p test_desktop_vieneu.py -v`.

- `test_manifest_exposes_presets_and_default`: valid pinned fixture → 25 presets and `minh_quan_pro`.
- `test_readiness_requires_all_pinned_assets`: remove any required file → `model_ready` is false.
- `test_invalid_manifest_has_no_presets`: invalid JSON → empty preset list and null default.
- `test_cancelled_download_stays_not_ready_then_retry_completes`: cancel → not-ready; retry → ready while reusing valid files.
- `test_missing_runtime_or_frontend_is_reported`: missing CLI or preprocessing import → unavailable field and actionable reason.

### Task 2 — Add VieNeu preset and clone synthesis

Files:

- `src/tts_mcp/desktop_vieneu.py::VieNeuProvider.synthesize`
- `tests/test_desktop_vieneu.py::VieNeuSynthesisTests`
- `src/tts_mcp/engine.py::Engine.list_voices` (inspected, no change)
- `src/tts_mcp/convert.py::save_audio` (inspected, no change)

Interfaces: Synthesis consumes validated request fields and saved voice rows from `Engine.list_voices`; it calls the official VieNeu phonemizer and CAM++ frontend, then the resolved `audiocpp_cli`. It returns the existing `{audio_path, format}` result shape.

Change: Validate language, text, preset IDs, profile kind, reference path, and output format. Use manifest assets for presets; use saved Clone reference audio without loading OmniVoice `prompt.pt`; support one-off WAV, MP3, FLAC, and OGG references without saving them. Normalize non-WAV references with bundled FFmpeg, cache CAM++ embeddings by source-file content hash, invoke audio.cpp with an argument list, validate its output, and remove incomplete files on failure. Save VieNeu output as 48 kHz WAV or MP3 through the existing conversion path; do not apply `atempo`.

Verify: `python -m unittest discover -s tests -p test_desktop_vieneu.py -v`.

- `test_preset_uses_manifest_assets_and_writes_48khz`: valid preset → packaged codes passed to CLI and readable 48 kHz WAV.
- `test_unknown_preset_does_not_launch_cli`: unknown ID → structured input error and no process launch.
- `test_saved_clone_uses_reference_and_campp_embedding`: Clone profile → reference audio and cached embedding, no OmniVoice prompt.
- `test_one_off_non_wav_is_normalized_without_persisting`: MP3/FLAC/OGG reference → normalized WAV and no voice-library row.
- `test_cli_failure_removes_partial_output`: failing process → structured error and incomplete output removed.
- `test_mp3_export_preserves_48khz`: MP3 request → conversion receives 48 kHz source audio.

### Task 3 — Add the provider-aware JSONL contract

Files:

- `src/tts_mcp/desktop.py::dispatch_request`
- `src/tts_mcp/desktop.py::run_protocol`
- `tests/test_desktop.py::DesktopWorkerTests`

Interfaces: The existing dispatcher calls the VieNeu provider from Tasks 1–2 and keeps `Engine` for OmniVoice. `status` adds a `providers` map; `prepare_model` and `synthesize` require a validated `provider` field.

Change: Add `providers.omnivoice` and `providers.vieneu`, each with `model_ready`, `runtime_available`, `preprocessing_available`, and `unavailable_reason`; include `preset_voices` (`id`, `name`, `label`) and `default_voice` under VieNeu. Keep existing top-level OmniVoice model details used by Settings. Route preparation and synthesis to the selected provider, preserve progress/cancellation, reject missing or unknown providers and provider-incompatible voice modes, and return actionable structured errors without fallback. Update existing OmniVoice sidecar requests in the desktop tests to include `provider: "omnivoice"`; add protocol cases for VieNeu routing and rejection paths. Leave CLI and MCP dispatch unchanged.

Verify: `python -m unittest discover -s tests -p test_desktop.py -v`.

- `test_status_reports_both_providers_and_manifest_voices`: status → both readiness records and VieNeu preset/default metadata.
- `test_prepare_and_synthesis_require_known_provider`: omitted or unknown ID → `invalid_input` before provider work.
- `test_omnivoice_requests_keep_engine_dispatch`: `provider: "omnivoice"` → existing Engine path.
- `test_vieneu_preset_dispatches_to_adapter`: `provider: "vieneu", voice: "preset"` → VieNeu adapter.
- `test_vieneu_design_profile_is_rejected`: Design profile → unsupported voice error.
- `test_protocol_cancels_selected_provider_preparation`: cancel → `cancelled` response and assets remain not-ready.

### Task 4 — Add provider selection and provider-specific workspace controls

Files:

- `apps/desktop/src/lib/sidecar.ts::{StatusResult, VoiceMode}`
- `apps/desktop/src/App.tsx::{SetupScreen, SettingsView, WorkspaceView, App}`
- `apps/desktop/src/lib/i18n.ts::createUiCopy`

Interfaces: The UI consumes the provider map from Task 3, sends `provider` on preparation and synthesis, and passes the selected manifest preset ID using the approved voice shape.

Change: Add first-run provider selection before downloads, default to OmniVoice, persist the choice in `localStorage`, and remove automatic preparation on startup. Show install/readiness and explicit prepare actions for both providers in Settings; switching to an uninstalled provider opens setup without fallback. In the workspace, provide VieNeu presets with the manifest default, saved Clone profiles, and a one-off reference picker; keep Design and advanced OmniVoice controls OmniVoice-only and hide the speed slider for VieNeu. Add English and Vietnamese labels.

Verify: `npm --prefix apps/desktop run build` completes without TypeScript or Vite errors. Manual flow confirms: clean startup offers both providers without downloading; OmniVoice remains the default; VieNeu setup is explicit and cancellable; provider switching retains installed assets; VieNeu synthesizes Vietnamese and English with `minh_quan_pro`, a saved Clone, and a one-off reference; its workspace hides speed and OmniVoice-only controls; status errors and retry remain visible.

### Task 5 — Package the pinned native runtime and update desktop instructions

Files:

- `scripts/build_sidecar.py::main`
- `tests/test_build_sidecar.py::SidecarBuildTests`
- `apps/desktop/src-tauri/tauri.conf.json::bundle.externalBin`
- `README.md::Run the desktop app locally and Build a release app`
- `docs/desktop-development.md::Build the sidecar`

Interfaces: The packaging command accepts the host-built `audiocpp_cli` path and target triple, stages target-named OmniVoice and audio.cpp binaries, and Tauri bundles both. `VieNeuProvider` uses `TTS_MCP_AUDIOCPP_PATH` for development or the bundled sibling executable for packaged builds.

Change: Collect the optional `vieneu` frontend packages into the Python sidecar. Require `--audiocpp <path>` for release packaging, stage `audiocpp-cli-{target}{.exe}` beside `tts-sidecar-{target}{.exe}`, and add `binaries/audiocpp-cli` alongside `binaries/tts-sidecar` in Tauri `externalBin`. Document the matching-host CPU build and packaging steps for `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc`, and `x86_64-unknown-linux-gnu`; document installation with `.[mp3,desktop-vieneu]` and the explicit provider download flow.

Verify: `python -m unittest discover -s tests -p test_build_sidecar.py -v`; `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`.

- `test_builder_stages_both_binaries_for_target`: target and two input paths → `tts-sidecar-{target}{.exe}` and `audiocpp-cli-{target}{.exe}` in Tauri binaries.
- On each release host, build audio.cpp `v0.9.0` with its official CPU instructions, run `python scripts/build_sidecar.py --ffmpeg <ffmpeg-path> --audiocpp <audiocpp_cli-path> --target <target-triple>`, and confirm Tauri finds both target-suffixed binaries.
- After all tasks, run `python -m unittest discover -s tests -v`, `python -m compileall -q src tests`, `npm --prefix apps/desktop run build`, and `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`; all must succeed.

## Files inspected, no change

- `src/tts_mcp/engine.py::Engine.load_voice_profile` — VieNeu must use Clone reference audio without the OmniVoice prompt.
- `src/tts_mcp/convert.py::save_audio` — already accepts a sample-rate argument for WAV and MP3 output.
- `src/tts_mcp/cli.py::main` and `src/tts_mcp/server.py::speak` — CLI/MCP remain OmniVoice-only.
- `tests/test_server.py` — MCP protocol and behavior remain unchanged.
- `apps/desktop/src-tauri/capabilities/default.json` and `apps/desktop/src-tauri/Cargo.toml` — no new frontend shell permission or Rust plugin is needed because the Python sidecar launches the sibling executable.
- `docs/llm/AGENTS.md`, `docs/llm/INDEX.md`, `docs/llm/architecture/overview.md`, and `docs/llm/workflows/mcp-voice-library.md` — wiki describes verified source only and will be refreshed after implementation.

## Impact map

Entry: `apps/desktop/src/App.tsx::App`; `src/tts_mcp/desktop.py::dispatch_request`
Flow: Existing OmniVoice flow: App startup `status` → `prepare_model` → `synthesize` through `SidecarClient` JSONL → `dispatch_request` → `Engine.generate` → `save_audio`; planned VieNeu flow: selected provider status → explicit preparation → provider-specific synthesis → `audiocpp_cli` → `save_audio`
State changes: Selected provider in `localStorage`; VieNeu assets below `TTS_MCP_DATA_DIR/models/vieneu`; cached speaker embeddings under app data; generated files under `outputs`; voice-profile database unchanged
External effects: Pinned Hugging Face downloads; target-matched `audiocpp_cli` process per VieNeu synthesis; bundled FFmpeg for reference normalization and MP3 export; local audio writes
Change candidates: `src/tts_mcp/desktop_vieneu.py`, `src/tts_mcp/desktop.py`, `pyproject.toml`, `apps/desktop/src/lib/sidecar.ts`, `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/i18n.ts`, `scripts/build_sidecar.py`, `apps/desktop/src-tauri/tauri.conf.json`, `README.md`, `docs/desktop-development.md`, `tests/test_desktop_vieneu.py`, `tests/test_desktop.py`, and `tests/test_build_sidecar.py`
Verification: Targeted VieNeu asset/synthesis, JSONL, and packaging tests; full Python unit suite and compile check; frontend build; Tauri cargo check; manual first-run, synthesis, switching, cancellation/retry, and packaging flow on each supported native release host
Verified at: `6b7c1d666c6a9f42d9ec0f48e203f11e008a9e7c`

## Approval Gate

Required: yes
Reason: Changes the desktop JSONL request contract, adds an optional dependency, changes packaging and UI flows across multiple files, and adds a provider to synthesis.
Status: approved

## Decision Log

- D1: Expose manifest-derived preset IDs, names, labels, and default under `providers.vieneu` in `status`.
- D2: Use `voice: "preset"` with `preset_id`; retain `profile` for saved Clone profiles and `file` for one-off references.
- D3: Hide the speed slider for VieNeu; keep it unchanged for OmniVoice and do not use FFmpeg `atempo`.
