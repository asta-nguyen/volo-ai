# Contributing to Volo AI

Thanks for helping improve Volo AI. Keep changes focused, and include the
checks relevant to the code you changed.

## Development setup

The project uses Python 3.10+, Node.js 22+, and stable Rust. FFmpeg is needed
for MP3 export during source development.

- For the MCP server and desktop app setup, start with the [README](README.md).
- For desktop development, formatting, and packaging details, see the
  [desktop development guide](docs/desktop-development.md).
- For web development, install dependencies with `npm ci --prefix apps/web`
  and start the app with `npm --prefix apps/web run dev`.

## AI-assisted contributions

When using an AI coding agent, read [`AGENTS.md`](AGENTS.md) and follow the
[`using-devkit` workflow](.agents/skills/using-devkit/SKILL.md). Use
[`read-codebase-context`](.agents/skills/read-codebase-context/SKILL.md) to
check affected code and documentation before editing.

For new or ambiguous work, start with
[`brainstorm-feature`](.agents/skills/brainstorm-feature/SKILL.md). For
architectural changes, use [`plan-feature`](.agents/skills/plan-feature/SKILL.md)
to create and get approval for `design.md` and `tasks.md` before implementation.
Then use [`implement-task`](.agents/skills/implement-task/SKILL.md) and finish
with [`review-and-verify`](.agents/skills/review-and-verify/SKILL.md). For bug
fixes, follow [`systematic-debugging`](.agents/skills/systematic-debugging/SKILL.md).
Small, clearly scoped changes use the simpler path in `using-devkit` and do not
need an architectural task plan.

## Checks

Run checks for the areas you changed. CI currently runs the Python and desktop
checks below; the web app has its own test and build commands.

### Python engine and MCP

```sh
python -m unittest discover -s tests -v
python -m compileall -q src tests
```

### Desktop app

```sh
npm --prefix apps/desktop run build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

The Tauri check needs the platform's Tauri system dependencies and the
target-named sidecar paths. CI prepares compile-only placeholders for those
paths; see the [CI workflow](.github/workflows/ci.yml).

### Web app

```sh
npm --prefix apps/web test
npm --prefix apps/web run build
```

### Formatting

Install the Python formatter with `python -m pip install -e '.[dev]'`, then
check Python and desktop formatting with:

```sh
python -m ruff format --check src tests
npm --prefix apps/desktop run format:check
```

## Pull requests

- Explain the problem, the change, and any user-visible effects.
- Add or update tests when behavior changes, and report which checks you ran.
- Update user or developer documentation when the change makes it stale.
  Keep the [verified codebase wiki](docs/llm/INDEX.md) grounded in current
  source and tests.
- For interface changes, include screenshots or a short recording when useful.
- Do not include secrets, local logs, model weights, generated speech, or build
  output unless a reviewed fixture specifically requires it.

The desktop sidecar uses newline-delimited JSON on stdout and sends diagnostics
to stderr. Preserve that protocol when changing desktop requests or responses.
