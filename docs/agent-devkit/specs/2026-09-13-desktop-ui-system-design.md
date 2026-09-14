# Volo AI Desktop UI System

## Status

Approved by the user on 2026-09-13 to replace the full desktop UI and proceed
through completion.

## Related context

- [Architecture overview](../../llm/architecture/overview.md)
- [Local TTS Desktop App](2026-09-12-local-tts-desktop-app-design.md)
- [Advanced OmniVoice Controls](2026-09-12-advanced-omnivoice-controls-design.md)

## Product intent

Give Volo AI a coherent production desktop interface for macOS, Windows, and
Linux. The redesign should make the synthesis workspace, first-run model
setup, voice profiles, settings, and logs feel like one product while keeping
the existing local-first behavior intact.

## Decisions

- Use source-owned shadcn/ui components backed by Base UI primitives.
- Keep Tailwind CSS v4 as the styling system and use CSS variables for the
  Volo AI theme tokens.
- Use `lucide-react` for interface icons and `motion` for short, purposeful
  state and route transitions.
- Preserve the existing React/Tauri boundaries, sidecar JSONL protocol,
  i18next resources, and screen behavior. This is a presentation and
  interaction migration, not a backend rewrite.
- Keep the desktop-only layout constraints appropriate for the current
  macOS/Windows/Linux target. Mobile UI is out of scope.
- Keep English as the default interface locale and preserve the existing
  independent EN/VI interface and synthesis-language controls.
- Prefer native CSS transitions for simple hover/focus/progress effects; use
  Motion only where it improves state continuity or hierarchy.
- After the local model becomes ready, seed the `OmniVoice-Demo` profile once
  from the developer-provided sample audio when that path exists. The seed is
  best-effort and never blocks setup on machines without that sample.

## Scope

### App shell

Replace the current custom navigation and status ribbon with a shadcn/Base UI
shell: branded sidebar, active navigation, engine readiness state, compact
status footer, keyboard-visible focus, and a consistent content frame.

### First-run setup

Redesign the model download screen with a clear phase, progress indicator,
asset summary, storage information, retry/cancel actions, and recoverable
error states. Motion must not imply progress that the sidecar has not
reported, and reduced-motion preferences must be honored.

### Synthesis workspace

Redesign the script editor, output preview/audio player, target-language
control, voice source selector, file/profile/design panels, speed control,
format selector, advanced OmniVoice disclosure, render/export actions, and
inline validation/error states. Existing automatic voice, file clone, saved
profile, voice design, advanced settings, and long-form behavior remain
available.

### Voice profiles

Redesign the saved-profile library and create form with loading, empty, list
error, form error, save, use, delete, and confirmation states. Profile data
and existing sidecar operations remain unchanged. A first-ready desktop
session can also show the seeded `OmniVoice-Demo` profile with the supplied
Vietnamese reference transcript.

### Settings and logs

Redesign the app-language switch, engine metrics, local-storage path, logs
summary, request list, empty state, privacy note, and retry/error presentation.
The interface-language switch remains separate from synthesis language.

## Component and file boundaries

Add source-owned primitives under `apps/desktop/src/components/ui/` only for
controls used by these screens: button, card, input, textarea, label, select,
dialog/alert-dialog, badge, progress, tabs, separator, skeleton, and tooltip
as needed by the implemented states. Add the shared `cn` utility and shadcn
configuration. Extract the real screen boundaries from `App.tsx` into shell,
setup, workspace, profiles, settings, and logs components while keeping
sidecar orchestration and state ownership simple.

Remove the bespoke Sass surface after migration. `styles.css` becomes the
Tailwind v4 entry point and theme token layer; no parallel design system is
introduced.

## Motion and accessibility

- Animate route content, setup phase changes, profile list appearance, and
  actionable success/error transitions with short opacity/position/layout
  changes.
- Use CSS transitions for ordinary hover, focus, pressed, and color changes.
- Respect `prefers-reduced-motion` and Motion's reduced-motion hook.
- Use Base UI semantics for dialog, select, tabs, and other composite
  controls; every field has a visible label or accessible name.
- Preserve keyboard operation, visible focus, disabled/busy semantics, and
  `aria-live`/alert messaging for sidecar errors and progress.

## Non-goals

- No changes to Python, OmniVoice inference, sidecar protocol, profile format,
  export behavior, or Tauri permissions.
- No new cloud, auth, recording, batch, history, or mobile feature.
- No speculative component library or global state/store.

## Verification

The redesign is complete when all five screens render through the new system,
the existing EN/VI and TTS flows still work, all loading/error/empty states
remain recoverable, keyboard and reduced-motion behavior are checked, and the
frontend, backend, Rust, and packaged-app verification commands pass.

## Execution

Execution plan: [Volo AI Desktop UI System plan](../plans/2026-09-13-desktop-ui-system-plan.md)
