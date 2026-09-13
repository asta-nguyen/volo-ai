# Verified codebase wiki

## Domains

- [[architecture/overview|Architecture]] — runtime entry points and
  boundaries across the Python engine, sidecar, and Tauri desktop app.

## Feature inventory

Deep feature pages have not been selected yet. Current source establishes
these user-facing areas for a future documentation pass:

- [~] Local model setup and offline synthesis — desktop sidecar requests
  `status`, `prepare_model`, and `synthesize`.
- [~] Advanced OmniVoice synthesis and Voice Design — desktop `synthesize`
  forwards native generation controls and duration-based long-form chunking.
- [~] File-based voice cloning and saved profiles — the desktop provides a
  dedicated profile library for creating, listing, reusing, and deleting local
  profiles through `save_voice`, `list_voices`, and `delete_voice`.
- [~] Desktop settings and interface localization — Settings stores the app
  locale separately from the synthesis language.
- [~] CLI and MCP generation — `tts_mcp/cli.py` and `tts_mcp/server.py`.

## Sources

- `src/tts_mcp/engine.py`
- `src/tts_mcp/desktop.py`
- `src/tts_mcp/cli.py`
- `src/tts_mcp/server.py`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/ui.tsx`
- `apps/desktop/src/lib/utils.ts`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src/lib/sidecar.ts`
