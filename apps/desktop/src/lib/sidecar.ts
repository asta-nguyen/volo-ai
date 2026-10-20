import { Command, type Child } from "@tauri-apps/plugin-shell";
import { appDataDir } from "@tauri-apps/api/path";
import { getVersion } from "@tauri-apps/api/app";
import {
  clearFrontendDiagnostics,
  recordFrontendDiagnostic,
  type DiagnosticEvent,
} from "./diagnostics";

export type Language = "en" | "vi";
export type ProviderId = "omnivoice" | "vieneu";
export type VoiceMode = "auto" | "profile" | "preset" | "file";
export type VoiceKind = "clone" | "design" | "vieneu_preset";
export type AudioFormat = "wav" | "mp3";

export type GenerationConfig = {
  guidance_scale?: number;
  t_shift?: number;
  position_temperature?: number;
  class_temperature?: number;
  layer_penalty_factor?: number;
  denoise?: boolean;
  preprocess_prompt?: boolean;
  postprocess_output?: boolean;
  audio_chunk_duration?: number;
  audio_chunk_threshold?: number;
  pad_duration?: number;
  fade_duration?: number;
};

export type VieNeuConfig = {
  temperature?: number;
  top_k?: number;
  top_p?: number;
  repetition_penalty?: number;
  repetition_window?: number;
  do_sample?: boolean;
  seed?: number;
};

export type VoiceProfile = {
  name: string;
  language: Language | null;
  kind: VoiceKind;
  preset_id?: string | null;
  ref_audio?: string | null;
  design_instruction?: string | null;
  ref_text?: string | null;
  is_default: boolean;
};

type Request = {
  id: string;
  type: string;
  [key: string]: unknown;
};

type Success<T> = { id: string; ok: true; result: T };
type Failure = {
  id: string;
  ok: false;
  error: { code: string; message: string };
};
type Response<T> = Success<T> | Failure;

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const PREPARATION_TIMEOUT_MS = 60 * 60 * 1000;
const SEED_TIMEOUT_MS = 60 * 60 * 1000;
const RUNTIME_INSTALL_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const MAX_REQUEST_LOGS = 500;

export type ProgressEvent = {
  id: string;
  event: "progress";
  provider?: ProviderId;
  phase: string;
  asset?: string;
  progress?: number | null;
  message?: string;
  preset_id?: string;
  current?: number;
  total?: number;
};

export type SeedVieNeuResult = {
  profiles: Array<{
    preset_id: string;
    name: string;
    status: "created" | "updated" | "reused";
  }>;
  failed: Array<{ preset_id: string; message: string }>;
  unfinished: string[];
  cancelled: boolean;
};

export type StatusResult = {
  model_ready: boolean;
  device: string;
  languages: Language[];
  model: string;
  tokenizer: string;
  asr_model: string;
  providers: Record<ProviderId, ProviderStatus>;
  nvidia_runtime?: NvidiaRuntimeStatus;
  diagnostics?: DiagnosticEvent[];
  diagnostics_complete?: boolean;
};

export type NvidiaRuntimeStatus = {
  supported: boolean;
  installed: boolean;
  installed_version: string | null;
  needs_update: boolean;
  active: boolean;
  available: boolean;
  size: number | null;
};

export type ProviderStatus = {
  model_ready: boolean;
  runtime_available: boolean;
  preprocessing_available: boolean;
  unavailable_reason: string | null;
  preset_voices?: Array<{ id: string; name: string; label: string }>;
  default_voice?: string | null;
};

export type SynthesisResult = {
  audio_path: string;
  format: AudioFormat;
};

export type AudioHistoryItem = {
  id: string;
  audio_path: string;
  format: AudioFormat;
  created_at: string;
  provider: ProviderId | null;
  voice_name: string | null;
  text: string | null;
  metadata_available: boolean;
};

export type AudioHistoryCursor = { created_at: string; id: string };

export type AudioHistoryPage = {
  items: AudioHistoryItem[];
  total: number;
  next_cursor: AudioHistoryCursor | null;
};

export class SidecarError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type RequestLogStatus = "pending" | "success" | "error";

