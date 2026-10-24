# Delta

Merged into docs/llm/: 2026-10-24

Issue: 15
Approved: 2026-10-24 — expose Logs during first-run setup and enrich exported failed-request diagnostics

## MODIFIED Requirements

### DSET-local-diagnostics

Previously: bounded local diagnostic history and a user-triggered, redacted export.

Baseline:

````md
### DSET-local-diagnostics

The desktop app SHALL keep bounded local diagnostic events and export a
home-path-redacted report only after the user chooses Export.

#### Scenario: A user exports an error report

- GIVEN local desktop errors or runtime events have been recorded
- WHEN the user exports diagnostics from Logs
- THEN the saved JSON contains app, platform, runtime, and error details without request payloads, synthesized text, audio, or voice content

Evidence: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/diagnostics.ts`, `apps/desktop/src/lib/sidecar.ts`, `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_diagnostics.py`, `tests/test_desktop_diagnostics.py`
````

Replacement:

````md
### DSET-local-diagnostics

The desktop app SHALL retain bounded local diagnostic events, make Logs and user-triggered export available from first-run setup before providers are ready, and include sanitized failed-request context in home-path-redacted reports without request payloads or generated content.

#### Scenario: Open Logs during setup

- GIVEN one or more providers are not ready or the sidecar is unavailable
- WHEN the user opens Logs from first-run setup
- THEN the app opens Logs and allows an explicit export, using a frontend-only report marked incomplete when the sidecar cannot respond

#### Scenario: Export a failed request

- GIVEN a failed request has diagnostic details
- WHEN the user chooses Export
- THEN the report includes its timestamp, operation, request ID, provider and last-known setup stage or asset when available, error code, sanitized error message, elapsed time, and sanitized stack details, while excluding request payloads, synthesized text, audio, and voice content

Evidence: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/diagnostics.ts`, `apps/desktop/src/lib/sidecar.ts`, `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_diagnostics.py`, `tests/test_desktop_diagnostics.py`
````
