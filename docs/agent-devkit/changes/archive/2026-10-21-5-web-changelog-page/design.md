# Website Changelog Page

Issue: #5 · Branch: `feat/5-web-changelog-page`

## Goal

Let visitors read Volo AI's versioned changelog on the website in English or Vietnamese, with downloads tied to the exact version shown.

## Scope

- Add localized `/[locale]/changelog` pages linked from the website navigation.
- Read release entries and Markdown notes from the repository-root `changelog.md`; show every valid version entry in the file, newest first.
- Use the GitHub Releases API only to find installer assets whose release tag exactly matches a changelog entry. Link directly to those asset downloads; do not link to GitHub release-note pages or the release archive.
- Keep changelog content visible if the release lookup fails or a version has not been published yet; show a localized download status without redirecting visitors elsewhere.
- Render the Markdown without raw HTML, hyperlinks, or images so the only outbound links on the changelog page are version-matched installer downloads.
- Keep the homepage's latest-release behavior unchanged.

## Behavior

- `/en/changelog` and `/vi/changelog` render the same repository changelog with localized page chrome.
- A strict `## vMAJOR.MINOR.PATCH` heading starts each release entry. The entry's body continues up to the next valid version heading. Entries appear in file order.
- Every entry shows its version, safe Markdown notes, and direct installer links returned for that exact release tag. A missing release or installer shows a localized status and no download link.
- The route does not show links to GitHub release pages or archives. Header/footer navigation stays on the website; only installer links leave the site.
- Invalid locale returns 404. Invalid headings are ignored. Duplicate version headings after the first are ignored.
- A missing or unreadable changelog is an application error and must be caught by the production build or route check; do not silently substitute GitHub release notes.

## Interfaces

- Add root `changelog.md` as the cumulative, ordered source for website notes. Keep `release.md` as the per-tag input consumed by the existing desktop release workflow; release preparation updates both files with the matching release notes.
- Add a small server-only changelog reader/parser that reads the root file and returns validated version/body records.
- Extend `apps/web/lib/releases.ts` with a bounded server-side lookup of stable releases and validated direct installer assets for the exact changelog tags. Preserve `getLatestRelease()` for the homepage.
- Update `apps/web/app/[locale]/changelog/page.tsx` to render local notes and exact-version downloads without pagination or external release-page links.
- Update localized copy/styles and tests for parsing, exact-tag asset matching, unavailable downloads, safe Markdown, and absence of release-page links.
- Configure Next.js output tracing so the repository-root `changelog.md` ships with the server-rendered route.

## Verification

- Run `npm --prefix apps/web test` and the production build.
- Verify parser behavior for ordered entries, strict and duplicate headings, and empty content.
- Verify release lookup matches only the requested stable tag, links only to validated direct asset URLs, and returns no download links on missing releases or API failure.
- Check both locales render the same notes, preserve the version headings, and expose no GitHub release-page/archive links or authored Markdown links.
- Check the production route can read the root changelog included by Next.js output tracing.
- Validate the website architecture wiki and release preparation guide after source behavior is verified.

## Related context

- [Architecture overview](../../../../llm/architecture/overview.md)
- [Existing website release client](../../../../../apps/web/lib/releases.ts)
- [Release publishing guide](../../../../desktop-development.md)
