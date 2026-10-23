# Desktop responsiveness and resource visibility tasks

## Design

[Desktop responsiveness and resource visibility](design.md)

## Global Constraints

- Additive only: no JSONL field renames, removals, or schema-version bumps.
- A render holding a provider lock is uninterruptible; cancel applies only
  while a synthesis waits for its lock.
- Provider locks (`Engine._inference_lock`,
  `VieNeuProvider._synthesis_lock`) still serialize execution — no parallel
  renders.
- No new runtime dependencies; stdlib fallbacks for platform metrics.
- `npm`/`cargo`/PyInstaller packaging behavior owned by
  `2026-10-23-sidecar-onedir` stays untouched.

## Impact map

- Entry: `src/tts_mcp/desktop.py::run_protocol` (JSONL loop) and
  `apps/desktop/src/lib/sidecar.ts::SidecarClient.request` (frontend
  callsite), surfaced through `apps/desktop/src/App.tsx::App`.
- Flow: stdin JSONL → `run_protocol` → `dispatch_request` →
  `Engine`/`VieNeuProvider` → response/progress on stdout →
  `SidecarClient.consume` → React state → views.
- State changes: none persistent — all caches are process-local; DB schema
  and on-disk formats unchanged.
- External effects: fewer audio.cpp `--help` subprocesses, fewer JSONL
  progress lines during downloads, fewer `localStorage` writes during
  stderr bursts, smaller/stripped release binary.
- Change candidates: `src/tts_mcp/engine.py`,
  `src/tts_mcp/desktop_vieneu.py`, `src/tts_mcp/desktop.py`,
  `src/tts_mcp/convert.py`, `src/tts_mcp/desktop_diagnostics.py`,
  `apps/desktop/src/lib/sidecar.ts`, `apps/desktop/src/App.tsx`,
  `apps/desktop/src/lib/i18n.ts`, `apps/desktop/src-tauri/Cargo.toml`,
  `tests/test_desktop.py`, `tests/test_desktop_vieneu.py`,
  `tests/test_desktop_diagnostics.py`.
- Verification: `python -m unittest discover -s tests -v`,
  `python -m compileall -q src tests`,
  `npm --prefix apps/desktop run build`,
  `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`.
- Verified at: a545fd5af796c2b8cc26a3f685180d612b043a24 (plus unrelated
  uncommitted user edits to `.gitignore`, `tauri.conf.json`,
  `docs/agent-devkit/INDEX.md` — preserve them).

## Tasks

### Task 1 — Lazy imports

Files: `src/tts_mcp/engine.py` (top-level `import numpy as np`),
`src/tts_mcp/engine.py::Engine.transcribe_with_timestamps`,
`src/tts_mcp/desktop_vieneu.py` (top-level `import numpy as np`),
`src/tts_mcp/desktop_vieneu.py::VieNeuProvider._speaker_embedding`,
`src/tts_mcp/desktop_vieneu.py::VieNeuProvider._synthesize`,
`src/tts_mcp/convert.py` (top-level `import numpy as np`),
`src/tts_mcp/desktop.py` (top-level `from tts_mcp.api import ...`),
`src/tts_mcp/desktop.py::_local_api_server`,
`src/tts_mcp/desktop.py::dispatch_request`
Interfaces: none — internal only; module APIs unchanged. `TYPE_CHECKING`
imports keep the `np.ndarray` / `ApiServer` annotations resolvable.
Change: move `numpy` imports under `if TYPE_CHECKING:` plus a local
`import numpy as np` inside each function that calls `np.*` at runtime
(`transcribe_with_timestamps`, `_speaker_embedding`, `_synthesize`);
`convert.py` uses numpy only in annotations so it needs no runtime import.
Move `from tts_mcp.api import ApiServer, ApiStartError` off the top level:
`ApiServer` inside `_local_api_server()` (annotation under
`TYPE_CHECKING`), `ApiStartError` inside the `start_api` branch of
`dispatch_request`.
Verify: `python -c "import tts_mcp.engine, tts_mcp.desktop_vieneu,
tts_mcp.convert, tts_mcp.desktop, sys; assert 'numpy' not in sys.modules
and 'mcp' not in sys.modules"`; `python -m compileall -q src tests`;
`python -m unittest discover -s tests -v`.
Progress: todo
Result: none

### Task 2 — VieNeu status probe caching

