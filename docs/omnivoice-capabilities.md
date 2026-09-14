# OmniVoice capabilities

## What “supported voices” means

OmniVoice does not ship a fixed gallery of 646 named speakers. Its official
model card describes three generation modes:

- **Voice cloning** — provide a short reference recording and, optionally, its
  transcript. The model reproduces the reference speaker's voice style.
- **Voice design** — describe a speaker with attributes; no reference recording
  is required.
- **Auto voice** — provide neither a reference nor an instruction and let the
  model choose a voice.

The upstream model currently lists **646 languages**, with an OmniVoice language
ID, an ISO 639-3 code, and training-data hours for each entry. The authoritative
full catalog is maintained by the OmniVoice project in
[`docs/languages.md`](https://github.com/k2-fsa/OmniVoice/blob/master/docs/languages.md).
Vietnamese is `vi` / `vie`; English is `en` / `eng`.

## Voice cloning guidance

- Use a clean 3–10 second reference clip. Longer clips increase inference cost
  and can reduce cloning quality.
- `ref_text` can be omitted; OmniVoice can use its Whisper ASR path to
  transcribe the reference.
- A reference in the same language as the target gives standard pronunciation.
  Cross-lingual cloning can carry the reference language's accent into the
  output.
- The model outputs audio at 24 kHz.

Source: [OmniVoice README / Python API](https://github.com/k2-fsa/OmniVoice#python-api).

## Voice design attributes

The official Voice Design guide supports these attributes:

| Category | Values |
| --- | --- |
| Gender | `male`, `female` |
| Age | `child`, `teenager`, `young adult`, `middle-aged`, `elderly` |
| Pitch | `very low pitch`, `low pitch`, `moderate pitch`, `high pitch`, `very high pitch` |
| Style | `whisper` |
| English accent | `american accent`, `british accent`, `australian accent`, `canadian accent`, `indian accent`, `chinese accent`, `korean accent`, `japanese accent`, `portuguese accent`, `russian accent` |
| Chinese dialect | `河南话`, `陕西话`, `四川话`, `贵州话`, `云南话`, `桂林话`, `济南话`, `石家庄话`, `甘肃话`, `宁夏话`, `青岛话`, `东北话` |

Attributes are comma-separated and can be combined across categories. Voice
design is most reliable for English and Chinese; voice cloning is the stable
mode for broader language coverage.

Source: [official Voice Design guide](https://github.com/k2-fsa/OmniVoice/blob/master/docs/voice-design.md).

## Volo AI seed behavior

Volo AI's current importer stores real voice profiles, not abstract language
records. Each importable seed must therefore contain a real reference audio
file:

```text
seed-pack/
└── narrator-vi/
    ├── manifest.json
    └── reference.wav
```

The app currently exposes `en` and `vi` as its supported target languages. A
646-entry language catalog can be added separately, but it must not be
represented as 646 cloned profiles without 646 licensed reference recordings.

## Licensing and safety

The upstream code is Apache-2.0, while the pretrained model is CC-BY-NC. Voice
reference recordings have their own rights and must only be bundled with the
speaker's permission and a license that allows redistribution. Do not use a
public celebrity recording as a default seed.

Source: [official model card license and disclaimer](https://huggingface.co/k2-fsa/OmniVoice).
