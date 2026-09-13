# Advanced OmniVoice Controls and Native Long-Form Generation

## Status

Approved. The user approved this design on 2026-09-12.

## Related context

- [Architecture overview](../../llm/architecture/overview.md)

## Product intent

Give desktop users access to the important OmniVoice generation controls
without making the default synthesis flow feel like a laboratory panel. Keep
the existing local voice, saved profile, export, and offline behavior intact.

## Decisions

- Keep the current basic controls visible: target language, voice source,
  speed, output format, and render action.
- Add a collapsed `Advanced settings` section for the full OmniVoice
  generation configuration supported by the local engine.
- Add `Voice design` as a desktop voice source. It accepts OmniVoice's
  `instruct` text and does not require reference audio.
- Keep voice profiles as reusable clone prompts. Generation settings apply per
  request and are not persisted inside a profile.
- Do not split text in React or the sidecar. Let OmniVoice's native long-form
  path split by estimated audio duration and join the generated chunks. The
  UI may expose the native chunk target and activation threshold as optional
  advanced overrides.
- Preserve existing request fields and defaults. New settings are optional;
  omitted values use OmniVoice defaults.

## User experience

### Advanced settings

The panel exposes these controls with the current model defaults shown:

| Control | Default | Rule |
| --- | --- | --- |
| Fixed duration | off | Positive seconds; overrides speed when set |
| Diffusion steps | 32 | Positive integer |
| Guidance scale | 2.0 | Finite non-negative number |
| Time-step shift | 0.1 | Finite non-negative number |
| Position temperature | 5.0 | Finite non-negative number |
| Class temperature | 0.0 | Finite non-negative number |
| Layer penalty factor | 5.0 | Finite non-negative number |
| Denoise | on | Boolean |
| Preprocess reference | on | Boolean |
| Postprocess output | on | Boolean |
| Chunk target duration | 15 seconds | Positive seconds |
| Chunk activation threshold | 30 seconds | Positive seconds |
| Padding per side | 0.1 seconds | Non-negative seconds |
| Fade duration | 0.1 seconds | Non-negative seconds |
| Normalize text | off | Boolean; keeps the existing optional dependency behavior |

Blank optional numeric fields are omitted from the request. The UI explains
that long text is automatically chunked by OmniVoice rather than by a fixed
character count.

### Voice design

The voice source list gains `Voice design`. A required instruction field is
shown only for that mode, with examples such as `female, low pitch, British
accent`. File cloning and saved profiles keep their current reference audio,
transcript, and language warning behavior.

### Accessibility and failure states

The advanced section uses native progressive disclosure, labels every control,
keeps keyboard focus visible, and reports invalid values inline before
inference. A failed generation leaves the input and selected settings intact.
No partial audio is presented as a completed result if a native long-form
generation request fails.

## Interface contract

The desktop `synthesize` request remains additive. Existing fields continue to
work:

```json
{
  "type": "synthesize",
  "text": "...",
  "language": "en",
  "voice": "auto | file | profile | design",
  "voice_name": "optional saved profile",
  "ref_audio": "optional local path",
  "ref_text": "optional transcript",
  "instruct": "optional voice design instruction",
  "speed": 1.0,
  "format": "wav | mp3",
  "steps": 32,
  "duration": null,
  "normalize_text": false,
  "generation_config": {
    "guidance_scale": 2.0,
    "t_shift": 0.1,
    "position_temperature": 5.0,
    "class_temperature": 0.0,
    "layer_penalty_factor": 5.0,
    "denoise": true,
    "preprocess_prompt": true,
    "postprocess_output": true,
    "audio_chunk_duration": 15.0,
    "audio_chunk_threshold": 30.0,
    "pad_duration": 0.1,
    "fade_duration": 0.1
  }
}
```

The implementation may omit `generation_config` when all advanced values are
defaults. The sidecar validates the voice-mode combinations and numeric
values, then the engine forwards only supported fields to OmniVoice. CLI and
MCP public calls remain backward-compatible and may continue using their
existing basic options.

## Long-form behavior

The engine passes the optional native chunk settings through to OmniVoice.
When the settings are omitted, OmniVoice's defaults remain active. The model
estimates duration, splits long input into chunks, generates each chunk with
the same language and voice prompt, and returns joined audio to the existing
WAV/MP3 conversion path. The desktop protocol continues to expose one request
and one terminal result; per-chunk editing, streaming, and per-chunk progress
are out of scope.

## Error paths and compatibility

- Empty design instructions are rejected before model inference.
- `design` cannot be combined with a saved profile or reference audio.
- `profile` still requires an existing saved profile.
- `file` still requires a validated local audio reference.
- Non-finite, negative, or otherwise type-invalid advanced values return the
  existing structured `invalid_input` error.
- `duration` takes precedence over `speed`, matching OmniVoice behavior.
- The existing output path, asset permissions, cancellation flow, sidecar
  recovery, and profile file format do not change.

## Verification

- Add engine tests proving advanced fields, duration, normalization, and
  design instructions reach the OmniVoice mock.
- Add sidecar tests for `design`, profile/file incompatibilities, invalid
  numeric values, and native chunk configuration forwarding.
- Run the existing Python tests and frontend format/build checks.
- Manually open the desktop app, render auto voice, file clone, saved profile,
  and voice design; exercise the Advanced section and a long-form script.

## Scope exclusions

Hardware compatibility preflight, microphone recording, streaming output,
manual text chunk editing, per-chunk regeneration, batch generation, and
profile-specific saved generation settings remain separate work.

## Execution

Execution plan: [Advanced OmniVoice Controls plan](../plans/2026-09-12-advanced-omnivoice-controls-plan.md)
