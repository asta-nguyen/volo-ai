# Desktop responsiveness and resource visibility

## Goal

Keep the desktop app responsive while speech is rendering, remove fixed
per-request probe cost from hot paths, and show the user which compute
backend and how much memory the engine is using.

## Scope

In scope, ordered:

1. Lazy imports — `numpy` and the `mcp`-backed `ApiServer` import lazily so
   the sidecar spawn path does not pay for them.
2. VieNeu status probe caching — `status` stops respawning the audio.cpp
   `--help` subprocess and re-parsing the manifest and ~50 preset asset
   files on every call.
3. Storage micro-costs — steady-state DB opens skip repeated `mkdir`, audio
   history scanning defers path resolution to the returned page, the voice
   seed loop hoists its profile list out of the preset loop, and the
   duplicate reference-audio validator in `desktop.py` is removed.
4. Synthesis worker lane — `synthesize` runs on a worker like the other
   long operations; a synthesis still waiting for its provider lock honors
   `cancel`.
5. Download progress throttling — tqdm-derived progress events emit at most
   ~10 Hz except terminal updates.
6. Status telemetry — `status` reports each provider's compute backend and
   best-effort process RSS/GPU memory.
7. Frontend — memoized UI copy, deduplicated stderr diagnostics, friendly
   per-provider backend labels plus RAM display, and a graceful cancel path
   that only falls back to an engine restart when a render is in flight.
8. Rust release profile — LTO, single codegen unit, stripped symbols.
9. Wiki updates for the changed behavior.

Out of scope:

- PyInstaller onedir packaging — covered by the sibling change
  `2026-10-23-sidecar-onedir`; no duplication here.
- Splitting `App.tsx` — deferred; only targeted edits.
- Replacing the `motion` dependency — deferred.
- Persistent audio.cpp server mode or a VieNeu GPU backend — upstream work.
- Parallel renders per provider — the existing provider locks still
  serialize execution.
- MCP/REST status shape changes — only the desktop sidecar `status` result
  gains fields.

## Behavior

### Sidecar responsiveness

`synthesize` joins the long-operation worker set in `run_protocol`. The
request loop stays responsive: `status`, `list_voices`,
`list_audio_history`, and `cancel` are answered while a render runs.
Concurrent `synthesize` requests are not rejected; they queue on the
provider locks (`Engine._inference_lock`,
`VieNeuProvider._synthesis_lock`), preserving the effective FIFO
serialization without blocking the loop.

Queued cancellation: both providers acquire their locks through a shared
package-private helper `_acquire_lock_cancelable(lock, should_cancel)` that
polls `lock.acquire(timeout=0.25)` and raises `DownloadCancelled` when the
cancel event fires while waiting. Once a lock is held, rendering is
uninterruptible — unchanged from today. `dispatch_request` already maps
`DownloadCancelled` to a `cancelled` error response, and `cancel` on an
unknown id keeps its error (generalized wording since downloads are no
longer the only cancellable operations).

### Status caching

`VieNeuProvider` caches probe results keyed on `(path, st_mtime_ns,
st_size)`:

- the audio.cpp `--help` subprocess result, keyed on the resolved binary
- the parsed voice manifest
- GGUF header/size validity and encoder validity
- per-preset `ref_codes.txt`/`speaker.emb.txt` validation
- the preprocessing import probe, cached once (installed packages cannot
  change inside the process)

File changes produce new `(mtime, size)` keys, so no explicit invalidation
is needed; the cache is bounded (cleared when it exceeds 128 entries).
`desktop_diagnostics.events` caches its bounded JSONL read the same way.

### Storage micro-costs

`_open_database` runs `DATA_DIR.mkdir`/`VOICES_DIR.mkdir` once per process
(a module flag, the same pattern as `_MIGRATED_STORAGES`); per-connection
pragmas and the `user_version` schema check stay on every connection.
`_list_audio_history` scans with `os.scandir` (cached `DirEntry.stat()`),
filters by cursor and sorts lightweight tuples, and calls `Path.resolve()`
only for the returned page; `total` still counts every scanned item.
`desktop.py::_validate_reference_audio` delegates to
`engine._validate_reference_audio_path` after its non-empty-string guard
and returns the resolved path. `_seed_vieneu_voices` calls
`Engine.list_voices()` once before the preset loop and refreshes the local
copy only after creating a profile inside the loop.

### Download progress

`Engine._download_asset` and `VieNeuProvider._download_patterns` emit
progress at most every 100 ms wall-clock; the first emit and any
`progress == 1.0` terminal emit always go through. Fewer JSONL lines and
fewer React state updates per download, with the same phase and completion
signals.

### Status telemetry

The `status` result gains:

```json
"resources": { "peak_rss_bytes": 0, "gpu_memory_bytes": null }
```

- `peak_rss_bytes`: `resource.getrusage(RUSAGE_SELF).ru_maxrss` normalized
  to bytes (Linux reports KB, macOS bytes); on Windows a small ctypes
  `GetProcessMemoryInfo` fallback; `null` on failure.