export type RequestLog = {
  id: string;
  operation: string;
  status: RequestLogStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export class SidecarClient {
  private child: Child | null = null;
  private command: Command<string> | null = null;
  private startPromise: Promise<void> | null = null;
  private activePreparationIds = new Set<string>();
  private activeSeedId: string | null = null;
  private activeRuntimeInstallId: string | null = null;
  private nextId = 1;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  >();
  private progressListeners = new Set<(event: ProgressEvent) => void>();
  private logListeners = new Set<(entry: RequestLog) => void>();
  private logs: RequestLog[] = [];
  private outputBuffer = "";
  private diagnosticsHydrated = false;

  async start(): Promise<void> {
    if (this.child) return;
    if (this.startPromise) return this.startPromise;
    const pending = this.spawn();
    this.startPromise = pending;
    try {
      await pending;
    } finally {
      if (this.startPromise === pending) this.startPromise = null;
    }
  }

  private async spawn(): Promise<void> {
    if (!isTauriRuntime()) {
      throw new SidecarError(
        "tauri_required",
        "The local engine is available in the Volo AI desktop app. Run `npm run tauri dev`.",
      );
    }
    const command = Command.sidecar("binaries/tts-sidecar", [], {
      env: {
        TTS_MCP_DATA_DIR: await appDataDir(),
        TTS_MCP_APP_VERSION: await getVersion(),
      },
    });
    this.command = command;
    command.stdout.on("data", (line) => this.consume(String(line)));
    command.stderr.on("data", () =>
      recordFrontendDiagnostic(
        "sidecar_stderr",
        "sidecar_stderr",
        undefined,
        "The local engine reported an error.",
      ),
    );
    const handleStopped = (reason: SidecarError) => {
      if (this.command !== command) return;
      recordFrontendDiagnostic(
        "sidecar_exit",
        reason.code,
        undefined,
        "The local engine stopped unexpectedly.",
      );
      this.child = null;
      this.command = null;
      this.rejectAll(reason);
    };
    command.on("error", (message) =>
      handleStopped(
        new SidecarError("sidecar_stopped", `The local TTS engine stopped: ${message}`),
      ),
    );
    command.on("close", () => {
      handleStopped(new SidecarError("sidecar_stopped", "The local TTS engine stopped"));
    });
    try {
      const child = await command.spawn();
      if (this.command !== command) {
        await child.kill();
        throw new SidecarError("sidecar_stopped", "The local TTS engine stopped");
      }
      this.child = child;
    } catch (reason) {
      if (reason instanceof SidecarError) throw reason;
      if (this.command === command) this.command = null;
      recordFrontendDiagnostic(
        "sidecar_start_failed",
        "sidecar_unavailable",
        undefined,
        "Could not start the local engine.",
      );
      throw new SidecarError(
        "sidecar_unavailable",
        `Could not start the local engine: ${String(reason)}`,
      );
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.command = null;
    this.rejectAll(new Error("The local TTS engine stopped"));
    if (child) await child.kill();
  }

  onProgress(listener: (event: ProgressEvent) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  onLog(listener: (entry: RequestLog) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  getLogs(): RequestLog[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
    this.diagnosticsHydrated = false;
    clearFrontendDiagnostics();
    this.logListeners.forEach((listener) =>
      listener({
        id: "cleared",
        operation: "clear",
        status: "success",
        startedAt: Date.now(),
      }),
    );
  }

  async cancelPreparation(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.activePreparationIds].map((request_id) =>
        this.request({ type: "cancel", request_id }),
      ),
    );
    const failure = results.find(
      (result) =>
        result.status === "rejected" &&
        !(result.reason instanceof SidecarError && result.reason.code === "not_found"),
    );
    if (failure?.status === "rejected") throw failure.reason;
  }

  async cancelSeed(): Promise<void> {
    if (!this.activeSeedId) return;
    await this.request({ type: "cancel", request_id: this.activeSeedId });
  }

  async cancelNvidiaRuntime(): Promise<void> {
    if (!this.activeRuntimeInstallId) return;
    await this.request({ type: "cancel", request_id: this.activeRuntimeInstallId });
  }

  hydrateDiagnostics(events: DiagnosticEvent[]): void {
    if (this.diagnosticsHydrated) return;
    this.diagnosticsHydrated = true;
    const historic = events.slice(-MAX_REQUEST_LOGS).map((event, index): RequestLog => {
      const startedAt = Date.parse(event.time) || Date.now();
      const failure = [
        "request_failed",
        "runtime_install_failed",
        "frontend_error",
        "sidecar_exit",
        "sidecar_start_failed",
        "sidecar_stderr",
        "runtime_cpu_fallback",
      ].includes(event.category);
      return {
        id: `diagnostic-${startedAt}-${index}`,
        operation: event.operation ?? event.category,
        status: failure ? "error" : "success",
        startedAt,
        finishedAt: startedAt,
        errorCode: failure ? (event.code ?? event.category) : undefined,
        errorMessage: event.message,
      };
    });
    this.logs = [...historic, ...this.logs].slice(-MAX_REQUEST_LOGS);
    const latest = this.logs.at(-1);
    if (latest) this.logListeners.forEach((listener) => listener(latest));
  }

  async saveDesignVoice(
    name: string,
    designInstruction: string,
    language: Language,
  ): Promise<void> {
    await this.request({
      type: "save_design_voice",
      name,
      design_instruction: designInstruction,
      language,
    });
  }

  async request<T>(payload: Omit<Request, "id">): Promise<T> {
    const id = String(this.nextId++);
    const isPreparation = payload.type === "prepare_model";
    const isSeed = payload.type === "seed_vieneu_voices";
    const isRuntimeInstall = payload.type === "install_nvidia_runtime";
    if (isPreparation) this.activePreparationIds.add(id);
    if (isSeed) this.activeSeedId = id;
    if (isRuntimeInstall) this.activeRuntimeInstallId = id;
    this.addLog({
      id,
      operation: String(payload.type ?? "unknown"),
      status: "pending",
      startedAt: Date.now(),
    });
    let retried = false;
    try {
      while (true) {
        try {
          await this.start();
          const value = await this.requestOnce<T>(id, payload);
          this.completeLog(id, "success");
          return value;
        } catch (reason) {
          if (!retried && reason instanceof SidecarError && reason.code === "sidecar_stopped") {
            retried = true;
            continue;
          }
          throw reason;
        }
      }
    } catch (reason) {
      this.pending.delete(id);
      const error =
        reason instanceof SidecarError
          ? { code: reason.code, message: reason.message }
          : {
              code: "request_failed",
              message: reason instanceof Error ? reason.message : String(reason),
            };
      this.completeLog(id, "error", error);
      recordFrontendDiagnostic(
        "request_failed",
        error.code,
        String(payload.type ?? "unknown"),
        "A local operation failed.",
      );
      throw reason;
    } finally {
      if (isPreparation) this.activePreparationIds.delete(id);
      if (isSeed && this.activeSeedId === id) this.activeSeedId = null;
      if (isRuntimeInstall && this.activeRuntimeInstallId === id)
        this.activeRuntimeInstallId = null;
    }
  }

  private async requestOnce<T>(id: string, payload: Omit<Request, "id">): Promise<T> {
    const child = this.child;
    const command = this.command;
    if (!child) throw new Error("The local TTS engine is unavailable");
    const request = JSON.stringify({ ...payload, id }) + "\n";
    const timeoutMs =
      payload.type === "prepare_model"
        ? PREPARATION_TIMEOUT_MS
        : payload.type === "seed_vieneu_voices"
          ? SEED_TIMEOUT_MS
          : payload.type === "install_nvidia_runtime"
            ? RUNTIME_INSTALL_TIMEOUT_MS
            : REQUEST_TIMEOUT_MS;
    let timeout: ReturnType<typeof setTimeout>;
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      timeout = setTimeout(() => {
        this.pending.delete(id);
        const error = new SidecarError(
          "request_timeout",
          `The local engine did not respond within ${Math.round(timeoutMs / 60000)} minutes`,
        );
        if (this.command === command) {
          this.child = null;
          this.command = null;
          this.rejectAll(error);
          void child.kill().catch(() => undefined);
        }
        reject(error);
      }, timeoutMs);
    });
    try {
      await child.write(request);
    } catch (reason) {
      clearTimeout(timeout!);
      const error = new SidecarError("sidecar_stopped", "The local TTS engine stopped");
      if (this.command === command) {
        this.child = null;
        this.command = null;
        this.rejectAll(error);
      }
      throw error;
    }
    return response.finally(() => clearTimeout(timeout!));
  }

  private addLog(entry: RequestLog): void {
    this.logs = [...this.logs, entry].slice(-MAX_REQUEST_LOGS);
    this.logListeners.forEach((listener) => listener(entry));
  }

  private completeLog(
    id: string,
    status: Exclude<RequestLogStatus, "pending">,
    error?: { code: string; message: string },
  ): void {
    const finishedAt = Date.now();
    this.logs = this.logs.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            status,
            finishedAt,
            durationMs: finishedAt - entry.startedAt,
            ...(error ? { errorCode: error.code, errorMessage: error.message } : {}),
          }
        : entry,
    );
    const entry = this.logs.find((item) => item.id === id);
    if (entry) this.logListeners.forEach((listener) => listener(entry));
  }

  private consume(chunk: string): void {
    this.outputBuffer += chunk;
    const lines = this.outputBuffer.split("\n");
    this.outputBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.handle(JSON.parse(line) as Response<unknown> | ProgressEvent);
      } catch {
        console.warn("[tts-sidecar] Invalid response", line);
      }
    }
  }

  private handle(message: Response<unknown> | ProgressEvent): void {
    if (!("ok" in message)) {
      this.progressListeners.forEach((listener) => listener(message));
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new SidecarError(message.error.code, message.error.message));
  }

  private rejectAll(reason: Error): void {
    for (const { reject } of this.pending.values()) reject(reason);
    this.pending.clear();
  }
}
