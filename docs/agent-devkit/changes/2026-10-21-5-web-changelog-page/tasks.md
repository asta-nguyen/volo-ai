# Website Changelog Page tasks

Issue: #5 · Branch: `feat/5-web-changelog-page`

## Design

[Website Changelog Page](design.md)

## Global Constraints

- Use GitHub Releases as the source of published release notes; keep root `release.md` as the per-tag source.
- Do not add or maintain a cumulative `CHANGELOG.md`.
- Display published stable releases only, newest first, with localized English/Vietnamese page chrome.
- Fetch on the server with bounded timeout, pagination, validation, and the existing five-minute cache policy.
- Render release Markdown without executing raw HTML; keep a canonical GitHub release link for each entry.
- Keep the current homepage's latest-release download behavior working.

## Impact map

- Entry: planned `apps/web/app/[locale]/changelog/page.tsx` and localized navigation in `apps/web/app/[locale]/page.tsx`
- Flow: visitor opens `/en/changelog` or `/vi/changelog` → server calls GitHub Releases list API through `getReleaseHistory(page)` → validate and filter release records → render notes, pagination, localized status, and canonical links
- State changes: none; release content remains in GitHub Release metadata sourced from the tagged `release.md`
- External effects: cached read-only HTTPS requests to the public GitHub Releases API; external links to official release pages
- Change candidates: `apps/web/lib/releases.ts`, new `apps/web/app/[locale]/changelog/page.tsx`, `apps/web/app/[locale]/page.tsx`, `apps/web/lib/site-copy.ts`, `apps/web/app/globals.css`, `apps/web/package.json` and `apps/web/package-lock.json` only if a safe Markdown renderer is needed, `docs/llm/architecture/overview.md`, `docs/llm/INDEX.md`
- Verification: production build and manual locale, pagination, stable-filter, error-state, safe-rendering, and homepage regression checks
- Verified at: `2a96ee839635f5ca76126eddcd2731c436a63158`

## Tasks

### Task 1 — [Web data] Fetch and validate release history

Files: `apps/web/lib/releases.ts::LatestRelease`, new `ReleaseHistory` result and `getReleaseHistory(page)`

Interfaces: Return typed stable release records containing tag, publication date, Markdown body, official release URL, and whether an older page is available.

Change: Add a server-side paginated GitHub Releases API request with a bounded page size, five-second timeout, and five-minute revalidation. Exclude drafts and prereleases. Validate the strict `vMAJOR.MINOR.PATCH` tag, parseable publication date, notes body type, and exact HTTPS GitHub release URL. Return explicit empty/unavailable states without changing `getLatestRelease()` behavior.

Verify: `rtk npm --prefix apps/web run build` passes. Manually confirm valid records sort/filter correctly, malformed entries are omitted, empty history is distinct from API failure, timeout/rate-limit errors return unavailable, and the existing latest-release data remains unchanged.

Progress: todo
Result: none

### Task 2 — [Web UI] Add localized changelog pages

Files: new `apps/web/app/[locale]/changelog/page.tsx`, `apps/web/app/[locale]/page.tsx`, `apps/web/lib/site-copy.ts`, `apps/web/app/globals.css`, `apps/web/package.json`, `apps/web/package-lock.json` only if required

Interfaces: Add `/en/changelog` and `/vi/changelog`, localized page metadata and navigation strings, release-list pagination, and localized empty/unavailable states.

Change: Render release cards newest first with version, date, release notes, and canonical GitHub link. Preserve locale and page number in older/newer navigation. Render Markdown with raw HTML disabled; use an existing parser if available or add one safe renderer dependency if needed. Keep a link to the complete GitHub Releases archive.

Verify: `rtk npm --prefix apps/web run build` passes. Manually check both locales, release-note formatting, official links, pagination boundaries, empty/API-failure states, raw HTML inertness, and homepage download behavior.

Progress: todo
Result: none

### Task 3 — [Docs] Update verified release-history coverage

Files: `docs/llm/architecture/overview.md::Website release flow`, `docs/llm/INDEX.md::Feature inventory`

Interfaces: Document the localized changelog route and its GitHub Releases data source; clarify that `release.md` remains per-release input and there is no cumulative changelog file.

Change: After Tasks 1–2 pass, update the wiki with only verified page behavior, caching, locale, and release-source details.

Verify: Run the `document-wiki` task-update procedure and wiki validator; confirm new route and source paths exist and links resolve.

Progress: todo
Result: none

## Files inspected, no change

- `apps/web/lib/releases.ts` — existing latest stable release fetch, cache, validation, and notes link.
- `apps/web/app/[locale]/page.tsx` — current homepage downloads section and localized route.
- `apps/web/lib/site-copy.ts` — English/Vietnamese copy model.
- `apps/web/app/globals.css` — existing site layout and release styles.
- `release.md` — current per-release notes source.
- `docs/desktop-development.md` — release preparation and tag workflow.

## Baseline

- 2026-10-21 before feature code: website production build passed. Next.js warned that `/Users/nus/pnpm-lock.yaml` is outside this repository and was ignored; no web test runner is configured.

## Approval Gate

Status: approved

## Decision Log

None
