# Desktop VieNeu-TTS provider using audio.cpp

## Problem

Volo AI currently exposes one desktop synthesis provider: the Python OmniVoice
engine. Add VieNeu-TTS v3 Turbo as a second local provider for the desktop app,
using audio.cpp for speech inference. Keep the existing CLI and MCP behavior
bound to OmniVoice.

## Decisions

- **Scope:** Volo AI desktop only. CLI and MCP keep their current engine,
  protocol, and behavior.
- **Inference:** run a target-native `audiocpp_cli` process for each VieNeu
  synthesis request. This avoids adding another long-running HTTP server and
  its port/process lifecycle. OmniVoice continues through `Engine.generate`.
- **Preprocessing:** use VieNeu's Python components for SEA-G2P text
  phonemization and CAM++ speaker embeddings. Python does not run VieNeu TTS
  inference or load its Python TTS/codec weights. audio.cpp turns the reference
  WAV into its reference codes.
- **First run:** show the provider choice before downloading model assets; do
  not auto-download. Default the choice to OmniVoice for existing installs and
  persist the selected provider in `localStorage`. Keep each provider's model
  assets when switching.
- **Packaging:** ship a CPU-capable `audiocpp_cli` binary for each desktop
  target supported by the existing Tauri app. Use the VieNeu Q8_0 GGUF package
  and make the official `vieneu` preprocessing package a desktop-only optional
  dependency so CLI/MCP installs do not gain it. VieNeu preparation also
  installs the CAM++ speaker-encoder asset needed for offline cloning.
- **Voice cloning:** support VieNeu packaged preset voices, saved Clone
  profiles that have reference audio, and a one-off reference chosen in the
  synthesis view. The one-off reference is not saved to the voice library.
  Voice Design profiles remain OmniVoice-only.

## Pinned upstream inputs

- Build the CPU-capable `audiocpp_cli` from audio.cpp tag `v0.9.0` for each
  desktop target supported by the existing Tauri app.
- Fetch model assets from `pnnbao-ump/VieNeu-TTS-v3-Turbo` at revision
  `61b85e3d937fbbacb387714180e8182823512523`:
  - `gguf/vieneu-v3-turbo-q8_0.gguf` for inference;
  - `gguf/voices/manifest.json` as the source of preset IDs and default;
  - each manifest-listed voice's `ref_codes.txt` and `speaker.emb.txt`;
  - `speaker_encoder.onnx` for offline CAM++ embeddings.
- The pinned manifest contains 25 presets and declares `minh_quan_pro` as its
  default. Download and validate every listed preset file, not only the default
  voice included in audio.cpp's model-manager package. The manifest remains the
  source of truth for the selector and its default.
- Mark VieNeu's model ready only after the GGUF, manifest, all listed preset
  files, and speaker encoder are present and validated. The download does not
  need VieNeu's Python TTS or codec weights.

## Decision Log

### D1 — Expose presets through provider status

Question: How does the desktop UI receive the preset list and default from the
downloaded manifest?

Decision: Include `preset_voices` (`id`, `name`, and `label`) and
`default_voice` under `providers.vieneu` in `status`. Read them from the local
manifest; return an empty list and `null` default until a valid manifest is
available.

Impact: The sidecar status response carries manifest-derived preset metadata,
and the UI consumes it instead of duplicating preset IDs or labels.

Confirmed by user: 2026-10-08

### D2 — Use a distinct synthesis mode for packaged presets

Question: How does a synthesis request distinguish a packaged VieNeu preset
from a saved user profile?

Decision: Send presets as `voice: "preset"` with `preset_id` from the manifest.
Keep saved Clone profiles on `voice: "profile"` with `voice_name`, and
one-off references on `voice: "file"` with `ref_audio`.

Impact: The VieNeu sidecar dispatcher accepts a distinct preset mode and
validates its ID against the manifest; the existing OmniVoice voice modes and
saved profile schema remain unchanged.

Confirmed by user: 2026-10-08

### D3 — Hide the unsupported VieNeu speed control

Question: How should the desktop handle its current speed slider when the
selected provider does not expose a synthesis-speed option?

Decision: Hide the speed slider for VieNeu and keep it unchanged for OmniVoice.
Do not add FFmpeg `atempo` post-processing.

Impact: The workspace presents provider-specific controls, and VieNeu output
does not receive speed post-processing.

Confirmed by user: 2026-10-08

## Performance expectation and tradeoffs

The audio.cpp VieNeu guide reports a CPU benchmark on an Intel Core i5-12400F:
a 28-second utterance took 8 seconds end to end, including process start and
model load (RTF 0.29). It reports Python CPU at RTF 0.55–0.62 in fp32, or 0.35
with int8 on CPUs that support VNNI. That is about 1.9–2.1× faster than the
reported Python fp32 path and about 1.2× faster than Python int8 on that machine.
These are upstream, model-specific measurements; the app should not promise the
same speedup across desktop hardware.

