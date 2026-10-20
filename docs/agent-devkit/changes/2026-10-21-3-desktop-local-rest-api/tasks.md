# Desktop Local REST API tasks

Issue: #3
Branch: `feat/3-desktop-local-rest-api`

## Design

[Desktop Local REST API](design.md)

## Global Constraints

- Bind only to `127.0.0.1:8765`; the API is manually enabled, off by default, and stops with the desktop app.
- Match current MCP capabilities and reuse their validation, provider, profile, and data-store behavior.
- Keep model preparation explicit; return JSON results and structured non-2xx errors.
- Cap JSON request bodies at 1 MiB and return HTTP 413 for oversized requests.
- No token is required by user choice; reject non-loopback Host values, browser Origin requests, and non-JSON bodies, and emit no CORS allow headers.
- Do not permit LAN/remote access or add a second persistence layer.
- Prefer the standard library and add no dependency unless needed to meet the approved contract.

## Impact map

Entry: no existing source; planned entry: `src/tts_mcp/api.py::ApiServer` and `apps/desktop/src/App.tsx::SettingsView` Start/Stop controls (pending approval)
Flow: no existing flow; planned flow: Settings Start → `SidecarClient` JSONL `start_api` → `dispatch_request` → `ApiServer` on a separate HTTP thread → existing MCP functions and Engine/providers; HTTP Stop → sidecar shutdown (pending approval)
State changes: existing synthesis files, model assets, and saved voice-profile data may change through the matching MCP function; server start state is process-local and is not restored on next app launch (pending approval)
External effects: loopback HTTP requests; explicit model downloads through existing provider functions; filesystem reads/writes and voice-profile deletion through existing MCP functions (pending approval)
Change candidates: new `src/tts_mcp/api.py::ApiServer`, `src/tts_mcp/desktop.py::dispatch_request`, `tests/test_api.py`, `tests/test_desktop.py`, `apps/desktop/src/lib/sidecar.ts::SidecarClient`, `apps/desktop/src/App.tsx::SettingsView`, `apps/desktop/src/lib/i18n.ts`, new `docs/desktop-local-api.md`, `docs/llm/architecture/overview.md`, `docs/llm/INDEX.md` (pending approval)
Verification: focused API/desktop tests; full Python suite; Python compile check; desktop build; curl checks for every route and loopback/security/lifecycle behavior (pending approval)
Verified at: `2a96ee839635f5ca76126eddcd2731c436a63158`

## Tasks

### Task 1 — [Python API] Add REST routes and trust-boundary checks

Files: `src/tts_mcp/api.py::ApiServer`, `src/tts_mcp/server.py::status`, `src/tts_mcp/server.py::prepare_model`, `src/tts_mcp/server.py::speak`, `src/tts_mcp/server.py::clone`, `src/tts_mcp/server.py::design`, `src/tts_mcp/server.py::list_voices`, `src/tts_mcp/server.py::save_voice`, `src/tts_mcp/server.py::delete_voice`, `tests/test_api.py::ApiServerTests`

Interfaces: Add the eight `/api/v1` routes from the design. Return `{"result": ...}` on success and `{"error":{"code":...,"message":...}}` on non-2xx errors; return HTTP 413 above the 1 MiB request-body limit and list voices as structured profile records.

Change: Use a separate standard-library threaded HTTP listener on `127.0.0.1` and the fixed port `8765`. Dispatch to existing MCP functions. Validate method, route, JSON body type/size, and Host before operation dispatch; reject every request with an Origin header; emit no CORS allow headers. Keep model preparation explicit and preserve existing MCP argument semantics.

Verify: `rtk .venv/bin/python -m unittest discover -s tests -p test_api.py -v` passes. Each MCP-equivalent route returns its expected result; malformed JSON, invalid arguments, oversized body, unknown route, and operation errors return structured non-2xx JSON; bad Host, any Origin, and unsupported body content type never call the tool function; successful calls invoke the matching existing function once.

Progress: todo
Result: none

### Task 2 — [Sidecar lifecycle] Start and stop the local API from Settings

Files: `src/tts_mcp/desktop.py::dispatch_request`, `src/tts_mcp/desktop.py::run_protocol`, `tests/test_desktop.py::DesktopWorkerTests`, `apps/desktop/src/lib/sidecar.ts::SidecarClient`, `apps/desktop/src/App.tsx::SettingsView`, `apps/desktop/src/lib/i18n.ts::createUiCopy`

Interfaces: Add `start_api`, `stop_api`, and `api_status` JSONL operations and typed client methods. Return the fixed base URL and running/error state.

Change: Keep one server per sidecar process. Start only on user action, make Stop idempotent, report port conflicts, stop the listener during sidecar shutdown, and add localized Start/Stop/status/error/Copy URL help in the existing MCP settings view. Show the documented no-token local-process risk.

Verify: `rtk .venv/bin/python -m unittest discover -s tests -p test_desktop.py -v` and `rtk npm --prefix apps/desktop run build` pass. Lifecycle tests verify off-by-default, start, repeated stop, port conflict, and shutdown; manual curl check verifies API calls work after Start and fail after Stop/app shutdown.

Progress: todo
Result: none

### Task 3 — [Docs] Document local API callers and verified architecture

Files: new `docs/desktop-local-api.md`, `docs/llm/architecture/overview.md::Runtime boundaries`, `docs/llm/architecture/overview.md::Domains`, `docs/llm/INDEX.md::Feature inventory`

Interfaces: Document the route/method/body/response contract, fixed base URL, curl examples, timeouts, and accepted no-token loopback trust boundary.

Change: After Tasks 1–2 pass, document only behavior established by implementation and tests. Explain that the API is opt-in, host-local, and process-local; link the API page from the wiki index.

Verify: Run the `document-wiki` task-update procedure and its wiki validator. Confirm all route examples match the live handlers and all internal links/source paths resolve.

Progress: todo
Result: none

## Files inspected, no change

- `src/tts_mcp/server.py` — the existing MCP tool set and arguments.
- `src/tts_mcp/desktop.py` — JSONL dispatch and sidecar lifecycle.
- `apps/desktop/src/lib/sidecar.ts` — sidecar startup and request contract.
- `apps/desktop/src/App.tsx::SettingsView` — existing MCP setup surface.
- `docs/llm/architecture/overview.md` — current runtime and provider boundaries.
- `docs/llm/workflows/mcp-voice-library.md` — shared profile behaviors.
- `docs/llm/workflows/desktop-vieneu.md` — provider behavior and model preparation.

## Baseline

- 2026-10-21 before feature code: `.venv/bin/python -m unittest discover -s tests -v` passed all 152 tests; `.venv/bin/python -m compileall -q src tests` passed; desktop production build passed with the existing large-chunk warning.
- The shell's global Python 3.10 has `mcp==1.27.2` and fails to collect `tests/test_server.py`; use the repository `.venv` for Python checks.

## Approval Gate

Status: approved

## Decision Log

None.
