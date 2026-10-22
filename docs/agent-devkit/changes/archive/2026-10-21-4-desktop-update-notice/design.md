Issue: #4
Branch: `feat/4-desktop-update-notice`

# Desktop Update Notice

## Goal

Tell users when a newer stable Volo AI desktop release is available and give them a safe release/download link.

## Scope

- Check for a new release at app startup without blocking UI rendering, and offer a manual check in Settings.
- Use an in-app banner as the notification surface. This is the working default because no reply arrived to the optional banner-versus-OS-notification question after the 30-second opportunity; it can be revised before approval.
- Do not send OS notifications, automatically download installers, or install updates.
- Check only the stable release returned by the public `az-forge/volo-ai` GitHub Releases API.
- Keep offline startup quiet. A manual check may show an unavailable state.

## Behavior

- Read the installed version with the existing Tauri `getVersion()` API.
- Query `https://api.github.com/repos/az-forge/volo-ai/releases/latest` with a five-second timeout. Record each automatic attempt before making the request, including failed attempts, and run at most one automatic attempt per 24 hours. The Settings action bypasses the cooldown without changing its timestamp.
- Accept only a strict `vMAJOR.MINOR.PATCH` release tag with `draft === false`, `prerelease === false`, and an HTTPS `html_url` whose host and path match the exact GitHub release for that tag.
- Compare numeric major/minor/patch components. Show the banner only when the release is newer than the installed version and its tag has not been dismissed.
- The banner displays the available version, opens the validated release page (which contains notes and platform assets), and can be dismissed. Persist the dismissal for that release tag; a later release appears again.
- Automatic network/parse failures are silent and do not change app readiness or synthesis state. A manual failure shows localized unavailable feedback and can be retried.
- Store only the last automatic-check attempt time and dismissed tag in existing local browser storage. No account, update package, or model data is stored.
- Add a narrow Tauri `connect-src` allowance for `https://api.github.com`. Open the validated release page through the already-installed shell plugin's `open` API and add only the permission needed for that operation.

## Edge cases

- No network, DNS failure, timeout, rate limit, 404, non-2xx response, malformed JSON, invalid version, draft/prerelease, or unsafe release URL → no startup banner; manual checks show unavailable feedback.
- Installed version equal to or newer than latest stable → no update banner.
- A banner dismissed for tag `vX.Y.Z` stays hidden for that tag; a different newer tag is shown.
- Rapid restarts within 24 hours do not repeat automatic checks; manual check bypasses this throttle.
- A failed release-link validation never opens an external URL.
- Development runtime without Tauri version access reports a manual check result as unavailable and does not break Vite UI startup.

## Interfaces

- Add `apps/desktop/src/lib/update-check.ts` with a small typed release parser/comparator and `checkLatestRelease` browser-fetch function.
- Add an app-shell update query that uses Tauri `getVersion()`, starts after first render, and keeps its result independent from provider/model readiness.
- Add a localized in-app banner and a manual check action in Settings > General.
- Add only `https://api.github.com` to Tauri `connect-src` and the existing shell plugin open permission needed for the validated GitHub release URL.

## Verification

- The desktop repository has no frontend test script or test runner. Do not add a dependency or runner for this feature. Verify the production build and use a repeatable manual response matrix with valid older/current/newer tags, malformed/unsafe release data, timeout/offline, cooldown, and dismissal.
- Manually verify English/Vietnamese banner and Settings states, official external link opening, and that no download or install starts.
- Update the architecture wiki after current source and QA establish the behavior.

## Related context

- [Architecture overview](../../../../llm/architecture/overview.md)