audio.cpp still needs Python preprocessing for custom cloning because its
VieNeu port does not include the CAM++ speaker encoder. The upstream guide also
documents a SEA-G2P C ABI for text preprocessing, but this MVP keeps the Python
front end beside the required CAM++ preprocessing. The C++ port also lacks
streaming and the reference denoiser, so this design does not claim those
features.

## User-visible behavior

1. On a clean install, Volo AI displays OmniVoice and VieNeu-TTS choices with
   readiness and an explicit download action. The user chooses a provider
   before the first model download.
2. Settings → Model lists both providers, their install state, and a way to
   select or download each one. Switching to an installed provider is
   immediate. Switching to an uninstalled provider opens its setup state; it
   does not silently fall back to the other engine.
3. The synthesis workspace indicates the active provider. OmniVoice keeps its
   current controls. VieNeu offers its packaged voice presets, usable saved
   Clone profiles, and a reference-file option for WAV, MP3, FLAC, or OGG. It
   hides OmniVoice-only Design and advanced generation controls. The preset
   selector defaults to `minh_quan_pro`, as declared by the pinned manifest.
4. VieNeu output is 48 kHz WAV. WAV and MP3 exports remain available; MP3 uses
   the existing FFmpeg conversion path while preserving the source sample
   rate. OmniVoice output and export behavior remain unchanged.
5. If download is cancelled or fails, the provider stays not-ready and the UI
   offers retry. Other installed providers remain usable.

The setup gate follows the selected provider's readiness. `prepare_model` and
`synthesize` require an explicit `provider` ID: `omnivoice` or `vieneu`. The
`status` result includes both providers, with model readiness separate from
runtime and preprocessing availability:

```json
{
  "providers": {
    "omnivoice": {
      "model_ready": true,
      "runtime_available": true,
      "preprocessing_available": true,
      "unavailable_reason": null
    },
    "vieneu": {
      "model_ready": false,
      "runtime_available": true,
      "preprocessing_available": false,
      "preset_voices": [],
      "default_voice": null,
      "unavailable_reason": "VieNeu preprocessing package is unavailable"
    }
  }
}
```

`model_ready` means the provider's downloaded assets are present and validated.
For OmniVoice, runtime availability reflects the existing engine and
preprocessing is available because it has no separate provider frontend. For
VieNeu, runtime availability means the target-matched `audiocpp_cli` can run;
preprocessing availability means the optional VieNeu Python frontend imports
successfully. The CAM++ encoder is a downloaded model asset and counts toward
VieNeu model readiness. When the validated manifest is present, VieNeu status
also returns its preset IDs, names, labels, and default voice. `unavailable_reason`
is null when runtime and preprocessing are available, and otherwise gives an
actionable reason.

## Runtime and data flow

The React app continues to use the existing JSONL Python sidecar. Extend the
desktop request contract with a validated provider identifier on
`prepare_model` and `synthesize`; `status` reports readiness for both
providers. The sidecar dispatches OmniVoice requests to the existing `Engine`
and VieNeu requests to a small desktop-only adapter. Do not introduce a
general provider plug-in framework or change `Engine`'s CLI/MCP contract.

For VieNeu synthesis, the adapter:

1. validates text, language, voice choice, and any reference audio;
2. accepts a packaged preset as `voice: "preset"` with `preset_id`, a saved
   Clone as `voice: "profile"` with `voice_name`, or a one-off reference as
   `voice: "file"` with `ref_audio`; it rejects `design` voices;
3. phonemizes the target text with VieNeu's Python front end;
4. uses packaged reference codes and speaker embeddings for preset voices, or
   normalizes a custom reference to WAV with the bundled FFmpeg, obtains a
   CAM++ embedding, and caches that embedding by original reference-file
   content hash under the app data directory;
5. invokes `audiocpp_cli` with an argument list, the VieNeu v3 Turbo GGUF,
   phonemes, and the selected voice inputs;
6. checks that the generated WAV exists and is readable, then writes the
   requested output format under the existing outputs directory.

The synthesis view accepts the same reference formats already supported by the
desktop sidecar (WAV, MP3, FLAC, and OGG), normalizing them to WAV before the
audio.cpp call. Saved Clone profiles expose their copied reference audio
through `Engine.list_voices`; VieNeu uses that audio and does not load the
OmniVoice `prompt.pt`. No SQLite schema change is needed. A saved Design
profile is rejected for VieNeu with a clear unsupported-voice error.

The selected provider is a desktop preference in `localStorage`. Model files
and derived speaker-embedding cache files live below `TTS_MCP_DATA_DIR`; final
audio remains under its existing `outputs` directory. Provider downloads become
ready only after required files are present and validated. A cancelled or
partial download must not create a ready marker. The audio.cpp executable is
resolved from a development override (`TTS_MCP_AUDIOCPP_PATH`) or the
target-matched executable bundled beside the existing sidecar.

## Errors and recovery

