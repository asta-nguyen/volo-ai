# Volo AI Desktop UI System plan

## Approved design

[Volo AI Desktop UI System](../specs/2026-09-13-desktop-ui-system-design.md)

The user explicitly approved the stack (`shadcn/ui + Base UI`, Tailwind v4,
`lucide-react`, and Motion) and authorized the full desktop UI migration on
2026-09-13. The plan preserves the current Tauri/React/sidecar contracts and
all user-visible TTS capabilities.

## Approval Gate

- Required: yes
- Reason: this changes the shared component system, frontend dependencies,
  every desktop screen, and removes the existing Sass surface.
- Status: approved

## Decision Log

- 2026-09-13 — User chose shadcn/ui + Base UI, Tailwind v4, lucide-react, and
  Motion for the production UI migration.
- 2026-09-13 — Scope is the complete desktop UI, not a new TTS capability;
  Python, sidecar protocol, Tauri permissions, and data formats stay stable.
- 2026-09-13 — The app remains desktop-only for macOS, Windows, and Linux;
  English remains the default and interface locale stays independent from
  synthesis language.
- 2026-09-13 — Approval gate cleared by the user's explicit instruction to
  grant full implementation authority and continue until the UI is done.
- 2026-09-13 — Keep the screen components colocated in `App.tsx` for this
  small desktop surface; centralize only reusable UI primitives in
  `src/components/ui.tsx` to avoid prop-plumbing files without independent
  behavior.

## Tasks

### Task 1 — Install and configure the UI system

Files:

- `apps/desktop/package.json`
- `apps/desktop/package-lock.json`
- `apps/desktop/components.json`
- `apps/desktop/src/lib/utils.ts`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/components/ui.tsx`

Interfaces:

- shadcn source-owned components use Base UI primitives and expose stable
  props to screen components.
- `cn(...inputs)` is the only shared class-composition helper.
- Tailwind v4 theme variables define background, surface, border, text,
  accent, success, warning, and destructive states.

Change:

- Add the minimal runtime/build dependencies required by the approved stack:
  `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge`,
  `lucide-react`, `motion`, and `tw-animate-css`; add the shadcn CLI only as
  a development tool if the generated source requires it.
- Generate/adapt only the primitives used by the five existing screens:
  button, card, input, textarea, label, select, dialog/alert-dialog, badge,
  progress, tabs, separator, skeleton, and tooltip.
- Keep imports simple and relative for the current single-entry desktop app;
  record the shadcn metadata without introducing a new runtime state layer.
- Replace the current global Sass-oriented rules with Tailwind v4 imports,
  theme tokens, desktop sizing, typography, focus, scrollbar, and reduced
  motion rules.

Verify:

- `rtk npm install` from `apps/desktop` updates the lockfile cleanly.
- `rtk npm run build` passes before screen migration continues.

### Task 2 — Rebuild the app shell and screen boundaries

Files:

- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/ui.tsx`

Interfaces:

- `App` remains the single owner of sidecar client, model readiness,
  synthesis, profile, locale, and navigation state.
- Screen components receive typed state and callbacks; they do not call the
  sidecar directly.
- `AppView` remains `workspace | profiles | settings | logs`.

Change:

- Rebuild the shell/header/footer boundaries in the existing app module
  without introducing context or a store.
- Replace the hand-drawn SVG icon helper with named lucide-react icons and
  preserve accessible labels for icon-only controls.
- Add active-route styling, engine status, and route transitions using
  `motion/react` with reduced-motion handling.
- Keep the setup screen outside the ready shell so first-run state cannot be
  obscured by navigation.

Verify:

- Each route renders through the new shell with no stale custom class
  dependency.
- TypeScript and format checks pass.

### Task 3 — Migrate setup and synthesis workspace

Files:

- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src/components/ui.tsx`

Interfaces:

- Existing `GenerationConfig`, `Language`, `VoiceMode`, `SynthesisResult`,
  and setup progress types remain the source of truth.
- Workspace callbacks keep current validation and sidecar request payloads.
- Advanced settings continue to render as progressive disclosure and keep
  the existing defaults/omission rules.

Change:

- Build the model setup card with `Progress`, `Card`, `Badge`, and typed
  action buttons; animate only sidecar-reported phase changes.
- Rebuild the workspace as a clear editor/preview plus control-deck layout
  with cards, tabs or segmented controls, labeled fields, native range
  input, and accessible busy/error states.
- Use a Base UI select for saved profiles and a dialog for destructive or
  confirmable profile actions where the workspace invokes them.
- Keep file selection native through the existing Tauri dialog and retain
  audio preview/export behavior.
- Add only missing EN/VI labels/descriptions needed by the new UI; do not
  change the existing translation model.

Verify:

- Manual desktop smoke: auto voice, file clone, saved profile, voice design,
  advanced settings, long text, audio preview, and WAV/MP3 export.
- Confirm validation leaves text/settings intact and never starts inference on
  invalid input.

### Task 4 — Migrate profiles, settings, and logs

Files:

- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src/components/ui.tsx`

Interfaces:

- Profile components keep existing `list_voices`, `save_voice`, and
  `delete_voice` callbacks and error separation.
- Settings keeps app interface locale independent from synthesis language.
- Logs remain session-only and continue to redact request payloads/text/audio.

Change:

- Rebuild profile cards/create form with `Card`, `Input`, `Textarea`,
  `Label`, `Badge`, `Dialog`, `Skeleton`, and lucide actions. Preserve
  loading, empty, list-error, form-error, save, use, and delete states.
- Rebuild Settings with a clear language selector, engine health card, and
  local storage card.
- Rebuild Logs with summary badges, readable request rows, pending/success/
  error states, and an accessible empty state.
- Use Motion for list enter/exit and confirmation transitions while keeping
  deletion recoverability and focus return intact.

Verify:

- Manual smoke: switch EN/VI in Settings, reload the app, create/use/delete
  a profile, trigger empty/loading/error states, and inspect logs.
- Keyboard-check sidebar, selects, dialog, profile form, and all primary
  actions.

### Task 5 — Remove the old presentation layer and polish interaction

Files:

- `apps/desktop/src/components.scss` (remove)
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/styles.css`
- `apps/desktop/package.json`
- `apps/desktop/package-lock.json`
- `apps/desktop/src/components/ui.tsx`

Interfaces:

- There is one styling system: Tailwind v4 plus component-local class names
  where they materially improve readability.
- No screen imports `components.scss`, no Sass dependency remains, and no
  duplicated hand-built icon system remains.

Change:

- Delete the old Sass import and file after all selectors are migrated.
- Remove `sass` if no other source uses it.
- Add the final hover/pressed/focus/disabled transitions, reduced-motion
  fallback, desktop overflow behavior, and consistent empty/error/loading
  treatment.
- Run a source search for old class names and raw UI controls that should be
  represented by the new primitives; retain native audio/range/file controls
  where they are the correct platform behavior.

Verify:

- `rtk npm run format:check`
- `rtk npm run build`
- `rtk git diff --check`
- `rtk rg -n 'components.scss|className="button |className="side-link|<select|<details' apps/desktop/src`
  returns only intentional native controls or no stale presentation usage.

### Task 6 — Review, package, and update project context

Files:

- `docs/agent-devkit/INDEX.md`
- `docs/llm/INDEX.md`
- `docs/llm/architecture/overview.md`
- `docs/llm/LOG.md`

Change:

- Run the frontend, backend, Rust, and packaged-app checks already used by the
  repository.
- Launch the packaged app or Tauri dev app and inspect every route with CUA,
  including first-run setup, EN/VI, profile CRUD, settings, logs, and a
  successful render.
- Run `review-and-verify` against the final diff, then update the existing
  wiki only with source-grounded UI architecture and verification results.
- Keep the plan/spec execution links and status accurate; do not commit.

Verify:

- `rtk python -m unittest discover -s tests -v`
- `rtk python -m compileall -q src tests`
- `rtk cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `rtk npm run tauri build -- --bundles app`
- CUA manual smoke passes on the built macOS app; Windows/Linux remain
  covered by the shared Tauri/React code and cross-platform-safe primitives.

## Execution order

Tasks 1 and 2 establish the component contract and shell. Task 3 migrates
the primary value path, Task 4 migrates the supporting screens, and Task 5
removes the old surface. Task 6 is the final review and verification gate.

## Rollback

Each task is frontend-local and can be reverted from the working diff without
touching Python or stored profile/model data. Keep the old Sass file until
Task 5's migration checks pass.
