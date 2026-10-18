# Desktop speech providers

## Requirements

### DVP-dual-model-readiness

The desktop UI SHALL keep the synthesis workspace unavailable until both
providers are ready and prepare every provider with missing model assets
concurrently after one explicit setup action.

#### Scenario: prepare both providers on first run

- GIVEN either or both providers are not ready
- WHEN the user starts model preparation from the first-run screen
- THEN the app starts preparation for each provider with missing model assets
  concurrently and keeps the synthesis workspace unavailable until both
  providers report model, runtime, and preprocessing readiness

#### Scenario: reuse ready model assets

- GIVEN a provider's complete model assets are already available in app data
- WHEN the user starts model preparation from the first-run screen
- THEN the app skips preparation for that provider and reuses its saved assets

Evidence: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/sidecar.ts`, `src/tts_mcp/desktop.py`, `src/tts_mcp/engine.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_desktop.py`

### DVP-profile-availability

The desktop UI SHALL expose the shared voice library while the sidecar is
online, even when the selected provider is not ready.

#### Scenario: open saved profiles before model preparation

- GIVEN the sidecar reports status and the selected provider is not ready
- WHEN the user opens Voice Profiles from the setup screen
- THEN the app loads saved profiles so they can be inspected or deleted

Evidence: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/sidecar.ts`, `src/tts_mcp/desktop.py`

### DVP-provider-preparation

The desktop UI SHALL persist the selected provider and download model assets
only after the user explicitly starts preparation.

#### Scenario: select a provider without preparing it

- GIVEN the user selects VieNeu in the desktop app
- WHEN the user has not started preparation
- THEN the app stores the selection and does not download model assets

Evidence: `apps/desktop/src/App.tsx`, `tests/test_desktop_vieneu.py`

### DVP-provider-selection

The desktop sidecar SHALL accept only `omnivoice` or `vieneu` for
`prepare_model` and `synthesize` requests and reject unknown or missing IDs
before provider work.

#### Scenario: unknown provider rejected

- GIVEN a sidecar request has an unknown or missing provider
- WHEN it requests preparation or synthesis
- THEN the sidecar returns `invalid_input` without invoking either provider

Evidence: `src/tts_mcp/desktop.py`, `tests/test_desktop.py`

### DVP-provider-status

The desktop sidecar SHALL report model readiness separately from runtime and
preprocessing availability and include VieNeu presets and its default voice
from a valid local manifest.

#### Scenario: inspect provider status

- GIVEN VieNeu has a valid local manifest
- WHEN the UI requests `status`
- THEN the response includes VieNeu preset entries and the default preset,
  independently of runtime and model readiness

Evidence: `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_desktop.py`, `tests/test_desktop_vieneu.py`

### DVP-provider-surface

The desktop and terminal interfaces SHALL keep their provider support split:
the desktop offers OmniVoice and VieNeu, while standalone CLI generation uses
OmniVoice only.

#### Scenario: choose a desktop provider

- GIVEN the user opens the desktop workspace
- WHEN the provider selector is displayed
- THEN it offers OmniVoice and VieNeu with OmniVoice selected by default

#### Scenario: generate through the standalone CLI

- GIVEN the user invokes a terminal generation command
- WHEN the command runs
- THEN it uses OmniVoice without a provider selector

Evidence: `apps/desktop/src/App.tsx`, `src/tts_mcp/cli.py`, `tests/test_cli.py`, `tests/test_desktop.py`

### DVP-saved-preset-routing

The desktop sidecar SHALL route a saved VieNeu preset profile to its stored
preset ID for VieNeu and use its saved reference WAV and transcript for
OmniVoice when present.

#### Scenario: synthesize a seeded profile with VieNeu

- GIVEN a saved VieNeu profile has a preset ID and generated reference audio
- WHEN the desktop selects the VieNeu provider
- THEN the sidecar invokes the existing manifest-preset path with its stored ID

#### Scenario: synthesize a seeded profile with OmniVoice

- GIVEN a saved VieNeu profile has reference audio and its transcript
- WHEN the desktop selects OmniVoice
- THEN the sidecar generates from that audio and transcript

#### Scenario: use a preset-only profile with OmniVoice

- GIVEN a saved VieNeu profile has no reference audio
- WHEN the desktop selects OmniVoice
- THEN the sidecar returns guidance to use VieNeu or seed the profile

Evidence: `src/tts_mcp/desktop.py`, `src/tts_mcp/engine.py`, `tests/test_desktop.py`

### DVP-vieneu-generation-config

The desktop SHALL keep VieNeu generation settings separate from OmniVoice settings, validate the VieNeu sampler fields, and forward them only as VieNeu audio.cpp request options.

