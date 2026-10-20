# Volo AI Website and Downloads

## Goal

Give prospective users a bilingual public page to understand Volo AI and
download the latest stable desktop build for a supported operating system.

## Scope

- Create a small Next.js App Router site under `apps/web`, using TypeScript,
  Node.js 22, and the Vercel Node runtime.
- Serve English and Vietnamese pages at `/en` and `/vi`; `/` redirects to
  `/en`, matching the desktop app's current default language.
- Show a concise product overview, key local/offline features, first-run model
  download expectations, supported platforms, current version, release notes,
  and available installer links.
- Read the latest published stable release from the public
  `asta-nguyen/volo-ai` GitHub repository at runtime. Cache the response on the
  server for five minutes. Link directly to GitHub release assets; do not proxy
  installer downloads or require a GitHub token.
- Support the release workflow's current targets only: macOS Apple Silicon
  (ARM64), Windows x64, and Linux x64. Show all matching installer formats
  present in the current release for each target.
- Explain that the macOS packages are unsigned and not notarized, so Gatekeeper
  can warn or block the download. Add concise, localized help beside the macOS
  download choice for the distinct Gatekeeper warnings users may encounter,
  including a clearly labeled advanced option to temporarily disable Gatekeeper.
- Keep the site usable on mobile, keyboard accessible, and indexable by search
  engines with locale-specific page metadata.

Out of scope: accounts, a CMS, a database, installer hosting/proxying,
automatic updates, mobile builds, Intel macOS downloads, a historical release
archive, and configuring a production domain or Vercel project.

## Behavior

- `/` sends visitors to `/en`. The language switch links to the same page in
  the other locale and keeps the current locale in the URL.
- Unsupported locale paths return a not-found page rather than silently
  displaying English or Vietnamese under the wrong URL.
- The download section presents separate macOS ARM64, Windows x64, and Linux
  x64 choices. Each choice lists only assets from the latest stable release
  whose filename matches that release tag and the platform's current OS/arch
  identifier. Each link uses the asset's `browser_download_url` and displays
  its filename and size.
- The page shows the release version and publication date and links to that
  release's notes on GitHub.
- A missing release or missing platform asset produces a clear unavailable
  state and a link to the GitHub Releases page. A GitHub API/network failure
  keeps the product information visible and shows the unavailable state.
- Accept only HTTPS asset URLs on `github.com` that belong to this repository;
  ignore malformed or unexpected assets instead of rendering arbitrary links.
- Beside the macOS choice, explain that after trying to open a build from the
  official Volo AI GitHub Releases page, users who trust it and believe it has
  not been tampered with can go to System Settings → Privacy & Security → Open
  Anyway and confirm. Link to [Apple's safety guidance](https://support.apple.com/en-ie/102445).
- Provide a separate, collapsed advanced/testing option that explains current
  macOS builds lack an Apple Developer ID signature and notarization, which is
  why Gatekeeper cannot verify them as identified/notarized software. Only for
  a build downloaded from the official Releases page, show
  `sudo spctl --master-disable` as a temporary, system-wide workaround, then
  `sudo spctl --master-enable` to restore Gatekeeper and `spctl --status` to
  confirm it is enabled. State that disabling assessment affects all apps,
  requires an administrator password, weakens protection, and does not repair
  a corrupted or modified app. Link to [Apple's command guidance](https://help.apple.com/xcode/mac/current/en.lproj/dev9b7736b0e.html).
- Treat “Volo AI is damaged and can't be opened” separately: advise users to
  delete that copy, download it again from the official Releases page, and stop
  and contact the maintainer if the warning persists. Do not instruct users to
  bypass this warning or remove quarantine with `xattr`.
- As of 2026-10-18 the public repository has no published release, so the
  initial page must show the unavailable state until the first stable release
  is published.

## Edge cases

- No stable release exists yet or GitHub returns `404`: show the no-downloads
  state and a link to the repository's Releases page.
- The release exists but lacks one platform's assets: keep the other platform
  links available and mark only the missing platform unavailable.
- A platform has multiple installer formats: list all valid formats for that
  platform so visitors can choose the package they need.
- GitHub times out, rate-limits, or returns invalid data: show product content
  and a clear unavailable state with the Releases link.
- An asset has an unknown platform suffix, wrong architecture, unexpected
  filename, or unsafe URL: omit that asset.
- macOS “Apple cannot check” warning: show the localized unsigned/not-notarized
  notice and cautious Apple-supported override steps for users who trust the
  official release source. Keep global Gatekeeper disable instructions in a
  separate advanced disclosure with the reason, system-wide impact, and
  re-enable command.
- macOS “app is damaged” warning: recommend a fresh download and contacting
  the maintainer if it persists; never present this as a routine override or
  route the user to the global Gatekeeper option.

## Interfaces

- New site entry points: `apps/web/app/(default)/page.tsx` redirects `/` to
  `/en`; `apps/web/app/[locale]/layout.tsx` sets the document language for
  `en` or `vi`; `apps/web/app/[locale]/page.tsx` renders localized product and
  download content.
- Release metadata source:
  `GET https://api.github.com/repos/asta-nguyen/volo-ai/releases/latest`.
  The page consumes release tag, publication date, notes URL, and each asset's
  name, size, and browser download URL.
- Release asset names follow the existing
  `volo-ai_<tag>_<os>_<arch>.<extension>` convention. Current platform keys
  are `macos_arm64`, `windows_x64`, and `linux_x64`.
- The site has no public application API, persistent state, or secret
  configuration. The existing desktop release workflow remains the source of
  installer builds and uploads.

## Verification

- Build the site with Node.js 22 using `npm --prefix apps/web run build`.
- Manually inspect `/`, `/en`, and `/vi`, including language switching,
  responsive layout, keyboard navigation, metadata, and all platform choices.
- Verify the no-release state against the repository's current empty releases
  list, then verify asset links against a published stable release.
- Use browser request blocking or response overrides to verify API failure,
  missing-platform, and malformed-asset states without adding a test runner.
- Inspect both locales' macOS help: the “Apple cannot check” steps are
  distinguished from the “app is damaged” recovery advice, the Apple support
  link is present, and the advanced Gatekeeper option explains missing signing
  and notarization, its system-wide risk, and how to re-enable/check it. Confirm
  there is no quarantine-removal instruction.
- Confirm each rendered download URL points to the matching GitHub release
  asset and that the page does not expose a token or proxy the file.

## Related context

- [Architecture overview](../../../../llm/architecture/overview.md)
