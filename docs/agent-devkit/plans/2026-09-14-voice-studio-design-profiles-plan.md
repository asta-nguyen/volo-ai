# Voice Studio and Design Profiles plan

## Approved design

- Design: [Voice Studio and Design Profiles](../specs/2026-09-14-voice-studio-design-profiles-design.md)
- Design approved by the user on 2026-09-14.

## Approval Gate

Required: yes

Reason: this changes the SQLite schema, adds a JSONL sidecar operation, changes profile synthesis resolution, and updates the desktop profile UI.

Status: approved by the user on 2026-09-14

## Decision Log

- Keep the existing `Voice Profiles` navigation item. Put Clone and Design creation in that page; keep Synthesize focused on selecting a saved voice and rendering text.
- Store a Design profile as its language plus the user-written `design_instruction`. Do not generate an audio file and reclone it; advanced diffusion controls remain per render.
- Preserve `save_voice` for clone profiles and add `save_design_voice` for the new profile kind, so existing callers keep their contract.
- Treat all existing rows and bundled seed profiles as `clone` profiles during migration.

## Tasks

### 1. Add profile kinds and design storage in the engine

Files:

- `src/tts_mcp/engine.py`
- `tests/test_engine.py`
- No change: `src/tts_mcp/cli.py`, `src/tts_mcp/server.py`; their existing profile operations should continue through the engine API.

Interfaces:

- Extend `list_voices()` entries with `kind: "clone" | "design"`.
- Keep `save_voice(name, ref_audio, ref_text=None, language="en", ...)` unchanged for clone callers.
- Add `save_design_voice(name, design_instruction, language="en", ...)`.
- Make profile loading return enough information for synthesis to resolve either a clone prompt or a design instruction without exposing raw DB details to callers.

Change:

1. Add red tests for migrating the existing schema, listing old rows as `clone`, saving/upserting a Design profile, loading both profile kinds, and deleting a Design profile.
2. Run the focused engine tests and confirm the new assertions fail before implementation.
3. Bump the internal schema version and migrate `voice_profiles` with the smallest compatible table rebuild: add `kind` with default `clone`, add nullable `design_instruction`, make clone-only file columns nullable for Design rows, preserve existing rows/indexes, and keep seed metadata intact.
4. Add validation so Design profiles require a non-empty instruction and valid language, while clone validation remains unchanged. Persist/upsert Design rows without creating clone prompt or reference-audio files.
5. Update profile listing, lookup, and deletion so both kinds behave consistently. Keep the existing `app_seeds` history behavior unchanged.
6. Run the focused engine tests until green.

Verify:

- `rtk python -m unittest tests.test_engine -v`
- Existing clone profile and seed-import tests remain green.

### 2. Extend the JSONL desktop sidecar contract

Files:

- `src/tts_mcp/desktop.py`
- `tests/test_desktop.py`

Interfaces:

- Accept `{ "type": "save_design_voice", "name": string, "design_instruction": string, "language": "en" | "vi" }` and return the same success/error envelope used by `save_voice`.
- Keep profile synthesis requests unchanged: `{ "voice": "profile", "voice_name": string, ... }`.

Change:

1. Add red protocol tests for the new save operation and for profile synthesis resolving a clone prompt versus a Design instruction.
2. Run the focused desktop tests and confirm the new assertions fail before implementation.
3. Route `save_design_voice` to the engine method and return the refreshed profile/list response shape.
4. Update `voice: "profile"` resolution to inspect the saved profile kind: load the clone prompt for clone profiles, or pass the stored Design instruction as `instruct` for Design profiles. Preserve existing validation and reject conflicting per-request voice inputs.
5. Run the focused desktop tests until green.

Verify:

- `rtk python -m unittest tests.test_desktop -v`
- Existing JSONL save/list/delete/profile synthesis tests remain green.

### 3. Add the simple Create Voice UI

Files:

- `apps/desktop/src/lib/sidecar.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/i18n.ts`

Interfaces:

- Extend the frontend `VoiceProfile` type with `kind` and optional Design metadata needed for display.
- Add a sidecar helper for `save_design_voice`; keep the existing clone helper and request shape.

Change:

1. Add the UI-side type/request assertions or component behavior tests available in the current project setup; if no frontend test harness exists, use the TypeScript build as the red/green check.
2. Add a compact Clone/Design selector in Voice Profiles. Clone keeps the existing audio, optional transcript, and language fields. Design shows one required plain-language description field plus name and language.
3. Submit Clone through `save_voice` and Design through `save_design_voice`; reset the form and refresh the list on success.
4. Show a small Clone/Design kind label in profile cards and keep delete behavior shared.
5. Keep Synthesize to `Auto voice` plus saved profiles; do not add a second set of creation controls there.
6. Add only the required English/Vietnamese labels and errors, then run the desktop build.

Verify:

- `rtk npm --prefix apps/desktop run build`
- Manually smoke test: create one Clone, create one Design, select each in Synthesize, render, delete each, and confirm the list refreshes.

### 4. Update verified documentation and run the full gate

Files:

- `docs/llm/INDEX.md`
- `docs/llm/architecture/overview.md`

Interfaces:

- Document the user-visible Voice Profiles flow and the two profile kinds without documenting unsupported internals.

Change:

1. Update the wiki only after the implementation and tests establish the final behavior.
2. Run the repository verification commands and inspect the final diff for unrelated changes.

Verify:

- `rtk python -m unittest discover -s tests -v`
- `rtk python -m compileall -q src tests`
- `rtk npm --prefix apps/desktop run build`
- `rtk cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `rtk git diff --check`
- Run `review-and-verify` against the implementation diff and report any pre-existing environment failure separately.

## Review handoff

After all tasks are implemented and verified, run `review-and-verify`. The review must check migration safety, clone backward compatibility, Design profile synthesis resolution, duplicate-name behavior, UI error states, and preservation of the user's existing staged/unstaged changes.

## Execution

The Approval Gate was explicitly approved on 2026-09-14. Tasks 1–4 were implemented in order; final verification and review evidence are recorded in the implementation handoff.
