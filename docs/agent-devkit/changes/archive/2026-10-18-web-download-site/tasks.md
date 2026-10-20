# Volo AI Website and Downloads tasks

## Design

[Volo AI Website and Downloads](design.md)

## Global Constraints

- Use Next.js App Router, TypeScript, Node.js 22, and a Vercel Node runtime.
- Serve only English and Vietnamese at `/en` and `/vi`; `/` redirects to `/en`.
- Read the latest published stable release from the public GitHub repository;
  do not require a token or proxy installer downloads.
- Cache GitHub release metadata on the server for five minutes.
- Support only macOS ARM64, Windows x64, and Linux x64, matching the existing
  release workflow.
- Validate release asset names and HTTPS GitHub URLs before rendering links.
- Keep release metadata and download failures visible in both locales; do not
  render broken or guessed download links.
- Localize the macOS Gatekeeper help: offer cautious Apple-supported steps for
  an “Apple cannot check” warning and redownload/stop advice for an “app is
  damaged” warning. Keep any Gatekeeper disable instructions in a separate
  advanced disclosure with its reason, system-wide warning, and re-enable
  command. Do not suggest removing quarantine.
- Do not add a test runner. Verify the new app with its production build and
  focused browser QA.

## Impact map

Entry: no existing source; planned entry:
`design.md::apps/web/app/[locale]/page.tsx::LocaleHomePage` (pending approval)

Flow: no existing flow; planned flow: `/` redirect or `/{locale}` request →
localized server-rendered page → cached GitHub latest-stable-release request →
validate and group assets by supported OS/architecture → visitor downloads the
selected asset directly from GitHub (pending approval)

State changes: none; the site stores no user or release state
(pending approval)

External effects: Vercel server sends a read-only request to the public GitHub
Releases API; visitor downloads selected release assets directly from GitHub
(pending approval)

Change candidates: create `apps/web/package.json`,
`apps/web/package-lock.json`, `apps/web/tsconfig.json`,
`apps/web/app/(default)/layout.tsx`, `apps/web/app/(default)/page.tsx`,
`apps/web/app/[locale]/layout.tsx`, `apps/web/app/[locale]/page.tsx`,
`apps/web/app/globals.css`, and `apps/web/lib/releases.ts`; update
`docs/llm/architecture/overview.md` and `docs/llm/INDEX.md` after verifying
the implemented routes and release behavior (pending approval)

Verification: with Node.js 22, run `npm ci --prefix apps/web` and
`npm --prefix apps/web run build`; manually inspect locale and platform states
in a browser, using the current no-release API result plus browser response
overrides for published, incomplete, malformed, and failed API responses. A
real GitHub download cannot be verified until the repository publishes its
first stable release (pending approval)

Verified at: 4ed026c7658e37254c9e4650d595ff02a1eaad86

## Tasks

### Task 1 — Bootstrap the localized Next.js site

Files: `apps/web/package.json::scripts`, `apps/web/package-lock.json`,
`apps/web/tsconfig.json::compilerOptions`,
`apps/web/postcss.config.mjs::PostCSS configuration`,
`apps/web/next-env.d.ts::Next.js type declarations`,
`apps/web/app/(default)/layout.tsx::DefaultRootLayout`,
`apps/web/app/(default)/page.tsx::DefaultPage`,
`apps/web/app/[locale]/layout.tsx::LocaleRootLayout`,
`apps/web/app/[locale]/page.tsx::LocaleHomePage`,
`apps/web/lib/site-copy.ts::Localized site content`, `apps/web/app/globals.css`,
`.gitignore::Next.js build output`

Interfaces: Create the independent `apps/web` application using Node.js 22 and npm. `/` redirects to `/en`; `/en` and `/vi` render the same product page in the selected locale, with the matching document language and a language switch.

Change: Create the minimum Next.js App Router application and one responsive product page. Explain local text-to-speech, local data handling, first-run model downloads, and the three supported desktop targets. Include the release/download section's page structure and locale-specific metadata. Keep copy and links in the two supported locales; do not add a CMS, account flow, or client-side localization dependency.

Verify: `npm ci --prefix apps/web` and `npm --prefix apps/web run build` pass
on Node.js 22. Run the production app and confirm `/` reaches `/en`, both
locale URLs render their own copy and document language, an unsupported locale
returns not found, the language switch preserves the page, and the layout works
at desktop and mobile widths with keyboard navigation.

