# Volo AI / tts-mcp

## Purpose

This repository contains the local OmniVoice TTS engine exposed through a
terminal CLI, an MCP server, and a Volo AI Tauri desktop app.

## Layout

- `src/tts_mcp/`: Python engine, audio conversion, CLI, MCP server, and the
  JSONL desktop sidecar.
- `apps/desktop/`: React + TypeScript UI and Tauri 2 shell.
- `scripts/`: sidecar packaging helpers.
- `tests/`: stdlib `unittest` coverage for engine, conversion, and sidecar
  protocol.
- `docs/agent-devkit/`: approved feature specs and execution plans.
- `docs/llm/`: source-grounded codebase wiki.

## Runtime requirements

- Python 3.10 or newer.
- Node.js 20 or newer.
- Rust toolchain for Tauri.
- FFmpeg for MP3 export during source development; release sidecars bundle it.

## Verified commands

```sh
python -m unittest discover -s tests -v
python -m compileall -q src tests
npm --prefix apps/desktop run build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

The desktop sidecar uses newline-delimited JSON on stdin/stdout and writes
diagnostic logs to stderr. Model assets and generated audio live in the
directory selected by `TTS_MCP_DATA_DIR`; packaged apps use their Tauri app
data directory.

## Code intelligence

OpenEZ is indexed for this repository. Prefer MCP tools
(`code_query`, `code_context`, `graph_neighbors`) for semantic code
questions. Use `memory_recall` for previously recorded decisions.
Fall back to direct file reads and `rg` when OpenEZ is unavailable.

## Skills

- `brainstorm-feature`: `.agents/skills/brainstorm-feature/SKILL.md`
- `context-handoff`: `.agents/skills/context-handoff/SKILL.md`
- `document-wiki`: `.agents/skills/document-wiki/SKILL.md`
- `estimate-feature`: `.agents/skills/estimate-feature/SKILL.md`
- `implement-task`: `.agents/skills/implement-task/SKILL.md`
- `plan-feature`: `.agents/skills/plan-feature/SKILL.md`
- `read-codebase-context`: `.agents/skills/read-codebase-context/SKILL.md`
- `review-and-verify`: `.agents/skills/review-and-verify/SKILL.md`
- `setup-codebase`: `.agents/skills/setup-codebase/SKILL.md`
- `setup-openez`: `.agents/skills/setup-openez/SKILL.md`
- `systematic-debugging`: `.agents/skills/systematic-debugging/SKILL.md`
- `using-devkit`: `.agents/skills/using-devkit/SKILL.md`

## Documentation

The verified codebase wiki is at `docs/llm/INDEX.md`.

For behavior, workflow, or domain questions:

1. Read `docs/llm/INDEX.md`.
2. Open the relevant wiki page.
3. Verify important claims against current source and tests.

The wiki describes verified behavior only; source and tests remain
authoritative.
