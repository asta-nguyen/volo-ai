# Delta: MCP VieNeu sampler config

Merged into docs/llm/: 2026-10-16

## ADDED Requirements

### VLIB-vieneu-sampler-config

Page: `docs/llm/workflows/mcp-voice-library.md`

Search: checked every VLIB requirement in `mcp-voice-library.md` and the DVP sampler requirement in `desktop-vieneu.md`; none covers `vieneu_config` on MCP `speak` or `clone`.

Requirement:

````md
### VLIB-vieneu-sampler-config

VieNeu MCP `speak` and `clone` SHALL accept an optional `vieneu_config` object with the desktop's VieNeu sampler fields, forward it only to VieNeu synthesis, and reject it for OmniVoice.

#### Scenario: set a sampler seed

- GIVEN a caller invokes VieNeu `speak` or `clone` with `vieneu_config={"seed": 1234}`
- WHEN the request is synthesized
- THEN the provider receives that config and maps it to audio.cpp request options

#### Scenario: reject OmniVoice or invalid configuration

- GIVEN a caller supplies `vieneu_config` to OmniVoice or supplies an invalid VieNeu value
- WHEN the request is validated
- THEN it fails before the OmniVoice engine or audio.cpp is invoked

Evidence: `src/tts_mcp/server.py`, `src/tts_mcp/desktop_vieneu.py`, `tests/test_server.py`, `tests/test_desktop_vieneu.py`
````
