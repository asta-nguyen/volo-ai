# MCP Access to the Volo AI Voice Library plan

## Approved design

- Design: [MCP Access to the Volo AI Voice Library](../specs/2026-09-27-mcp-shared-app-voice-library-design.md)
- The user approved the shared-library direction on 2026-09-27 and asked to improve the remaining gaps.

## Approval Gate

Required: yes

Reason: this changes the behavior of a public MCP tool and spans server code, tests, setup documentation, and the verified wiki; shared-store writes also affect the desktop library.

Status: approved by the user on 2026-09-28

## Decision Log

### D1 — Reuse the app voice library

Question: Should MCP copy profiles into a separate store or use the Volo AI app-data directory?

Decision: Set MCP's existing `TTS_MCP_DATA_DIR` environment variable to the path shown in Volo AI Settings → Storage.

Impact: `list_voices`, generation, `save_voice`, and `delete_voice` use the same SQLite database and files as the desktop app. Saving under an existing profile name replaces it; deleting a profile removes it from the app library.

Confirmed by user: 2026-09-27

### D2 — Reuse the existing MCP tools

Question: Should this add a second generation tool or extend the existing tool?

Decision: Keep the existing `clone` and `list_voices` tools and their parameters; `clone(voice=...)` will support saved Clone and Design profiles.

Impact: Existing external-reference calls remain unchanged; no new MCP tool names, parameters, storage, or migrations are added.

Confirmed by user: 2026-09-27

## Tasks

### 1. Add saved Design profile support to MCP tools

Files:

- `tests/test_server.py` — extend the current MCP protocol and clone coverage.
- `src/tts_mcp/server.py` — update `clone` at lines 59–104 and `list_voices` at lines 146–158.
- Files inspected, no change: `src/tts_mcp/engine.py` at lines 894–950 already returns the supported Clone and Design profile shapes; `apps/desktop/src/lib/sidecar.ts` at line 135 already points the desktop sidecar at Tauri `appDataDir()`.

Interfaces:

- Keep the existing `clone` inputs and output format.
- Use `Engine.load_voice_profile(name)`, which returns `{ "kind": "clone", "prompt": ... }` or `{ "kind": "design", "instruct": ... }`.
- Keep external-reference input on `ref_audio_path` with optional `ref_text`.
- Keep `Engine.list_voices()` as the source of profile names, kinds, language, reference paths, and design instructions.

Change:

1. If `.venv` is missing, create it and install the project using the existing README commands: `rtk python -m venv .venv` and `rtk .venv/bin/python -m pip install -e .`. Use this environment for checks; the global Python currently has MCP 1.27.2 and cannot import the server's MCP SDK v2 module.
2. Add focused tests to `tests/test_server.py` for a saved Clone profile, a saved Design profile, external-reference argument forwarding, and `list_voices` output for both profile kinds.
3. Run the focused MCP tests and confirm the new assertions fail before implementation.
4. Change `clone(voice=...)` to call `engine.load_voice_profile(voice)`. Pass a Clone profile's `prompt` as `voice_clone_prompt`; pass a Design profile's `instruct` as `instruct`. Leave the `ref_audio_path` branch and missing-source error intact.
5. Update the `clone` tool description to say that `voice` accepts either saved profile kind.
6. Format each listed profile with its name, kind, and language. Include `ref_audio` for Clone profiles and `design_instruction` for Design profiles, so the output never presents a Design profile as a missing reference.
7. Run the focused MCP tests until green.

Verify:

```sh
rtk .venv/bin/python -m unittest discover -s tests -p test_server.py -v
```

### 2. Document sharing and tool usage for Codex

Files:

- `README.md` — extend the MCP setup section at lines 30–70.
- Files inspected, no change: `src/tts_mcp/engine.py` at line 22 defines the environment-variable default; `apps/desktop/src/App.tsx` at lines 1034–1041 displays the actual app-data path; official [Codex MCP documentation](https://developers.openai.com/codex/mcp) documents the `codex mcp add --env KEY=VALUE -- ...` form.

Interfaces:

- Continue using the current `tts mcp` stdio command and the existing `TTS_MCP_DATA_DIR` environment variable.
- Use the exact path the app displays under Settings → Storage; do not construct a second profile directory.

Change:

1. Add a Codex CLI example that sets `TTS_MCP_DATA_DIR` with `--env` before `--`, and show the equivalent `[mcp_servers.<name>.env]` TOML table for a server that is already registered.
2. Tell the reader to copy the path from Volo AI Settings → Storage. Explain that omitting the variable keeps the separate `~/.tts-mcp` store.
3. Add agent-call examples for `list_voices`, `clone` with a saved profile name, and `clone` with an external `ref_audio_path` plus optional `ref_text`.
4. State that `save_voice` and `delete_voice` modify the app library when MCP uses the shared path; saving with an existing name replaces that profile.
5. Preserve the existing virtual-environment install steps, Claude setup instructions, and dependency version requirements already present in the working tree.

Verify:

- Review the Markdown examples against the Codex CLI syntax and `TTS_MCP_DATA_DIR` source behavior.
- Confirm the setup text distinguishes the app-data directory from `~/.tts-mcp` and describes the shared-library write effects.

### 3. Run repository verification and hand off wiki update

Files:

- `docs/llm/architecture/overview.md` — update through `document-wiki` after the implementation is verified.
- `docs/llm/workflows/mcp-voice-library.md` — add through `document-wiki` to document the selected end-to-end MCP voice-library workflow.
- `docs/llm/INDEX.md` and `docs/llm/LOG.md` — keep the wiki index and source snapshot record current.

Interfaces:

- Verify the existing MCP protocol, Clone/Design dispatch, and README setup without changing the MCP tool contract.

Change:

1. Run all repository verification commands documented in `AGENTS.md` and inspect their exit codes.
2. Run `review-and-verify` against the implementation diff. Review shared-store overwrite/delete behavior and preserve the pre-existing changes in `README.md`, `pyproject.toml`, and `tests/test_server.py`.
3. After verification, invoke `document-wiki` to update the architecture overview and add a source-backed MCP voice-library workflow page.

Verify:

```sh
rtk .venv/bin/python -m unittest discover -s tests -v
rtk .venv/bin/python -m compileall -q src tests
rtk npm --prefix apps/desktop run build
rtk cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
rtk git diff --check
```

## Review handoff

After Tasks 1–3, run `review-and-verify`. Confirm Clone and Design profiles route to the correct engine arguments, external reference calls remain unchanged, shared-store writes are documented, and pre-existing working-tree changes remain intact. Since MCP profile behavior changes, invoke `document-wiki` after verification to update `docs/llm/architecture/overview.md` and `docs/llm/workflows/mcp-voice-library.md`.