#### Scenario: configure VieNeu sampling

- GIVEN the user selects VieNeu and changes one or more sampler controls
- WHEN the app synthesizes speech
- THEN it sends only the changed VieNeu values in `vieneu_config`, which the sidecar maps to `--request-option` arguments

#### Scenario: reject cross-provider or invalid configuration

- GIVEN a request supplies `vieneu_config` to OmniVoice or supplies an invalid VieNeu value
- WHEN the sidecar validates the synthesis request
- THEN it returns `invalid_input` before invoking synthesis

Evidence: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/sidecar.ts`, `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_desktop.py`, `tests/test_desktop_vieneu.py`

### DVP-vieneu-output-contract

VieNeu synthesis SHALL accept only WAV or MP3 output and save converted audio
from a readable 48 kHz WAV produced by `audiocpp_cli`.

#### Scenario: export VieNeu audio

- GIVEN VieNeu produces a readable 48 kHz WAV and the requested output is WAV
  or MP3
- WHEN synthesis completes
- THEN the sidecar saves the selected format and returns its path and format

Evidence: `src/tts_mcp/desktop_vieneu.py`, `src/tts_mcp/convert.py`, `tests/test_desktop_vieneu.py`

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

### DVP-vieneu-voice-modes

VieNeu synthesis SHALL accept a validated manifest preset, a saved Clone
profile, or one-off reference audio, and reject saved Design profiles and
OmniVoice-only generation controls.

#### Scenario: use a saved Clone profile

- GIVEN the voice library contains a Clone profile with reference audio
- WHEN VieNeu synthesizes from that profile
- THEN it uses the profile audio without a transcript

Evidence: `src/tts_mcp/desktop_vieneu.py`, `src/tts_mcp/desktop.py`, `tests/test_desktop.py`, `tests/test_desktop_vieneu.py`

## Flow

1. The UI asks the sidecar for `status`, displays both providers, and persists
   the selected provider as `volo-ai.provider`. The default selection is
   OmniVoice. The synthesis workspace remains unavailable until both providers
   report model, runtime, and preprocessing readiness. MCP provider behavior
   is documented in the [MCP voice library](mcp-voice-library.md).
2. The user starts one preparation action from the first-run screen. The UI
   sends concurrent `prepare_model` requests only for providers with incomplete
   model assets and shows progress separately for each provider. The sidecar
   allows one active preparation per provider, so OmniVoice and VieNeu can
   download together while duplicate downloads for one provider are rejected.
   Existing complete assets are reused. VieNeu downloads its pinned GGUF,
   manifest, listed preset assets, and CAM++ speaker encoder; progress and
   cancellation use the JSONL stream. Settings can still prepare one provider
   on demand.
3. For synthesis, the sidecar validates the requested provider and voice mode.
   Direct presets and seeded VieNeu profiles use their manifest ID. When
   OmniVoice is selected, a seeded profile uses its stored reference WAV and
   transcript; a preset-only profile returns guidance to select VieNeu or seed
   the voice. Clone profiles without a VieNeu preset ID use their reference
   audio with VieNeu. One-off references are normalized before VieNeu calls
   `audiocpp_cli`. Design profiles are not supported by VieNeu.
4. The provider phonemizes text and invokes `audiocpp_cli` with its `tts` task.
   It requires a readable 48 kHz WAV, then writes WAV or MP3 through
   `save_audio` and returns `{audio_path, format}`.
5. With VieNeu selected, the workspace exposes separate sampler controls for
   temperature, top-k, top-p, repetition penalty and window, sampling mode, and
   an optional seed. Its defaults are `0.8`, `25`, `0.95`, `1.2`, `64`, and
   sampling enabled; an empty seed leaves the audio.cpp random default. The app
   sends only values changed from those defaults in `vieneu_config`, and the
   sidecar validates the whitelist before adding VieNeu `--request-option`
   arguments.

## State changes

- The selected provider is stored in browser local storage. Profile data stays
  in the shared SQLite voice library. A preset-only profile stores its name and
  manifest ID; a seeded profile also owns its generated reference WAV and
  transcript. Seeding does not copy or change VieNeu model assets.
- VieNeu sampler drafts stay in app memory for the current session, including
  when switching providers; they are not written to local storage or saved
  voice profiles.
- OmniVoice and VieNeu model assets are stored under `models/omnivoice` and
  `models/vieneu` in the Tauri app-data directory passed to the sidecar through
  `TTS_MCP_DATA_DIR`. Rebuilding the app with the same bundle identifier keeps
  this directory and its downloaded assets.
- VieNeu assets are stored below `models/vieneu`. Derived speaker embeddings
  for reference cloning are cached below `models/vieneu/speaker-embeddings` by
  source audio content hash.
- Generated files are stored below the configured data directory's `outputs`.
  Selecting one-off reference audio does not add a profile.

## Side effects

- VieNeu preparation downloads the pinned repository assets declared by
  `src/tts_mcp/desktop_vieneu.py`.
- First-run preparation uses the existing app-data model directories and can
  download missing OmniVoice and VieNeu assets at the same time. Complete
  provider assets are skipped by each provider's readiness check.
- Reference files are normalized by FFmpeg to mono, 48 kHz PCM WAV in a
  temporary directory. The temporary file is removed after the CLI call.
- Each VieNeu synthesis starts the bundled or configured CPU `audiocpp_cli`.
  The desktop release stages the native binary beside the Python sidecar.
- Changed VieNeu sampler fields and an optional seed are passed through the
  request options interface; default sampler values are omitted so the CLI
  keeps its defaults.
- Voice Profiles seeding runs locally after readiness checks, stores WAVs with
  profile assets, and does not add them to Audio History.
- Synthesis writes an output file. MP3 conversion uses the existing FFmpeg and
  pydub path.

## Authorization & constraints

- The desktop sidecar is a local JSONL process and has no account or remote
  authorization layer.
- Supported synthesis languages are English and Vietnamese. VieNeu outputs
  WAV or MP3; reference files may be WAV, MP3, FLAC, or OGG.
- VieNeu readiness requires a valid GGUF, local manifest, every listed preset
  reference-code and speaker-embedding file, the CAM++ encoder, an available
  audio.cpp runtime, and preprocessing support. Status reports these aspects
  separately.
- VieNeu preset IDs are validated against the manifest at save and synthesis
  boundaries. Clone profiles work with either provider; Design profiles work
  with OmniVoice only. Seeded VieNeu profiles route to the preset ID with
  VieNeu and to their WAV/transcript with OmniVoice; preset-only profiles need
  VieNeu.
- VieNeu does not consume OmniVoice speed or generation settings and does not
  apply speed post-processing. `vieneu_config` is accepted only for VieNeu and
  is restricted to its sampler fields. The standalone CLI remains
  OmniVoice-only.

## Error paths

- Missing or unknown provider IDs return `invalid_input` before provider work.
- An invalid manifest exposes no preset list. Invalid or incomplete assets
  remain not-ready and can be retried; cancellation leaves valid partial files
  available for retry.
- First-run setup stays visible until both providers report ready. A download
  error is shown for its provider and can be retried; a second active download
  for the same provider returns `busy` while downloads for the other provider
  remain independent.
- Missing audio.cpp runtime or VieNeu preprocessing is reported in status. A
  missing CLI output or unreadable/non-48 kHz WAV fails synthesis, and an
  incomplete final output is removed.
- Seeding requires the manifest, model, preprocessing, and runtime to be ready;
  it does not download assets. Per-preset errors and unfinished IDs remain
  visible so the user can retry.
- Unknown presets, missing references, unsupported Design profiles, invalid
  language or format, incompatible generation settings, and malformed or
  cross-provider sampler settings return structured errors before inference.

## Tests

- `tests/test_desktop.py` checks provider status, provider-ID validation,
  concurrent provider preparation and per-provider progress, provider routing,
  seeded-profile asset selection, pure-preset OmniVoice
  guidance, Design rejection, seed retries/cancellation, and preparation
  behavior.
- `tests/test_desktop_vieneu.py` checks asset and manifest validation,
  cancellation and retry, runtime reporting, preset and Clone synthesis,
  reference normalization, VieNeu sampler validation and request-option
  mapping, output cleanup, and 48 kHz WAV/MP3 paths.
- `tests/test_desktop.py` checks that VieNeu configuration routes to the VieNeu
  adapter and is rejected by OmniVoice before engine generation.
- `tests/test_build_sidecar.py` checks target-named sidecar and audio.cpp
  staging and collection of the optional VieNeu packages.
- `tests/test_cli.py` covers terminal command behavior and VieNeu preset
  profile labels.

## Related

- [Architecture overview](../architecture/overview.md)
- [MCP voice library](mcp-voice-library.md)

## Sources

- `src/tts_mcp/desktop.py`
- `src/tts_mcp/desktop_vieneu.py`
- `src/tts_mcp/engine.py`
- `src/tts_mcp/convert.py`
- `tests/test_desktop.py`
- `tests/test_desktop_vieneu.py`
- `src/tts_mcp/cli.py`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src/lib/sidecar.ts`
- `apps/desktop/src-tauri/tauri.conf.json`
- `scripts/build_sidecar.py`
- `pyproject.toml`
- `tests/test_build_sidecar.py`
- `tests/test_cli.py`
