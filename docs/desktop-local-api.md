# Desktop Local REST API

Volo AI exposes its existing TTS and voice-profile operations to local scripts
through an opt-in HTTP API. Open **Settings > MCP** in the desktop app and
press **Start API** before making requests. The API is off after app startup and
stops when the desktop sidecar exits.

## Base URL and trust boundary

The API listens only at `http://127.0.0.1:8765`. It has no token by design, so
any process on the same computer that can reach the port can use its synthesis
and profile operations, including deleting a saved profile and writing audio
to a caller-selected path. Start it only while local callers need it, then
press **Stop API** in Settings.

The server rejects requests carrying an `Origin` header, missing, malformed,
or non-loopback `Host` values, and body-bearing requests without
`Content-Type: application/json`.
It does not enable CORS. These checks limit browser access; they do not
authenticate other local processes.

## Routes

All request and response bodies are JSON. Successful responses use
`{"result": ...}`. Errors use a non-2xx status and
`{"error":{"code":"...","message":"..."}}`. JSON request bodies are
limited to 1 MiB.

| Method | Path | Request body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/v1/status` | — | Existing provider and runtime status |
| `POST` | `/api/v1/prepare_model` | MCP `prepare_model` arguments, including `provider` | Preparation result for the selected provider |
| `POST` | `/api/v1/speak` | MCP `speak` arguments | Generated audio result |
| `POST` | `/api/v1/clone` | MCP `clone` arguments | Generated audio result |
| `POST` | `/api/v1/design` | MCP `design` arguments | Generated audio result |
| `GET` | `/api/v1/voices` | — | `{"voices":[...]}` with structured saved-profile records |
| `POST` | `/api/v1/voices` | MCP `save_voice` arguments | Saved profile result |
| `DELETE` | `/api/v1/voices/{name}` | — | Existing profile-deletion result |

The synthesis and profile routes use the same argument names, defaults,
providers, validation, and data directory as their MCP tools. For example, a
caller can request default-provider speech with:

```sh
curl --max-time 3600 -X POST http://127.0.0.1:8765/api/v1/speak \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello from Volo AI.","output_path":"/tmp/hello.wav"}'
```

Use an explicit request timeout for model preparation and synthesis. A client
timeout does not cancel an operation already running in the desktop sidecar.
Model downloads happen only through `POST /api/v1/prepare_model`; synthesis
does not prepare models automatically.

To list existing profiles:

```sh
curl http://127.0.0.1:8765/api/v1/voices
```

To remove a profile, URL-encode its name as one path segment:

```sh
curl -X DELETE 'http://127.0.0.1:8765/api/v1/voices/demo%20voice'
```

The `status` result contains the existing MCP status fields. Field availability
depends on provider and runtime state.