Progress: done
Result: Node 22 production build and route/browser checks passed: `/` redirects to `/en`, `/en` and `/vi` render matching language and metadata, unsupported locales return 404, locale switching works, and 320px/375px layouts have no horizontal overflow.

### Task 2 — Resolve and display current GitHub release assets

Files: `apps/web/lib/releases.ts::getLatestRelease`, `apps/web/app/[locale]/page.tsx::LocaleHomePage`, `apps/web/lib/site-copy.ts::localized release and Gatekeeper copy`, `apps/web/app/globals.css::download states`

Interfaces: The server-side release helper calls
`GET /repos/asta-nguyen/volo-ai/releases/latest`, caches the response for
300 seconds, and returns validated release metadata grouped by `macos_arm64`,
`windows_x64`, and `linux_x64`. The page renders direct links from each
matching asset's `browser_download_url`.

Change: Distinguish no-release (`404`) from other API failures. Match asset
names to the returned release tag and one supported OS/architecture pair;
allow multiple uploaded formats per platform. Accept only HTTPS download URLs
hosted at `github.com` for this repository. Show the release version,
publication date, release-notes link, filenames, and sizes. Localize the
no-release, missing-platform, API-error, and unsigned macOS notices. For an
“Apple cannot check” warning, explain the cautious Open Anyway path after
downloading from the official Releases page and link to Apple support. In a
separate advanced disclosure, explain that current builds lack Apple Developer
ID signing and notarization, give the temporary `spctl` disable command, explain
its system-wide effect, and include commands to re-enable and check Gatekeeper.
For “Volo AI is damaged,” advise a fresh official download and contacting the
maintainer if it persists; do not recommend a bypass. Keep product information
visible when downloads are unavailable and link to the repository's Releases
page.

Verify: `npm --prefix apps/web run build` passes. Check the current GitHub
latest-release endpoint and production page's no-release state. Since release
lookup runs only on the server, use an ephemeral Node fetch stub with the
production server to render a valid release with all targets and multiple
formats, a missing target, a wrong architecture, a malformed asset URL, and an
API failure. Confirm valid links point directly to matching GitHub assets and
neither page HTML nor application requests expose a credential. Review both
locales' macOS help for the two distinct warning paths and confirm the advanced
disclosure explains unsigned/notarized status, system-wide impact, and the
re-enable/status commands. Confirm it contains no quarantine removal command
and damaged-app advice does not point users to the bypass.

Progress: done
Result: Production-rendered EN/VI valid-release checks passed with multiple formats and direct GitHub asset URLs; wrong-architecture and unsafe-host assets were omitted. Missing-platform, API-503, and network-failure states retained product information and the Releases fallback without guessed links; the live latest endpoint returned 404. Browser QA confirmed localized Gatekeeper help and no quarantine-removal instruction.

### Task 3 — Update verified architecture documentation

Files: `docs/llm/architecture/overview.md::Entry points`, `docs/llm/INDEX.md::Feature inventory`

Interfaces: Document the implemented Next.js public site and its read-only GitHub Release metadata flow using exact source paths.

Change: Add only behavior verified in the completed site: supported locales
and platforms, runtime release lookup and cache behavior, direct GitHub
downloads, and unavailable-release/error handling. Keep the architecture
wiki's sources and feature inventory navigable. No `delta.md` is needed because
the existing architecture page has no `## Requirements` section for this new
web domain.

Verify: Read the updated wiki pages against the implemented source; confirm
every linked page and source path exists and that no proposed behavior is
documented as current behavior.

Progress: done
Result: Updated the architecture overview and feature inventory after checking the implementation; the document-wiki validator confirmed 5 Markdown files and 26 requirements with zero errors or warnings.

## Files inspected, no change

- `.github/workflows/release.yml` — existing release targets, asset naming, and publish ordering.
- `README.md` — current user-facing product and first-run behavior.
- `docs/desktop-development.md` — release process, package targets, and macOS signing status.
- `docs/llm/INDEX.md` — verified wiki navigation and current feature inventory.
- `docs/llm/architecture/overview.md` — desktop runtime and release architecture.
- `apps/desktop/package.json` — Node.js 22 and npm command conventions.
- `apps/desktop/src/lib/i18n.ts` — existing English default and supported locale names.
- `apps/desktop/src-tauri/tauri.conf.json` — desktop shell configuration; independent from the public site.

## Approval Gate

Status: approved

## Decision Log

None.
