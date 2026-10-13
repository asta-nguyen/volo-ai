# Delta: VieNeu generation controls

Merged into docs/llm/: 2026-10-13

## ADDED Requirements

### DVP-vieneu-generation-config

Page: `docs/llm/workflows/desktop-vieneu.md`

Search: checked all DVP requirements in `desktop-vieneu.md`; none covers per-request VieNeu sampler settings or their separation from OmniVoice configuration.

````markdown
### DVP-vieneu-generation-config

The desktop SHALL keep VieNeu generation settings separate from OmniVoice settings, validate the VieNeu sampler fields, and forward them only as VieNeu audio.cpp request options.

#### Scenario: configure VieNeu sampling

- GIVEN the user selects VieNeu and changes one or more sampler controls
- WHEN the app synthesizes speech
- THEN it sends only the changed VieNeu values in `vieneu_config`, which the sidecar maps to `--request-option` arguments

#### Scenario: reject cross-provider or invalid configuration

- GIVEN a request supplies `vieneu_config` to OmniVoice or supplies an invalid VieNeu value
- WHEN the sidecar validates the synthesis request
- THEN it returns `invalid_input` before invoking synthesis

Evidence: `apps/desktop/src/App.tsx`, `apps/desktop/src/lib/sidecar.ts`, `src/tts_mcp/desktop.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_desktop.py`, `tests/test_desktop_vieneu.py`
````
