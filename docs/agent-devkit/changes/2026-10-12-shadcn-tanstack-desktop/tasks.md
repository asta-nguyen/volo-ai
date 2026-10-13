# Desktop shadcn and TanStack Query adoption — tasks

## Design

[Desktop shadcn and TanStack Query adoption](design.md)

## Global Constraints

- Use source-owned shadcn components backed by Base UI for shared controls;
  keep the Volo theme, layout, Tauri boundaries, and sidecar JSONL contract.
- Add only components currently used by the app. Keep native audio, range,
  and file-picker controls and the app-specific audio player.
- TanStack Query owns only sidecar-backed status, profile, and History data.
  Do not persist its cache or use it for general UI state.
- Sidecar queries and mutations use `networkMode: "always"`, do not retry
  automatically, and do not refetch on focus or reconnect. Keep the existing
  one-time SidecarClient child-restart retry.
- Preserve cursor-based History pagination and its existing “Load more” flow.
- Keep model preparation and VieNeu seeding progress and cancellation on the
  existing sidecar event flow.

## Approval Gate

- Required: yes
- Reason: this adds a frontend dependency and query cache, changes sidecar data
  ownership, and standardizes shared controls and component imports. The
  proposed `cnfast` dependency changes the approved dependency set and carries
  an upstream maintenance notice, a reported Base UI type compatibility risk,
  and a Node.js `>=22` engine requirement that conflicts with the repository's
  Node.js `>=20` support.
- Status: pending
- Prior approval: user — “ok duyệt và implement đi” on 2026-10-12 (original scope)
- Revision approval: user — “duyệt” on 2026-10-12 (cnfast dependency revision)

## Decision Log

- 2026-10-12 — User chose shadcn for shared components and TanStack Query for
  server state; approved this design and task list for implementation.
- 2026-10-12 — Keep the existing 2026 desktop UI spec and plan as history;
  this adoption is tracked as a separate change.
- 2026-10-12 — The current shadcn CLI selects Base UI with a `base-*` style;
  use `base-nova` instead of the obsolete root `base` setting.
- 2026-10-12 — User requested `cnfast` for the shared `cn` helper. This proposes
  adding `cnfast@0.2.0`, removing the direct `clsx` and `tailwind-merge`
  dependencies (the source search found no other imports), and verifying Base UI type
  compatibility. User approved using `cnfast` on 2026-10-12; see
  [Decision D1](decisions.md).
- 2026-10-12 — Implementation found that `cnfast@0.2.0` declares Node.js
  `>=22`, conflicting with the repository's `>=20` requirement. The user must
  choose whether to raise the project minimum or preserve Node 20 support with
  a `cnfast` release whose published engine requirement supports it. Approval
  is pending for this runtime compatibility revision.

## Tasks

### Task 1 — Align shadcn and migrate shared desktop controls

Files:

- `apps/desktop/package.json`
- `apps/desktop/package-lock.json`
- `apps/desktop/src/lib/utils.ts::cn`
- `AGENTS.md` and `docs/desktop-development.md` (if the supported Node minimum
  is raised)
- `apps/desktop/components.json`
- `apps/desktop/tsconfig.json`
- `apps/desktop/vite.config.ts`
- `apps/desktop/src/components/ui.tsx` (remove)
- `apps/desktop/src/components/ui/{button,card,input,textarea,label,badge,progress,select,alert-dialog,separator,skeleton,tabs,field,toggle-group,checkbox}.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/AudioPlayer.tsx`
- `docs/desktop-development.md`

Files inspected, no change:

- `apps/desktop/src/styles.css` — existing Volo theme tokens and Tailwind CSS v4 utilities

Interfaces: shadcn CLI resolves Base UI and the `@/*` alias to
`apps/desktop/src`. Existing consumers keep typed component props and preserve
current labels, values, callbacks, and visual tokens.

Change: Replace the existing `cn` helper implementation with the user-approved
`cnfast` release and preserve its call sites. Resolve its Node engine
requirement with the project's declared minimum before finalizing the package
version; remove direct `clsx` and `tailwind-merge` dependencies. Set the shadcn
style to `base-nova` and configure matching
TypeScript and Vite aliases. Replace the hand-built shared controls with the corresponding
source-owned shadcn components. Replace the Settings tablist with Tabs and the
destructive confirmation with AlertDialog. Convert reusable direct buttons in
the screens and audio-player controls to the shared Button. Use FieldGroup and
Field for forms, ToggleGroup for small single-choice option sets, and Checkbox
with FieldSet for the advanced boolean options. Preserve Volo styling, selected
values, horizontal tab overflow, focus visibility, and current content. Keep
app-specific audio composition and native audio/range/file-picker controls.
Add no unused catalog components.

