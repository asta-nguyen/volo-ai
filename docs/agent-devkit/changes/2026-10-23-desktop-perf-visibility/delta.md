# Delta

## ADDED Requirements

### DVP-synthesis-execution

Page: `docs/llm/workflows/desktop-vieneu.md`
Search: checked every page with prefix DVP and the DVT page; no existing
requirement covers sidecar synthesis concurrency or cancelable lock waits —
`DVT-concurrency-cancellation` covers transcription only.

Requirement:

````md
### DVP-synthesis-execution

The desktop sidecar SHALL run each `synthesize` request on a worker thread
so the request loop stays responsive during rendering, and SHALL serialize
provider execution through the provider locks. A `cancel` request SHALL
abort a synthesis that is still waiting for its provider lock, while a
render in flight completes uninterrupted.

#### Scenario: status during rendering

- GIVEN a `synthesize` request is rendering on a worker
- WHEN a `status` or `list_voices` request arrives
- THEN the loop answers it without waiting for the render

#### Scenario: cancel a queued synthesis

- GIVEN a `synthesize` request is waiting for its provider lock
- WHEN a `cancel` request names its id
- THEN the waiting request raises cancellation and answers `cancelled`

#### Scenario: render in flight is not interrupted

- GIVEN a `synthesize` request has acquired its provider lock
- WHEN a `cancel` request names its id
- THEN the render continues to completion and answers normally

Evidence: `src/tts_mcp/desktop.py`, `src/tts_mcp/engine.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_desktop.py`
````

## MODIFIED Requirements

### DVP-provider-status

Previously: reported readiness, presets, and default voice only.

Baseline:

````md
### DVP-provider-status

The desktop sidecar SHALL report model readiness separately from runtime and
preprocessing availability and include VieNeu presets and its default voice
from a valid local manifest.

#### Scenario: inspect provider status

- GIVEN VieNeu has a valid local manifest
- WHEN the UI requests `status`
- THEN the response includes VieNeu preset entries and the default preset,
  independently of runtime and model readiness

Evidence: `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_desktop.py`, `tests/test_desktop_vieneu.py`
````

Replacement:

````md
### DVP-provider-status

The desktop sidecar SHALL report model readiness separately from runtime and
preprocessing availability and include VieNeu presets and its default voice
from a valid local manifest. It SHALL also report each provider's compute
backend — OmniVoice's detected device and VieNeu's CPU-only backend — and
best-effort engine resource usage (peak process RSS, plus GPU memory only
while a model is loaded) without triggering a model load.

#### Scenario: inspect provider status

- GIVEN VieNeu has a valid local manifest
- WHEN the UI requests `status`
- THEN the response includes VieNeu preset entries and the default preset,
  independently of runtime and model readiness

#### Scenario: inspect backend and memory

- GIVEN the sidecar is running
- WHEN the UI requests `status`
- THEN the response reports the OmniVoice backend, the VieNeu `cpu` backend,
  and the engine's peak RSS, with GPU memory null until a model is loaded

Evidence: `src/tts_mcp/desktop.py`, `src/tts_mcp/engine.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_desktop.py`, `tests/test_desktop_vieneu.py`
````
