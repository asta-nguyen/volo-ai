# Advanced OmniVoice Controls — Execution Plan

## Approved design

[Advanced OmniVoice Controls and Native Long-Form Generation](../specs/2026-09-12-advanced-omnivoice-controls-design.md)

## Task 1 — Extend the engine generation contract

Files: modify `src/tts_mcp/engine.py:231-271` and
`tests/test_engine.py:12-31`.

Interfaces: add optional `duration: float | None` and
`generation_config: dict[str, Any] | None` parameters to `Engine.generate`.
The engine consumes the desktop config and produces the existing `np.ndarray`
result; callers that omit them keep the current behavior.

Change: define the supported OmniVoice generation keys once in `engine.py`:
`guidance_scale`, `t_shift`, `position_temperature`, `class_temperature`,
`layer_penalty_factor`, `denoise`, `preprocess_prompt`, `postprocess_output`,
`audio_chunk_duration`, `audio_chunk_threshold`, `pad_duration`, and
`fade_duration`. Forward only those keys as keyword arguments to
`self.model.generate`, alongside the existing `text`, `language`, `speed`,
`num_step`, voice prompt, and optional normalization. Do not let a config
dictionary replace the base request fields. Preserve the existing auto, file,
profile, and design argument behavior.

Verify: use `FakeModel.kwargs` to assert that duration-related config, all
boolean/numeric config keys, `normalize_text=True`, and `instruct` reach the
OmniVoice call, while a call without config still has the existing keyword
shape. Run `python -m unittest tests.test_engine -v`.

Files inspected, no change: `/Users/nus/.pyenv/versions/3.10.16/lib/python3.10/site-packages/omnivoice/models/omnivoice.py:166-190,585-701,900-950`,
`src/tts_mcp/cli.py`, and `src/tts_mcp/server.py`.

Steps:

1. Add failing engine unit tests for generation-config forwarding, fixed
   duration forwarding, normalization, and design instruction forwarding.
2. Run `python -m unittest tests.test_engine -v` and confirm the new tests
   fail because `Engine.generate` does not accept the config yet.
3. Add the supported-key tuple and optional config parameter, filter config
   keys, and forward the filtered values to `self.model.generate`.
4. Run `python -m unittest tests.test_engine -v` and require zero failures.

## Task 2 — Validate and dispatch the desktop request contract

Files: modify `src/tts_mcp/desktop.py:24-117` and
`tests/test_desktop.py:23-207`.

Interfaces: import the supported generation-key set from `engine.py` and
extend the existing JSONL `synthesize` operation with
`voice: "design"`, optional `instruct`, optional positive `duration`,
optional boolean `normalize_text`, and optional `generation_config`.
`dispatch_request` continues returning the existing success/error envelope.

Change: add boundary validation with these exact rules:

- `voice` is one of `auto`, `profile`, `file`, or `design`.
- `steps` is an integer greater than zero; booleans and fractional values are
  rejected instead of being silently coerced.
- `duration` is absent/null or a finite number greater than zero.
- `normalize_text` is a boolean when present.
- Numeric generation fields are finite; chunk target and threshold are
  greater than zero; guidance, temperatures, penalty, padding, and fade are
  non-negative; boolean generation fields are actual booleans.
- Unknown generation keys and wrong value types return `invalid_input`.
- `auto` has no voice-specific payload, `profile` requires `voice_name`,
  `file` requires the existing validated audio path, and `design` requires a
  non-empty `instruct`; incompatible profile/file/design fields are rejected.

Pass `duration`, `normalize_text`, and the validated config to
`Engine.generate`; pass no empty config when it was omitted. Keep output
creation after successful inference so a failed long-form call cannot be
reported as a completed audio result.

Verify: add tests for design success, design missing/empty instruction,
profile/file/design incompatibilities, invalid steps/duration/config values,
config forwarding, normalization, and duration precedence. Existing tests for
file validation, profiles, progress, cancellation, and structured errors must
remain green. Run `python -m unittest tests.test_desktop -v`.

Files inspected, no change: `src/tts_mcp/convert.py` and
`tests/test_convert.py`; output conversion remains downstream of generation.

Steps:

1. Add failing sidecar tests for the new voice mode, invalid numeric/boolean
   fields, incompatible mode payloads, and forwarded config.
2. Run `python -m unittest tests.test_desktop -v` and confirm the new tests
   fail with the current three-mode validator and missing forwards.
3. Add the finite-number, positive-number, boolean, and config-key validation
   helpers at the existing desktop boundary.
4. Extend `_synthesize` to dispatch design, duration, normalization, and the
   validated generation config while retaining current file/profile handling.
5. Run `python -m unittest tests.test_desktop -v` and require zero failures.

## Task 3 — Add typed frontend request state and behavior

Files: modify `apps/desktop/src/lib/sidecar.ts:4-7`,
`apps/desktop/src/App.tsx:150-242`, and
`apps/desktop/src/App.tsx:625-782`.

Interfaces: define `VoiceMode = "auto" | "profile" | "file" | "design"` and
an exported `GenerationConfig` type matching Task 1's twelve supported keys.
The existing generic `SidecarClient.request` remains the transport; the UI
builds the additive synthesize payload.

