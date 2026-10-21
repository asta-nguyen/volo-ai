# Website Changelog Page tasks

Issue: #5 · Branch: `feat/5-web-changelog-page`

## Design

[Website Changelog Page](design.md)

## Global Constraints

- The repository-root `changelog.md` is the source of website changelog entries and notes.
- Each changelog download lookup must match the exact stable release tag displayed on that entry.
- Changelog entries remain visible when a release or installer is unavailable.
- The changelog page links directly to validated installer assets and has no GitHub release-page/archive links.
- The homepage's current latest-release behavior remains unchanged.
- Render Markdown without raw HTML, links, or images; only direct installer downloads leave the changelog page.

## Impact map

Entry: existing `/[locale]/changelog` server page and `apps/web/lib/releases.ts`; planned root `changelog.md` reader.

Flow: request `/en/changelog` or `/vi/changelog` → read and parse root `changelog.md` → find stable release assets for the exact entry tags → render localized notes and direct download links.

State changes: none; changelog content is version-controlled Markdown and release lookup is read-only.

External effects: cached read-only requests to the public GitHub Releases API for exact-tag installer assets; browser downloads from validated direct asset URLs.

Change candidates: root `changelog.md`; `apps/web/lib/changelog.ts`; `apps/web/lib/releases.ts`; `apps/web/app/[locale]/changelog/page.tsx`; `apps/web/lib/site-copy.ts`; `apps/web/app/globals.css`; `apps/web/next.config.ts`; website tests; `docs/desktop-development.md`; `docs/llm/architecture/overview.md`; `docs/llm/INDEX.md`.

Verification: website tests cover parsing, exact-tag stable asset selection, unavailable assets, safe Markdown, and no release-page links; production build and production route checks cover both locales and root-file tracing; wiki validator and Markdown links pass.

Evidence: existing localized route, server-only release client, existing MarkdownIt dependency, and current latest-release homepage behavior were inspected; original implementation baseline passed four website tests and `npm --prefix apps/web run build` on 2026-10-21.

## Historical implementation (superseded by the decision below)

Tasks 1–3 below record the first implementation, which read notes and links from the GitHub Releases API. Their results remain historical; Task 4 replaces that changelog-page data flow.

### Task 1 — [Historical web data] Fetch GitHub release history

Files: `apps/web/lib/releases.ts::LatestRelease`, `getReleaseHistory`

Interfaces: Return typed stable release records containing tag, publication date, Markdown body, official release URL, and whether an older page is available.

Change: Add a server-side paginated GitHub Releases API request with a bounded page size, five-second timeout, and five-minute revalidation. Exclude drafts and prereleases. Validate strict version tags, dates, body type, and official release URLs without changing `getLatestRelease()`.

Verify: `rtk npm --prefix apps/web run build` and the release-history mock harness.

Progress: done
Result: Production build passed; 22 mock checks passed for stable filtering, sorting, invalid entries, empty/unavailable states, timeout/rate-limit errors, pagination, and unchanged `getLatestRelease()` behavior.

### Task 2 — [Historical web UI] Add localized changelog pages

Files: `apps/web/app/[locale]/changelog/page.tsx`, `apps/web/app/[locale]/page.tsx`, `apps/web/lib/site-copy.ts`, `apps/web/app/globals.css`, `apps/web/package.json`, `apps/web/package-lock.json`, `apps/web/test/`

Interfaces: Add `/en/changelog` and `/vi/changelog`, localized page metadata and navigation strings, release-list pagination, and localized empty/unavailable states.

Change: Render release cards with notes and canonical GitHub release links; preserve locale and page number in pagination; render Markdown with raw HTML disabled.

Verify: Website production build, automated pagination tests, and mocked production-route checks in English and Vietnamese.

Progress: done
Result: Production build passed; four Node regression tests passed; mocked `next start` checks covered locale copy, empty-page pagination, history links, and existing Markdown safety/filtering checks.

### Task 3 — [Historical docs] Document the first release-history implementation

Files: `docs/llm/architecture/overview.md::Website release flow`, `docs/llm/INDEX.md::Feature inventory`

Interfaces: Document the original localized route and GitHub Releases data source.

Change: Update the wiki after source behavior was verified.