Verify:

- From `apps/desktop`, `rtk npx shadcn@latest info --json` reports Base UI,
  the `@/` alias, and the installed components used by the app.
- `rtk npm --prefix apps/desktop run build` passes, including the `cnfast` API
  at existing Base UI component call sites.
- The selected `cnfast` package's declared Node engine is compatible with the
  project's documented and package-declared Node minimum.
- Manual keyboard check covers tab navigation, Select, AlertDialog, visible
  focus, and existing selection behavior in English and Vietnamese.

Progress: todo
Result: none

### Task 2 — Query status, profiles, and cursor-based History

Files:

- `apps/desktop/package.json`
- `apps/desktop/package-lock.json`
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/App.tsx`

Interfaces: A single in-memory `QueryClientProvider` supplies the app.
Provider status and saved profiles use `useQuery`; History uses
`useInfiniteQuery` with the existing `AudioHistoryCursor` and `next_cursor`.
Screen components continue to receive their existing data and loading/error
states.

Change: Add `@tanstack/react-query` and mount the provider. Move sidecar status,
profile, and History reads into queries. Set `networkMode: "always"`, disable
query retries and focus/reconnect refetches, and retain explicit refresh and
retry actions. Enable profile reads after status is available and History only
when that view is active. Flatten pages in cursor order and preserve the
existing duplicate handling, total count, “Load more” action, and selected-voice
fallback behavior. Do not persist cache data or pass an `AbortSignal` that
`SidecarClient` does not support.

Verify:

- `rtk npm --prefix apps/desktop run build` passes.
- Manual launch covers ready, unavailable, and OS-offline states; status
  refresh; profile navigation; History retry, next cursor, and re-entry refresh.

Progress: todo
Result: none

### Task 3 — Mutate sidecar data through Query and update project context

Files:

- `apps/desktop/src/App.tsx::prepareModel`, `seedVieNeuVoices`, `synthesize`,
  `saveProfile`, `deleteProfile`, `importVoiceFile`, `importSeedFolder`, and
  `deleteAudioHistory`
- `apps/desktop/src/App.tsx::importBundledSeedVoices`
- `docs/llm/architecture/overview.md::Runtime boundaries`

Interfaces: Data-changing sidecar operations use `useMutation` with
`networkMode: "always"` and retries disabled. Successful or partially
successful actions update or invalidate the corresponding status, profile, or
History query. Progress and cancellation continue to use SidecarClient events
and cancellation requests.

Change: Refresh status after model preparation; refresh profiles after bundled
seed import, user imports/seeding, save, or delete; and refresh History after
synthesis. After confirmed History deletion, remove the item across cached
pages and update the total while preserving active-take cleanup. Keep drafts,
selection, logs, current result, file dialogs, and exports local. Update the
architecture overview with the verified query-cache and event boundaries via
the `document-wiki` task update procedure.

Verify:

- `rtk npm --prefix apps/desktop run build` passes.
- Manual profile CRUD/import/seeding refreshes the list; preparation updates
  readiness; synthesis appears in History; deletion removes it from loaded
  pages and clears the active take/result; progress and cancellation messages
  remain correct in both locales.
- Query/mutation failures do not auto-retry; a stopped SidecarClient child
  still receives its existing single retry.

Progress: todo
Result: none

## Impact map

Entry: `apps/desktop/src/main.tsx::ReactDOM.createRoot`, `apps/desktop/src/App.tsx::App`
Flow: React root → QueryClientProvider → screen queries/mutations → SidecarClient JSONL → existing local Python sidecar; shared controls use source-owned shadcn/Base UI components
State changes: status, profiles, and cursor History pages move into an in-memory query cache; transient UI, progress, and logs remain local/event-driven; no persistent data changes
External effects: existing local sidecar operations and Tauri file dialogs only; no new network service, sidecar message, or data format
Change candidates: `apps/desktop/components.json`, `apps/desktop/tsconfig.json`, `apps/desktop/vite.config.ts`, `apps/desktop/package.json`, `apps/desktop/package-lock.json`, `apps/desktop/src/lib/utils.ts`, `apps/desktop/src/main.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/components/AudioPlayer.tsx`, `apps/desktop/src/components/ui.tsx` (remove), `apps/desktop/src/components/ui/`, `docs/desktop-development.md`, `docs/llm/architecture/overview.md`
Verification: cnfast/Base UI TypeScript compatibility, shadcn CLI metadata, desktop build, keyboard controls, ready/unavailable/offline sidecar, profile mutations, preparation progress/cancel, synthesis, and cursor History refresh/load/delete
Verified at: `fee54e8a5e63e57388ccd0aa959c8e764c030cf4`
