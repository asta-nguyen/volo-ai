# Voice Studio and Design Profiles

## Status

Approved by the user on 2026-09-14.

## Related context

- [Architecture overview](../../llm/architecture/overview.md)

## Product intent

Make voice creation and speech synthesis two separate, simple flows:

- `Voice Profiles` is the single place to create, import, and manage voices.
- `Synthesize` only chooses `Auto` or one saved profile, then renders text.
- A voice can be cloned from reference audio or designed from a reusable voice
  description.

The reusable Design profile stores its recipe and is rendered as a design voice
when selected. It is not converted into a generated WAV and cloned back into a
profile, which would add a lossy feedback step.

## Decisions

- Keep the existing `Voice Profiles` navigation item and add a clear `Create
  voice` flow there; do not add another top-level page.
- Keep the existing clone flow: name, reference audio, optional transcript,
  language, and save.
- Add a Design flow with name, language, and one required voice-description
  field. The description can contain gender, age, tone, accent, pitch, and
  style instructions in plain language.
- Store the Design recipe as `design_instruction` plus language. Advanced
  synthesis controls remain per-render controls and are not part of voice
  identity in this first version.
- Add a `kind` field with `clone` and `design` values. Existing rows and seed
  imports remain `clone`.
- Keep `save_voice` backward-compatible for reference-audio profiles. Add a
  separate `save_design_voice` engine/sidecar operation so clone validation and
  design validation cannot be confused.
- `list_voices` returns `kind` so the UI can display and select both profile
  types. The existing `synthesize` profile request remains the selection
  contract; the sidecar resolves clone prompts or design instructions from the
  selected profile.
- `delete_voice` removes either profile kind. Design profiles have no reference
  audio or clone prompt, so only their metadata and any profile-owned directory
  are removed.
- Keep bundled and manually imported seed voices as clone profiles. Their
  manifest contract does not change.

## Observable behavior

### Voice Profiles

- The user opens `Voice Profiles` and chooses `Clone voice` or `Design voice`.
- Clone saves the existing local reference copy and clone prompt.
- Design validates a non-empty name, supported language, and non-empty
  description, then saves the recipe locally.
- The profile library shows the voice name, language, and kind; both kinds can
  be deleted or used.

### Synthesize

- The voice selector contains `Auto voice` plus all saved profiles.
- `Auto voice` sends the existing auto request.
- A clone profile sends the existing profile request and loads its clone prompt.
- A Design profile sends the same profile request; the engine supplies the
  stored design instruction to OmniVoice.
- The Synthesize view does not expose profile creation, seed import, or direct
  reference-file cloning.

## Data and interface changes

- Migrate `voice_profiles` to add `kind` and nullable `design_instruction`.
  Existing records default to `kind = 'clone'`.
- Keep `ref_audio_path` and `prompt_path` nullable for Design rows while
  retaining the existing clone invariants for `kind = 'clone'`.
- Add `Engine.save_design_voice(name, design_instruction, language='en')`.
- Extend `Engine.list_voices()` with `kind`.
- Update desktop JSONL dispatch for `save_design_voice` and profile synthesis
  resolution. Invalid names, languages, empty descriptions, unknown profile
  kinds, and missing profile data return structured validation/not-found errors.
- Extend the frontend `VoiceProfile` type and the Voice Profiles form/UI copy.

## Compatibility and non-goals

- Do not change the CLI/MCP clone contract in this feature.
- Do not add cloud sync, authentication, or a remote voice store.
- Do not add a second database or frontend database boundary.
- Do not persist all advanced diffusion controls in a Design profile yet.
- Do not remove backend support for existing sidecar/CLI design requests unless
  tests prove it is unused outside the desktop UI.

## Affected files

- `src/tts_mcp/engine.py` — schema migration, Design profile persistence,
  profile listing/deletion, and profile synthesis resolution.
- `src/tts_mcp/desktop.py` — `save_design_voice` dispatch and profile synthesis
  branching.
- `apps/desktop/src/App.tsx` — Create Voice clone/design UI and the simplified
  profile selector.
- `apps/desktop/src/lib/sidecar.ts` — add the profile kind field.
- `apps/desktop/src/lib/i18n.ts` — localized Create Voice and profile-kind copy.
- `tests/test_engine.py` — schema migration, Design persistence, validation,
  listing, deletion, and synthesis resolution.
- `tests/test_desktop.py` — save-design and profile synthesis protocol tests.

## Verification

- Targeted engine and desktop unit tests cover clone compatibility, Design
  validation, schema migration, list/delete behavior, and profile synthesis.
- `python -m unittest discover -s tests -v`
- `python -m compileall -q src tests`
- `npm --prefix apps/desktop run build`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- Manual desktop smoke: create one clone and one Design profile, select each in
  Synthesize, verify Auto remains available, and delete each profile.

## Execution

Execution plan: [Voice Studio and Design Profiles plan](../plans/2026-09-14-voice-studio-design-profiles-plan.md).
