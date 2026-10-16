# Desktop shadcn and TanStack Query adoption

## Classification

Architectural: this changes the shared UI component boundary, adds a query
cache dependency, and moves sidecar-backed state into query and mutation flows.

## Status

The original design and use of `cnfast` were approved by the user on
2026-10-12 together with [tasks](tasks.md). On 2026-10-13, the user approved
raising the desktop development minimum to Node.js `>=22` to match
`cnfast@0.2.0`'s declared engine; see [decision D2](decisions.md).

## Problem

The desktop already depends on Base UI and has a shared `ui.tsx` module, but
those controls are hand-built and the shadcn CLI currently recognizes no
installed components. The CLI config does not select Base UI or resolve its
`@/` aliases. Settings tabs and some screen controls are also implemented
directly in `App.tsx`.

Status, voice profiles, and cursor-paginated History currently use manual
loading and refresh state in `App.tsx`. The sidecar is a local JSONL process,
so browser online state should not govern whether its queries can run.

## Goal

Use shadcn source components backed by Base UI for shared desktop controls, and
use TanStack Query for sidecar-backed status, profiles, and History while
preserving existing TTS flows, local UI state, and the sidecar contract.

## Approved direction

- Configure shadcn for Base UI and make `@/*` resolve to `apps/desktop/src` in
  the CLI, TypeScript, and Vite.
- Replace the shared hand-built controls with shadcn components used by the
  current screens: button, card, input, textarea, label, badge, progress,
  select, alert dialog, separator, skeleton, tabs, field, toggle group, and
  checkbox. Use `FieldGroup`/`Field` for forms, `ToggleGroup` for small option
  sets, and `Checkbox` for advanced boolean options. Keep Volo theme tokens,
  sizing, variants, and current screen behavior.
- Convert reusable controls currently written directly in `App.tsx` and the
  audio-player buttons to the shared components. Keep the app-specific audio
  composition and native audio, range, and file-picker controls.
- Add TanStack Query for sidecar status, saved voice profiles, and Audio
  History. Keep History cursor-based with `useInfiniteQuery` and its existing
  “Load more” interaction.
- Treat sidecar calls as local operations: set `networkMode: "always"`, disable
  automatic retries and focus/reconnect refetches, and retain the existing
  SidecarClient one-time retry when its child stops.
- Use mutations for sidecar operations that change data. Invalidate or update
  affected query data after successful or partially successful operations.
- Keep query data in memory only. Drafts, selections, theme, request logs,
  current synthesis result, progress, cancellation, Tauri file actions, and
  exports remain in their current local or event-driven flows.

## cnfast amendment — Node.js 22+ approved

The user requested using [`cnfast`](https://www.npmjs.com/package/cnfast) for
the shared Tailwind class helper. Replace the current `clsx` plus
`tailwind-merge` implementation in `apps/desktop/src/lib/utils.ts` with the
package's `cn` export, and remove the two direct dependencies; source search
found no other imports of `clsx` or `tailwind-merge`. Preserve the current `cn`
call sites and their class-merging behavior.

The `cnfast@0.2.0` package declares Node.js `>=22`. The user chose to raise the
desktop development minimum to Node.js `>=22`; update the package metadata,
lockfile, and developer setup documentation to match. This drops Node 20 support
for desktop development. Packaged end users do not need Node.js. The upstream
repository also says `cnfast` will no longer be maintained in favor of `cn`; a
reported Base UI typing issue describes function-valued `className`
incompatibility. The desktop TypeScript build must confirm existing wrappers
remain compatible.

## Compatibility

- Do not change Python behavior, JSONL message shapes, the profile database,
  audio formats, Tauri permissions, or TTS capabilities.
- Preserve loading, empty, error, refresh, and cancellation behavior in English
  and Vietnamese.
- Do not add the full shadcn catalog, a general client-state store, cache
  persistence, or a frontend test framework.

## Related context

- [Architecture overview](../../../../llm/architecture/overview.md)
- [Desktop audio history design](../../../specs/2026-10-08-desktop-audio-history-design.md)
- [shadcn CLI](https://ui.shadcn.com/docs/cli)
- [shadcn components.json](https://ui.shadcn.com/docs/components-json)
- [TanStack Query important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [TanStack infinite queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)
- [TanStack mutation invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)
- [cnfast upstream README and maintenance notice](https://github.com/aidenybai/cnfast)
- [cnfast Base UI className typing issue](https://github.com/aidenybai/cnfast/issues/1)

## Verification approach

Check shadcn CLI metadata and the desktop production build. Manually inspect
keyboard and focus behavior for tabs, selects, and destructive confirmation in
both locales. Exercise sidecar ready/unavailable and offline startup, profile
refresh after mutations, model progress and cancellation, synthesis refresh,
and cursor-based History pagination, retry, re-entry, and deletion. Confirm
query failures do not trigger TanStack retries and that SidecarClient recovery
still retries a stopped child once.
