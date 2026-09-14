import { Command, type Child } from "@tauri-apps/plugin-shell";
import { appDataDir } from "@tauri-apps/api/path";

export type Language = "en" | "vi";
export type VoiceMode = "auto" | "profile" | "file" | "design";
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

export type VoiceProfile = {
  name: string;
  language: Language;
  ref_audio?: string;
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

export type ProgressEvent = {
  id: string;
  event: "progress";
  phase: string;
  asset?: string;
  progress?: number | null;
  message?: string;
};

export type StatusResult = {
  model_ready: boolean;
  device: string;
  languages: Language[];
  model: string;
  tokenizer: string;
  asr_model: string;
};

export type SynthesisResult = {
  audio_path: string;
  format: AudioFormat;
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
  private activePreparationId: string | null = null;
  private nextId = 1;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  >();
  private progressListeners = new Set<(event: ProgressEvent) => void>();
  private logListeners = new Set<(entry: RequestLog) => void>();
  private logs: RequestLog[] = [];
  private outputBuffer = "";

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
      env: { TTS_MCP_DATA_DIR: await appDataDir() },
    });
    this.command = command;
    command.stdout.on("data", (line) => this.consume(String(line)));
    command.stderr.on("data", (line) => console.warn("[tts-sidecar]", line));
    const handleStopped = (reason: SidecarError) => {
      if (this.command !== command) return;
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

  async cancelPreparation(): Promise<void> {
    if (!this.activePreparationId) return;
    await this.request({ type: "cancel", request_id: this.activePreparationId });
  }

  async request<T>(payload: Omit<Request, "id">): Promise<T> {
    const id = String(this.nextId++);
    const isPreparation = payload.type === "prepare_model";
    if (isPreparation) this.activePreparationId = id;
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
      throw reason;
    } finally {
      if (isPreparation && this.activePreparationId === id) this.activePreparationId = null;
    }
  }

  private async requestOnce<T>(id: string, payload: Omit<Request, "id">): Promise<T> {
    const child = this.child;
    const command = this.command;
    if (!child) throw new Error("The local TTS engine is unavailable");
    const request = JSON.stringify({ ...payload, id }) + "\n";
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    try {
      await child.write(request);
    } catch (reason) {
      const error = new SidecarError("sidecar_stopped", "The local TTS engine stopped");
      if (this.command === command) {
        this.child = null;
        this.command = null;
        this.rejectAll(error);
      }
      throw error;
    }
    return response;
  }

  private addLog(entry: RequestLog): void {
    this.logs = [...this.logs, entry];
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
