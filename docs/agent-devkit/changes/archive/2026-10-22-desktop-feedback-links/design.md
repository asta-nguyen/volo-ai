# Desktop Feature Feedback Links

## Goal

Give Volo AI desktop users a clear way to submit public feature ideas and support the project on GitHub.

## Scope

- Add a community card to Settings > General with separate actions for suggesting a feature and starring Volo AI.
- Send feature suggestions to the public `Ideas` category in GitHub Discussions. State that ideas are public and users need a GitHub account to post or vote.
- Send the Star action to the public repository page. The user signs in and stars the repository themselves.
- Localize labels and explanatory copy in English and Vietnamese.
- Before release, enable GitHub Discussions for `az-forge/volo-ai` and create an open-ended `Ideas` category. The GitHub API currently reports `has_discussions: false`.
- Keep the feature in the desktop app. No website changes, app account, OAuth flow, backend, in-app voting, star count, or locally stored feedback.

## Behavior

- Settings > General displays one community card with `Suggest a feature` and `Star Volo AI` actions, plus a short notice that feature ideas are public on GitHub and GitHub sign-in is required to post, vote, or star.
- `Suggest a feature` opens `https://github.com/az-forge/volo-ai/discussions/categories/ideas` in the system browser.
- `Star Volo AI` opens `https://github.com/az-forge/volo-ai` in the system browser. The app does not modify the user's GitHub account or report whether they starred the repository.
- Reuse the installed Tauri shell plugin and its existing external-open flow. Extend its allowlist only for the two exact destinations above while preserving the existing validated release URL rule.
- If opening either URL fails, record a frontend diagnostic using the existing release-link error pattern; leave Settings available so the user can try again.
- The app makes no GitHub API request and sends no local app data. Posting, voting, and starring happen only after the user chooses to interact with GitHub.

## Edge cases

- Discussions are disabled now; the Ideas link must not ship until Discussions is enabled and the category exists.
- If the user is not signed in, GitHub handles sign-in before posting, voting, or starring. The app does not collect credentials.
- If GitHub is unreachable, the system browser shows its normal network or GitHub error state; the user can retry from Settings.
- If Tauri rejects an external URL or the system browser cannot open it, record a diagnostic and do not change app state.
- The Tauri shell allowlist must continue rejecting other GitHub paths, including arbitrary issue, pull request, and release URLs not already accepted by the current release rule.

## Interfaces

- Desktop UI: `apps/desktop/src/App.tsx::SettingsView` renders the actions and `apps/desktop/src/App.tsx::App` opens their fixed URLs with the existing shell plugin.
- Localization: `apps/desktop/src/lib/i18n.ts::createUiCopy` supplies English and Vietnamese labels and the public-submission notice.
- Tauri policy: `apps/desktop/src-tauri/tauri.conf.json::plugins.shell.open` allows only the two fixed destinations in addition to the existing validated release URL pattern. The existing shell-open capability remains in use.
- GitHub repository setup: enable Discussions and create the public `Ideas` category for `az-forge/volo-ai`.
- Persistence and network: none in the app.

## Verification

- `rtk npm --prefix apps/desktop run build` passes.
- `rtk cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` passes and accepts the updated Tauri shell configuration.
- Manual Tauri QA in English and Vietnamese verifies the public notice and both buttons, opens the Ideas page and repository page in the system browser, and confirms the existing update-release link still opens.
- Verify the repository API reports `has_discussions: true` and the Ideas category URL resolves before release.
- After source checks, update and verify the architecture wiki through `document-wiki`'s task-update procedure.
- No `delta.md` is needed: the wiki has no feature-feedback requirement page; implementation will update the existing architecture coverage.

## Related context

- [Architecture overview](../../../../llm/architecture/overview.md)
