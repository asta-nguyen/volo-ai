# Verified codebase wiki

## Domains

- [Architecture](architecture/overview.md) — runtime entry points and
  boundaries across the Python engine, sidecar, and Tauri desktop app.
- [MCP voice library](workflows/mcp-voice-library.md) — agent voice generation
  from saved Clone/Design profiles or external reference audio, including the
  shared app-data configuration.
- [Desktop speech providers](workflows/desktop-vieneu.md) — provider selection,
  on-demand asset setup, and VieNeu synthesis through the native audio.cpp CLI.

## Feature inventory

The desktop provider and MCP voice-library workflows have source-backed deep
coverage below. The remaining behaviors are mapped in the architecture overview
but do not yet have dedicated feature pages:

- [x] Desktop provider setup and offline synthesis — the desktop sidecar reports
  both providers, prepares the selected provider on request, and routes synthesis
  to OmniVoice or VieNeu; see the desktop provider workflow.
- [ ] Advanced OmniVoice synthesis — desktop `synthesize` forwards native
  generation controls and duration-based long-form chunking; Voice Design
  remains available through the engine and CLI/MCP entry points.
- [ ] Desktop voice profiles — the desktop provides a dedicated profile library for
  creating Clone profiles from audio or Design profiles from a natural-language
  voice description, then listing, reusing, and deleting them through
  `save_voice`, `save_design_voice`, `list_voices`, and `delete_voice`. SQLite
  stores profile metadata; clone audio/prompts stay under app data while Design
  instructions stay in SQLite. Bundled versioned seed folders are imported on
  setup, and users can import individual audio files or seed folders directly
  from the Voice Profiles view.
- [ ] Desktop settings and interface localization — Settings stores the app
  locale separately from the synthesis language and exposes General, Model,
  and Storage tabs for local engine status and data location.
- [ ] CLI generation and profile management — `tts_mcp/cli.py`.
- [x] MCP voice generation from saved Clone/Design profiles or external
  reference audio — MCP `list_voices` and `clone`; see the shared-store setup
  and profile behavior in the workflow page.

## Sources

- `src/tts_mcp/engine.py`
- `src/tts_mcp/desktop.py`
- `src/tts_mcp/cli.py`
- `src/tts_mcp/server.py`
- `tests/test_server.py`
- `tests/test_engine.py`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/ui.tsx`
- `apps/desktop/src/lib/utils.ts`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src/lib/sidecar.ts`