Verify: Run the wiki validator and `rtk git diff --check`.

Progress: done
Result: Wiki validator passed (6 Markdown files, 28 requirements, 0 errors/warnings); changed source and links resolved. This page content will be revised by Task 5.

## Tasks

### Task 4 — [Web source and UI] Read local changelog and show exact-version downloads

Files: root `changelog.md`; new `apps/web/lib/changelog.ts`; `apps/web/lib/releases.ts`; `apps/web/app/[locale]/changelog/page.tsx`; `apps/web/lib/site-copy.ts`; `apps/web/app/globals.css`; new `apps/web/next.config.ts`; `apps/web/test/`; `apps/web/package.json`

Interfaces: Parse ordered `## vMAJOR.MINOR.PATCH` entries from the root changelog into typed notes. Resolve each tag against stable GitHub release assets and return direct installer URLs associated with that exact tag.

Change: Replace API-sourced release notes and pagination with the local changelog. Preserve notes when release lookup fails, display localized download status, and remove release-page/archive links and authored Markdown hyperlinks from this page. Keep homepage latest-release behavior intact and include the root file in the route's Next.js output trace.

Verify: Website tests cover strict/duplicate/empty headings, exact stable tag and asset URL matching, missing release/assets and API failure, and unsafe or linked Markdown. `rtk npm --prefix apps/web test` and `rtk npm --prefix apps/web run build` pass; production-route checks show local notes and only direct installer links in both locales.

Progress: done
Result: npm --prefix apps/web test passed 18/18. Coverage includes strict SemVer headings and leading-zero rejection, duplicate/empty/CRLF input, repository changelog parsing, exact-tag stable asset lookup and direct URL validation, mismatched/draft/prerelease/missing/API-error cases, and removal of authored links, images, and raw HTML. npm --prefix apps/web run build passed; the production output trace includes the repository-root changelog.md. Mocked production route checks returned 200 for /en/changelog and /vi/changelog, rendered local notes in file order, showed only exact-tag direct installer links, and retained localized no-installer status when a release was unavailable. The homepage latest-release behavior remained intact.

### Task 5 — [Docs] Document changelog source and release preparation

Files: `docs/desktop-development.md::Publish a release`; `docs/llm/architecture/overview.md::Website release flow`; `docs/llm/INDEX.md::Feature inventory`

Interfaces: Document `changelog.md` as the website source, exact-tag installer lookup, and the release-preparation step that keeps the cumulative entry aligned with per-tag `release.md`.

Change: Update developer guidance and verified wiki behavior only after Task 4 passes.

Verify: Run the wiki validator, resolve all edited relative Markdown links, confirm referenced source paths exist, and run `rtk git diff --check`.

Progress: done
Result: docs/desktop-development.md now instructs maintainers to update the cumulative root changelog.md alongside per-tag release.md. The verified website wiki documents local Markdown notes, exact-tag installer lookup, safe rendering, and unavailable-download behavior. Wiki validation passed (6 Markdown files, 28 requirements, 0 errors/warnings); edited links and source paths resolve; git diff --check passed.

## Files inspected during planning

These files were inspected before implementation; files later changed are listed under the tasks above.

- `apps/web/lib/releases.ts` — current stable release parsing and homepage download behavior.
- `apps/web/app/[locale]/page.tsx` — homepage download section and localized navigation.
- `apps/web/lib/site-copy.ts` — English/Vietnamese copy model.
- `apps/web/app/globals.css` — website layout and changelog styles.
- `release.md` — per-tag notes source consumed by the current release workflow.
- `.github/workflows/release.yml` — validates and publishes the tagged `release.md`.
- `docs/desktop-development.md` — release preparation and tag workflow.

## Baseline

- 2026-10-21 before the revised implementation: `rtk npm --prefix apps/web test` passed (4 tests); `rtk npm --prefix apps/web run build` passed. Next.js warned that `/Users/nus/pnpm-lock.yaml` is outside the repository and was ignored.

## Approval Gate

Status: approved

## Decision Log

- 2026-10-21 — User directed that the web page read `changelog.md`, not GitHub release-note bodies, and that version entries only link to the exact version's download. This materially changes the approved data source and navigation behavior. User approved the revised `design.md` and Tasks 4–5; implementation is authorized.
