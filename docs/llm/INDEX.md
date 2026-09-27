# Verified codebase wiki

## Domains

- [[architecture/overview|Architecture]] — runtime entry points and
  boundaries across the Python engine, sidecar, and Tauri desktop app.

## Feature inventory

Deep feature pages have not been selected yet. Current source establishes
these user-facing areas for a future documentation pass:

- [~] Local model setup and offline synthesis — desktop sidecar requests
  `status`, `prepare_model`, and `synthesize`.
- [~] Advanced OmniVoice synthesis — desktop `synthesize` forwards native
  generation controls and duration-based long-form chunking; Voice Design
  remains available through the engine and CLI/MCP entry points.
- [~] Voice profiles — the desktop provides a dedicated profile library for
  creating Clone profiles from audio or Design profiles from a natural-language
  voice description, then listing, reusing, and deleting them through
  `save_voice`, `save_design_voice`, `list_voices`, and `delete_voice`. SQLite
  stores profile metadata; clone audio/prompts stay under app data while Design
  instructions stay in SQLite. Bundled versioned seed folders are imported on
  setup, and users can import individual audio files or seed folders directly
  from the Voice Profiles view.
- [~] Desktop settings and interface localization — Settings stores the app
  locale separately from the synthesis language and exposes General, Model,
  and Storage tabs for local engine status and data location.
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
