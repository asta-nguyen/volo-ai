import { Command, type Child } from "@tauri-apps/plugin-shell";
import { appDataDir } from "@tauri-apps/api/path";

export type Language = "en" | "vi";
export type VoiceMode = "auto" | "profile" | "file";
export type AudioFormat = "wav" | "mp3";

export type VoiceProfile = {
  name: string;
  ref_audio?: string;
  ref_text?: string | null;
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
};

export type SynthesisResult = {
  audio_path: string;
  format: AudioFormat;
};

export class SidecarError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export class SidecarClient {
  private child: Child | null = null;
  private command: Command<string> | null = null;
  private nextId = 1;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  >();
  private progressListeners = new Set<(event: ProgressEvent) => void>();
  private outputBuffer = "";

  async start(): Promise<void> {
    if (this.child) return;
    const command = Command.sidecar("binaries/tts-sidecar", [], {
      env: { TTS_MCP_DATA_DIR: await appDataDir() },
    });
    this.command = command;
    command.stdout.on("data", (line) => this.consume(String(line)));
    command.stderr.on("data", (line) => console.warn("[tts-sidecar]", line));
    command.on("error", (message) => this.rejectAll(new Error(String(message))));
    command.on("close", () => {
      this.child = null;
      this.rejectAll(new Error("The local TTS engine stopped"));
    });
    this.child = await command.spawn();
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

  async request<T>(payload: Omit<Request, "id">): Promise<T> {
    await this.start();
    if (!this.child) throw new Error("The local TTS engine is unavailable");
    const id = String(this.nextId++);
    const request = JSON.stringify({ ...payload, id }) + "\n";
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    await this.child.write(request);
    return response;
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
