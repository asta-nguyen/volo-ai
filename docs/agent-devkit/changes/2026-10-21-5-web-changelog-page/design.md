# Website Changelog Page

Issue: #5 · Branch: `feat/5-web-changelog-page`

## Goal

Let visitors browse Volo AI's published stable release history and read its release notes on the website in English or Vietnamese.

## Scope

- Add localized `/[locale]/changelog` pages linked from the existing website navigation.
- Read published release records and notes from the public GitHub Releases API, newest first; show version, published date, notes, and an official GitHub release link.
- Keep the repository-root `release.md` as the per-release source used by the tagged release workflow. Do not add a cumulative `CHANGELOG.md` or duplicate release-note content in the website repository.
- Use server-side fetching with a bounded timeout and the existing five-minute cache policy. Show explicit empty and unavailable states and a link to the complete GitHub Releases archive.
- Render release Markdown without enabling raw HTML.

## Behavior

- `/en/changelog` and `/vi/changelog` show the same published stable releases with localized page chrome and dates.
- List releases newest first and paginate through the public stable-release history. Exclude drafts and prereleases.
- Each release entry shows its tag, publication date, formatted release notes, and a link to that release's canonical GitHub page.
- The website navigation provides a localized Changelog link from the homepage and the changelog page.
- No published releases → show a localized empty state with a GitHub Releases link. GitHub API timeout, non-2xx response, or invalid payload → show a localized unavailable state with a retry/external link.
- Do not execute embedded HTML from a release body. Invalid tag, date, or release URL records are omitted rather than rendered.

## Edge cases

- A release page with fewer than one page of valid stable entries has no older-page link; invalid or filtered entries do not break the page.
- A malformed GitHub response, timeout, or rate limit does not crash static rendering; render the unavailable state.
- Release notes may be empty or contain unsupported Markdown constructs; render supported safe Markdown as text and preserve the canonical GitHub link.
- Locale switching stays on the changelog route and preserves the requested release-history page.

## Interfaces

- Extend `apps/web/lib/releases.ts` with a typed release-history result and `getReleaseHistory(page)` using the GitHub releases list endpoint. Validate version tags, stable flags, publication dates, body type, and exact official release URLs; use bounded page size, timeout, and cache settings.
- Add `apps/web/app/[locale]/changelog/page.tsx` to validate locale/page parameters, fetch the history, and render localized release entries and pagination.
- Add localized navigation, page title, pagination, empty, and unavailable strings in `apps/web/lib/site-copy.ts`.
- Add styles for release entries and pagination in `apps/web/app/globals.css`. Use a safe Markdown renderer with raw HTML disabled; add its package and lockfile entries only if no suitable renderer is already available.

## Verification

- Run the website production build.
- Manually verify both locales, newest-first order, older/newer pagination, release links, stable filtering, empty history, API timeout/error, and release bodies containing raw HTML.
- Confirm the homepage's current latest-release download behavior remains intact and that no duplicate `CHANGELOG.md` source is introduced.
- Update the architecture wiki only after source and behavior have been verified.

## Related context

- [Architecture overview](../../../llm/architecture/overview.md)
- [Existing website release client](../../../../apps/web/lib/releases.ts)
- [Release publishing guide](../../../desktop-development.md)