Files: `src/tts_mcp/desktop_vieneu.py::VieNeuProvider` (`__init__`,
`_runtime_status`, `_preprocessing_status`, `_manifest`,
`_valid_model_asset`, `_valid_encoder`, `_valid_voice_assets`),
`src/tts_mcp/desktop_diagnostics.py::events`,
`tests/test_desktop_vieneu.py`, `tests/test_desktop_diagnostics.py`
Interfaces: `VieNeuProvider.status()` and `desktop_diagnostics.events()`
keep their exact response shapes; consumed unchanged by `dispatch_request`.
Change: add a bounded (128-entry, clear-when-full) `self._probe_cache` on
`VieNeuProvider` with a `_cached_probe(key, fn)` helper. Key each probe on
`(str(path), st_mtime_ns, st_size)` where a file backs the probe:
`_runtime_status` on the resolved binary, `_manifest` on the manifest,
`_valid_model_asset`/`_valid_encoder` on their paths,
`_valid_voice_assets` on the `ref_codes.txt` + `speaker.emb.txt` pair.
Cache the `_preprocessing_status` import probe once under a fixed key.
Apply the same `(mtime, size)`-keyed cache inside
`desktop_diagnostics.events` for the diagnostics JSONL read.
Verify: new tests assert `subprocess.run` is invoked once across two
`status()` calls with unchanged files, that touching a probed file
revalidates, and that `events()` re-reads after the file grows;
`python -m unittest tests.test_desktop_vieneu tests.test_desktop_diagnostics -v`.
Progress: todo
Result: none

### Task 3 — Storage micro-costs

Files: `src/tts_mcp/engine.py::_open_database`,
`src/tts_mcp/desktop.py::_list_audio_history`,
`src/tts_mcp/desktop.py::_list_audio_history_page`,
`src/tts_mcp/desktop.py::_validate_reference_audio`,
`src/tts_mcp/desktop.py::_seed_vieneu_voices`,
`tests/test_desktop.py`
Interfaces: `_open_database` return contract unchanged;
`_list_audio_history`/`_list_audio_history_page` keep identical item
fields, ordering, `total`, and `next_cursor` semantics;
`_validate_reference_audio` returns the resolved path string (callers
re-validate downstream, and `Path.is_file` checks already ran).
Change: (a) guard `DATA_DIR.mkdir`/`VOICES_DIR.mkdir` behind a module flag
so they run once per process — pragmas and the `user_version` check stay
per connection; (b) rewrite `_list_audio_history` to use `os.scandir`,
build `(name, suffix, created_at, record, path)` tuples, apply the cursor
filter and sort on tuples, and `resolve()` + build item dicts only for the
page — `total` counts all scanned entries; (c) delegate
`_validate_reference_audio` to `engine._validate_reference_audio_path`
after keeping the non-empty-string guard, and drop the now-unused
`ALLOWED_REFERENCE_EXTENSIONS` if nothing else references it; (d) hoist
`Engine.list_voices()` above the preset loop in `_seed_vieneu_voices` and
refresh the local list after `save_vieneu_seed_reference` creates a
profile.
Verify: `python -m unittest tests.test_desktop -v` — plus a new test that
paginated iteration concatenates to the same order and `total` as the
non-paginated listing.
Progress: todo
Result: none

### Task 4 — Synthesis worker lane and queued cancel

Files: `src/tts_mcp/engine.py` (new `_acquire_lock_cancelable`),
`src/tts_mcp/engine.py::Engine.generate`,
`src/tts_mcp/desktop_vieneu.py::VieNeuProvider.synthesize`,
`src/tts_mcp/desktop.py::run_protocol`,
`src/tts_mcp/desktop.py::_synthesize`,
`src/tts_mcp/desktop.py::dispatch_request` (synthesize branch, seed call
site, cancel error message),
`tests/test_desktop.py`
Interfaces: `Engine.generate` gains `should_cancel: Callable[[], bool] |
None = None`; `VieNeuProvider.synthesize` gains keyword-only
`should_cancel`; `dispatch_request` already accepts `should_cancel` and
maps `DownloadCancelled` to `cancelled`. Produces the `cancel` behavior
Task 7's frontend relies on.
Change: add `_acquire_lock_cancelable(lock, should_cancel)` to engine.py
— loop `lock.acquire(timeout=0.25)` until held, raising
`DownloadCancelled` when `should_cancel()` fires; use it in
`Engine.generate` for `_inference_lock` and in
`VieNeuProvider.synthesize` for `_synthesis_lock`. In `run_protocol`, add
`"synthesize"` to the worker-operation set so it gets a `cancel_event`
and `active` registration like the other long ops; pass `should_cancel`
into `_synthesize` and both `provider.synthesize` call sites (dispatch and
the seed loop). Generalize the `cancel` fallback error message to cover
any active long-running operation.
Verify: new tests — a `status` request is answered while a stubbed render
holds the lock; a `cancel` during lock-wait returns `cancelled` for the
synthesis request; two synthesize requests serialize.
`python -m unittest tests.test_desktop -v`.
Progress: todo
Result: none

### Task 5 — Download progress throttle

Files: `src/tts_mcp/engine.py::_download_asset` (`ProgressBar.update`),
`src/tts_mcp/desktop_vieneu.py::VieNeuProvider._download_patterns`
(`ProgressBar.update`),
`tests/test_desktop.py`, `tests/test_desktop_vieneu.py`
Interfaces: identical progress event shape; only the emit rate changes.
Change: track a monotonic last-emit timestamp on the progress bar; emit
when `now - last >= 0.1` s, on the first update, or when
`progress == 1.0`. Cancel checks stay on every `update` call regardless
of emission.
Verify: a test feeds synthetic `update` ticks and asserts `on_progress`
is called at a bounded rate while every cancellation check still runs;
`python -m unittest discover -s tests -v`.
Progress: todo
Result: none

