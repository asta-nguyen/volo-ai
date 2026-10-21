# Delta

Merged into docs/llm/: 2026-10-21

Issue: 6

## ADDED Requirements

### DVT-transcribe-whisper-readiness

Page: `docs/llm/workflows/desktop-video-transcription.md`
Search: searched every page using the DVT prefix; existing requirements cover Whisper reuse and sidecar model readiness but none cover desktop Transcribe access independent of VieNeu or its setup-screen entry.

Requirement:

````md
### DVT-transcribe-whisper-readiness

The desktop SHALL make the Transcribe view available when the local OmniVoice Whisper ASR provider is ready, regardless of VieNeu readiness, while keeping synthesis gated on both providers.

#### Scenario: open transcription with VieNeu unavailable

- GIVEN OmniVoice/Whisper is ready and VieNeu is unavailable or not ready
- WHEN the user opens Transcribe from first-run setup or app navigation
- THEN the transcription workflow is available without preparing VieNeu assets

#### Scenario: keep synthesis gated

- GIVEN OmniVoice/Whisper is ready and VieNeu is not ready
- WHEN the user opens the synthesis workspace
- THEN the existing both-provider setup gate remains in effect

Evidence: `apps/desktop/src/App.tsx`
````
