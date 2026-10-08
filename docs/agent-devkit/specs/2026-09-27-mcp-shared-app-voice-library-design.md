# MCP Access to the Volo AI Voice Library

## Classification

Architectural: the standalone MCP process and desktop sidecar currently use different data directories. Making desktop profiles available to agents crosses the MCP, engine, and desktop storage boundary.

## Problem

Volo AI stores voice profiles in its Tauri app-data directory, while the standalone MCP server defaults to `~/.tts-mcp`. An agent can use a saved Clone profile only when that profile exists in the MCP server's selected data directory. The MCP `clone` tool also rejects saved Design profiles, even though the engine can load both profile kinds.

## Goal

Let an MCP agent generate speech with a voice saved in Volo AI or with an external reference audio file, using the existing MCP tools and the same local voice library as the desktop app.

## Verified baseline

- The MCP stdio server initializes, lists its six tools, and generates a WAV through `speak` when installed with MCP SDK 2.x.
- `clone` works with an external `ref_audio_path`.
- Setting `TTS_MCP_DATA_DIR` to the desktop app-data path lets the existing MCP `list_voices` and `clone(voice=...)` use the app's saved Clone profile. The app currently has one Clone profile in this environment.
- The remaining gaps are app-specific setup instructions and support for saved Design profiles through `clone`; the current `list_voices` output also does not identify profile kind.

## Approved direction

Configure the MCP process with `TTS_MCP_DATA_DIR` set to the exact directory displayed under Volo AI Settings → Storage. Do not copy profiles or add a synchronization layer. The desktop and MCP then read and write the same SQLite database and profile files.

The existing `clone` tool remains the speech-generation entry point:

- `voice=<profile name>` uses a saved Clone or Design profile.
- `ref_audio_path=<file path>` generates from an external audio reference without saving it.
- Existing `save_voice` imports an external reference into the shared library for reuse in both app and MCP.

No new MCP tool or profile format is needed. `list_voices` will identify profile kind so agents can choose profiles correctly. A saved Design profile passed to `clone` will route its design instruction to `Engine.generate`; a Clone profile will route its saved clone prompt.

## Observable behavior

1. When MCP is configured with the desktop app-data path, `list_voices` shows the app's saved profile names, kinds, and language. Clone entries may show their reference path; Design entries show their design instruction instead of a missing reference.
2. `clone(..., voice="name")` generates using either a saved Clone or Design profile from the selected library.
3. `clone(..., ref_audio_path="/path/to/audio.wav")` continues to generate from external audio. `save_voice` stores a profile in the selected library, making it visible to the desktop when that library is shared.
4. `save_voice` and `delete_voice` operate on the selected library. With the shared app directory, saving under an existing name replaces that profile and deleting a profile removes it from the app library as well.
5. If `TTS_MCP_DATA_DIR` is not set, the MCP server keeps using `~/.tts-mcp`; desktop profiles do not appear in that separate library.

## Scope

### Included

- Extend saved-profile selection in the existing MCP `clone` tool to handle both engine-supported profile kinds.
- Format `list_voices` results with the kind and relevant profile details.
- Document how to point MCP at the path shown in Volo AI Settings → Storage, and explain that profile changes then affect the shared library.
- Add focused MCP tests for Clone/Design profile dispatch and voice-list formatting.

### Excluded

- Adding another generation tool, database, profile-copy mechanism, or synchronization service.
- Changing the desktop voice-profile UI or profile schema.
- Changing how external reference files are validated or how model assets are downloaded.

## Interfaces and data

- Keep the existing MCP tool names and parameters: `clone`, `list_voices`, `save_voice`, and `delete_voice`.
- Reuse `Engine.load_voice_profile(name)`, which returns either `{kind: "clone", prompt: ...}` or `{kind: "design", instruct: ...}`.
- Reuse `TTS_MCP_DATA_DIR`; the desktop already sets it to Tauri `appDataDir()` for its sidecar, and the Settings → Storage view displays that path.
- Use the existing SQLite voice profile database and `voices/` files. No migration is required.

## Errors and compatibility

- A missing profile continues to raise the engine's existing not-found error with available profile names.
- A malformed Clone profile continues to fail when its prompt cannot be loaded; an invalid Design profile continues to fail when its instruction is empty.
- Calls using external reference audio keep the current `ref_audio_path` and optional `ref_text` behavior.
- Existing MCP clients keep the same tool names and arguments. The `voice` argument gains support for Design profiles.
- When using the shared app directory, existing `save_voice` and `delete_voice` tools modify the same library visible to Volo AI. The setup documentation must make this effect explicit.

## Verification

- Test that `clone` dispatches a Clone profile to `voice_clone_prompt` and a Design profile to `instruct`.
- Test that `list_voices` identifies profile kind and shows the appropriate reference or design instruction.
- Run the focused MCP tests and the full Python test suite; run an MCP stdio smoke check after the changes.
- Review the README MCP environment example against the directory displayed in Volo AI Settings → Storage.

## Related context

- [Architecture overview](../../llm/architecture/overview.md)

## Execution

- Plan: [MCP Access to the Volo AI Voice Library plan](../plans/2026-09-27-mcp-shared-app-voice-library-plan.md).
