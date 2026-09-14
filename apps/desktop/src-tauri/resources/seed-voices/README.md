# OmniVoice seed folder

This directory contains bundled voice seeds. The app imports each child
directory after the model is ready.

`voice-catalog.json` is the initial EN/VI product voice list. It contains
voice recipes and recording scripts; it is not imported as profiles because
OmniVoice does not provide named Admin/Narrator voices. The four Vietnamese
entries need licensed reference recordings before they can become clone
seeds. The English recipes can be tried in Voice Design mode.

```text
seed-voices/                 # choose this folder for multi-seed import
└── narrator-vi/
    ├── manifest.json
    └── reference.wav
```

Each `manifest.json` must include:

```json
{
  "id": "narrator-vi",
  "version": 1,
  "name": "Narrator Vietnamese",
  "language": "vi",
  "default": true,
  "ref_text": "Transcript matching the reference audio.",
  "audio": "reference.wav"
}
```

`audio` must be a relative path inside the same seed directory. Supported
formats are WAV, MP3, FLAC, and OGG. Use a clean 3–10 second clip when
possible. OmniVoice has 646 supported language IDs, but it does not ship 646
fixed named voices; every clone seed still needs its own licensed reference
recording. See [`docs/omnivoice-capabilities.md`](../../../../../docs/omnivoice-capabilities.md)
for the full capability notes and official catalog links.
