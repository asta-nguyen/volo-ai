# Volo AI 0.2.0

## Highlights

- Audio History entries can be renamed and their local file path copied to the clipboard.
- An opt-in local REST API exposes desktop speech and voice profiles at `http://127.0.0.1:8765/api/v1`. It starts only from Settings, binds to loopback, and stops when the app closes.
- The desktop app checks for newer stable releases and shows an update notice with a link to the official release.
- The website now serves a localized changelog page that reads this file and links each version to its exact installer downloads.
- A Transcribe view turns a public YouTube or Facebook video of up to 60 minutes into a timestamped `.srt` file with the local Whisper model.
- Long scripts no longer fail after five minutes of rendering; a running render shows its elapsed time and can be cancelled.
- MCP tools now return the reason a call failed instead of a generic "Error executing tool" message.