### Task 6 — Status telemetry: backend and memory

Files: `src/tts_mcp/engine.py` (new `_process_peak_rss`,
`Engine.gpu_memory_bytes`),
`src/tts_mcp/desktop.py::dispatch_request` (status branch),
`tests/test_desktop.py`
Interfaces: produces `resources` and `providers.<id>.backend` consumed by
Task 7's `StatusResult`/`ProviderStatus` types and UI.
Change: add `_process_peak_rss()` — `resource.getrusage(RUSAGE_SELF).
ru_maxrss` normalized to bytes (Linux KB, macOS bytes) with a ctypes
`GetProcessMemoryInfo` fallback on Windows and `None` on any failure —
and `Engine.gpu_memory_bytes()` returning `None` unless `self._model` is
loaded, then `torch.cuda.memory_allocated()` /
`getattr(torch.mps, "current_allocated_memory", ...)` guarded by
`try/except`. In the `status` branch add
`"resources": {"peak_rss_bytes": ..., "gpu_memory_bytes": ...}` and
`providers.omnivoice.backend = status["device"]`,
`providers.vieneu.backend = "cpu"`.
Verify: new test asserts `resources.peak_rss_bytes` is an int on POSIX,
`gpu_memory_bytes` is `None` with no loaded model, and
`providers.vieneu.backend == "cpu"`;
`python -m unittest tests.test_desktop -v`.
Progress: todo
Result: none

### Task 7 — Frontend pack

Files: `apps/desktop/src/lib/sidecar.ts` (`SidecarClient.spawn` stderr
handler, `cancelSynthesis`, `StatusResult`, `ProviderStatus`),
`apps/desktop/src/App.tsx` (`App` copy memoization, backend label,
Settings → Model metrics),
`apps/desktop/src/lib/i18n.ts` (new copy keys, en + vi)
Interfaces: consumes Task 4's `cancel` semantics and Task 6's
`resources`/`backend` fields. `cancelSynthesis()` signature unchanged.
Change: (a) `const copy: UiCopy = useMemo(() => createUiCopy(t), [t])`;
(b) dedupe `sidecar_stderr` diagnostics — one event per 5 s window, next
recorded message appends the suppressed count; (c) `cancelSynthesis`
sends `{type: "cancel", request_id}` for each `activeSynthesisIds` entry,
waits ≤750 ms for them to settle, and only calls `stop()` if any remain
— keep the `otherWork` guard; (d) add `resources?: {...}` and
`backend?: string` to the status types; (e) backend label helper mapping
`cuda*`/`mps`/`cpu` to i18n strings ("GPU — NVIDIA CUDA", "GPU — Apple
Silicon", "CPU only"), shown per active provider in the footer and
Settings → Model, plus peak RSS / GPU memory rows (MB, hidden when null).
Verify: `npm --prefix apps/desktop run build`.
Progress: todo
Result: none

### Task 8 — Rust release profile

Files: `apps/desktop/src-tauri/Cargo.toml`
Interfaces: none.
Change: append `[profile.release]` with `lto = true`,
`codegen-units = 1`, `strip = true`. No `panic = "abort"` — the crate
builds `cdylib`/`staticlib` targets.
Verify: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`.
Progress: todo
Result: none

### Task 9 — Wiki updates

Files: `docs/llm/workflows/desktop-vieneu.md`,
`docs/llm/workflows/desktop-runtime-diagnostics.md`,
`docs/llm/architecture/overview.md`
Interfaces: applies `delta.md`; run via the `document-wiki` skill.
Change: merge the delta (MODIFIED `DVP-provider-status`, ADDED
`DVP-synthesis-execution`) and update Flow/Side effects/Error
paths/Tests prose for the worker lane, probe caching, telemetry fields,
and the stderr dedupe; refresh any stale statements in the overview and
diagnostics pages.
Verify: wiki statements match the merged implementation; delta blocks
copied verbatim.
Progress: todo
Result: none

## Files inspected, no change

- `src/tts_mcp/api.py`, `src/tts_mcp/server.py` — read for the import
  chain cost; no behavioral edits in this change.
- `src/tts_mcp/transcribe.py` — read for worker-lane pattern and imports;
  unchanged.
- `apps/desktop/src/lib/diagnostics.ts` — read for the localStorage write
  path; the dedupe lives in `sidecar.ts`, not here.
- `apps/desktop/src-tauri/src/lib.rs` — read for plugin registration; no
  change needed.
- `apps/desktop/src-tauri/tauri.conf.json` — read; the remote `$schema`
  warning is IDE-side, not a config defect; untouched.

## Approval Gate

Status: pending

## Decision Log

None.
