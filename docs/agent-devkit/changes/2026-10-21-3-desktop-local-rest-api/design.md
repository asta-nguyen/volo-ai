Issue: #3
Branch: `feat/3-desktop-local-rest-api`

# Desktop Local REST API

## Goal

Let local scripts and applications call Volo AI's existing TTS and voice-profile capabilities through an opt-in REST API.

## Scope

- Add a versioned JSON REST API at `http://127.0.0.1:8765/api/v1`.
- Start and stop it manually from Settings > MCP. It is off by default and stops when the desktop app closes.
- Match all current MCP tool capabilities: `status`, `prepare_model`, `speak`, `clone`, `design`, `list_voices`, `save_voice`, and `delete_voice`.
- Reuse the existing MCP functions, providers, profile store, and configured data directory. Do not add a second database or a separate synthesis implementation.
- Do not add an API token, per the user's choice. Strictly bind to IPv4 loopback, validate the Host header, reject browser Origin requests, require JSON for body-bearing routes, and send no permissive CORS headers.
- Document that any process on the same machine can call all enabled routes, including voice deletion and synthesis with caller-selected file paths.
- Do not add LAN or remote access, MCP-over-HTTP, automatic startup, or a new dependency unless the standard library cannot safely satisfy this contract.

## Behavior

- The API is started only after the user presses Start in Settings > MCP. The UI displays the listening URL and current running/error state, and offers Stop. It is not restored automatically on the next app launch.
- The server binds only `127.0.0.1:8765`. If the port is occupied, Start fails with a localized actionable message; the app does not silently select a different port.
- Provide these operations:
  - `GET /api/v1/status`
  - `POST /api/v1/prepare_model`
  - `POST /api/v1/speak`
  - `POST /api/v1/clone`
  - `POST /api/v1/design`
  - `GET /api/v1/voices`
  - `POST /api/v1/voices`
  - `DELETE /api/v1/voices/{name}`
- Synthesis and profile requests use the corresponding MCP argument names and behavior. Model downloads remain explicit through `prepare_model`; synthesis does not silently prepare a provider.
- Successful responses are JSON under `result`. Errors use a non-2xx status and `error: {code, message}`. `GET /api/v1/voices` returns structured voice-profile records.
- The sidecar owns the server lifecycle; Start/Stop/Status requests travel over the existing JSONL process connection. The HTTP server runs separately from that input loop so a request does not consume the JSONL protocol stream.
- Any request carrying an `Origin` header is rejected. Requests with a non-loopback Host or a non-JSON body are rejected. The service emits no CORS allow headers.

## Edge cases

- Port already occupied → return a structured start failure and show the configured URL and error; never fall back to LAN or an implicit alternate port.
- Desktop sidecar stops or the app closes → shut down the HTTP listener and reject new calls.
- Limit JSON request bodies to 1 MiB; return HTTP 413 when the declared or received body exceeds the limit.
- Invalid JSON, unknown method/path, invalid MCP arguments, model/provider failures, and filesystem failures → return bounded JSON errors without a traceback or request payload in the response.
- A malformed Host, any browser Origin, and unsupported content type → reject before dispatching synthesis or profile mutations.
- Slow model preparation and synthesis may take a long time; the HTTP request remains synchronous and reports the existing operation result/error when it completes. Client timeout behavior is documented.
- With no token, every local process that can reach the loopback port is trusted to invoke mutating operations. This accepted risk is documented in Settings and API docs.

## Interfaces

- `src/tts_mcp/api.py::ApiServer` owns the HTTP routes, request validation, error mapping, and loopback listener. Prefer `http.server.ThreadingHTTPServer` from the standard library and call the existing MCP tool functions instead of duplicating synthesis logic.
- Add JSONL `start_api`, `stop_api`, and `api_status` operations to `src/tts_mcp/desktop.py::dispatch_request`. Keep one server instance per sidecar process and make stop idempotent.
- Extend `SidecarClient` with typed API lifecycle calls. Add running state, Start/Stop controls, URL copy/help, and localized error states under the existing Settings > MCP view.
- Add `docs/desktop-local-api.md` with route schemas, curl examples, long-request guidance, and the no-token loopback trust boundary.

## Verification

- Add Python `unittest` coverage for each route, existing tool reuse, JSON success/error shape, argument validation, body-size limit, invalid path/method, Host/Origin/content-type rejection, start/stop, port conflict, and listener shutdown.
- Run focused API/desktop tests, the full Python suite, Python compile check, and desktop production build.
- Manually start the API in the desktop app, call each operation with curl, stop it, verify the port no longer accepts requests, and confirm it is reachable only through `127.0.0.1` from the host.
- Update the architecture wiki after source and tests verify the behavior.

## Related context

- [Architecture overview](../../../llm/architecture/overview.md)
- [MCP voice library](../../../llm/workflows/mcp-voice-library.md)
- [Desktop speech providers](../../../llm/workflows/desktop-vieneu.md)