- Reject unknown provider IDs, unsupported voice kinds, missing or unreadable
  reference audio, and invalid language/text with the existing structured
  sidecar error format.
- If the selected provider is not installed, keep the setup screen visible and
  offer its explicit prepare action.
- If `audiocpp_cli` or a required preprocessing dependency is unavailable,
  report the corresponding VieNeu status field and an actionable error; never
  silently route its request to OmniVoice.
- If the native process exits unsuccessfully or produces a missing/unreadable
  WAV, return a structured failure and remove the incomplete output.
- A network error or cancellation leaves VieNeu not-ready; retry may reuse
  valid downloaded files. VieNeu readiness requires the Q8_0 GGUF, manifest,
  every manifest-listed preset asset, and the CAM++ encoder so installed
  cloning works offline.

## Compatibility and non-goals

- Existing installations with OmniVoice ready continue to select OmniVoice by
  default and do not download VieNeu until the user requests it.
- Existing Clone/Design profile rows and files remain valid. No profile schema
  migration or profile deletion behavior changes.
- This slice does not add provider selection to CLI/MCP, move OmniVoice onto
  audio.cpp, add audio.cpp's HTTP server, add VieNeu Voice Design/streaming, or
  add GPU-specific packaging. CPU is the portability baseline.
- The first implementation starts `audiocpp_cli` per synthesis request; it
  does not keep a warm C++ model process between requests.

## Verification approach

- Check sidecar protocol behavior for both providers, including model status,
  explicit preparation, cancellation/retry, invalid provider/voice inputs,
  clone references, process failure, and output cleanup.
- Check that each provider's WAV metadata uses its real sample rate (24 kHz for
  OmniVoice and 48 kHz for VieNeu), and that VieNeu MP3 conversion retains 48
  kHz source audio.
- Build the frontend and package the Python sidecar plus matching CPU
  `audiocpp_cli` on each currently supported desktop target.
- Manually run the desktop flow on each release target: first-run choice,
  preset synthesis in Vietnamese and English, direct WAV cloning and
  non-WAV-to-WAV reference normalization, a saved Clone profile, provider
  switching without a second download, model download cancellation/retry, and
  a clear error when the native executable is absent.

## Related context

- [Architecture overview](../../llm/architecture/overview.md)
- [MCP voice library](../../llm/workflows/mcp-voice-library.md)

## External references

- [audio.cpp VieNeu v3 Turbo model guide, v0.9.0](https://raw.githubusercontent.com/0xShug0/audio.cpp/v0.9.0/docs/community_models/vieneu_v3_turbo.md)
- [audio.cpp VieNeu v3 Turbo model specification, v0.9.0](https://raw.githubusercontent.com/0xShug0/audio.cpp/v0.9.0/model_specs/vieneu_v3_turbo.json)
- [VieNeu-TTS v3 Turbo GGUF assets at the pinned revision](https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo/tree/61b85e3d937fbbacb387714180e8182823512523/gguf)
- [VieNeu CAM++ speaker encoder at the pinned revision](https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo/blob/61b85e3d937fbbacb387714180e8182823512523/speaker_encoder.onnx)
- [VieNeu-TTS package metadata](https://github.com/pnnbao97/VieNeu-TTS/blob/main/pyproject.toml)

## Impact map

Entry: `apps/desktop/src/App.tsx::App`; `src/tts_mcp/desktop.py::dispatch_request`
Flow: App startup `status` → selected provider's explicit `prepare_model` → `synthesize` through `SidecarClient` JSONL → existing `Engine` or planned desktop VieNeu adapter → `save_audio` → app-data `outputs`; saved Clone references come from `Engine.list_voices`
State changes: selected provider in `localStorage`; VieNeu assets below `TTS_MCP_DATA_DIR/models/vieneu`; derived speaker-embedding cache under app data; generated files under `outputs`; no voice-profile database changes
External effects: pinned Hugging Face snapshot download; target-matched `audiocpp_cli` per VieNeu synthesis; bundled FFmpeg for reference normalization and MP3 export; local WAV/MP3 writes
Change candidates: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/sidecar.ts`, `apps/desktop/src/lib/i18n.ts`, `src/tts_mcp/desktop.py`, new `src/tts_mcp/desktop_vieneu.py`, `pyproject.toml`, `scripts/build_sidecar.py`, `apps/desktop/src-tauri/tauri.conf.json`, `README.md`, `docs/desktop-development.md`, `tests/test_desktop.py`, new `tests/test_desktop_vieneu.py`, and `tests/test_build_sidecar.py`
Verification: desktop sidecar tests for provider status/preparation/synthesis and cancellation; Python compile and full unit suite; frontend build and Tauri cargo check; CPU native packaging on each supported target; manual desktop flow from Verification approach
Verified at: `6b7c1d666c6a9f42d9ec0f48e203f11e008a9e7c`

## Execution

Plan: [Desktop audio.cpp VieNeu implementation](../plans/2026-10-08-desktop-audiocpp-vieneu-plan.md) — approval pending.