Change: add local React state initialized to OmniVoice defaults for advanced
controls, plus `instruct` and optional fixed duration. Build
`generation_config` from the advanced values and omit blank optional numeric
inputs. Include `voice: "design"` and `instruct` only for design mode; keep
reference/profile fields scoped to their existing modes. Validate visible
fields before calling the sidecar, keep all form state after errors, clear only
the previous result when a new render starts, and preserve the existing
playback/export/profile flows.

Verify: run `npm --prefix apps/desktop run format:check` and
`npm --prefix apps/desktop run build`; TypeScript must reject mismatched mode
or config fields. Manually exercise auto, file, profile, and design requests
and confirm the JSONL request in the Logs view contains the selected mode and
advanced values without reference fields leaking between modes.

Files inspected, no change: `apps/desktop/src/main.tsx`,
`apps/desktop/src/lib/i18n.ts`, and `apps/desktop/src/components.scss` are
handled in Task 4; Tauri permissions and shell configuration do not change.

Steps:

1. Add the typed `VoiceMode` and `GenerationConfig` definitions and update
   the existing mode union.
2. Run `npm --prefix apps/desktop run build` to establish a clean baseline
   before adding the component state and request assembly.
3. Add advanced state, design-mode validation, and additive request assembly
   to `App.tsx`.
4. Run `npm --prefix apps/desktop run format:check` and
   `npm --prefix apps/desktop run build` and require both to pass.

## Task 4 — Render the accessible advanced panel and translations

Files: modify `apps/desktop/src/App.tsx:640-782`,
`apps/desktop/src/lib/i18n.ts:47-92,195-242,324-456`, and
`apps/desktop/src/components.scss:338-530`.

Interfaces: consume the state and `GenerationConfig` payload from Task 3;
`UiCopy` supplies English and Vietnamese labels, descriptions, validation
messages, and mode text.

Change: add the third `Voice design` source with an instruction textarea and
examples. Add a native collapsed `details/summary` `Advanced settings` panel
containing labeled controls for fixed duration, steps, guidance, time-step
shift, both temperatures, layer penalty, denoise, preprocess reference,
postprocess output, chunk target/threshold, padding, fade, and normalize text.
Show the native long-form explanation using duration language, not a fixed
character promise. Add inline invalid messages, keyboard-visible focus, and
disabled controls during generation while retaining the current responsive
visual system and reduced-motion behavior.

Verify: run `npm --prefix apps/desktop run format:check` and
`npm --prefix apps/desktop run build`. In `npm --prefix apps/desktop run tauri dev`,
check keyboard-only navigation, collapsed/expanded advanced settings,
English/Vietnamese copy, design mode field visibility, invalid values, and a
long-form render with the native chunk explanation.

Files inspected, no change: `apps/desktop/src/styles.css` remains the Tailwind
v4 entry point; no new UI dependency or stylesheet system is introduced.

Steps:

1. Add the English and Vietnamese copy keys and expose them through
   `createUiCopy`.
2. Add the design mode and native disclosure markup with labels, help text,
   errors, and the complete advanced control set.
3. Add the minimum SCSS for the advanced grid, disclosure states, validation
   text, and design field using existing tokens.
4. Run `npm --prefix apps/desktop run format:check` and
   `npm --prefix apps/desktop run build` and require both to pass.

## Task 5 — Run the full verification and review handoff

Files: inspect all files changed by Tasks 1–4; update
`docs/llm/INDEX.md` or its linked feature page only if the verified behavior
now documented there is incomplete.

Interfaces: validate the engine, sidecar, and UI as one backward-compatible
desktop flow; no new public CLI/MCP options are required by the approved
design.

Change: run the complete automated checks and the manual desktop smoke flow.
The smoke flow covers model-ready startup, auto voice, file clone, saved
profile, Voice Design, every advanced panel group, fixed duration, native
long-form chunking, WAV/MP3 preview/export, and failure recovery with form
values intact.

Verify: run `python -m unittest discover -s tests -v`,
`python -m compileall -q src tests`,
`npm --prefix apps/desktop run format:check`,
`npm --prefix apps/desktop run build`, and
`cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`. Then run
`npm --prefix apps/desktop run tauri dev` for the manual flow. Finish by
invoking `review-and-verify`; because this is user-visible behavior, invoke
`document-wiki` after verification to update the verified feature inventory.

Files inspected, no change: `apps/desktop/src-tauri/tauri.conf.json`,
`apps/desktop/src-tauri/capabilities/default.json`, `src/tts_mcp/cli.py`, and
`src/tts_mcp/server.py`; the approved feature leaves shell permissions and
CLI/MCP compatibility unchanged.

Steps:

1. Run the Python unit, compile, frontend format/build, and Rust checks above.
2. Run the manual Tauri smoke flow and record any reproducible failure with
   its request ID and structured error code.
3. Invoke `review-and-verify` against the completed diff; fix required
   findings and rerun the failed check.
4. Invoke `document-wiki` with the verified behavior and update only the
   source-grounded feature page or index entries that changed.

## Approval Gate

Required: yes
Reason: changes the desktop JSONL request schema, crosses the engine/sidecar/UI boundary, and changes multiple application files.
Status: approved

## Decision Log

None.
