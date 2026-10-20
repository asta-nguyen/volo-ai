# Desktop Update Notice tasks

Issue: #4
Branch: `feat/4-desktop-update-notice`

## Design

[Desktop Update Notice](design.md)

## Global Constraints

- Check only the latest stable release from `az-forge/volo-ai`; validate its strict version tag and exact HTTPS GitHub release URL.
- Check at app startup without blocking rendering, with a five-second network timeout. Record every automatic attempt, including failures, and wait 24 hours before the next automatic attempt; manual check bypasses the cooldown without resetting it.
- Show an in-app banner only; do not send OS notifications or automatically download/install updates.
- Keep startup quiet on offline/network/API/parse failure; expose a retryable unavailable state only for manual check.
- Persist dismissal by release tag and show a different newer release later.
- Allow network access only to `https://api.github.com` in Tauri CSP; open only the validated release URL through the existing shell plugin.

## Impact map

Entry: no existing source; planned entry: `apps/desktop/src/App.tsx::App` startup and `SettingsView` manual check, using planned `apps/desktop/src/lib/update-check.ts::checkLatestRelease` (pending approval)
Flow: no existing flow; planned flow: App startup/manual Settings action → browser `fetch` of GitHub latest-release metadata → strict parse and numeric version comparison → in-app banner or manual unavailable state → validated GitHub release page opened through shell plugin (pending approval)
State changes: local browser storage records automatic-check time and dismissed release tag; no model, audio, or account data changes (pending approval)
External effects: public HTTPS GET to GitHub Releases API; opening the validated GitHub release page in the system browser; no automatic download or install (pending approval)
Change candidates: new `apps/desktop/src/lib/update-check.ts`, `apps/desktop/src/App.tsx::App` and `SettingsView`, `apps/desktop/src/lib/i18n.ts`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/capabilities/default.json`, `docs/llm/architecture/overview.md`, `docs/llm/INDEX.md` (pending approval)
Verification: desktop production build; controlled manual release-response matrix for tag comparison, malformed data, unsafe URL, timeout, cooldown, dismissal, links, and both locales (pending approval)
Verified at: `2a96ee839635f5ca76126eddcd2731c436a63158`

## Tasks

### Task 1 — [Desktop logic] Check and validate latest stable release

Files: new `apps/desktop/src/lib/update-check.ts::checkLatestRelease`, `apps/desktop/src-tauri/tauri.conf.json::app.security.csp`

Interfaces: Add a typed update result with `available`, `current`, and `unavailable` states, the validated release tag, and validated release URL. Read the installed version through the existing `getVersion()` API in the caller.

Change: Fetch the latest stable release with a five-second timeout. Validate strict `vMAJOR.MINOR.PATCH`, non-draft/non-prerelease flags, and exact HTTPS GitHub release host/path before comparing versions. Return no update when installed is equal/newer. Record every automatic attempt before fetching and throttle automatic checks to 24 hours; manual checks bypass the cooldown without resetting it. Add only `https://api.github.com` to `connect-src`.

Verify: `rtk npm --prefix apps/desktop run build` passes. Manual controlled responses verify older/current/newer tag comparison, malformed/draft/prerelease payloads, unsafe URL rejection, timeout/offline state, automatic cooldown, and manual bypass. No external link opens for invalid data.

Progress: todo
Result: none

### Task 2 — [Desktop UI] Show and dismiss localized update banner

Files: `apps/desktop/src/App.tsx::App`, `apps/desktop/src/App.tsx::SettingsView`, `apps/desktop/src/lib/i18n.ts::createUiCopy`, `apps/desktop/src-tauri/capabilities/default.json::default`

Interfaces: Add the non-blocking startup query, localized banner and manual Settings check. Open the validated release page through the installed shell plugin and grant only the needed shell-open capability.

Change: Render the in-app banner independently from provider readiness; show the version and release-page link. Persist dismissal for that release tag. Keep automatic failures silent and show retryable unavailable feedback only after a manual check. Do not trigger download/install.

Verify: `rtk npm --prefix apps/desktop run build` passes. Manual QA in English and Vietnamese verifies the banner on a newer release, no banner for current/equal version, dismiss persistence, redisplay for a later tag, manual retry, offline feedback, correct external link opening, and no install action.

Progress: todo
Result: none

### Task 3 — [Docs] Update verified release-check behavior

Files: `docs/llm/architecture/overview.md::Desktop shell`, `docs/llm/architecture/overview.md::Data and dependencies`, `docs/llm/INDEX.md::Feature inventory`

Interfaces: None.

Change: After Tasks 1–2 pass, document the stable-release check, cooldown, in-app banner, manual check, and no-auto-install behavior from current source. Keep the description limited to implemented behavior.

Verify: Run the `document-wiki` task-update procedure and wiki validator; confirm all sources and internal links resolve.

Progress: todo
Result: none

## Files inspected, no change

- `docs/llm/architecture/overview.md` — current release workflow and website download behavior.
- `apps/web/lib/releases.ts` — current validated stable-release source and tag/link contract.
- `apps/desktop/src/lib/sidecar.ts` — existing Tauri app version access.
- `apps/desktop/src-tauri/tauri.conf.json` — current desktop CSP.
- `apps/desktop/src-tauri/capabilities/default.json` — current shell permissions.
- `apps/desktop/src/lib/i18n.ts` — English/Vietnamese copy patterns.
- `apps/desktop/package.json` — confirms there is no frontend test script or test runner.

## Baseline

- 2026-10-21 before feature code: desktop production build passed with the existing large-chunk warning; the full Python suite passed all 152 tests under `.venv/bin/python`.
- The desktop package has no frontend test runner; the plan uses a production build and a controlled manual response matrix.

## Approval Gate

Status: approved

## Decision Log

None.
