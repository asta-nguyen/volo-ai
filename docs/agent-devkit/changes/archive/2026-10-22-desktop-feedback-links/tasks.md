# Desktop Feature Feedback Links tasks

## Design

[Desktop Feature Feedback Links](design.md)

## Global Constraints

- Feature suggestions use public GitHub Discussions for `az-forge/volo-ai`; users sign in to post, vote, or star.
- The app opens only the fixed Ideas-category and repository URLs in addition to the existing validated release URL.
- The app does not send GitHub API requests, store feedback, or collect GitHub credentials.
- Keep the UI copy available in English and Vietnamese.

## Impact map

Entry: `apps/desktop/src/App.tsx::SettingsView` community card actions
Flow: Settings > General action → `apps/desktop/src/App.tsx::App` Tauri shell open → system browser → GitHub Ideas category or repository page
State changes: none in the app
External effects: open fixed public GitHub pages in the system browser; posting, voting, and starring occur only after the user chooses to interact on GitHub
Change candidates: `apps/desktop/src/App.tsx::SettingsView`, `apps/desktop/src/App.tsx::App`, `apps/desktop/src/lib/i18n.ts::createUiCopy`, `apps/desktop/src-tauri/tauri.conf.json::plugins.shell.open`, GitHub repository settings for `az-forge/volo-ai`, `docs/llm/architecture/overview.md`, and `docs/llm/INDEX.md`
Verification: desktop production build, Tauri config check, manual Tauri link and locale QA, GitHub Discussions API/category check, and `document-wiki` task update
Verified at: `47e9b32232badb104b3c40735ed7215b2f4ce6f9`

The working tree already contains user edits in `App.tsx`, `tauri.conf.json`, `capabilities/default.json`, `AudioPlayer.tsx`, `docs/llm/architecture/overview.md`, and `docs/agent-devkit/INDEX.md`. These were read where relevant and must be preserved.

## Tasks

### Task 1 — Enable the public Ideas forum

Files: GitHub repository settings for `az-forge/volo-ai` (external, not versioned)

Interfaces: Enable the GitHub Discussions destination consumed by Task 2 and create the `Ideas` category with the open-ended discussion format.

Change: Enable Discussions for the public repository and create a public `Ideas` category for feature suggestions. Do not create a discussion or poll as part of setup. The current repository API reports `has_discussions: false`.

Verify: The public repository API reports `has_discussions: true`; `https://github.com/az-forge/volo-ai/discussions/categories/ideas` opens the Ideas category and its new-discussion action targets that category. Do not create a public post during verification.

Progress: done
Result: GitHub CLI enabled Discussions; GraphQL confirms Ideas (slug ideas, isAnswerable false); the public Ideas URL returned HTTP 200. No discussion was posted.

### Task 2 — Add localized Settings links with a narrow external-open scope

Files: `apps/desktop/src/App.tsx::SettingsView`, `apps/desktop/src/App.tsx::App`, `apps/desktop/src/lib/i18n.ts::createUiCopy`, `apps/desktop/src-tauri/tauri.conf.json::plugins.shell.open`

Interfaces: Use the Ideas category created in Task 1, the fixed repository URL, the existing `shellOpen` API, and the already granted `shell:allow-open` capability.

Change: Add the localized community card to Settings > General with the public-submission notice and separate `Suggest a feature` and `Star Volo AI` actions. Open the exact Ideas and repository URLs with the system browser. Catch open failures and record diagnostics using the existing release-link pattern. Extend the Tauri shell URL scope only for those destinations while retaining the existing release URL rule. Preserve the current uncommitted audio-player and Linux AppImage changes in files this task touches.

Verify: `rtk npm --prefix apps/desktop run build` and `rtk cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` pass. Manual Tauri QA in English and Vietnamese verifies the notice and both destinations, confirms Settings remains usable after an open failure, and confirms the existing update-release link still opens. Review the Tauri scope to confirm it allows only the two fixed URLs plus the existing release pattern, not other GitHub paths.

Progress: done
Result: Desktop build, cargo check, and a debug macOS app bundle passed. Native Tauri QA showed both EN/VI notices and buttons; actual clicks opened the Ideas category and repository in Brave. Source-extracted handler checks passed for both destinations and opener rejection diagnostics; 16 shell-policy accept/reject cases passed. The unchanged update-release handler and its valid URL were checked against the new policy; no newer-release banner was available for a live banner click.

### Task 3 — Document the verified feedback links

Files: `docs/llm/architecture/overview.md::Domains`, `docs/llm/INDEX.md::Feature inventory`

Interfaces: Document only behavior established by Tasks 1 and 2; preserve the existing user edits in the architecture overview.

Change: Use `document-wiki`'s task-update procedure to describe the public Discussions destination, the separate manual Star link, the GitHub sign-in requirement, the fixed external destinations, and the absence of app-side feedback storage or API calls.

Verify: The wiki task update completes its source and link validation with no stale claims or broken internal links.

Progress: done
Result: Architecture overview and wiki inventory updated from current source. Wiki validator passed: 7 Markdown files, 37 requirements, 0 errors/warnings. git diff --check passed.

## Files inspected, no change

- `apps/desktop/src-tauri/capabilities/default.json` — already grants the shell-open capability required by the existing release link.
- `apps/desktop/src/lib/update-check.ts` — validates release URLs before the existing release link opens; this behavior remains unchanged.
- `apps/desktop/src-tauri/Cargo.toml` — the Tauri shell plugin is already installed.
- `docs/llm/AGENTS.md` — instructions for maintaining the verified wiki.

## Baseline

- Before source edits: desktop production build passed with the existing chunk-size warning; cargo check passed.

## Final verification

- Python unittest suite: 242 tests passed; compileall passed.
- Desktop production build and cargo check passed; debug macOS app bundle built and exercised through native UI.
- Ideas category HTTP 200; new-discussion link selects category=ideas. No public discussion or Star was created.
- The existing Vite large-chunk warning remains.
- No commit or push was performed; unrelated user changes and staging were preserved.

## Approval Gate

Status: approved

Approved by user on 2026-10-22: “implement task đi”, after both design and tasks were presented. Approval includes GitHub Discussions setup and desktop implementation through review.

## Decision Log

None.