- `gpu_memory_bytes`: `torch.cuda.memory_allocated()` or
  `torch.mps.current_allocated_memory()`, read only while `Engine._model`
  is loaded — the check never triggers a lazy load; `null` otherwise or on
  any error.

`providers.omnivoice.backend` reports the detected device (`"cuda:0"`,
`"mps"`, or `"cpu"`); `providers.vieneu.backend` is always `"cpu"` because
audio.cpp hardcodes the CPU backend. All fields are additive; nothing is
renamed or removed.

### Frontend

- `createUiCopy(t)` memoized on `t` — one object per language change
  instead of ~460 lookups per render.
- `command.stderr` diagnostics are deduplicated: at most one
  `sidecar_stderr` event per 5 s window; the next recorded event appends
  the suppressed count to its message.
- `cancelSynthesis` sends `{type: "cancel", request_id}` for each active
  synthesis id and waits up to ~750 ms for the pending requests to settle;
  if they settle (cancelled while queued or completed normally) the engine
  is not restarted — otherwise it falls back to `stop()` exactly as today.
  The existing `otherWork` guard is unchanged.
- Footer and Settings → Model show a friendly per-provider backend label
  via i18n (`cuda*` → "GPU — NVIDIA CUDA", `mps` → "GPU — Apple Silicon",
  `cpu` → "CPU only"), and Settings shows peak RSS / GPU memory when
  reported — VieNeu renders on CPU regardless of the detected device.

### Rust release profile

`apps/desktop/src-tauri/Cargo.toml` gains `[profile.release]` with
`lto = true`, `codegen-units = 1`, `strip = true`. `panic = "abort"` is not
used because the crate also builds `cdylib`/`staticlib` targets.

## Edge cases

- Two `synthesize` requests arrive together: both spawn workers; the second
  waits on the provider lock and is still cancellable while waiting.
- `cancel` during an in-flight render: sets the event, which the render
  path never checks — the request completes normally and the frontend
  falls back to engine restart after its grace window, preserving the
  current UX for mid-render cancels.
- Model assets change between `status` calls: new `(mtime, size)` cache
  keys miss and revalidate — stale results are impossible.
- A `status` call while a download is writing files mid-flight can read a
  half-written asset and cache "invalid" for that `(mtime, size)`; the next
  state revalidates — same observable behavior as today.
- Windows: `resource` is unavailable → ctypes fallback; if that fails,
  `peak_rss_bytes` is `null` and the UI hides the metric.
- Model not loaded: `gpu_memory_bytes` is `null`; on a torch build without
  `torch.mps.current_allocated_memory` a guarded `getattr` yields `null`.
- Schema guard kept: `user_version` is still read per connection, so a
  newer-schema DB is still rejected after the mkdir fast-path.
- Seed loop: profiles created earlier in the same loop are visible to later
  collision checks because the local voice list is refreshed after each
  save.

## Interfaces

- `Engine.generate(..., should_cancel: Callable[[], bool] | None = None)` —
  new optional kwarg; default preserves current behavior for CLI/MCP
  callers.
- `VieNeuProvider.synthesize(request, voices, output_dir, output_path=None,
  *, should_cancel: Callable[[], bool] | None = None)`.
- `engine._acquire_lock_cancelable(lock, should_cancel)` — package-private
  helper shared with `desktop_vieneu`.
- `status` result additions: `resources.peak_rss_bytes: int | null`,
  `resources.gpu_memory_bytes: int | null`, `providers.<id>.backend:
  string`.
- `sidecar.ts`: `StatusResult.resources?: { peak_rss_bytes: number | null;
  gpu_memory_bytes: number | null }`, `ProviderStatus.backend?: string`.
  `cancelSynthesis()` keeps its signature and `boolean` return.
- `desktop_diagnostics.events` — same return shape, internally cached.
- `desktop.py::_synthesize(request, engine, should_cancel=None)` — internal
  signature only.

## Verification

- `python -m unittest discover -s tests -v` — including new tests: queued
  synthesis cancel, `status` answered mid-render, probe cache (subprocess
  run once across calls), progress emit rate cap, RSS field presence.
- `python -m compileall -q src tests`.
- Import cost: `python -c "import tts_mcp.engine, tts_mcp.desktop, sys;
  assert 'numpy' not in sys.modules and 'mcp' not in sys.modules"`.
- `npm --prefix apps/desktop run build`.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`.
- Manual smoke recorded in results: second `status` call latency, `status`
  responsiveness during a render, graceful cancel of a queued render.

## Related context

- [Desktop speech providers](../../../llm/workflows/desktop-vieneu.md) —
  `DVP-provider-status` gains the backend/memory reporting; the new
  `DVP-synthesis-execution` requirement covers the worker lane.
- [Desktop runtime and diagnostics](../../../llm/workflows/desktop-runtime-diagnostics.md) —
  `DSET-local-diagnostics` stays valid; the stderr dedupe refines how
  frontend events are recorded.
- [Video transcription](../../../llm/workflows/desktop-video-transcription.md) —
  `DVT-concurrency-cancellation` defines the worker-lane pattern this
  change extends to synthesis.
- [Architecture overview](../../../llm/architecture/overview.md)
