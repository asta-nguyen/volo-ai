import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { appDataDir, homeDir, resolveResource } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import { copyFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertCircle,
  ArrowUpRight,
  AudioLines,
  Captions,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Clock,
  Coffee,
  Copy,
  Download,
  FileAudio,
  FileText,
  FileVideo,
  FolderOpen,
  Globe,
  HardDrive,
  History,
  Languages,
  Library,
  LoaderCircle,
  Logs,
  Monitor,
  Moon,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  SidecarClient,
  SidecarError,
  type AudioHistoryCursor,
  type AudioHistoryItem,
  type AudioHistoryPage,
  type AudioFormat,
  type GenerationConfig,
  type Language,
  type LocalApiState,
  type NvidiaRuntimeStatus,
  type ProviderId,
  type ProviderStatus,
  type ProgressEvent,
  type RenameAudioHistoryResult,
  type RequestLog,
  type SeedVieNeuResult,
  type StatusResult,
  type SynthesisResult,
  type TranscribeVideoResult,
  type VieNeuConfig,
  type VoiceKind,
  type VoiceMode,
  type VoiceProfile,
} from "./lib/sidecar";
import {
  frontendDiagnosticsComplete,
  frontendDiagnosticsForExport,
  getFrontendDiagnostics,
  recordFrontendDiagnostic,
} from "./lib/diagnostics";
import { createUiCopy, setAppLanguage, type AppLanguage, type UiCopy } from "./lib/i18n";
import {
  automaticCheckDue,
  checkLatestRelease,
  clearDismissedTag,
  dismissUpdateTag,
  readDismissedTag,
  recordAutomaticCheck,
  type UpdateCheckResult,
} from "./lib/update-check";
import { cn } from "./lib/utils";
import { AudioPlayer, InlineAudioPreview } from "./components/AudioPlayer";

export type ThemeMode = "light" | "dark" | "system";

export function readTheme(): ThemeMode {
  return (localStorage.getItem("volo-ai.theme") as ThemeMode) || "system";
}

export function applyTheme(theme: ThemeMode) {
  localStorage.setItem("volo-ai.theme", theme);
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (isDark) {
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.classList.remove("dark");
    document.documentElement.setAttribute("data-theme", "light");
  }
}

export type TakeItem = {
  id: string;
  timestamp: number;
  provider: ProviderId;
  voiceName: string;
  format: AudioFormat;
  audioPath: string;
  text: string;
};

const SAMPLE_SCRIPTS = {
  vi: [
    {
      titleKey: "sampleNews" as const,
      text: "Chào mừng quý thính giả đến với bản tin công nghệ của Volo AI. Hôm nay chúng ta sẽ cùng khám phá công nghệ giọng nói AI thế hệ mới hoạt động hoàn toàn offline trên thiết bị của bạn.",
    },
    {
      titleKey: "sampleStory" as const,
      text: "Đêm mùa thu tĩnh lặng, tiếng lá rơi khẽ khàng ngoài hiên vắng. Những công cụ giản dị nhất lại thường tạo nên những điều phi thường.",
    },
    {
      titleKey: "sampleConversation" as const,
      text: "Xin chào bạn, hôm nay thời tiết rất đẹp. Giọng nói bạn đang nghe được tạo trực tiếp với chất lượng cao và tốc độ phản hồi tức thì.",
    },
  ],
  en: [
    {
      titleKey: "sampleNews" as const,
      text: "The quietest tools often do the most important work. Welcome to Volo AI, your private, high-fidelity local voice synthesis studio.",
    },
    {
      titleKey: "sampleStory" as const,
      text: "High in the misty mountains, the ancient library stood silent, waiting for someone to speak the forgotten words into the twilight.",
    },
    {
      titleKey: "sampleConversation" as const,
      text: "Good morning! It's fantastic to have you here. Let's see what kind of creative audio experiences we can shape today.",
    },
  ],
};

const client = new SidecarClient();
const STATUS_QUERY_KEY = ["sidecar", "status"] as const;
const VOICES_QUERY_KEY = ["sidecar", "voices"] as const;
const API_STATE_QUERY_KEY = ["sidecar", "local-api"] as const;
const AUDIO_HISTORY_QUERY_KEY = ["sidecar", "audio-history"] as const;
type AppView = "workspace" | "transcribe" | "profiles" | "history" | "settings" | "logs";
type SettingsTab = "general" | "model" | "storage" | "mcp";
type McpClientId = "codex" | "claude-code" | "claude-desktop" | "cursor" | "vscode" | "zed";

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildMcpConfig(clientId: McpClientId, dataDir: string): string {
  const command = "/absolute/path/to/tts";
  const args = ["mcp"];
  const env = { TTS_MCP_DATA_DIR: dataDir };

  if (clientId === "codex") {
    return `codex mcp add volo-tts --env ${shellQuote(`TTS_MCP_DATA_DIR=${dataDir}`)} -- ${shellQuote(command)} mcp`;
  }
  if (clientId === "claude-code") {
    return `claude mcp add --scope user --env ${shellQuote(`TTS_MCP_DATA_DIR=${dataDir}`)} volo-tts -- ${shellQuote(command)} mcp`;
  }

  const server = { command, args, env };
  const config =
    clientId === "zed"
      ? { context_servers: { "volo-tts": server } }
      : { mcpServers: { "volo-tts": server } };
  return JSON.stringify(config, null, 2);
}

const BUNDLED_SEED_DIRECTORY = "resources/seed-voices";
// Set once VieNeu presets were seeded as profiles, so voices the user deletes stay deleted.
const VIENEU_SEEDED_KEY = "volo-ai.vieneu-presets-seeded";
type SeedImportResult = {
  imported: Array<{ id: string; name: string; language: string }>;
  skipped: Array<{ id: string; name: string; reason: string }>;
  errors: Array<{ id: string; message: string }>;
};
type ImportStatus = { message: string; tone: "success" | "error" };

type AdvancedDraft = {
  duration: string;
  steps: string;
  guidance_scale: string;
  t_shift: string;
  position_temperature: string;
  class_temperature: string;
  layer_penalty_factor: string;
  denoise: boolean;
  preprocess_prompt: boolean;
  postprocess_output: boolean;
  audio_chunk_duration: string;
  audio_chunk_threshold: string;
  pad_duration: string;
  fade_duration: string;
  normalize_text: boolean;
};

type VieNeuDraft = {
  temperature: string;
  top_k: string;
  top_p: string;
  repetition_penalty: string;
  repetition_window: string;
  do_sample: boolean;
  seed: string;
};

const DEFAULT_ADVANCED: AdvancedDraft = {
  duration: "",
  steps: "32",
  guidance_scale: "2.0",
  t_shift: "0.1",
  position_temperature: "5.0",
  class_temperature: "0.0",
  layer_penalty_factor: "5.0",
  denoise: true,
  preprocess_prompt: true,
  postprocess_output: true,
  audio_chunk_duration: "15.0",
  audio_chunk_threshold: "30.0",
  pad_duration: "0.1",
  fade_duration: "0.1",
  normalize_text: false,
};

const DEFAULT_VIENEU: VieNeuDraft = {
  temperature: "0.8",
  top_k: "25",
  top_p: "0.95",
  repetition_penalty: "1.2",
  repetition_window: "64",
  do_sample: true,
  seed: "",
};

const DEFAULT_VIENEU_CONFIG: VieNeuConfig = {
  temperature: 0.8,
  top_k: 25,
  top_p: 0.95,
  repetition_penalty: 1.2,
  repetition_window: 64,
  do_sample: true,
};

function readAdvancedNumber(
  value: string,
  label: string,
  options: { integer?: boolean; positive?: boolean } = {},
): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    (options.integer && !Number.isInteger(number)) ||
    (options.positive ? number <= 0 : number < 0)
  )
    throw new Error(`${label}: invalid value`);
  return number;
}

function readVieNeuConfig(draft: VieNeuDraft, invalidMessage: string): VieNeuConfig {
  const readRequired = (
    value: string,
    label: string,
    options: { integer?: boolean; positive?: boolean } = {},
  ) => {
    const number = readAdvancedNumber(value, label, options);
    if (number === undefined || (options.integer && !Number.isSafeInteger(number))) {
      throw new Error(invalidMessage);
    }
    return number;
  };
  const temperature = readRequired(draft.temperature, "temperature");
  const topK = readRequired(draft.top_k, "top_k", { integer: true, positive: true });
  const topP = readRequired(draft.top_p, "top_p", { positive: true });
  const repetitionPenalty = readRequired(draft.repetition_penalty, "repetition_penalty", {
    positive: true,
  });
  const repetitionWindow = readRequired(draft.repetition_window, "repetition_window", {
    integer: true,
  });
  const seed = draft.seed.trim() ? readRequired(draft.seed, "seed", { integer: true }) : undefined;
  if (topP > 1) throw new Error(invalidMessage);

  const config: VieNeuConfig = {};
  if (temperature !== DEFAULT_VIENEU_CONFIG.temperature) config.temperature = temperature;
  if (topK !== DEFAULT_VIENEU_CONFIG.top_k) config.top_k = topK;
  if (topP !== DEFAULT_VIENEU_CONFIG.top_p) config.top_p = topP;
  if (repetitionPenalty !== DEFAULT_VIENEU_CONFIG.repetition_penalty) {
    config.repetition_penalty = repetitionPenalty;
  }
  if (repetitionWindow !== DEFAULT_VIENEU_CONFIG.repetition_window) {
    config.repetition_window = repetitionWindow;
  }
  if (draft.do_sample !== DEFAULT_VIENEU_CONFIG.do_sample) config.do_sample = draft.do_sample;
  if (seed !== undefined) config.seed = seed;
  return config;
}

function readSynthesisLanguage(): Language {
  const saved =
    localStorage.getItem("volo-ai.synthesis-language") ?? localStorage.getItem("volo-ai.language");
  return saved === "vi" ? "vi" : "en";
}

function readProvider(): ProviderId {
  return typeof window !== "undefined" && localStorage.getItem("volo-ai.provider") === "vieneu"
    ? "vieneu"
    : "omnivoice";
}

function providerIsReady(status: ProviderStatus | undefined): boolean {
  return Boolean(status?.model_ready && status.runtime_available && status.preprocessing_available);
}

function backendLabel(backend: string, copy: UiCopy): string {
  const normalized = backend.toLowerCase();
  if (normalized.startsWith("cuda")) return copy.backendCuda;
  if (normalized === "mps") return copy.backendMps;
  if (normalized === "cpu") return copy.backendCpu;
  return backend.toUpperCase();
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1048576).toLocaleString()} MB`;
}

function formatLogTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function fileName(path: string | undefined): string {
  return path?.split(/[\\/]/).pop() || "Reference audio";
}

// Profile names become filenames, so the engine accepts only ASCII letters, digits, "_" and "-".
function toVoiceName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
}

function voiceNameFromFile(path: string): string {
  return toVoiceName(fileName(path).replace(/\.[^.]+$/, "")) || "imported-voice";
}

function preferredVoiceForLanguage(voices: VoiceProfile[], language: Language): string {
  return (
    voices.find(
      (voice) => voice.kind !== "vieneu_preset" && voice.language === language && voice.is_default,
    )?.name ??
    voices.find((voice) => voice.kind !== "vieneu_preset" && voice.language === language)?.name ??
    "auto"
  );
}

const TRANSCRIBE_PHASES = new Set(["metadata", "fetch", "audio", "transcribe"]);
const SUPPORTED_VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "fb.watch",
]);

function isSupportedVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      SUPPORTED_VIDEO_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

const MAX_SESSION_TAKES = 5;

function ElapsedTime() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="ml-auto font-mono text-xs tabular-nums">{formatDuration(seconds)}</span>;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function srtFileName(title: string): string {
  const safe = title
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${(safe || "transcript").slice(0, 80)}.srt`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-(--muted-foreground)">
      {children}
    </p>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-x-5 gap-y-4">
      <div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-(--accent)">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-(--foreground) sm:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-(--muted-foreground)">
            {description}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-(--destructive-border) bg-(--destructive-surface) px-3.5 py-3 text-sm leading-5 text-(--destructive)"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function UpdateBanner({
  copy,
  tag,
  onOpenRelease,
  onDismiss,
}: {
  copy: UiCopy;
  tag: string;
  onOpenRelease: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-(--border) bg-(--surface) px-4 py-3"
    >
      <Sparkles className="size-5 shrink-0 text-(--accent)" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{copy.updateBannerTitle(tag)}</p>
        <p className="text-xs leading-5 text-(--muted-foreground)">
          {copy.updateBannerDescription}
        </p>
      </div>
      <Button size="sm" onClick={onOpenRelease}>
        <ArrowUpRight className="size-4" />
        {copy.updateViewRelease}
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={onDismiss} aria-label={copy.updateDismiss}>
        <X className="size-4" />
      </Button>
    </div>
  );
}

function SetupScreen({
  copy,
  providers,
  progressEvents,
  providerErrors,
  preparingProviders,
  isPreparing,
  isCancelling,
  setupError,
  canPrepare,
  omniVoiceReady,
  engineFailed,
  onRetryEngine,
  onPrepareAll,
  onCancel,
  onOpenProfiles,
  onOpenHistory,
  onOpenSettings,
  onOpenLogs,
  onOpenTranscribe,
}: {
  copy: UiCopy;
  providers: Record<ProviderId, ProviderStatus> | null;
  progressEvents: Record<ProviderId, ProgressEvent | null>;
  providerErrors: Partial<Record<ProviderId, string>>;
  preparingProviders: ProviderId[];
  isPreparing: boolean;
  isCancelling: boolean;
  setupError: string | null;
  canPrepare: boolean;
  omniVoiceReady: boolean;
  engineFailed: boolean;
  onRetryEngine: () => void;
  onPrepareAll: () => void;
  onCancel: () => void;
  onOpenProfiles: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenLogs: () => void;
  onOpenTranscribe: () => void;
}) {
  const providerChoices: Array<[ProviderId, string, string[], string]> = [
    [
      "omnivoice",
      copy.providerOmni,
      [copy.setupAssetOmniVoice, copy.setupAssetTokenizer, copy.setupAssetWhisper],
      copy.setupAssetsDescription,
    ],
    [
      "vieneu",
      copy.providerVieNeu,
      [copy.setupAssetVieNeuModel, copy.setupAssetVieNeuVoices, copy.setupAssetVieNeuEncoder],
      copy.setupAssetsVieNeuDescription,
    ],
  ];
  const hasErrors = Boolean(setupError || Object.values(providerErrors).some(Boolean));
  return (
    <main className="flex min-h-screen items-center justify-center overflow-auto bg-(--background) px-6 py-10 text-(--foreground)">
      <div className="w-full max-w-4xl">
        <div className="mb-9 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-(--accent) text-white shadow-[0_12px_30px_rgb(191_95_69/22%)]">
            <AudioLines className="size-5" />
          </div>
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-(--muted-foreground)">
              VOLO AI
            </p>
            <p className="text-sm font-semibold">{copy.localVoiceStudio}</p>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="overflow-hidden">
            <CardHeader className="p-7 pb-0">
              <div>
                <SectionLabel>{copy.firstRun}</SectionLabel>
                <CardTitle className="mt-3 text-2xl tracking-[-0.04em]">
                  {copy.prepareEngine}
                </CardTitle>
                <CardDescription className="mt-3 max-w-xl">{copy.setupCopy}</CardDescription>
              </div>
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-(--accent-soft) text-(--accent)">
                <Download className="size-5" />
              </div>
            </CardHeader>
            <CardContent className="p-7">
              <section className="mb-5">
                <SectionLabel>{copy.requiredModels}</SectionLabel>
                <div className="mt-3 grid gap-3">
                  {providerChoices.map(([id, label]) => {
                    const status = providers?.[id];
                    const progressEvent = progressEvents[id];
                    const progress = status?.model_ready
                      ? 100
                      : Math.round((progressEvent?.progress ?? 0) * 100);
                    const isReady = providerIsReady(status);
                    const isInstalling = preparingProviders.includes(id);
                    return (
                      <div
                        key={id}
                        className="rounded-2xl border border-(--border) bg-(--surface-muted) p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold">{label}</p>
                          <Badge variant={isReady ? "success" : "destructive"}>
                            {isReady ? copy.ready : copy.unavailable}
                          </Badge>
                        </div>
                        <Progress value={progress} className="mt-3" />
                        <p className="mt-2 text-xs leading-5 text-(--muted-foreground)">
                          {progressEvent?.message ??
                            status?.unavailable_reason ??
                            (isInstalling
                              ? copy.preparingModels
                              : engineFailed
                                ? copy.engineUnavailable
                                : copy.waitingEngine)}
                        </p>
                        {progressEvent?.asset && (
                          <p className="mt-1 font-mono text-[10px] uppercase text-(--muted-foreground)">
                            {progressEvent.asset}
                          </p>
                        )}
                        {providerErrors[id] && (
                          <div className="mt-3">
                            <ErrorMessage>{providerErrors[id]}</ErrorMessage>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
              {setupError && (
                <div className="mt-4">
                  <ErrorMessage>{setupError}</ErrorMessage>
                </div>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                {engineFailed ? (
                  // Without a running engine the model state is unknown, so retry the engine first.
                  <Button onClick={onRetryEngine}>
                    <RotateCcw className="size-4" />
                    {copy.retryProfiles}
                  </Button>
                ) : (
                  <Button
                    onClick={onPrepareAll}
                    disabled={isPreparing || isCancelling || !canPrepare}
                  >
                    {isPreparing ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    {isPreparing
                      ? copy.preparingModels
                      : hasErrors
                        ? copy.retryDownload
                        : copy.downloadModel}
                  </Button>
                )}
                {isPreparing && (
                  <Button variant="secondary" onClick={onCancel} disabled={isCancelling}>
                    <CircleStop className="size-4" />
                    {isCancelling ? copy.cancelling : copy.cancelDownload}
                  </Button>
                )}
                {omniVoiceReady && (
                  <Button variant="ghost" onClick={onOpenTranscribe}>
                    <Captions className="size-4" />
                    {copy.transcribe}
                  </Button>
                )}
                <Button variant="ghost" onClick={onOpenProfiles}>
                  <Library className="size-4" />
                  {copy.voiceProfiles}
                </Button>
                <Button variant="ghost" onClick={onOpenHistory}>
                  <History className="size-4" />
                  {copy.audioHistory}
                </Button>
                <Button variant="ghost" onClick={onOpenSettings}>
                  <Settings2 className="size-4" />
                  {copy.settings}
                </Button>
                <Button variant="ghost" onClick={onOpenLogs}>
                  <Logs className="size-4" />
                  {copy.logs}
                </Button>
              </div>
              <p className="mt-4 text-xs leading-5 text-(--muted-foreground)">
                {copy.resumeDownload}
              </p>
            </CardContent>
          </Card>
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <div>
                  <SectionLabel>{copy.setupDownloads}</SectionLabel>
                  <CardTitle className="mt-2">
                    {copy.providerOmni} + {copy.providerVieNeu}
                  </CardTitle>
                </div>
                <ShieldCheck className="size-5 text-(--success)" />
              </CardHeader>
              <CardContent className="space-y-5">
                {providerChoices.map(([id, label, assets, description]) => (
                  <div key={id}>
                    <p className="mb-2 text-sm font-semibold">{label}</p>
                    <div className="space-y-2">
                      {assets.map((asset) => (
                        <div
                          key={asset}
                          className="flex items-center gap-3 rounded-xl border border-(--border) bg-(--surface-muted) px-3.5 py-3 text-sm"
                        >
                          <CheckCircle2 className="size-4 text-(--success)" />
                          {asset}
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-(--muted-foreground)">
                      {description}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <SectionLabel>{copy.setupAfter}</SectionLabel>
                  <CardTitle className="mt-2">{copy.setupAfterTitle}</CardTitle>
                </div>
                <Sparkles className="size-5 text-(--accent)" />
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm leading-6 text-(--muted-foreground)">
                  {copy.setupAfterDescription}
                </p>
                <div className="mt-5 flex items-center gap-2 text-xs font-semibold">
                  <HardDrive className="size-4 text-(--accent)" />
                  {copy.setupStorageValue}
                </div>
                <p className="mt-2 text-xs leading-5 text-(--muted-foreground)">
                  {copy.setupStorageDescription}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}

function LogsView({
  logs,
  copy,
  onClearLogs,
  onExportDiagnostics,
  isExportingDiagnostics,
  diagnosticsIncomplete,
}: {
  logs: RequestLog[];
  copy: UiCopy;
  onClearLogs: () => void;
  onExportDiagnostics: () => void;
  isExportingDiagnostics: boolean;
  diagnosticsIncomplete: boolean;
}) {
  const [filter, setFilter] = useState<"all" | "success" | "error">("all");
  const successCount = logs.filter((entry) => entry.status === "success").length;
  const errorCount = logs.filter((entry) => entry.status === "error").length;

  const filteredLogs = useMemo(() => {
    if (filter === "success") return logs.filter((l) => l.status === "success");
    if (filter === "error") return logs.filter((l) => l.status === "error");
    return logs;
  }, [logs, filter]);

  return (
    <div>
      <PageHeader
        eyebrow={copy.logsEyebrow}
        title={copy.localActivity}
        description={copy.logsDescription}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-(--border) bg-(--surface) p-1">
              <ToggleGroup
                multiple={false}
                value={[filter]}
                onValueChange={(value) => {
                  if (value[0]) setFilter(value[0] as "all" | "success" | "error");
                }}
                spacing={0}
                aria-label={copy.logsDescription}
              >
                {(
                  [
                    ["all", copy.filterAll],
                    ["success", copy.filterSuccess],
                    ["error", copy.filterError],
                  ] as const
                ).map(([f, label]) => (
                  <ToggleGroupItem key={f} value={f} size="sm">
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            {logs.length > 0 && (
              <Button variant="ghost" size="sm" onClick={onClearLogs} title={copy.clearLogs}>
                <Trash2 className="size-3.5 text-(--destructive)" />
                <span className="text-xs text-(--destructive)">{copy.clearLogs}</span>
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={onExportDiagnostics}
              disabled={isExportingDiagnostics}
            >
              {isExportingDiagnostics ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <FileText className="size-3.5" />
              )}
              {isExportingDiagnostics ? copy.exportingDiagnostics : copy.exportDiagnostics}
            </Button>
          </div>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          [logs.length, copy.requests, "text-(--foreground)"],
          [successCount, copy.success, "text-(--success)"],
          [errorCount, copy.errors, "text-(--destructive)"],
        ].map(([value, label, color]) => (
          <Card key={String(label)} className="rounded-xl">
            <CardContent className="p-4">
              <p className={`text-2xl font-semibold tracking-[-0.04em] ${color}`}>{value}</p>
              <p className="mt-1 text-xs text-(--muted-foreground)">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        {filteredLogs.length === 0 ? (
          <CardContent className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
            <div className="grid size-12 place-items-center rounded-2xl bg-(--surface-muted) text-(--muted-foreground)">
              <Logs className="size-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold">{copy.noRequests}</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-(--muted-foreground)">
              {copy.logsEmpty}
            </p>
          </CardContent>
        ) : (
          <div className="divide-y divide-(--border)">
            {filteredLogs.map((entry) => (
              <motion.article
                key={entry.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-4 p-5"
              >
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${entry.status === "success" ? "bg-(--success)" : entry.status === "error" ? "bg-(--destructive)" : "animate-pulse bg-(--accent)"}`}
                  aria-label={entry.status}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-semibold">
                      {copy.operationLabels[entry.operation as keyof UiCopy["operationLabels"]] ??
                        entry.operation}
                    </p>
                    <Badge
                      variant={
                        entry.status === "error"
                          ? "destructive"
                          : entry.status === "success"
                            ? "success"
                            : "default"
                      }
                    >
                      {entry.status === "pending"
                        ? copy.running
                        : (entry.status === "success"
                            ? copy.success
                            : copy.statusError
                          ).toUpperCase()}
                    </Badge>
                  </div>
                  {entry.errorMessage && (
                    <p
                      className={`mt-2 text-sm ${entry.status === "error" ? "text-(--destructive)" : "text-(--muted-foreground)"}`}
                    >
                      {entry.errorMessage}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.08em] text-(--muted-foreground)">
                    <span>{entry.operation}</span>
                    <span>
                      {copy.request} / {entry.requestId ?? entry.id}
                    </span>
                    <span>{formatLogTime(entry.startedAt)}</span>
                    {entry.provider && <span>{entry.provider}</span>}
                    {entry.stage && <span>{entry.stage}</span>}
                    {entry.asset && <span>{entry.asset}</span>}
                    {entry.durationMs !== undefined && (
                      <span>
                        {entry.durationMs} {copy.milliseconds}
                      </span>
                    )}
                    {entry.errorCode && (
                      <span>
                        {copy.code} / {entry.errorCode}
                      </span>
                    )}
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </Card>
      {diagnosticsIncomplete && (
        <p role="status" className="mt-3 text-sm text-(--muted-foreground)">
          {copy.diagnosticsIncomplete}
        </p>
      )}
      <p className="mt-4 text-xs leading-5 text-(--muted-foreground)">{copy.logsPrivacy}</p>
    </div>
  );
}

function VoiceProfilesView({
  voices,
  presetVoices,
  isLoading,
  listError,
  formError,
  profileName,
  profileKind,
  profilePresetId,
  refAudio,
  refText,
  designInstruction,
  isSaving,
  isImporting,
  isImportingSeed,
  isSeedingVieNeu,
  isCancellingSeed,
  seedProgress,
  seedResult,
  seedError,
  importStatus,
  seedImportStatus,
  deletingVoice,
  copy,
  onChooseReference,
  onImportVoiceFile,
  onImportSeedFolder,
  onSeedVieNeuVoices,
  onCancelSeed,
  onProfileNameChange,
  onProfilePresetIdChange,
  onRefTextChange,
  onProfileKindChange,
  onDesignInstructionChange,
  onSave,
  onRetry,
  onUse,
  onDelete,
}: {
  voices: VoiceProfile[];
  presetVoices: Array<{ id: string; name: string; label: string }>;
  isLoading: boolean;
  listError: string | null;
  formError: string | null;
  profileName: string;
  profileKind: VoiceKind;
  profilePresetId: string;
  refAudio: string | null;
  refText: string;
  designInstruction: string;
  isSaving: boolean;
  isImporting: boolean;
  isImportingSeed: boolean;
  isSeedingVieNeu: boolean;
  isCancellingSeed: boolean;
  seedProgress: ProgressEvent | null;
  seedResult: SeedVieNeuResult | null;
  seedError: string | null;
  importStatus: ImportStatus | null;
  seedImportStatus: ImportStatus | null;
  deletingVoice: string | null;
  copy: UiCopy;
  onChooseReference: () => void;
  onImportVoiceFile: () => void;
  onImportSeedFolder: () => void;
  onSeedVieNeuVoices: () => void;
  onCancelSeed: () => void;
  onProfileNameChange: (value: string) => void;
  onProfilePresetIdChange: (value: string) => void;
  onRefTextChange: (value: string) => void;
  onProfileKindChange: (value: VoiceKind) => void;
  onDesignInstructionChange: (value: string) => void;
  onSave: () => Promise<void>;
  onRetry: () => void;
  onUse: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const activeImportStatus = importStatus ?? seedImportStatus;
  return (
    <div>
      <PageHeader
        eyebrow={copy.profilesEyebrow}
        title={copy.profilesTitle}
        description={copy.profilesDescription}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onSeedVieNeuVoices}
              disabled={isSeedingVieNeu}
            >
              {isSeedingVieNeu ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <AudioLines className="size-4 text-(--accent)" />
              )}
              {isSeedingVieNeu ? copy.seedingVieNeuVoices : copy.seedVieNeuVoices}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onImportVoiceFile}
              disabled={isImporting || isImportingSeed || isSaving}
            >
              {isImporting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <FileAudio className="size-4 text-(--accent)" />
              )}
              {isImporting ? copy.importingVoiceFile : copy.importVoiceFile}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onImportSeedFolder}
              disabled={isImporting || isImportingSeed || isSaving}
            >
              {isImportingSeed ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <FolderOpen className="size-4 text-(--accent)" />
              )}
              {isImportingSeed ? copy.importingSeedFolder : copy.importSeedFolder}
            </Button>
          </div>
        }
      />
      <ul className="mb-5 space-y-1 text-xs leading-5 text-(--muted-foreground)">
        <li>
          <span className="font-semibold text-(--foreground)">{copy.importVoiceFile}:</span>{" "}
          {copy.voiceImportDescription}
        </li>
        <li>
          <span className="font-semibold text-(--foreground)">{copy.importSeedFolder}:</span>{" "}
          {copy.seedImportDescription}
        </li>
      </ul>
      {activeImportStatus && (
        <div
          className={`mb-5 rounded-xl border px-4 py-3 text-sm ${activeImportStatus.tone === "error" ? "border-(--destructive-border) bg-(--destructive-surface) text-(--destructive)" : "border-(--success-border) bg-(--success-surface) text-(--success)"}`}
          role={activeImportStatus.tone === "error" ? "alert" : "status"}
        >
          {activeImportStatus.message}
        </div>
      )}
      {(isSeedingVieNeu || seedResult || seedError) && (
        <div
          className={`mb-5 rounded-xl border px-4 py-3 text-sm ${seedError || seedResult?.failed.length || seedResult?.unfinished.length ? "border-(--destructive-border) bg-(--destructive-surface) text-(--destructive)" : "border-(--accent-border) bg-(--accent-soft) text-(--foreground)"}`}
          role={
            seedError || seedResult?.failed.length || seedResult?.unfinished.length
              ? "alert"
              : "status"
          }
        >
          {seedError ? (
            <p>{seedError}</p>
          ) : (
            <div className="space-y-2">
              {isSeedingVieNeu && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="flex min-w-0 items-center gap-2">
                    <LoaderCircle className="size-4 shrink-0 animate-spin" />
                    <span className="truncate">
                      {seedProgress?.message ?? copy.seedingVieNeuVoices}
                      {seedProgress?.preset_id ? ` · ${seedProgress.preset_id}` : ""}
                      {seedProgress?.current && seedProgress.total
                        ? ` · ${seedProgress.current}/${seedProgress.total}`
                        : ""}
                    </span>
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onCancelSeed}
                    disabled={isCancellingSeed}
                  >
                    {isCancellingSeed ? copy.cancellingSeed : copy.cancelSeed}
                  </Button>
                </div>
              )}
              {seedResult && (
                <>
                  <p>
                    {seedResult.cancelled ? copy.seedVieNeuCancelled : copy.seedVieNeuCompleted}
                    {" · "}
                    {seedResult.profiles.filter((item) => item.status === "created").length}{" "}
                    {copy.seedCreated}
                    {" · "}
                    {seedResult.profiles.filter((item) => item.status === "updated").length}{" "}
                    {copy.seedUpdated}
                    {" · "}
                    {seedResult.profiles.filter((item) => item.status === "reused").length}{" "}
                    {copy.seedReused}
                  </p>
                  {seedResult.failed.length > 0 && (
                    <p>
                      {copy.seedFailed}:{" "}
                      {seedResult.failed
                        .map((item) => `${item.preset_id} (${item.message})`)
                        .join(", ")}
                    </p>
                  )}
                  {seedResult.unfinished.length > 0 && (
                    <p>
                      {copy.seedUnfinished}: {seedResult.unfinished.join(", ")}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <div>
              <SectionLabel>{copy.voiceLibrary}</SectionLabel>
              <CardTitle className="mt-2 first-letter:uppercase">
                {copy.savedProfiles} · {voices.length}
              </CardTitle>
            </div>
            {isLoading && <LoaderCircle className="size-4 animate-spin text-(--accent)" />}
          </CardHeader>
          <CardContent>
            {listError && (
              <div className="mb-4 flex items-center justify-between gap-3">
                <ErrorMessage>{listError}</ErrorMessage>
                <Button variant="ghost" size="sm" onClick={onRetry} disabled={isLoading}>
                  {copy.retryProfiles}
                </Button>
              </div>
            )}
            {isLoading && !listError && (
              <div className="space-y-3">
                {[1, 2].map((item) => (
                  <Skeleton key={item} className="h-24 w-full" />
                ))}
              </div>
            )}
            {!isLoading && !listError && voices.length === 0 && (
              <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-(--border-strong) bg-(--surface-muted) p-8 text-center">
                <div className="grid size-12 place-items-center rounded-2xl bg-(--accent-soft) text-(--accent)">
                  <AudioLines className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold">{copy.emptyProfilesTitle}</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-(--muted-foreground)">
                  {copy.emptyProfilesDescription}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-5"
                  onClick={() => nameInputRef.current?.focus()}
                >
                  <Plus className="size-4" />
                  {copy.createFirstProfile}
                </Button>
              </div>
            )}
            {!isLoading && !listError && voices.length > 0 && (
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {voices.map((voice) => {
                    const manifestPreset =
                      voice.kind === "vieneu_preset"
                        ? presetVoices.find((item) => item.id === voice.preset_id)
                        : undefined;
                    return (
                      <motion.article
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        key={voice.name}
                        className="rounded-2xl border border-(--border) bg-(--surface-muted) p-4 transition-colors hover:border-(--border-strong)"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-(--accent) text-white">
                              <AudioLines className="size-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate font-semibold">{voice.name}</h3>
                                <Badge variant="success">{copy.profileReady}</Badge>
                                <Badge variant="outline">
                                  {voice.kind === "design"
                                    ? copy.designVoice
                                    : voice.kind === "vieneu_preset"
                                      ? copy.vieneuPresetProfile
                                      : copy.cloneVoice}
                                </Badge>
                                {voice.is_default && <Badge>{copy.defaultVoice}</Badge>}
                              </div>
                              <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-[10px] uppercase tracking-[0.08em] text-(--muted-foreground)">
                                {voice.kind === "design" ? (
                                  <Sparkles className="size-3" />
                                ) : (
                                  <FileAudio className="size-3" />
                                )}
                                {voice.kind === "vieneu_preset"
                                  ? `${copy.presetIdLabel}: ${voice.preset_id ?? ""}${manifestPreset ? ` · ${manifestPreset.name} · ${manifestPreset.label}` : ""}`
                                  : `${voice.language?.toUpperCase()} · ${
                                      voice.kind === "design"
                                        ? copy.designProfileSummary
                                        : fileName(voice.ref_audio ?? undefined)
                                    }`}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="destructive"
                            size="icon"
                            aria-label={`${copy.deleteProfile}: ${voice.name}`}
                            onClick={() => onDelete(voice.name)}
                            disabled={deletingVoice === voice.name}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-(--border) pt-3">
                          <div className="min-w-0 text-xs text-(--muted-foreground)">
                            {voice.kind === "design" ? (
                              <span className="line-clamp-2">
                                {voice.design_instruction ?? copy.designProfileSummary}
                              </span>
                            ) : voice.kind === "vieneu_preset" ? (
                              <span>
                                {copy.providerVieNeu}
                                {voice.ref_audio ? " · OmniVoice WAV" : ""}
                                {manifestPreset
                                  ? ` · ${manifestPreset.name} · ${manifestPreset.label}`
                                  : ""}
                              </span>
                            ) : (
                              <span className="flex gap-3">
                                <span>{copy.sourceAudio}</span>
                                <span>·</span>
                                <span>
                                  {voice.ref_text?.trim()
                                    ? copy.transcriptIncluded
                                    : copy.noTranscript}
                                </span>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {voice.ref_audio && (
                              <InlineAudioPreview
                                audioPath={voice.ref_audio}
                                label={copy.previewAudio}
                                pauseLabel={copy.pauseAudio}
                              />
                            )}
                            <Button size="sm" onClick={() => onUse(voice.name)}>
                              <Play className="size-3.5" />
                              {copy.useProfile}
                            </Button>
                          </div>
                        </div>
                      </motion.article>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <div>
              <SectionLabel>{copy.createProfile}</SectionLabel>
              <CardTitle className="mt-2">{copy.createProfile}</CardTitle>
            </div>
            <Plus className="size-5 text-(--accent)" />
          </CardHeader>
          <CardContent>
            <CardDescription>
              {profileKind === "design"
                ? copy.createDesignProfileDescription
                : profileKind === "vieneu_preset"
                  ? copy.createVieNeuPresetProfileDescription
                  : copy.createProfileDescription}
            </CardDescription>
            {formError && (
              <div className="mt-4">
                <ErrorMessage>{formError}</ErrorMessage>
              </div>
            )}
            <form
              className="mt-5 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void onSave();
              }}
            >
              <div className="rounded-xl border border-(--border) bg-(--surface-muted) p-1">
                <ToggleGroup
                  multiple={false}
                  value={[profileKind]}
                  onValueChange={(value) => {
                    if (value[0]) onProfileKindChange(value[0] as VoiceKind);
                  }}
                  spacing={0}
                  className="grid w-full grid-cols-3"
                  aria-label={copy.createProfile}
                >
                  {(["clone", "design", "vieneu_preset"] as VoiceKind[]).map((kind) => (
                    <ToggleGroupItem
                      key={kind}
                      value={kind}
                      className="h-auto min-h-9 min-w-0 px-1.5 py-1.5 text-center text-xs leading-tight whitespace-normal"
                    >
                      {kind === "design"
                        ? copy.designVoice
                        : kind === "vieneu_preset"
                          ? copy.vieneuPresetProfile
                          : copy.cloneVoice}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="profile-name">{copy.profileName}</FieldLabel>
                  <Input
                    ref={nameInputRef}
                    id="profile-name"
                    value={profileName}
                    placeholder={copy.profileNamePlaceholder}
                    disabled={isSaving}
                    onChange={(event) => onProfileNameChange(event.target.value)}
                  />
                </Field>
                {profileKind === "clone" ? (
                  <>
                    <Field>
                      <FieldLabel>{copy.referenceAudio}</FieldLabel>
                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full justify-start"
                          onClick={onChooseReference}
                          disabled={isSaving}
                        >
                          <FolderOpen className="size-4 text-(--accent)" />
                          <span className="truncate">
                            {refAudio ? fileName(refAudio) : copy.noAudioSelected}
                          </span>
                        </Button>
                        {refAudio && (
                          <div className="flex items-center gap-2">
                            <InlineAudioPreview
                              audioPath={refAudio}
                              label={copy.previewAudio}
                              pauseLabel={copy.pauseAudio}
                            />
                          </div>
                        )}
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="profile-transcript">
                        {copy.referenceTranscript}
                      </FieldLabel>
                      <Textarea
                        id="profile-transcript"
                        value={refText}
                        placeholder={copy.optionalTranscript}
                        disabled={isSaving}
                        onChange={(event) => onRefTextChange(event.target.value)}
                      />
                    </Field>
                  </>
                ) : profileKind === "design" ? (
                  <Field>
                    <FieldLabel htmlFor="profile-design-instruction">
                      {copy.voiceDesignInstruction}
                    </FieldLabel>
                    <Textarea
                      id="profile-design-instruction"
                      value={designInstruction}
                      placeholder={copy.voiceDesignPlaceholder}
                      disabled={isSaving}
                      onChange={(event) => onDesignInstructionChange(event.target.value)}
                    />
                    <p className="text-xs leading-5 text-(--muted-foreground)">
                      {copy.voiceDesignExample}
                    </p>
                  </Field>
                ) : (
                  <Field>
                    <FieldLabel htmlFor="profile-vieneu-preset">
                      {copy.vieneuPresetSelector}
                    </FieldLabel>
                    {presetVoices.length > 0 ? (
                      <Select
                        value={profilePresetId || null}
                        items={presetVoices.map((voice) => ({
                          value: voice.id,
                          label: `${voice.name} · ${voice.label}`,
                        }))}
                        onValueChange={(value) => {
                          if (typeof value === "string") onProfilePresetIdChange(value);
                        }}
                        disabled={isSaving}
                      >
                        <SelectTrigger
                          id="profile-vieneu-preset"
                          aria-label={copy.vieneuPresetSelector}
                        >
                          <SelectValue placeholder={copy.vieneuPresetSelector} />
                        </SelectTrigger>
                        <SelectContent>
                          {presetVoices.map((voice) => (
                            <SelectItem key={voice.id} value={voice.id}>
                              {voice.name} · {voice.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="rounded-xl border border-(--border) bg-(--surface-muted) p-3 text-xs leading-5 text-(--muted-foreground)">
                        {copy.vieneuPresetCatalogUnavailable}
                      </p>
                    )}
                  </Field>
                )}
              </FieldGroup>
              <Button
                type="submit"
                className="w-full"
                disabled={
                  isSaving || (profileKind === "vieneu_preset" && presetVoices.length === 0)
                }
              >
                <Plus className="size-4" />
                {isSaving ? copy.savingProfile : copy.createProfileButton}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SettingsView({
  copy,
  appLanguage,
  theme,
  selectedProvider,
  providers,
  modelReady,
  engineOnline,
  device,
  resources,
  dataDir,
  modelId,
  tokenizerId,
  asrModelId,
  modelStatusError,
  setupError,
  progressEvent,
  nvidiaRuntime,
  runtimeProgress,
  runtimeError,
  runtimeRestartRequired,
  isInstallingRuntime,
  isRemovingRuntime,
  isRefreshingStatus,
  isPreparing,
  preparingProviders,
  localApi,
  localApiError,
  isStartingLocalApi,
  isStoppingLocalApi,
  onStartLocalApi,
  onStopLocalApi,
  isCheckingUpdates,
  manualUpdateFeedback,
  onChangeLanguage,
  onChangeTheme,
  onSelectProvider,
  onPrepareProvider,
  onCancelPrepare,
  onRefreshStatus,
  onInstallRuntime,
  onCancelRuntime,
  onRemoveRuntime,
  onCheckForUpdates,
  onOpenCommunityPage,
  onBack,
}: {
  copy: UiCopy;
  appLanguage: AppLanguage;
  theme: ThemeMode;
  selectedProvider: ProviderId;
  providers: Record<ProviderId, ProviderStatus> | null;
  modelReady: boolean;
  engineOnline: boolean;
  device: string;
  resources: StatusResult["resources"];
  dataDir: string | null;
  modelId: string;
  tokenizerId: string;
  asrModelId: string;
  modelStatusError: string | null;
  setupError: string | null;
  progressEvent: ProgressEvent | null;
  nvidiaRuntime?: NvidiaRuntimeStatus;
  runtimeProgress: ProgressEvent | null;
  runtimeError: string | null;
  runtimeRestartRequired: boolean;
  isInstallingRuntime: boolean;
  isRemovingRuntime: boolean;
  isRefreshingStatus: boolean;
  isPreparing: boolean;
  preparingProviders: ProviderId[];
  localApi: LocalApiState | null;
  localApiError: string | null;
  isStartingLocalApi: boolean;
  isStoppingLocalApi: boolean;
  onStartLocalApi: () => void;
  onStopLocalApi: () => void;
  isCheckingUpdates: boolean;
  manualUpdateFeedback: "none" | "current" | "unavailable";
  onChangeLanguage: (language: AppLanguage) => void;
  onChangeTheme: (theme: ThemeMode) => void;
  onSelectProvider: (provider: ProviderId) => void;
  onPrepareProvider: (provider: ProviderId) => void;
  onCancelPrepare: () => void;
  onRefreshStatus: () => void;
  onInstallRuntime: () => void;
  onCancelRuntime: () => void;
  onRemoveRuntime: () => void;
  onCheckForUpdates: () => void;
  onOpenCommunityPage: (page: "ideas" | "repository" | "kofi") => void;
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");
  const [copiedDataDir, setCopiedDataDir] = useState(false);
  const [copiedMcpConfig, setCopiedMcpConfig] = useState(false);
  const [copiedApiUrl, setCopiedApiUrl] = useState(false);
  const [mcpClient, setMcpClient] = useState<McpClientId>("codex");
  const mcpSetupConfig = dataDir ? buildMcpConfig(mcpClient, dataDir) : copy.loadingDataPath;
  const localApiUrl = localApi?.url ?? "http://127.0.0.1:8765";

  const handleCopyDataDir = async () => {
    if (!dataDir) return;
    try {
      await navigator.clipboard.writeText(dataDir);
      setCopiedDataDir(true);
      setTimeout(() => setCopiedDataDir(false), 2000);
    } catch {}
  };

  const handleCopyMcpConfig = async () => {
    if (!dataDir) return;
    try {
      await navigator.clipboard.writeText(mcpSetupConfig);
      setCopiedMcpConfig(true);
      setTimeout(() => setCopiedMcpConfig(false), 2000);
    } catch {}
  };

  const handleCopyApiUrl = async () => {
    try {
      await navigator.clipboard.writeText(localApiUrl);
      setCopiedApiUrl(true);
      setTimeout(() => setCopiedApiUrl(false), 2000);
    } catch {}
  };

  const mcpClients: Array<[McpClientId, string]> = [
    ["codex", copy.mcpClientCodex],
    ["claude-code", copy.mcpClientClaudeCode],
    ["claude-desktop", copy.mcpClientClaudeDesktop],
    ["cursor", copy.mcpClientCursor],
    ["vscode", copy.mcpClientVSCode],
    ["zed", copy.mcpClientZed],
  ];

  const tabs: Array<[SettingsTab, string]> = [
    ["model", copy.modelTab],
    ["general", copy.generalTab],
    ["storage", copy.storageTab],
    ["mcp", copy.mcpTab],
  ];
  const assets = [copy.setupAssetOmniVoice, copy.setupAssetTokenizer, copy.setupAssetWhisper];
  const providerChoices: Array<[ProviderId, string]> = [
    ["omnivoice", copy.providerOmni],
    ["vieneu", copy.providerVieNeu],
  ];
  return (
    <div>
      <PageHeader
        eyebrow={copy.settingsEyebrow}
        title={copy.studioSettings}
        description={copy.settingsCopy}
        action={
          <Button variant="secondary" onClick={onBack}>
            <ChevronRight className="size-4 rotate-180" />
            {copy.backToSynthesize}
          </Button>
        }
      />
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value) setActiveTab(value as SettingsTab);
        }}
        className="gap-5"
      >
        <TabsList className="mb-0 w-full overflow-x-auto" aria-label={copy.studioSettings}>
          {tabs.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general" className="grid gap-5 lg:grid-cols-2">
          {activeTab === "general" && (
            <>
              <Card>
                <CardHeader>
                  <div>
                    <SectionLabel>{copy.appLanguage}</SectionLabel>
                    <CardTitle className="mt-2">{copy.interfaceLanguage}</CardTitle>
                  </div>
                  <Languages className="size-5 text-(--accent)" />
                </CardHeader>
                <CardContent>
                  <CardDescription>{copy.appLanguageDescription}</CardDescription>
                  <div className="mt-5 rounded-xl bg-(--surface-muted) p-1.5">
                    <ToggleGroup
                      multiple={false}
                      value={[appLanguage]}
                      onValueChange={(value) => {
                        if (value[0]) onChangeLanguage(value[0] as AppLanguage);
                      }}
                      spacing={0}
                      className="grid w-full grid-cols-2"
                      aria-label={copy.appLanguage}
                    >
                      {(["en", "vi"] as AppLanguage[]).map((item) => (
                        <ToggleGroupItem key={item} value={item} size="lg">
                          {item === "en" ? copy.english : copy.vietnamese}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div>
                    <SectionLabel>{copy.theme}</SectionLabel>
                    <CardTitle className="mt-2">{copy.themeTitle}</CardTitle>
                  </div>
                  <Sun className="size-5 text-(--accent)" />
                </CardHeader>
                <CardContent>
                  <CardDescription>{copy.themeDescription}</CardDescription>
                  <div className="mt-5 rounded-xl bg-(--surface-muted) p-1.5">
                    <ToggleGroup
                      multiple={false}
                      value={[theme]}
                      onValueChange={(value) => {
                        if (value[0]) onChangeTheme(value[0] as ThemeMode);
                      }}
                      spacing={0}
                      className="grid w-full grid-cols-3"
                      aria-label={copy.theme}
                    >
                      {(
                        [
                          ["light", copy.themeLight, Sun],
                          ["dark", copy.themeDark, Moon],
                          ["system", copy.themeSystem, Monitor],
                        ] as const
                      ).map(([item, label, Icon]) => (
                        <ToggleGroupItem key={item} value={item} size="lg">
                          <Icon />
                          <span>{label}</span>
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <div>
                    <SectionLabel>{copy.updateSection}</SectionLabel>
                    <CardTitle className="mt-2">{copy.updateTitle}</CardTitle>
                  </div>
                  <ArrowUpRight className="size-5 text-(--accent)" />
                </CardHeader>
                <CardContent>
                  <CardDescription>{copy.updateDescription}</CardDescription>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <Button
                      variant="secondary"
                      onClick={onCheckForUpdates}
                      disabled={isCheckingUpdates}
                    >
                      {isCheckingUpdates ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      {isCheckingUpdates ? copy.updateChecking : copy.updateCheckNow}
                    </Button>
                    {manualUpdateFeedback === "current" && (
                      <p className="text-sm text-(--muted-foreground)">{copy.updateCurrent}</p>
                    )}
                    {manualUpdateFeedback === "unavailable" && (
                      <p className="text-sm text-(--destructive)">{copy.updateUnavailable}</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <div>
                    <SectionLabel>{copy.communitySection}</SectionLabel>
                    <CardTitle className="mt-2">{copy.communityTitle}</CardTitle>
                  </div>
                  <ArrowUpRight className="size-5 text-(--accent)" />
                </CardHeader>
                <CardContent>
                  <CardDescription>{copy.communityDescription}</CardDescription>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button variant="secondary" onClick={() => onOpenCommunityPage("ideas")}>
                      {copy.suggestFeature}
                      <ArrowUpRight data-icon="inline-end" />
                    </Button>
                    <Button variant="secondary" onClick={() => onOpenCommunityPage("repository")}>
                      <Star data-icon="inline-start" />
                      {copy.starProject}
                    </Button>
                    <Button variant="secondary" onClick={() => onOpenCommunityPage("kofi")}>
                      <Coffee data-icon="inline-start" />
                      {copy.supportOnKofi}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
        <TabsContent value="model" className="grid gap-5 lg:grid-cols-2">
          {activeTab === "model" && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <SectionLabel>{copy.localEngine}</SectionLabel>
                  <CardTitle className="mt-2">{copy.modelDetails}</CardTitle>
                  <CardDescription className="mt-2">{copy.modelDescription}</CardDescription>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge variant={modelReady ? "success" : "destructive"}>
                    {modelReady ? copy.ready : copy.unavailable}
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onRefreshStatus}
                    disabled={isRefreshingStatus}
                  >
                    {isRefreshingStatus ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3.5" />
                    )}
                    {isRefreshingStatus ? copy.refreshingStatus : copy.refreshStatus}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-6">
                  <SectionLabel>{copy.providerStatus}</SectionLabel>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {providerChoices.map(([id, label]) => {
                      const status = providers?.[id];
                      const isActive = selectedProvider === id;
                      const isInstalling = preparingProviders.includes(id);
                      return (
                        <div
                          key={id}
                          className="rounded-2xl border border-(--border) bg-(--surface-muted) p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold">{label}</p>
                              <p className="mt-1 text-xs leading-5 text-(--muted-foreground)">
                                {status?.unavailable_reason ?? copy.providerRuntimeReady}
                              </p>
                            </div>
                            <Badge variant={providerIsReady(status) ? "success" : "destructive"}>
                              {providerIsReady(status) ? copy.ready : copy.unavailable}
                            </Badge>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant={isActive ? "secondary" : "ghost"}
                              disabled={isActive}
                              onClick={() => onSelectProvider(id)}
                            >
                              {isActive ? copy.activeProvider : copy.selectProvider}
                            </Button>
                            {!status?.model_ready && !isInstalling && (
                              <Button
                                size="sm"
                                onClick={() => onPrepareProvider(id)}
                                disabled={isPreparing}
                              >
                                {copy.downloadProvider}
                              </Button>
                            )}
                            {isInstalling && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={onCancelPrepare}
                                disabled={!isPreparing}
                              >
                                {copy.cancelDownload}
                              </Button>
                            )}
                          </div>
                          {isInstalling && progressEvent && (
                            <div className="mt-4">
                              <Progress value={Math.round((progressEvent.progress ?? 0) * 100)} />
                              <p className="mt-2 text-xs text-(--muted-foreground)">
                                {progressEvent.message ?? progressEvent.asset ?? copy.verifyAssets}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {nvidiaRuntime?.supported && (
                  <div className="mb-6 rounded-2xl border border-(--border) bg-(--surface-muted) p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="max-w-2xl">
                        <SectionLabel>{copy.nvidiaRuntime}</SectionLabel>
                        <h3 className="mt-2 text-base font-semibold">
                          {copy.optionalNvidiaSupport}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-(--muted-foreground)">
                          {copy.nvidiaRuntimeDescription}
                        </p>
                      </div>
                      <Badge variant={nvidiaRuntime.active ? "success" : "secondary"}>
                        {nvidiaRuntime.active
                          ? copy.nvidiaActive
                          : nvidiaRuntime.needs_update
                            ? copy.nvidiaUpdateAvailable
                            : nvidiaRuntime.installed
                              ? copy.nvidiaInstalled
                              : copy.cpuDefault}
                      </Badge>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(!nvidiaRuntime.installed || nvidiaRuntime.needs_update) &&
                        !isInstallingRuntime && (
                          <Button size="sm" onClick={onInstallRuntime}>
                            <Download className="size-3.5" />
                            {nvidiaRuntime.needs_update ? copy.updateNvidia : copy.installNvidia}
                          </Button>
                        )}
                      {isInstallingRuntime && (
                        <Button size="sm" variant="secondary" onClick={onCancelRuntime}>
                          <CircleStop className="size-3.5" />
                          {copy.cancelDownload}
                        </Button>
                      )}
                      {nvidiaRuntime.installed && !isInstallingRuntime && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={onRemoveRuntime}
                          disabled={isRemovingRuntime}
                        >
                          {isRemovingRuntime ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                          {isRemovingRuntime ? copy.removingNvidia : copy.removeNvidia}
                        </Button>
                      )}
                    </div>
                    {isInstallingRuntime && runtimeProgress && (
                      <div className="mt-4">
                        <Progress value={Math.round((runtimeProgress.progress ?? 0) * 100)} />
                        <p className="mt-2 text-xs text-(--muted-foreground)">
                          {Math.round((runtimeProgress.progress ?? 0) * 100)}% ·{" "}
                          {copy.cpuRemainsAvailable}
                        </p>
                      </div>
                    )}
                    {(runtimeError ||
                      runtimeRestartRequired ||
                      (nvidiaRuntime.installed && !nvidiaRuntime.active)) && (
                      <p role="status" className="mt-3 text-sm text-(--muted-foreground)">
                        {runtimeError ??
                          (runtimeRestartRequired
                            ? copy.restartToApplyNvidia
                            : copy.nvidiaNotActive)}
                      </p>
                    )}
                  </div>
                )}
                <div className="rounded-2xl border border-(--border) bg-(--surface-muted) p-5">
                  <div className="flex items-end justify-between gap-4">
                    <Metric
                      label={copy.modelPackage}
                      value={modelReady ? copy.verifiedAssets : copy.unverifiedAssets}
                    />
                    <span className="font-mono text-lg font-semibold text-(--accent)">
                      {modelReady ? "100%" : "0%"}
                    </span>
                  </div>
                  <Progress value={modelReady ? 100 : 0} className="mt-5" />
                  <p className="mt-3 text-xs text-(--muted-foreground)">
                    {engineOnline ? copy.offlineEngine : copy.unavailable}
                  </p>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {assets.map((asset) => (
                    <div
                      key={asset}
                      className="flex items-center gap-3 rounded-xl border border-(--border) bg-(--surface-muted) px-4 py-3"
                    >
                      <CheckCircle2
                        className={`size-4 ${modelReady ? "text-(--success)" : "text-(--muted-foreground)"}`}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{asset}</p>
                        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-(--muted-foreground)">
                          {modelReady ? copy.assetReady : copy.unavailable}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                  <Metric label={copy.modelId} value={modelId} />
                  <Metric label={copy.tokenizerId} value={tokenizerId} />
                  <Metric label={copy.asrModelId} value={asrModelId} />
                  <Metric
                    label={copy.connection}
                    value={engineOnline ? copy.offlineEngine : copy.unavailable}
                  />
                  <Metric
                    label={copy.device}
                    value={backendLabel(
                      providers?.[selectedProvider]?.backend ?? device,
                      copy,
                    )}
                  />
                  {resources?.peak_rss_bytes != null && (
                    <Metric
                      label={copy.peakMemory}
                      value={formatMegabytes(resources.peak_rss_bytes)}
                    />
                  )}
                  {resources?.gpu_memory_bytes != null && (
                    <Metric
                      label={copy.gpuMemory}
                      value={formatMegabytes(resources.gpu_memory_bytes)}
                    />
                  )}
                  <Metric label={copy.languages} value="EN · VI" />
                  <Metric label={copy.sampleRate} value="24 KHZ" />
                </div>
                {(setupError || modelStatusError) && (
                  <div className="mt-5">
                    <ErrorMessage>{setupError ?? modelStatusError}</ErrorMessage>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="storage" className="grid gap-5 lg:grid-cols-2">
          {activeTab === "storage" && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <SectionLabel>{copy.localStorage}</SectionLabel>
                  <CardTitle className="mt-2">{copy.appDataDirectory}</CardTitle>
                </div>
                <HardDrive className="size-5 text-(--accent)" />
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <code className="block flex-1 overflow-x-auto rounded-xl border border-(--border) bg-(--surface-muted) p-3.5 font-mono text-xs text-(--foreground)">
                    {dataDir ?? copy.loadingDataPath}
                  </code>
                  {dataDir && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleCopyDataDir}
                      className="shrink-0 gap-1.5"
                    >
                      {copiedDataDir ? (
                        <>
                          <Check className="size-3.5 text-(--success)" />
                          <span className="text-(--success)">{copy.appDataCopied}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" />
                          <span>{copy.copyAppData}</span>
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <p className="mt-3 text-sm leading-6 text-(--muted-foreground)">
                  {copy.storageDescription}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="mcp" className="grid gap-5 lg:grid-cols-2">
          {activeTab === "mcp" && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <SectionLabel>{copy.mcpSection}</SectionLabel>
                  <CardTitle className="mt-2">{copy.mcpTitle}</CardTitle>
                  <CardDescription className="mt-2">{copy.mcpDescription}</CardDescription>
                </div>
                <Settings2 className="size-5 text-(--accent)" />
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionLabel>{copy.mcpClientLabel}</SectionLabel>
                  <Select
                    value={mcpClient}
                    items={mcpClients.map(([value, label]) => ({ value, label }))}
                    onValueChange={(value) => {
                      if (typeof value === "string") setMcpClient(value as McpClientId);
                    }}
                  >
                    <SelectTrigger aria-label={copy.mcpClientLabel} className="max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {mcpClients.map(([id, name]) => (
                        <SelectItem key={id} value={id}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <SectionLabel>{copy.mcpConfigurationLabel}</SectionLabel>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCopyMcpConfig}
                    disabled={!dataDir}
                    className="gap-1.5"
                  >
                    {copiedMcpConfig ? (
                      <>
                        <Check className="size-3.5 text-(--success)" />
                        <span className="text-(--success)">{copy.mcpConfigCopied}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" />
                        <span>{copy.copyMcpConfig}</span>
                      </>
                    )}
                  </Button>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-xl border border-(--border) bg-(--surface-muted) p-4 font-mono text-xs leading-6 text-(--foreground)">
                  <code>{mcpSetupConfig}</code>
                </pre>
                <p className="mt-3 text-sm leading-6 text-(--muted-foreground)">
                  {copy.mcpExecutableHelp}
                </p>
                <p className="mt-2 text-sm leading-6 text-(--muted-foreground)">
                  {copy.mcpClientHelp[mcpClient]}
                </p>
                <div className="mt-4 rounded-xl border border-(--border) bg-(--surface-muted) p-4">
                  <p className="text-sm leading-6 text-(--muted-foreground)">
                    {copy.mcpVieNeuHelp}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          {activeTab === "mcp" && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <SectionLabel>{copy.apiSection}</SectionLabel>
                  <CardTitle className="mt-2">{copy.apiTitle}</CardTitle>
                  <CardDescription className="mt-2">{copy.apiDescription}</CardDescription>
                </div>
                <Globe className="size-5 text-(--accent)" />
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionLabel>{copy.apiStatusLabel}</SectionLabel>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span
                      className={`size-2 rounded-full ${localApi?.running ? "bg-(--success)" : "bg-(--muted-foreground)"}`}
                    />
                    {localApi?.running ? copy.apiStatusRunning : copy.apiStatusStopped}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <SectionLabel>{copy.apiBaseUrlLabel}</SectionLabel>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleCopyApiUrl}
                      className="gap-1.5"
                    >
                      {copiedApiUrl ? (
                        <>
                          <Check className="size-3.5 text-(--success)" />
                          <span className="text-(--success)">{copy.apiUrlCopied}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" />
                          <span>{copy.copyApiUrl}</span>
                        </>
                      )}
                    </Button>
                    <Button
                      variant={localApi?.running ? "secondary" : "default"}
                      size="sm"
                      onClick={localApi?.running ? onStopLocalApi : onStartLocalApi}
                      disabled={!localApi || isStartingLocalApi || isStoppingLocalApi}
                      className="gap-1.5"
                    >
                      {isStartingLocalApi || isStoppingLocalApi ? (
                        <>
                          <LoaderCircle className="size-3.5 animate-spin" />
                          <span>{isStartingLocalApi ? copy.apiStarting : copy.apiStopping}</span>
                        </>
                      ) : localApi?.running ? (
                        <>
                          <CircleStop className="size-3.5" />
                          <span>{copy.apiStop}</span>
                        </>
                      ) : (
                        <>
                          <Play className="size-3.5" />
                          <span>{copy.apiStart}</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <code className="mt-3 block overflow-x-auto rounded-xl border border-(--border) bg-(--surface-muted) p-3.5 font-mono text-xs text-(--foreground)">
                  {localApiUrl}
                </code>
                {localApiError && (
                  <p className="mt-3 rounded-xl border border-(--destructive-border) bg-(--destructive-surface) px-3.5 py-3 text-sm leading-5 text-(--destructive)">
                    {localApiError}
                  </p>
                )}
                <p className="mt-3 text-sm leading-6 text-(--muted-foreground)">{copy.apiHelp}</p>
                <div className="mt-4 rounded-xl border border-(--border) bg-(--surface-muted) p-4">
                  <p className="text-sm leading-6 text-(--muted-foreground)">
                    {copy.apiTrustWarning}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-(--muted-foreground)">
        {label}
      </p>
      <p className="mt-1.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

function AdvancedNumberField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  min: string;
  max?: string;
  step: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onOpenChange,
  onConfirm,
  busy,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Audio History rename targets become filenames, so new names accept only
// unaccented ASCII letters, digits, spaces, hyphens, and underscores.
const AUDIO_HISTORY_STEM_PATTERN = /^[A-Za-z0-9 _-]+$/;

function AudioHistoryView({
  copy,
  appLanguage,
  items,
  total,
  nextCursor,
  isLoading,
  isLoadingMore,
  error,
  deletingFileName,
  renamingFileName,
  onRetry,
  onLoadMore,
  onDelete,
  onRename,
}: {
  copy: UiCopy;
  appLanguage: AppLanguage;
  items: AudioHistoryItem[];
  total: number;
  nextCursor: AudioHistoryCursor | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  deletingFileName: string | null;
  renamingFileName: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
  onDelete: (fileName: string) => void;
  onRename: (fileName: string, newName: string) => Promise<void>;
}) {
  const [confirmDeleteFileName, setConfirmDeleteFileName] = useState<string | null>(null);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [copiedFileName, setCopiedFileName] = useState<string | null>(null);
  const [copyPathFailed, setCopyPathFailed] = useState(false);
  const confirmedItem = items.find((item) => item.id === confirmDeleteFileName);
  const isRenaming = renameTargetId !== null && renamingFileName === renameTargetId;
  const locale = appLanguage === "vi" ? "vi-VN" : "en-US";

  function openRenameDialog(item: AudioHistoryItem) {
    setRenameTargetId(item.id);
    setRenameDraft(item.id.replace(/\.[^.]+$/, ""));
    setRenameError(null);
  }

  function closeRenameDialog() {
    setRenameTargetId(null);
    setRenameError(null);
  }

  async function submitRename() {
    if (!renameTargetId) return;
    const stem = renameDraft.trim();
    const currentStem = renameTargetId.replace(/\.[^.]+$/, "");
    if (stem === currentStem) {
      closeRenameDialog();
      return;
    }
    if (!stem || !AUDIO_HISTORY_STEM_PATTERN.test(stem)) {
      setRenameError(copy.audioHistoryRenameInvalid);
      return;
    }
    try {
      await onRename(renameTargetId, stem);
      closeRenameDialog();
    } catch (reason) {
      setRenameError(reason instanceof Error ? reason.message : copy.audioHistoryRenameFailed);
    }
  }

  async function copyAudioPath(item: AudioHistoryItem) {
    try {
      await navigator.clipboard.writeText(item.audio_path);
      setCopyPathFailed(false);
      setCopiedFileName(item.id);
      window.setTimeout(() => {
        setCopiedFileName((current) => (current === item.id ? null : current));
      }, 2000);
    } catch {
      setCopyPathFailed(true);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow={copy.audioHistoryEyebrow}
        title={copy.audioHistoryTitle}
        description={copy.audioHistoryDescription}
        action={
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-(--muted-foreground) sm:inline">
              {items.length} / {total} {copy.audioHistoryCount}
            </span>
            <Button variant="secondary" onClick={onRetry} disabled={isLoading || isLoadingMore}>
              {isLoading || isLoadingMore ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              <span>{copy.audioHistoryRetry}</span>
            </Button>
          </div>
        }
      />
      <p className="mb-4 text-xs text-(--muted-foreground) sm:hidden">
        {items.length} / {total} {copy.audioHistoryCount}
      </p>

      {error && (
        <div className="mb-5">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      )}

      {copyPathFailed && (
        <div className="mb-5">
          <ErrorMessage>{copy.copyAudioPathFailed}</ErrorMessage>
        </div>
      )}

      {isLoading && items.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-(--muted-foreground)">
            <LoaderCircle className="size-4 animate-spin" />
            {copy.audioHistoryLoading}
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        error ? null : (
          <Card>
            <CardContent className="flex flex-col items-center px-6 py-14 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-(--accent-soft) text-(--accent)">
                <History className="size-5" />
              </div>
              <h2 className="mt-4 font-semibold">{copy.audioHistoryEmptyTitle}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-(--muted-foreground)">
                {copy.audioHistoryEmptyDescription}
              </p>
            </CardContent>
          </Card>
        )
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const voiceName =
              item.voice_name === "auto"
                ? copy.autoVoice
                : item.voice_name === "design"
                  ? copy.designVoice
                  : item.voice_name === "file"
                    ? copy.referenceFile
                    : item.voice_name;
            const createdAt = new Date(item.created_at);
            const dateLabel = Number.isNaN(createdAt.valueOf())
              ? item.created_at
              : new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(createdAt);
            // Untouched takes are named by UUID; their script says more than the file name.
            const scriptTitle =
              /^[0-9a-f]{32}\.[a-z0-9]+$/.test(item.id) && item.metadata_available && item.text
                ? item.text
                : null;

            return (
              <Card key={item.id}>
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="line-clamp-2 min-w-0 text-sm font-semibold leading-6">
                        {scriptTitle ?? item.id}
                      </h2>
                      <Badge variant="outline">{item.format}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-(--muted-foreground)">
                      <span>{dateLabel}</span>
                      {item.provider && (
                        <span>{item.provider === "vieneu" ? "VieNeu" : "OmniVoice"}</span>
                      )}
                      {voiceName && <span>{voiceName}</span>}
                      {scriptTitle && <span className="font-mono">{item.id}</span>}
                    </div>
                    {!scriptTitle && item.metadata_available && item.text && (
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-(--muted-foreground)">
                        {item.text}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <InlineAudioPreview
                      audioPath={item.audio_path}
                      label={copy.previewAudio}
                      pauseLabel={copy.pauseAudio}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 px-2.5 text-xs"
                      aria-label={`${copy.audioHistoryRename}: ${item.id}`}
                      title={copy.audioHistoryRename}
                      disabled={Boolean(deletingFileName) || Boolean(renamingFileName)}
                      onClick={() => openRenameDialog(item)}
                    >
                      <Pencil className="size-3.5" />
                      <span>{copy.audioHistoryRename}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 px-2.5 text-xs text-(--muted-foreground) hover:text-(--foreground)"
                      aria-label={`${copy.copyAudioPath}: ${item.id}`}
                      title={copiedFileName === item.id ? copy.copied : copy.copyAudioPath}
                      onClick={() => void copyAudioPath(item)}
                    >
                      {copiedFileName === item.id ? (
                        <>
                          <Check className="size-3.5 text-(--success)" />
                          <span className="text-(--success)">{copy.copied}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" />
                          <span>{copy.copyAudioPath}</span>
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${copy.audioHistoryDelete}: ${item.id}`}
                      title={copy.audioHistoryDelete}
                      disabled={Boolean(deletingFileName) || Boolean(renamingFileName)}
                      onClick={() => setConfirmDeleteFileName(item.id)}
                    >
                      <Trash2 className="size-4 text-(--destructive)" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={onLoadMore} disabled={isLoading || isLoadingMore}>
            {isLoadingMore && <LoaderCircle className="size-4 animate-spin" />}
            <span>{isLoadingMore ? copy.audioHistoryLoadingMore : copy.audioHistoryLoadMore}</span>
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDeleteFileName)}
        title={copy.audioHistoryDelete}
        description={copy.audioHistoryConfirmDelete}
        confirmLabel={copy.audioHistoryDelete}
        cancelLabel={copy.cancel}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteFileName(null);
        }}
        onConfirm={() => {
          if (confirmedItem) onDelete(confirmedItem.id);
          setConfirmDeleteFileName(null);
        }}
        busy={deletingFileName === confirmDeleteFileName}
      />

      <AlertDialog
        open={Boolean(renameTargetId)}
        onOpenChange={(open) => {
          if (!open) closeRenameDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.audioHistoryRenameTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.audioHistoryRenameDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="audio-history-rename">{copy.audioHistoryRenameLabel}</FieldLabel>
            <Input
              id="audio-history-rename"
              value={renameDraft}
              disabled={isRenaming}
              autoFocus
              onChange={(event) => {
                setRenameDraft(event.target.value);
                setRenameError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitRename();
                }
              }}
            />
            {renameTargetId && (
              <p className="text-xs text-(--muted-foreground)">
                {renameTargetId.slice(renameTargetId.lastIndexOf("."))}
              </p>
            )}
            {renameError && <FieldError>{renameError}</FieldError>}
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRenaming}>{copy.cancel}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={isRenaming}
              onClick={() => void submitRename()}
            >
              {isRenaming && <LoaderCircle className="size-4 animate-spin" />}
              {copy.audioHistoryRename}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function WorkspaceView({
  copy,
  provider,
  providerStatuses,
  onProviderChange,
  mode,
  language,
  text,
  speed,
  format,
  advanced,
  advancedError,
  vieneuAdvanced,
  vieneuAdvancedError,
  voices,
  presetVoices,
  selectedVoice,
  refAudio,
  result,
  error,
  isGenerating,
  isImportingSeed,
  takes,
  activeTakeId,
  onSelectTake,
  onLanguageChange,
  onTextChange,
  onSpeedChange,
  onFormatChange,
  onAdvancedChange,
  onVieNeuAdvancedChange,
  onVoiceSelectionChange,
  onChooseReference,
  onSynthesize,
  onCancelSynthesis,
  onExport,
}: {
  copy: UiCopy;
  provider: ProviderId;
  providerStatuses: Record<ProviderId, ProviderStatus> | null;
  onProviderChange: (provider: ProviderId) => void;
  mode: VoiceMode;
  language: Language;
  text: string;
  speed: number;
  format: AudioFormat;
  advanced: AdvancedDraft;
  advancedError: string | null;
  vieneuAdvanced: VieNeuDraft;
  vieneuAdvancedError: string | null;
  voices: VoiceProfile[];
  presetVoices: Array<{ id: string; name: string; label: string }>;
  selectedVoice: string;
  refAudio: string | null;
  result: SynthesisResult | null;
  error: string | null;
  isGenerating: boolean;
  isImportingSeed: boolean;
  takes: TakeItem[];
  activeTakeId: string | null;
  onSelectTake: (take: TakeItem) => void;
  onLanguageChange: (language: Language) => void;
  onTextChange: (text: string) => void;
  onSpeedChange: (speed: number) => void;
  onFormatChange: (format: AudioFormat) => void;
  onAdvancedChange: (patch: Partial<AdvancedDraft>) => void;
  onVieNeuAdvancedChange: (patch: Partial<VieNeuDraft>) => void;
  onVoiceSelectionChange: (name: string) => void;
  onChooseReference: () => void;
  onSynthesize: () => void;
  onCancelSynthesis: () => void;
  onExport: () => void;
}) {
  const isOmniVoice = provider === "omnivoice";
  const visibleVoices = isOmniVoice
    ? voices.filter((voice) => voice.kind !== "vieneu_preset" || Boolean(voice.ref_audio))
    : // VieNeu preset profiles duplicate the preset entries listed above them.
      voices.filter((voice) => voice.kind === "clone");
  if (isOmniVoice) {
    visibleVoices.sort(
      (left, right) => Number(right.language === language) - Number(left.language === language),
    );
  }
  const selectedSource = isOmniVoice
    ? mode === "profile"
      ? `profile:${selectedVoice}`
      : "auto"
    : mode === "profile"
      ? `profile:${selectedVoice}`
      : mode === "file"
        ? "file"
        : `preset:${selectedVoice}`;
  const voiceItems = [
    ...(isOmniVoice
      ? [{ value: "auto", label: `${copy.autoVoice} · ${copy.autoVoiceDescription}` }]
      : presetVoices.map((voice) => ({ value: `preset:${voice.id}`, label: voice.label }))),
    ...(!isOmniVoice ? [{ value: "file", label: copy.referenceFile }] : []),
    ...visibleVoices.map((voice) => ({
      value: `profile:${voice.name}`,
      label:
        voice.kind === "vieneu_preset"
          ? (presetVoices.find((preset) => preset.id === voice.preset_id)?.label ?? voice.name)
          : `${voice.name} · ${voice.language?.toUpperCase() ?? ""}${voice.is_default ? ` · ${copy.defaultVoice}` : ""}`,
    })),
  ];
  const speedPresets = [0.8, 1.0, 1.25, 1.5];

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  // Measured speaking rates: OmniVoice ~2.9 words/s at 1x, VieNeu presets ~3.9 words/s.
  const wordsPerSecond = provider === "vieneu" ? 3.9 : 2.9 * speed;
  const estSeconds = Math.max(1, Math.round(wordCount / wordsPerSecond));
  const [copiedText, setCopiedText] = useState(false);
  const [sampleMenuOpen, setSampleMenuOpen] = useState(false);

  const handleCopyText = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } catch {}
  };

  const currentSamples = SAMPLE_SCRIPTS[language] || SAMPLE_SCRIPTS.en;

  // Describe the take being played, not the current form selection.
  const activeTake = takes.find((take) => take.id === activeTakeId);

  return (
    <div>
      <PageHeader
        eyebrow={copy.voiceWorkspace}
        title={copy.title}
        description={copy.workspaceDescription}
        action={
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {isOmniVoice ? copy.providerOmni : copy.providerVieNeu}
            </Badge>
            <Badge variant="success">
              <span className="mr-2 size-1.5 rounded-full bg-(--success)" />
              {copy.modelReady}
            </Badge>
          </div>
        }
      />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_370px]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-(--border) pb-4">
            <div className="flex flex-wrap items-center justify-between gap-4 w-full">
              <div>
                <SectionLabel>{copy.scriptCanvas}</SectionLabel>
                <CardTitle className="mt-1">{copy.untitledSpeech}</CardTitle>
              </div>

              {/* Stats & Actions */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Word & Duration Pill */}
                <div className="flex items-center gap-2 rounded-xl border border-(--border) bg-(--surface-muted) px-3 py-1.5 font-mono text-xs text-(--muted-foreground)">
                  <span className="font-semibold text-(--foreground)">
                    {wordCount} {copy.words}
                  </span>
                  <span>·</span>
                  <span>
                    {text.length} {copy.characters}
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1 text-(--accent)">
                    <Clock className="size-3" />~
                    {estSeconds < 60 ? `${estSeconds}s` : formatDuration(estSeconds)}{" "}
                    {copy.estimatedDuration}
                  </span>
                </div>

                {/* Sample scripts dropdown */}
                <div className="relative">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSampleMenuOpen(!sampleMenuOpen)}
                    className="h-8 gap-1.5 text-xs"
                    title={copy.sampleScripts}
                  >
                    <Wand2 className="size-3.5 text-(--accent)" />
                    <span>{copy.sampleScripts}</span>
                  </Button>

                  {sampleMenuOpen && (
                    <div className="absolute right-0 top-10 z-30 min-w-56 overflow-hidden rounded-xl border border-(--border) bg-(--surface) p-1.5 shadow-xl">
                      {currentSamples.map((sample) => (
                        <Button
                          key={sample.titleKey}
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            onTextChange(sample.text);
                            setSampleMenuOpen(false);
                          }}
                          className="w-full justify-start"
                        >
                          <Sparkles data-icon="inline-start" />
                          <span>{copy[sample.titleKey as keyof UiCopy] as string}</span>
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center">
                  {/* Copy text */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyText}
                    className="h-8 px-2.5 text-xs text-(--muted-foreground) hover:text-(--foreground)"
                    title={copy.copyScript}
                    aria-label={copy.copyScript}
                  >
                    {copiedText ? (
                      <Check className="size-3.5 text-(--success)" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>

                  {/* Clear text */}
                  {text.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onTextChange("")}
                      className="h-8 px-2 text-xs text-(--muted-foreground) hover:text-(--destructive)"
                      title={copy.clearScript}
                      aria-label={copy.clearScript}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Textarea
              aria-label={copy.untitledSpeech}
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !isGenerating) {
                  event.preventDefault();
                  onSynthesize();
                }
              }}
              className="min-h-[310px] resize-none rounded-none border-0 bg-transparent px-6 py-6 text-base leading-8 shadow-none focus-visible:ring-0"
              spellCheck={false}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--border) px-6 py-3 text-xs text-(--muted-foreground)">
              <span>{copy.renderShortcut}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em]">
                {language === "vi" ? copy.vietnameseDiacritics : copy.englishPronunciation}
              </span>
            </div>
          </CardContent>
          {error && (
            <div className="px-5 pb-5">
              <ErrorMessage>{error}</ErrorMessage>
            </div>
          )}
          <div className="border-t border-(--border) bg-(--surface-muted) p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <SectionLabel>{copy.outputPreview}</SectionLabel>
                <h2 className="mt-1 text-base font-semibold">
                  {isGenerating
                    ? copy.rendering
                    : result
                      ? copy.renderedTake
                      : copy.nothingRendered}
                </h2>
              </div>
              {result && !isGenerating && <Badge variant="success">{copy.ready}</Badge>}
            </div>

            {isGenerating ? (
              <div
                role="status"
                className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-(--accent-border) bg-(--surface) px-4 py-6 text-sm text-(--muted-foreground)"
              >
                <div className="flex size-9 items-center justify-center rounded-xl bg-(--accent-soft) text-(--accent)">
                  <LoaderCircle className="size-4 animate-spin" />
                </div>
                <span>{copy.rendering}</span>
                <ElapsedTime />
                <Button variant="ghost" size="sm" onClick={onCancelSynthesis}>
                  <CircleStop data-icon="inline-start" />
                  {copy.cancel}
                </Button>
              </div>
            ) : result ? (
              <div className="mt-4">
                <AudioPlayer
                  audioPath={result.audio_path}
                  format={result.format}
                  sampleRate={activeTake?.provider === "vieneu" ? 48000 : 24000}
                  voiceName={activeTake?.voiceName}
                  copy={copy}
                  onExport={onExport}
                  autoPlay={false}
                />
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-(--border-strong) bg-(--surface) px-4 py-6 text-sm text-(--muted-foreground)">
                <div className="flex size-9 items-center justify-center rounded-xl bg-(--surface-muted) text-(--accent)">
                  <Play className="size-4" />
                </div>
                <span>{copy.generateTake}</span>
              </div>
            )}

            {/* Session Takes History */}
            {takes.length > 0 && (
              <div className="mt-5 border-t border-(--border) pt-4">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <History className="size-3.5 text-(--accent)" />
                    <SectionLabel>{copy.takeHistory}</SectionLabel>
                  </div>
                  <span className="font-mono text-[10px] text-(--muted-foreground)">
                    {takes.length} / {MAX_SESSION_TAKES}
                  </span>
                </div>
                <ToggleGroup
                  multiple={false}
                  value={activeTakeId ? [activeTakeId] : []}
                  onValueChange={(value) => {
                    const selected = takes.find((take) => take.id === value[0]);
                    if (selected) onSelectTake(selected);
                  }}
                  aria-label={copy.takeHistory}
                  className="flex flex-wrap gap-2"
                  spacing={0}
                >
                  {takes.map((take, index) => {
                    const takeNum = takes.length - index;
                    return (
                      <ToggleGroupItem
                        key={take.id}
                        value={take.id}
                        variant="outline"
                        size="sm"
                        className="h-auto gap-2 rounded-xl px-3 py-1.5"
                      >
                        <Play data-icon="inline-start" />
                        <span>
                          {copy.take} #{takeNum}
                        </span>
                        <span className="font-mono text-[10px] uppercase opacity-75">
                          {take.voiceName} · {take.format}
                        </span>
                      </ToggleGroupItem>
                    );
                  })}
                </ToggleGroup>
              </div>
            )}
          </div>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <div>
              <SectionLabel>{copy.voiceSource}</SectionLabel>
              <CardTitle className="mt-2">{copy.shapeTake}</CardTitle>
            </div>
            <SlidersHorizontal className="size-5 text-(--accent)" />
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Quick Provider Switcher */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>{copy.chooseProvider}</Label>
                <Badge
                  variant={
                    providerIsReady(providerStatuses?.[provider]) ? "success" : "destructive"
                  }
                >
                  {providerIsReady(providerStatuses?.[provider]) ? copy.ready : copy.unavailable}
                </Badge>
              </div>
              <div className="rounded-xl border border-(--border) bg-(--surface-muted) p-1">
                <ToggleGroup
                  multiple={false}
                  value={[provider]}
                  onValueChange={(value) => {
                    if (value[0]) onProviderChange(value[0] as ProviderId);
                  }}
                  spacing={0}
                  className="grid w-full grid-cols-2"
                  aria-label={copy.chooseProvider}
                >
                  {(
                    [
                      ["omnivoice", copy.providerOmni],
                      ["vieneu", copy.providerVieNeu],
                    ] as const
                  ).map(([pId, label]) => (
                    <ToggleGroupItem key={pId} value={pId} size="sm">
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>

            <div>
              <Label>{copy.synthesisLanguage}</Label>
              <div className="mt-2 rounded-xl bg-(--surface-muted) p-1.5">
                <ToggleGroup
                  multiple={false}
                  value={[language]}
                  onValueChange={(value) => {
                    if (value[0]) onLanguageChange(value[0] as Language);
                  }}
                  spacing={0}
                  className="grid w-full grid-cols-2"
                  aria-label={copy.synthesisLanguage}
                >
                  {(["en", "vi"] as Language[]).map((item) => (
                    <ToggleGroupItem key={item} value={item} size="lg">
                      {item === "en" ? copy.english : copy.vietnamese}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>
            <div>
              <Label>{copy.voiceSource}</Label>
              <div className="mt-2 space-y-3">
                <Select
                  value={selectedSource}
                  items={voiceItems}
                  onValueChange={(value) => {
                    if (typeof value === "string") onVoiceSelectionChange(value);
                  }}
                >
                  <SelectTrigger aria-label={copy.voiceSource}>
                    <SelectValue placeholder={copy.voiceSource} />
                  </SelectTrigger>
                  <SelectContent>
                    {voiceItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {visibleVoices.length === 0 && presetVoices.length === 0 && (
                  <p className="text-xs leading-5 text-(--muted-foreground)">{copy.noProfiles}</p>
                )}
                {!isOmniVoice && mode === "file" && (
                  <Button
                    variant="secondary"
                    className="w-full justify-start"
                    onClick={onChooseReference}
                    disabled={isGenerating}
                  >
                    <FolderOpen className="size-4 text-(--accent)" />
                    <span className="truncate">
                      {refAudio ? fileName(refAudio) : copy.chooseReference}
                    </span>
                  </Button>
                )}
              </div>
            </div>
            <Separator />
            {isOmniVoice && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="speed">{copy.speed}</Label>
                  <div className="flex items-center gap-1.5">
                    <ToggleGroup
                      multiple={false}
                      value={speedPresets
                        .filter((preset) => Math.abs(speed - preset) < 0.04)
                        .map(String)}
                      onValueChange={(value) => {
                        if (value[0]) onSpeedChange(Number(value[0]));
                      }}
                      aria-label={copy.speed}
                      spacing={1}
                    >
                      {speedPresets.map((preset) => (
                        <ToggleGroupItem
                          key={preset}
                          value={String(preset)}
                          variant="outline"
                          size="sm"
                          className="font-mono"
                        >
                          {preset}×
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <span className="ml-1 rounded-md bg-(--surface-muted) px-2 py-1 font-mono text-xs font-semibold">
                      {speed.toFixed(2)}×
                    </span>
                  </div>
                </div>
                <input
                  id="speed"
                  aria-label={copy.speed}
                  type="range"
                  min="0.25"
                  max="2"
                  step="0.05"
                  value={speed}
                  onChange={(event) => onSpeedChange(Number(event.target.value))}
                  className="w-full accent-(--accent)"
                />
              </div>
            )}
            <div>
              <Label>{copy.outputFormat}</Label>
              <div className="mt-2 rounded-xl bg-(--surface-muted) p-1.5">
                <ToggleGroup
                  multiple={false}
                  value={[format]}
                  onValueChange={(value) => {
                    if (value[0]) onFormatChange(value[0] as AudioFormat);
                  }}
                  spacing={0}
                  className="grid w-full grid-cols-2"
                  aria-label={copy.outputFormat}
                >
                  {(["wav", "mp3"] as AudioFormat[]).map((item) => (
                    <ToggleGroupItem
                      key={item}
                      value={item}
                      size="lg"
                      className="font-mono uppercase"
                    >
                      {item}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>
            {isOmniVoice && (
              <details className="group rounded-xl border border-(--border) bg-(--surface-muted)">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)">
                  <span>{copy.advancedSettings}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAdvancedChange(DEFAULT_ADVANCED);
                      }}
                      title={copy.resetDefaults}
                      aria-label={copy.resetDefaults}
                    >
                      <RotateCcw />
                    </Button>
                    <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
                  </div>
                </summary>
                <div className="border-t border-(--border) px-3.5 pb-3.5 pt-3 space-y-4">
                  <p className="text-xs leading-5 text-(--muted-foreground)">
                    {copy.advancedSettingsDescription}
                  </p>
                  <div>
                    <SectionLabel>{copy.qualityGroup}</SectionLabel>
                    <div className="mt-2.5 grid grid-cols-2 gap-3">
                      <AdvancedNumberField
                        label={copy.diffusionSteps}
                        value={advanced.steps}
                        min="1"
                        step="1"
                        disabled={isGenerating}
                        onChange={(value) => onAdvancedChange({ steps: value })}
                      />
                      <AdvancedNumberField
                        label={copy.guidanceScale}
                        value={advanced.guidance_scale}
                        min="0"
                        step="0.1"
                        disabled={isGenerating}
                        onChange={(value) => onAdvancedChange({ guidance_scale: value })}
                      />
                      <AdvancedNumberField
                        label={copy.tShift}
                        value={advanced.t_shift}
                        min="0"
                        step="0.1"
                        disabled={isGenerating}
                        onChange={(value) => onAdvancedChange({ t_shift: value })}
                      />
                      <AdvancedNumberField
                        label={copy.layerPenaltyFactor}
                        value={advanced.layer_penalty_factor}
                        min="0"
                        step="0.1"
                        disabled={isGenerating}
                        onChange={(value) => onAdvancedChange({ layer_penalty_factor: value })}
                      />
                      <AdvancedNumberField
                        label={copy.positionTemperature}
                        value={advanced.position_temperature}
                        min="0"
                        step="0.1"
                        disabled={isGenerating}
                        onChange={(value) => onAdvancedChange({ position_temperature: value })}
                      />
                      <AdvancedNumberField
                        label={copy.classTemperature}
                        value={advanced.class_temperature}
                        min="0"
                        step="0.1"
                        disabled={isGenerating}
                        onChange={(value) => onAdvancedChange({ class_temperature: value })}
                      />
                    </div>
                  </div>
                  <div>
                    <SectionLabel>{copy.chunkingGroup}</SectionLabel>
                    <div className="mt-2.5 grid grid-cols-2 gap-3">
                      <AdvancedNumberField
                        label={copy.fixedDuration}
                        value={advanced.duration}
                        min="0.1"
                        step="0.1"
                        disabled={isGenerating}
                        onChange={(value) => onAdvancedChange({ duration: value })}
                      />
                      <AdvancedNumberField
                        label={copy.chunkDuration}
                        value={advanced.audio_chunk_duration}
                        min="0.1"
                        step="0.1"
                        disabled={isGenerating}
                        onChange={(value) => onAdvancedChange({ audio_chunk_duration: value })}
                      />
                      <AdvancedNumberField
                        label={copy.chunkThreshold}
                        value={advanced.audio_chunk_threshold}
                        min="0.1"
                        step="0.1"
                        disabled={isGenerating}
                        onChange={(value) => onAdvancedChange({ audio_chunk_threshold: value })}
                      />
                      <AdvancedNumberField
                        label={copy.padDuration}
                        value={advanced.pad_duration}
                        min="0"
                        step="0.05"
                        disabled={isGenerating}
                        onChange={(value) => onAdvancedChange({ pad_duration: value })}
                      />
                      <AdvancedNumberField
                        label={copy.fadeDuration}
                        value={advanced.fade_duration}
                        min="0"
                        step="0.05"
                        disabled={isGenerating}
                        onChange={(value) => onAdvancedChange({ fade_duration: value })}
                      />
                    </div>
                  </div>
                  <FieldSet className="grid grid-cols-2 gap-2 border-t border-(--border) pt-3">
                    <FieldLegend variant="label" className="sr-only">
                      {copy.advancedSettings}
                    </FieldLegend>
                    {(
                      [
                        ["denoise", copy.denoise],
                        ["preprocess_prompt", copy.preprocessPrompt],
                        ["postprocess_output", copy.postprocessOutput],
                        ["normalize_text", copy.normalizeText],
                      ] as const
                    ).map(([key, label]) => (
                      <Field key={key} orientation="horizontal" className="items-center gap-2">
                        <Checkbox
                          id={`advanced-${key}`}
                          checked={advanced[key]}
                          disabled={isGenerating}
                          onCheckedChange={(checked) =>
                            onAdvancedChange({ [key]: checked === true })
                          }
                        />
                        <FieldLabel
                          htmlFor={`advanced-${key}`}
                          className="cursor-pointer text-xs normal-case tracking-normal text-muted-foreground"
                        >
                          {label}
                        </FieldLabel>
                      </Field>
                    ))}
                  </FieldSet>
                </div>
              </details>
            )}
            {!isOmniVoice && (
              <details className="group rounded-xl border border-(--border) bg-(--surface-muted)">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)">
                  <span>{copy.vieneuAdvancedSettings}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onVieNeuAdvancedChange(DEFAULT_VIENEU);
                      }}
                      title={copy.resetDefaults}
                      aria-label={copy.resetDefaults}
                    >
                      <RotateCcw />
                    </Button>
                    <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
                  </div>
                </summary>
                <div className="space-y-4 border-t border-(--border) px-3.5 pb-3.5 pt-3">
                  <p className="text-xs leading-5 text-(--muted-foreground)">
                    {copy.vieneuAdvancedSettingsDescription}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <AdvancedNumberField
                      label={copy.vieneuTemperature}
                      value={vieneuAdvanced.temperature}
                      min="0"
                      step="0.1"
                      disabled={isGenerating}
                      onChange={(value) => onVieNeuAdvancedChange({ temperature: value })}
                    />
                    <AdvancedNumberField
                      label={copy.vieneuTopK}
                      value={vieneuAdvanced.top_k}
                      min="1"
                      step="1"
                      disabled={isGenerating}
                      onChange={(value) => onVieNeuAdvancedChange({ top_k: value })}
                    />
                    <AdvancedNumberField
                      label={copy.vieneuTopP}
                      value={vieneuAdvanced.top_p}
                      min="0.01"
                      max="1"
                      step="0.01"
                      disabled={isGenerating}
                      onChange={(value) => onVieNeuAdvancedChange({ top_p: value })}
                    />
                    <AdvancedNumberField
                      label={copy.vieneuRepetitionPenalty}
                      value={vieneuAdvanced.repetition_penalty}
                      min="0.01"
                      step="0.05"
                      disabled={isGenerating}
                      onChange={(value) => onVieNeuAdvancedChange({ repetition_penalty: value })}
                    />
                    <AdvancedNumberField
                      label={copy.vieneuRepetitionWindow}
                      value={vieneuAdvanced.repetition_window}
                      min="0"
                      step="1"
                      disabled={isGenerating}
                      onChange={(value) => onVieNeuAdvancedChange({ repetition_window: value })}
                    />
                    <AdvancedNumberField
                      label={copy.vieneuSeed}
                      value={vieneuAdvanced.seed}
                      min="0"
                      step="1"
                      disabled={isGenerating}
                      onChange={(value) => onVieNeuAdvancedChange({ seed: value })}
                    />
                  </div>
                  <FieldSet className="border-t border-(--border) pt-3">
                    <FieldLegend variant="label" className="sr-only">
                      {copy.vieneuAdvancedSettings}
                    </FieldLegend>
                    <Field orientation="horizontal" className="items-center gap-2">
                      <Checkbox
                        id="vieneu-do-sample"
                        checked={vieneuAdvanced.do_sample}
                        disabled={isGenerating}
                        onCheckedChange={(checked) =>
                          onVieNeuAdvancedChange({ do_sample: checked === true })
                        }
                      />
                      <FieldLabel
                        htmlFor="vieneu-do-sample"
                        className="cursor-pointer text-xs normal-case tracking-normal text-muted-foreground"
                      >
                        {copy.vieneuSampling}
                      </FieldLabel>
                    </Field>
                  </FieldSet>
                </div>
              </details>
            )}
            {isOmniVoice && advancedError && <ErrorMessage>{advancedError}</ErrorMessage>}
            {!isOmniVoice && vieneuAdvancedError && (
              <ErrorMessage>{vieneuAdvancedError}</ErrorMessage>
            )}
            <Button
              size="lg"
              className="w-full"
              onClick={onSynthesize}
              disabled={isGenerating || isImportingSeed}
            >
              {isGenerating || isImportingSeed ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Play className="size-4 fill-current" />
              )}
              {isGenerating
                ? copy.rendering
                : isImportingSeed
                  ? copy.importingSeedFolder
                  : copy.renderSpeech}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TranscribeView({
  copy,
  url,
  progress,
  result,
  error,
  saved,
  isTranscribing,
  isCancelling,
  onUrlChange,
  onStart,
  onCancel,
  onSave,
}: {
  copy: UiCopy;
  url: string;
  progress: ProgressEvent | null;
  result: TranscribeVideoResult | null;
  error: string | null;
  saved: boolean;
  isTranscribing: boolean;
  isCancelling: boolean;
  onUrlChange: (value: string) => void;
  onStart: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const phaseLabel = progress ? (copy.transcribePhases[progress.phase] ?? progress.phase) : null;
  const percent =
    progress && typeof progress.progress === "number" ? Math.round(progress.progress * 100) : null;
  return (
    <div>
      <PageHeader
        eyebrow={copy.transcribeEyebrow}
        title={copy.transcribeTitle}
        description={copy.transcribeDescription}
        action={
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {copy.transcribeSourceYouTube} · {copy.transcribeSourceYouTubeHint}
            </Badge>
            <Badge variant="secondary">
              {copy.transcribeSourceFacebook} · {copy.transcribeSourceFacebookHint}
            </Badge>
          </div>
        }
      />
      <div className="grid items-start gap-5">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-(--border) pb-4">
            <div>
              <SectionLabel>{copy.transcribeVideoLink}</SectionLabel>
              <CardTitle className="mt-1">{copy.transcribeStart}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                if (!isTranscribing) onStart();
              }}
            >
              <Input
                className="flex-1"
                aria-label={copy.transcribeVideoLink}
                value={url}
                onChange={(event) => onUrlChange(event.target.value)}
                placeholder={copy.transcribeVideoLinkPlaceholder}
                disabled={isTranscribing}
                inputMode="url"
                spellCheck={false}
              />
              {isTranscribing && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onCancel}
                  disabled={isCancelling}
                >
                  <CircleStop data-icon="inline-start" />
                  {isCancelling ? copy.transcribeCancelling : copy.transcribeCancel}
                </Button>
              )}
              <Button type="submit" disabled={isTranscribing}>
                {isTranscribing ? (
                  <LoaderCircle className="animate-spin" data-icon="inline-start" />
                ) : (
                  <FileVideo data-icon="inline-start" />
                )}
                {isTranscribing ? copy.transcribeTranscribing : copy.transcribeStart}
              </Button>
            </form>
            <p className="text-xs leading-5 text-(--muted-foreground)">
              {copy.transcribeAuthorizationNotice}
            </p>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            {isTranscribing && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-(--muted-foreground)">
                  <span>{phaseLabel ?? copy.transcribeTranscribing}</span>
                  <span className="flex items-center gap-3">
                    {percent !== null && <span className="font-mono">{percent}%</span>}
                    <ElapsedTime />
                  </span>
                </div>
                <Progress value={percent ?? 0} />
              </div>
            )}
          </CardContent>
        </Card>
        {result && (
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-(--border) pb-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <SectionLabel>{copy.transcribeResultTitle}</SectionLabel>
                  <CardTitle className="mt-1">
                    {result?.title || copy.transcribeUntitledVideo}
                  </CardTitle>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {copy.transcribePlatformLabel} ·{" "}
                    {result.platform === "youtube"
                      ? copy.transcribeSourceYouTube
                      : copy.transcribeSourceFacebook}
                  </Badge>
                  <Badge variant="secondary">
                    {copy.transcribeDurationLabel} · {formatDuration(result.duration_seconds)}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <div className="max-h-56 overflow-auto rounded-xl border border-(--border) bg-(--surface-muted) p-4 text-sm leading-6 whitespace-pre-wrap">
                {result.transcript}
              </div>
              <div className="max-h-56 overflow-auto rounded-xl border border-(--border) bg-(--surface-muted) p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
                {result.srt}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={onSave}>
                  <Download data-icon="inline-start" />
                  {copy.transcribeSaveSrt}
                </Button>
                {saved && (
                  <span className="flex items-center gap-1.5 text-xs text-(--success)">
                    <Check className="size-3.5" />
                    {copy.transcribeSavedSrt}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function App() {
  const { t, i18n: translator } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const [view, setView] = useState<AppView>("workspace");
  const [provider, setProvider] = useState<ProviderId>(readProvider);
  const [modelProgress, setModelProgress] = useState<Record<ProviderId, ProgressEvent | null>>({
    omnivoice: null,
    vieneu: null,
  });
  const [runtimeProgress, setRuntimeProgress] = useState<ProgressEvent | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeRestartRequired, setRuntimeRestartRequired] = useState(false);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);
  const [diagnosticsIncomplete, setDiagnosticsIncomplete] = useState(false);
  const [modelPreparationErrors, setModelPreparationErrors] = useState<
    Partial<Record<ProviderId, string>>
  >({});
  const [setupError, setSetupError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>(readSynthesisLanguage);
  const [mode, setMode] = useState<VoiceMode>(() =>
    readProvider() === "vieneu" ? "preset" : "auto",
  );
  const [text, setText] = useState("The quietest tools often do the most important work.");
  const [speed, setSpeed] = useState(1);
  const [format, setFormat] = useState<AudioFormat>("wav");
  const [advanced, setAdvanced] = useState<AdvancedDraft>(DEFAULT_ADVANCED);
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [vieneuAdvanced, setVieNeuAdvanced] = useState<VieNeuDraft>(DEFAULT_VIENEU);
  const [vieneuAdvancedError, setVieNeuAdvancedError] = useState<string | null>(null);
  const [refAudio, setRefAudio] = useState<string | null>(null);
  const [refText, setRefText] = useState("");
  const [deletingAudioFile, setDeletingAudioFile] = useState<string | null>(null);
  const [renamingAudioFile, setRenamingAudioFile] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isCancellingSeed, setIsCancellingSeed] = useState(false);
  const [seedProgress, setSeedProgress] = useState<ProgressEvent | null>(null);
  const [seedResult, setSeedResult] = useState<SeedVieNeuResult | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [voiceImportStatus, setVoiceImportStatus] = useState<ImportStatus | null>(null);
  const [seedImportStatus, setSeedImportStatus] = useState<ImportStatus | null>(null);
  const [deletingVoice, setDeletingVoice] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState(() =>
    readProvider() === "vieneu" ? "" : "auto",
  );
  const [profileName, setProfileName] = useState("");
  const [profileKind, setProfileKind] = useState<VoiceKind>("clone");
  const [profilePresetId, setProfilePresetId] = useState("");
  const [designInstruction, setDesignInstruction] = useState("");
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [transcribeUrl, setTranscribeUrl] = useState("");
  const [transcribeProgress, setTranscribeProgress] = useState<ProgressEvent | null>(null);
  const [transcribeResult, setTranscribeResult] = useState<TranscribeVideoResult | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [transcribeSaved, setTranscribeSaved] = useState(false);
  const [isCancellingTranscribe, setIsCancellingTranscribe] = useState(false);
  const [preparingProviders, setPreparingProviders] = useState<ProviderId[]>([]);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<RequestLog[]>(() => client.getLogs());
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [takes, setTakes] = useState<TakeItem[]>([]);
  const [activeTakeId, setActiveTakeId] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [dismissedUpdateTag, setDismissedUpdateTag] = useState<string | null>(() =>
    readDismissedTag(),
  );
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [manualUpdateFeedback, setManualUpdateFeedback] = useState<
    "none" | "current" | "unavailable"
  >("none");
  const bundledSeedImportStarted = useRef(false);
  const vieneuAutoSeedStarted = useRef(false);
  const renderCancelled = useRef(false);
  const lastView = useRef<AppView>(view);
  const sidecarStopped = useRef(false);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, [theme]);

  const appLanguage: AppLanguage = translator.language === "vi" ? "vi" : "en";
  const copy: UiCopy = useMemo(() => createUiCopy(t), [t]);
  const queryClient = useQueryClient();
  const statusQuery = useQuery<StatusResult | null>({
    queryKey: STATUS_QUERY_KEY,
    queryFn: () => client.request<StatusResult>({ type: "status" }),
  });
  const engineStatus = statusQuery.data ?? null;
  const engineOnline = Boolean(engineStatus);
  const device = engineStatus?.device ?? "unknown";
  const voicesQuery = useQuery({
    queryKey: VOICES_QUERY_KEY,
    queryFn: () => client.request<{ voices: VoiceProfile[] }>({ type: "list_voices" }),
    enabled: engineOnline,
  });
  const voices = voicesQuery.data?.voices ?? [];
  const historyQuery = useInfiniteQuery({
    queryKey: AUDIO_HISTORY_QUERY_KEY,
    queryFn: ({ pageParam }) =>
      client.request<AudioHistoryPage>({
        type: "list_audio_history",
        paginated: true,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as AudioHistoryCursor | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: view === "history",
  });
  const audioHistory = useMemo(() => {
    const seen = new Set<string>();
    return (historyQuery.data?.pages.flatMap((page) => page.items) ?? []).filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [historyQuery.data]);
  const lastHistoryPage = historyQuery.data?.pages.at(-1);
  const audioHistoryTotal = lastHistoryPage?.total ?? 0;
  const audioHistoryCursor = lastHistoryPage?.next_cursor ?? null;
  const isLoadingAudioHistory = historyQuery.isLoading || historyQuery.isRefetching;
  const isLoadingMoreAudioHistory = historyQuery.isFetchingNextPage;
  const isLoadingVoices = voicesQuery.isFetching;
  const voiceListError = voicesQuery.error
    ? voicesQuery.error instanceof Error
      ? voicesQuery.error.message
      : copy.couldNotLoadProfiles
    : null;
  const isRefreshingStatus = statusQuery.isFetching;
  const modelStatusError = statusQuery.error
    ? statusQuery.error instanceof Error
      ? statusQuery.error.message
      : translator.t("errors.engineUnavailable")
    : null;
  const prepareMutation = useMutation({
    mutationFn: (target: ProviderId) =>
      client.request<{ model_ready: boolean }>({ type: "prepare_model", provider: target }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
  });
  const seedImportMutation = useMutation({
    mutationFn: (seedDirectory: string) =>
      client.request<SeedImportResult>({ type: "import_seed_voices", seed_dir: seedDirectory }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VOICES_QUERY_KEY }),
  });
  const seedVieNeuMutation = useMutation({
    mutationFn: () => client.request<SeedVieNeuResult>({ type: "seed_vieneu_voices" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: VOICES_QUERY_KEY }),
  });
  const runtimeInstallMutation = useMutation({
    mutationFn: () => client.request({ type: "install_nvidia_runtime" }),
    onSuccess: async () => {
      setRuntimeError(null);
      setRuntimeProgress(null);
      setRuntimeRestartRequired(true);
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
    onError: (reason) => {
      setRuntimeProgress(null);
      if (!(reason instanceof Error && "code" in reason && reason.code === "cancelled")) {
        setRuntimeError(reason instanceof Error ? reason.message : copy.nvidiaInstallFailed);
      }
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
  });
  const runtimeRemoveMutation = useMutation({
    mutationFn: () => client.request<{ removed: boolean }>({ type: "remove_nvidia_runtime" }),
    onSuccess: async () => {
      setRuntimeError(null);
      setRuntimeRestartRequired(true);
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
    onError: (reason) =>
      setRuntimeError(reason instanceof Error ? reason.message : copy.nvidiaRemoveFailed),
  });
  const importVoiceMutation = useMutation({
    mutationFn: (request: { name: string; path: string; language: Language }) =>
      client.request({
        type: "save_voice",
        name: request.name,
        ref_audio: request.path,
        language: request.language,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VOICES_QUERY_KEY }),
  });
  type SaveProfileRequest =
    | { kind: "vieneu_preset"; name: string; presetId: string }
    | { kind: "design"; name: string; instruction: string; language: Language }
    | { kind: "clone"; name: string; refAudio: string; refText?: string; language: Language };
  const saveProfileMutation = useMutation({
    mutationFn: (request: SaveProfileRequest) => {
      if (request.kind === "vieneu_preset") {
        return client.request({
          type: "save_vieneu_preset",
          name: request.name,
          preset_id: request.presetId,
        });
      }
      if (request.kind === "design") {
        return client.saveDesignVoice(request.name, request.instruction, request.language);
      }
      return client.request({
        type: "save_voice",
        name: request.name,
        ref_audio: request.refAudio,
        ref_text: request.refText,
        language: request.language,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VOICES_QUERY_KEY }),
  });
  const deleteProfileMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await client.request<{ deleted: boolean }>({ type: "delete_voice", name });
      if (!response.deleted) throw new Error(copy.couldNotDeleteVoice);
      return name;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VOICES_QUERY_KEY }),
  });
  const apiStateQuery = useQuery({
    queryKey: API_STATE_QUERY_KEY,
    queryFn: () => client.apiStatus(),
    enabled: view === "settings" && engineOnline,
  });
  const localApi = apiStateQuery.data ?? null;
  const [localApiError, setLocalApiError] = useState<string | null>(null);
  const apiStartMutation = useMutation({
    mutationFn: () => client.startLocalApi(),
    onSuccess: (state) => {
      setLocalApiError(null);
      queryClient.setQueryData(API_STATE_QUERY_KEY, state);
    },
    onError: (reason) =>
      setLocalApiError(reason instanceof Error ? reason.message : copy.apiStartFailed),
  });
  const apiStopMutation = useMutation({
    mutationFn: () => client.stopLocalApi(),
    onSuccess: (state) => {
      setLocalApiError(null);
      queryClient.setQueryData(API_STATE_QUERY_KEY, state);
    },
    onError: (reason) =>
      setLocalApiError(reason instanceof Error ? reason.message : copy.apiStopFailed),
  });
  const synthesisMutation = useMutation({
    mutationFn: (request: { type: string; [key: string]: unknown }) =>
      client.request<SynthesisResult>(request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AUDIO_HISTORY_QUERY_KEY }),
  });
  const transcribeMutation = useMutation({
    mutationFn: (url: string) =>
      client.request<TranscribeVideoResult>({ type: "transcribe_video", url }),
  });
  const deleteHistoryMutation = useMutation({
    mutationFn: async (audioId: string) => {
      const response = await client.request<{ deleted: boolean }>({
        type: "delete_audio_history",
        file_name: audioId,
      });
      if (!response.deleted) throw new Error(copy.audioHistoryDeleteFailed);
      return audioId;
    },
    onSuccess: (_, audioId) => {
      queryClient.setQueryData<InfiniteData<AudioHistoryPage, AudioHistoryCursor | null>>(
        AUDIO_HISTORY_QUERY_KEY,
        (current) => {
          if (
            !current ||
            !current.pages.some((page) => page.items.some((item) => item.id === audioId))
          ) {
            return current;
          }
          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => item.id !== audioId),
              total: Math.max(0, page.total - 1),
            })),
          };
        },
      );
      setTakes((current) => current.filter((take) => fileName(take.audioPath) !== audioId));
      if (result && fileName(result.audio_path) === audioId) {
        setResult(null);
        setActiveTakeId(null);
      }
    },
  });
  const renameHistoryMutation = useMutation({
    mutationFn: (request: { fileName: string; newName: string }) =>
      client.request<RenameAudioHistoryResult>({
        type: "rename_audio_history",
        file_name: request.fileName,
        new_name: request.newName,
      }),
    onSuccess: async (response, request) => {
      await queryClient.resetQueries({ queryKey: AUDIO_HISTORY_QUERY_KEY, exact: true });
      setTakes((current) =>
        current.map((take) =>
          fileName(take.audioPath) === request.fileName
            ? { ...take, audioPath: response.audio_path }
            : take,
        ),
      );
      setResult((current) =>
        current && fileName(current.audio_path) === request.fileName
          ? { ...current, audio_path: response.audio_path }
          : current,
      );
    },
  });
  const historyLoadError = historyQuery.error
    ? historyQuery.error instanceof Error
      ? `${copy.audioHistoryLoadFailed}: ${historyQuery.error.message}`
      : copy.audioHistoryLoadFailed
    : null;
  const audioHistoryError = renameHistoryMutation.error
    ? renameHistoryMutation.error instanceof Error
      ? `${copy.audioHistoryRenameFailed}: ${renameHistoryMutation.error.message}`
      : copy.audioHistoryRenameFailed
    : deleteHistoryMutation.error
      ? deleteHistoryMutation.error instanceof Error
        ? `${copy.audioHistoryDeleteFailed}: ${deleteHistoryMutation.error.message}`
        : copy.audioHistoryDeleteFailed
      : historyLoadError;
  const isPreparing = preparingProviders.length > 0;
  const isSavingProfile = saveProfileMutation.isPending;
  const isImportingVoice = importVoiceMutation.isPending;
  const isImportingSeed = seedImportMutation.isPending;
  const isSeedingVieNeu = seedVieNeuMutation.isPending;
  const isGenerating = synthesisMutation.isPending;
  const providerStatuses = engineStatus?.providers ?? null;
  const allProvidersReady = Boolean(
    providerStatuses &&
    providerIsReady(providerStatuses.omnivoice) &&
    providerIsReady(providerStatuses.vieneu),
  );
  const canPrepareAllModels =
    !providerStatuses ||
    !providerStatuses.omnivoice.model_ready ||
    !providerStatuses.vieneu.model_ready;
  const modelReady = providerStatuses
    ? providerIsReady(providerStatuses[provider])
    : provider === "omnivoice" && Boolean(engineStatus?.model_ready);
  const omniVoiceReady = providerStatuses
    ? providerIsReady(providerStatuses.omnivoice)
    : Boolean(engineStatus?.model_ready);
  const presetVoices = engineStatus?.providers?.vieneu?.preset_voices ?? [];
  const visibleUpdate =
    updateResult?.kind === "available" && updateResult.tag !== dismissedUpdateTag
      ? updateResult
      : null;

  async function importBundledSeedVoices() {
    if (bundledSeedImportStarted.current) return;
    bundledSeedImportStarted.current = true;
    try {
      const seedDirectory = await resolveResource(BUNDLED_SEED_DIRECTORY);
      const imported = await seedImportMutation.mutateAsync(seedDirectory);
      if (imported.errors.length) {
        console.warn("[volo-ai] Some bundled voice seeds could not be imported", imported.errors);
      }
    } catch (reason) {
      bundledSeedImportStarted.current = false;
      console.warn("[volo-ai] Could not import bundled voice seeds", reason);
    }
  }

  useEffect(() => {
    const unsubscribe = client.onProgress((event) => {
      if (event.phase === "seed_vieneu") setSeedProgress(event);
      else if (event.phase === "nvidia_runtime") setRuntimeProgress(event);
      else if (TRANSCRIBE_PHASES.has(event.phase)) setTranscribeProgress(event);
      else if (event.provider) {
        const target = event.provider;
        setModelProgress((current) => ({ ...current, [target]: event }));
      }
    });
    const unsubscribeLogs = client.onLog((entry) => {
      setLogs(client.getLogs());
      if (entry.operation === "sidecar_exit" && entry.id.startsWith("sidecar-exit-")) {
        sidecarStopped.current = true;
        queryClient.setQueryData<StatusResult | null>(STATUS_QUERY_KEY, null);
      } else if (
        sidecarStopped.current &&
        entry.status === "success" &&
        /^\d+$/.test(entry.id)
      ) {
        sidecarStopped.current = false;
        if (entry.operation !== "status") {
          void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
        }
      }
    });
    return () => {
      unsubscribe();
      unsubscribeLogs();
      void client.stop();
    };
  }, []);

  useEffect(() => {
    if (!automaticCheckDue()) return;
    recordAutomaticCheck();
    void getVersion()
      .catch(() => null)
      .then((version) => checkLatestRelease(version))
      .then(setUpdateResult)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const name = event.error instanceof Error ? event.error.name : "Error";
      recordFrontendDiagnostic(
        "frontend_error",
        name,
        undefined,
        "An unhandled frontend error occurred.",
      );
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const name = event.reason instanceof Error ? event.reason.name : "UnhandledRejection";
      recordFrontendDiagnostic(
        "frontend_error",
        name,
        undefined,
        "An unhandled frontend promise rejection occurred.",
      );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    if (!engineStatus) return;
    client.hydrateDiagnostics([...(engineStatus.diagnostics ?? []), ...getFrontendDiagnostics()]);
  }, [engineStatus]);

  // Bundled OmniVoice seeds import whichever provider is selected.
  useEffect(() => {
    if (omniVoiceReady) void importBundledSeedVoices();
  }, [omniVoiceReady]);

  useEffect(() => {
    const loadedVoices = voicesQuery.data?.voices;
    if (!loadedVoices) return;
    setSelectedVoice((current) => {
      if (mode !== "profile") return current;
      const selected = loadedVoices.find((voice) => voice.name === current);
      if (selected?.kind === "vieneu_preset") return current;
      return selected?.language === language
        ? current
        : preferredVoiceForLanguage(loadedVoices, language);
    });
  }, [voicesQuery.data, language, mode]);

  useEffect(() => {
    if (view !== "settings") return;
    void appDataDir()
      .then(setDataDir)
      .catch(() => setDataDir(copy.unavailable));
  }, [view]);

  useEffect(() => {
    const enteringProfiles = view === "profiles" && lastView.current !== "profiles";
    lastView.current = view;
    if (enteringProfiles && engineOnline && voicesQuery.data) void voicesQuery.refetch();
  }, [view, engineOnline, voicesQuery.data, voicesQuery.refetch]);

  useEffect(() => {
    if (provider !== "vieneu" || !engineStatus) return;
    const defaultVoice = engineStatus.providers?.vieneu?.default_voice;
    const manifestVoices = engineStatus.providers?.vieneu?.preset_voices ?? [];
    setMode((current) => (current === "profile" || current === "file" ? current : "preset"));
    setSelectedVoice((current) => {
      const savedPreset = voices.find((voice) => voice.name === current);
      return savedPreset?.kind === "vieneu_preset" ||
        manifestVoices.some((voice) => voice.id === current)
        ? current
        : (defaultVoice ?? "");
    });
  }, [provider, engineStatus, voices]);

  useEffect(() => {
    const manifestVoices = engineStatus?.providers?.vieneu?.preset_voices ?? [];
    if (manifestVoices.some((voice) => voice.id === profilePresetId)) return;
    const defaultVoice = engineStatus?.providers?.vieneu?.default_voice;
    setProfilePresetId(
      manifestVoices.some((voice) => voice.id === defaultVoice)
        ? defaultVoice!
        : (manifestVoices[0]?.id ?? ""),
    );
  }, [engineStatus, profilePresetId]);

  async function prepareModels(targets: ProviderId[]) {
    const requested = [...new Set(targets)];
    if (!requested.length) return;
    setSetupError(null);
    setModelPreparationErrors((current) => {
      const next = { ...current };
      requested.forEach((target) => delete next[target]);
      return next;
    });
    setModelProgress((current) => {
      const next = { ...current };
      requested.forEach((target) => {
        next[target] = null;
      });
      return next;
    });
    setPreparingProviders((current) => [...new Set([...current, ...requested])]);
    await Promise.all(
      requested.map(async (target) => {
        try {
          await prepareMutation.mutateAsync(target);
          if (target === "omnivoice") {
            await importBundledSeedVoices();
          } else if (target === provider) {
            await queryClient.invalidateQueries({ queryKey: VOICES_QUERY_KEY });
          }
        } catch (reason) {
          setModelPreparationErrors((current) => ({
            ...current,
            [target]:
              reason instanceof Error ? reason.message : translator.t("errors.modelSetupFailed"),
          }));
        } finally {
          setPreparingProviders((current) => current.filter((item) => item !== target));
        }
      }),
    );
  }

  async function prepareModel(target: ProviderId = provider) {
    await prepareModels([target]);
  }

  async function prepareBothModels() {
    const targets = (["omnivoice", "vieneu"] as ProviderId[]).filter(
      (target) => !providerStatuses?.[target].model_ready,
    );
    await prepareModels(targets);
  }

  async function refreshModelStatus() {
    await statusQuery.refetch();
  }

  async function checkForUpdatesManually() {
    if (isCheckingUpdates) return;
    setIsCheckingUpdates(true);
    setManualUpdateFeedback("none");
    const installedVersion = await getVersion().catch(() => null);
    const result = await checkLatestRelease(installedVersion);
    setUpdateResult(result);
    setIsCheckingUpdates(false);
    if (result.kind === "unavailable") {
      setManualUpdateFeedback("unavailable");
    } else if (result.kind !== "available") {
      setManualUpdateFeedback("current");
    } else if (result.tag === dismissedUpdateTag) {
      clearDismissedTag();
      setDismissedUpdateTag(null);
    }
  }

  function dismissUpdateBanner() {
    if (!visibleUpdate) return;
    dismissUpdateTag(visibleUpdate.tag);
    setDismissedUpdateTag(visibleUpdate.tag);
  }

  async function openUpdateRelease() {
    if (!visibleUpdate) return;
    try {
      await shellOpen(visibleUpdate.url);
    } catch {
      recordFrontendDiagnostic(
        "frontend_error",
        "release_link_open_failed",
        undefined,
        "Could not open the release page.",
      );
    }
  }

  async function openCommunityPage(page: "ideas" | "repository" | "kofi") {
    const url =
      page === "ideas"
        ? "https://github.com/az-forge/volo-ai/discussions/categories/ideas"
        : page === "kofi"
          ? "https://ko-fi.com/n2q1910"
          : "https://github.com/az-forge/volo-ai";
    try {
      await shellOpen(url);
    } catch {
      recordFrontendDiagnostic(
        "frontend_error",
        "community_link_open_failed",
        undefined,
        "Could not open the community page.",
      );
    }
  }

  async function cancelModelPreparation() {
    if (!isPreparing) return;
    setIsCancelling(true);
    try {
      await client.cancelPreparation();
    } catch (reason) {
      setSetupError(
        reason instanceof Error ? reason.message : translator.t("errors.modelSetupFailed"),
      );
    } finally {
      setIsCancelling(false);
    }
  }

  async function refreshVoices() {
    await voicesQuery.refetch();
  }

  async function refreshAudioHistory() {
    deleteHistoryMutation.reset();
    renameHistoryMutation.reset();
    await queryClient.resetQueries({ queryKey: AUDIO_HISTORY_QUERY_KEY, exact: true });
  }

  async function loadMoreAudioHistory() {
    if (!historyQuery.hasNextPage || historyQuery.isFetchingNextPage) return;
    deleteHistoryMutation.reset();
    renameHistoryMutation.reset();
    await historyQuery.fetchNextPage();
  }

  function navigateTo(nextView: AppView) {
    if (nextView === view) return;
    if (nextView === "history") {
      deleteHistoryMutation.reset();
      renameHistoryMutation.reset();
      queryClient.removeQueries({ queryKey: AUDIO_HISTORY_QUERY_KEY, exact: true });
    }
    setView(nextView);
  }

  function changeAppLanguage(next: AppLanguage) {
    setAppLanguage(next);
  }

  function changeProvider(next: ProviderId) {
    setProvider(next);
    localStorage.setItem("volo-ai.provider", next);
    navigateTo("workspace");
    setSetupError(null);
    setError(null);
    setResult(null);
    setRefAudio(null);
    if (next === "omnivoice") {
      setMode("auto");
      setSelectedVoice("auto");
    } else {
      setMode("preset");
      setSelectedVoice(engineStatus?.providers?.vieneu?.default_voice ?? "");
    }
    void queryClient.invalidateQueries({ queryKey: VOICES_QUERY_KEY });
  }

  function changeSynthesisLanguage(next: Language) {
    setLanguage(next);
    localStorage.setItem("volo-ai.synthesis-language", next);
    if (mode === "profile") {
      setSelectedVoice((current) => {
        const selected = voices.find((voice) => voice.name === current);
        if (selected?.kind === "vieneu_preset") return current;
        return selected?.language === next ? current : preferredVoiceForLanguage(voices, next);
      });
    }
  }

  function changeVoiceSelection(value: string) {
    if (value === "auto") {
      setMode("auto");
      setSelectedVoice("auto");
      return;
    }
    if (value === "file") {
      setMode("file");
      return;
    }
    const separator = value.indexOf(":");
    const kind = separator >= 0 ? value.slice(0, separator) : "profile";
    const name = separator >= 0 ? value.slice(separator + 1) : value;
    setMode(kind === "preset" ? "preset" : "profile");
    setSelectedVoice(name);
  }

  async function chooseReference() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "flac", "ogg"] }],
    });
    if (typeof selected === "string") setRefAudio(selected);
  }

  async function importVoiceFile() {
    if (!omniVoiceReady) {
      setVoiceImportStatus({ message: copy.omnivoiceProfileRequired, tone: "error" });
      return;
    }
    let selected: string | string[] | null;
    try {
      selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Audio", extensions: ["wav", "mp3", "flac", "ogg"] }],
      });
    } catch (reason) {
      setVoiceImportStatus({
        message: reason instanceof Error ? reason.message : copy.voiceImportFailed,
        tone: "error",
      });
      return;
    }
    if (typeof selected !== "string") return;
    const name = voiceNameFromFile(selected);
    if (voices.some((voice) => voice.name === name)) {
      setVoiceImportStatus({
        message: `${copy.voiceImportSkipped}: ${name}`,
        tone: "success",
      });
      return;
    }
    setVoiceImportStatus(null);
    setSeedImportStatus(null);
    setProfileError(null);
    try {
      await importVoiceMutation.mutateAsync({ name, path: selected, language });
      setRefAudio(selected);
      setVoiceImportStatus({
        message: `${copy.voiceImportCompleted}: ${name}`,
        tone: "success",
      });
    } catch (reason) {
      setVoiceImportStatus({
        message: reason instanceof Error ? reason.message : copy.voiceImportFailed,
        tone: "error",
      });
    }
  }

  async function importSeedFolder() {
    if (!omniVoiceReady) {
      setSeedImportStatus({ message: copy.omnivoiceProfileRequired, tone: "error" });
      return;
    }
    let selected: string | string[] | null;
    try {
      selected = await open({ multiple: false, directory: true });
    } catch (reason) {
      setSeedImportStatus({
        message: reason instanceof Error ? reason.message : copy.seedImportFailed,
        tone: "error",
      });
      return;
    }
    if (typeof selected !== "string") return;
    setSeedImportStatus(null);
    setVoiceImportStatus(null);
    try {
      const result = await seedImportMutation.mutateAsync(selected);
      if (!result.imported.length && !result.skipped.length && !result.errors.length) {
        setSeedImportStatus({ message: copy.noSeedVoicesFound, tone: "error" });
      } else {
        setSeedImportStatus({
          message: `${copy.seedImportCompleted}: ${result.imported.length} ${copy.seedImported}, ${result.skipped.length} ${copy.seedSkipped}, ${result.errors.length} ${copy.seedErrors}`,
          tone: result.errors.length ? "error" : "success",
        });
      }
    } catch (reason) {
      setSeedImportStatus({
        message: reason instanceof Error ? reason.message : copy.seedImportFailed,
        tone: "error",
      });
    }
  }

  async function seedVieNeuVoices(): Promise<SeedVieNeuResult | null> {
    setIsCancellingSeed(false);
    setSeedProgress(null);
    setSeedResult(null);
    setSeedError(null);
    setVoiceImportStatus(null);
    setSeedImportStatus(null);
    try {
      const result = await seedVieNeuMutation.mutateAsync();
      setSeedResult(result);
      return result;
    } catch (reason) {
      setSeedError(reason instanceof Error ? reason.message : copy.seedVieNeuFailed);
      return null;
    } finally {
      setIsCancellingSeed(false);
    }
  }

  // Once both models are ready, turn every VieNeu preset into a profile that
  // OmniVoice can also clone, so a fresh install starts with a voice library.
  useEffect(() => {
    if (!allProvidersReady || vieneuAutoSeedStarted.current) return;
    if (localStorage.getItem(VIENEU_SEEDED_KEY)) return;
    vieneuAutoSeedStarted.current = true;
    void seedVieNeuVoices().then((result) => {
      if (result && !result.cancelled && !result.failed.length && !result.unfinished.length) {
        localStorage.setItem(VIENEU_SEEDED_KEY, "1");
      }
    });
  }, [allProvidersReady]);

  async function cancelSeedVieNeuVoices() {
    setIsCancellingSeed(true);
    try {
      await client.cancelSeed();
    } catch (reason) {
      setSeedError(reason instanceof Error ? reason.message : copy.seedVieNeuFailed);
      setIsCancellingSeed(false);
    }
  }

  async function synthesize() {
    setError(null);
    if (!text.trim()) return setError(copy.enterText);
    if (mode === "profile" && !selectedVoice) return setError(copy.selectProfile);
    if (provider === "omnivoice" && mode !== "auto" && mode !== "profile") {
      return setError(copy.selectProfile);
    }
    if (provider === "vieneu" && mode === "preset" && !selectedVoice) {
      return setError(copy.selectProfile);
    }
    if (provider === "vieneu" && mode === "file" && !refAudio) {
      return setError(copy.chooseReferenceError);
    }
    if (provider === "vieneu" && mode === "auto") return setError(copy.selectProfile);
    let steps: number | undefined;
    let duration: number | undefined;
    let generationConfig: GenerationConfig = {};
    let vieneuConfig: VieNeuConfig = {};
    if (provider === "omnivoice") {
      try {
        steps = readAdvancedNumber(advanced.steps, copy.diffusionSteps, {
          integer: true,
          positive: true,
        });
        if (steps === undefined) throw new Error(copy.invalidSteps);
        duration = readAdvancedNumber(advanced.duration, copy.fixedDuration, { positive: true });
        generationConfig = {
          guidance_scale: readAdvancedNumber(advanced.guidance_scale, copy.guidanceScale),
          t_shift: readAdvancedNumber(advanced.t_shift, copy.tShift),
          position_temperature: readAdvancedNumber(
            advanced.position_temperature,
            copy.positionTemperature,
          ),
          class_temperature: readAdvancedNumber(advanced.class_temperature, copy.classTemperature),
          layer_penalty_factor: readAdvancedNumber(
            advanced.layer_penalty_factor,
            copy.layerPenaltyFactor,
          ),
          denoise: advanced.denoise,
          preprocess_prompt: advanced.preprocess_prompt,
          postprocess_output: advanced.postprocess_output,
          audio_chunk_duration: readAdvancedNumber(
            advanced.audio_chunk_duration,
            copy.chunkDuration,
            { positive: true },
          ),
          audio_chunk_threshold: readAdvancedNumber(
            advanced.audio_chunk_threshold,
            copy.chunkThreshold,
            { positive: true },
          ),
          pad_duration: readAdvancedNumber(advanced.pad_duration, copy.padDuration),
          fade_duration: readAdvancedNumber(advanced.fade_duration, copy.fadeDuration),
        };
      } catch (reason) {
        setAdvancedError(reason instanceof Error ? reason.message : copy.invalidAdvancedValue);
        return;
      }
    } else {
      try {
        vieneuConfig = readVieNeuConfig(vieneuAdvanced, copy.invalidVieNeuSettings);
      } catch {
        setVieNeuAdvancedError(copy.invalidVieNeuSettings);
        return;
      }
    }
    setAdvancedError(null);
    setVieNeuAdvancedError(null);
    try {
      const request: { type: string; [key: string]: unknown } = {
        type: "synthesize",
        provider,
        text,
        language,
        voice: mode,
        format,
      };
      if (provider === "omnivoice") {
        Object.assign(request, {
          voice_name: mode === "profile" ? selectedVoice : undefined,
          speed,
          steps,
          duration,
          normalize_text: advanced.normalize_text,
          generation_config: generationConfig,
        });
      } else {
        if (Object.keys(vieneuConfig).length) request.vieneu_config = vieneuConfig;
        if (mode === "preset") {
          request.preset_id = selectedVoice;
        } else if (mode === "profile") {
          request.voice_name = selectedVoice;
        } else {
          request.ref_audio = refAudio;
        }
      }
      renderCancelled.current = false;
      const response = await synthesisMutation.mutateAsync(request);
      setResult(response);
      const presetId =
        mode === "preset"
          ? selectedVoice
          : voices.find((voice) => voice.name === selectedVoice && voice.kind === "vieneu_preset")
              ?.preset_id;
      const activeVoiceLabel =
        presetId
          ? (presetVoices.find((p) => p.id === presetId)?.name ?? selectedVoice)
          : mode === "profile"
            ? selectedVoice
            : refAudio
              ? fileName(refAudio)
              : copy.autoVoice;
      const newTake: TakeItem = {
        id: String(Date.now()),
        timestamp: Date.now(),
        provider,
        voiceName: activeVoiceLabel,
        format: response.format,
        audioPath: response.audio_path,
        text,
      };
      setTakes((prev) => [newTake, ...prev.slice(0, MAX_SESSION_TAKES - 1)]);
      setActiveTakeId(newTake.id);
    } catch (reason) {
      if (renderCancelled.current) return;
      setError(reason instanceof Error ? reason.message : copy.synthesisFailed);
    }
  }

  async function cancelRender() {
    renderCancelled.current = true;
    if (await client.cancelSynthesis()) {
      // Restarting the engine also stops the local API server it hosts.
      void queryClient.invalidateQueries({ queryKey: API_STATE_QUERY_KEY });
      return;
    }
    renderCancelled.current = false;
    setError(copy.cancelRenderBusy);
  }

  function handleSelectTake(take: TakeItem) {
    setActiveTakeId(take.id);
    setResult({ audio_path: take.audioPath, format: take.format });
  }

  function handleClearLogs() {
    client.clearLogs();
    setLogs([]);
    setDiagnosticsIncomplete(false);
    void client
      .request<{ cleared: boolean; diagnostics_complete?: boolean }>({ type: "clear_diagnostics" })
      .then((result) => {
        client.clearLogs();
        setLogs([]);
        setDiagnosticsIncomplete(result.diagnostics_complete === false);
      })
      .catch(() => setDiagnosticsIncomplete(true));
  }

  async function handleExportDiagnostics() {
    setIsExportingDiagnostics(true);
    setDiagnosticsIncomplete(false);
    try {
      const homePath = await homeDir().catch(() => null);
      const frontendEvents = frontendDiagnosticsForExport(homePath);
      const frontendComplete = frontendDiagnosticsComplete() && homePath !== null;
      let report: unknown;
      try {
        report = await client.request({
          type: "get_diagnostics",
          frontend_events: frontendEvents,
          frontend_complete: frontendComplete,
        });
        if (
          typeof report === "object" &&
          report !== null &&
          "diagnostics_complete" in report &&
          report.diagnostics_complete === false
        ) {
          setDiagnosticsIncomplete(true);
        }
      } catch {
        report = {
          format: 1,
          created_at: new Date().toISOString(),
          app_version: await getVersion().catch(() => "unknown"),
          platform: { os: navigator.platform, architecture: "unknown" },
          runtime: { state: "unavailable" },
          diagnostics_complete: false,
          events: frontendEvents,
        };
        setDiagnosticsIncomplete(true);
      }
      const destination = await save({
        defaultPath: "volo-ai-diagnostics.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof destination === "string") {
        await writeTextFile(destination, JSON.stringify(report, null, 2));
      }
    } catch {
      setDiagnosticsIncomplete(true);
      setError(copy.exportFailed);
    } finally {
      setIsExportingDiagnostics(false);
    }
  }

  function cancelRuntimeInstall() {
    void client
      .cancelNvidiaRuntime()
      .catch((reason) =>
        setRuntimeError(reason instanceof Error ? reason.message : copy.nvidiaInstallFailed),
      );
  }

  function changeTheme(next: ThemeMode) {
    setTheme(next);
    applyTheme(next);
  }

  async function saveProfile() {
    if (profileKind !== "vieneu_preset" && !omniVoiceReady) {
      const message = copy.omnivoiceProfileRequired;
      setError(message);
      setProfileError(message);
      return;
    }
    if (!profileName.trim()) {
      const message = copy.profileNameRequired;
      setError(message);
      setProfileError(message);
      return;
    }
    if (profileKind === "clone" && !refAudio) {
      const message = copy.chooseReferenceError;
      setError(message);
      setProfileError(message);
      return;
    }
    if (profileKind === "design" && !designInstruction.trim()) {
      const message = copy.designProfileInstructionRequired;
      setError(message);
      setProfileError(message);
      return;
    }
    if (
      profileKind === "vieneu_preset" &&
      !presetVoices.some((voice) => voice.id === profilePresetId)
    ) {
      const message = copy.vieneuPresetCatalogUnavailable;
      setError(message);
      setProfileError(message);
      return;
    }
    setProfileError(null);
    const name = toVoiceName(profileName) || profileName.trim();
    try {
      let request: SaveProfileRequest;
      if (profileKind === "vieneu_preset") {
        request = {
          kind: "vieneu_preset",
          name,
          presetId: profilePresetId,
        };
      } else if (profileKind === "design") {
        request = {
          kind: "design",
          name,
          instruction: designInstruction.trim(),
          language,
        };
      } else {
        request = {
          kind: "clone",
          name,
          refAudio: refAudio!,
          refText: refText || undefined,
          language,
        };
      }
      await saveProfileMutation.mutateAsync(request);
      setProfileName("");
      setDesignInstruction("");
      setError(null);
      setProfileError(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : copy.couldNotSaveVoice;
      setError(message);
      setProfileError(message);
    }
  }

  async function deleteProfile(name = selectedVoice) {
    if (name === "auto") return;
    setDeletingVoice(name);
    setProfileError(null);
    try {
      await deleteProfileMutation.mutateAsync(name);
      if (selectedVoice === name) {
        setMode(provider === "vieneu" ? "preset" : "auto");
        setSelectedVoice(
          provider === "vieneu" ? (engineStatus?.providers?.vieneu?.default_voice ?? "") : "auto",
        );
      }
      setError(null);
      setProfileError(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : copy.couldNotDeleteVoice;
      setError(message);
      setProfileError(message);
    } finally {
      setDeletingVoice(null);
    }
  }

  async function deleteAudioHistory(audioId: string) {
    setDeletingAudioFile(audioId);
    try {
      await deleteHistoryMutation.mutateAsync(audioId);
    } catch {
      // The mutation error is rendered by the History view.
    } finally {
      setDeletingAudioFile(null);
    }
  }

  async function renameAudioHistory(fileName: string, newName: string) {
    setRenamingAudioFile(fileName);
    try {
      await renameHistoryMutation.mutateAsync({ fileName, newName });
    } finally {
      setRenamingAudioFile(null);
    }
  }

  function useProfile(name: string) {
    const profile = voices.find((voice) => voice.name === name);
    if (provider === "vieneu" && profile?.kind === "design") {
      setError(copy.vieneuDesignUnsupported);
      return;
    }
    const switchToVieNeu =
      profile?.kind === "vieneu_preset" && !profile.ref_audio && provider !== "vieneu";
    if (switchToVieNeu) {
      setProvider("vieneu");
      localStorage.setItem("volo-ai.provider", "vieneu");
      setError(null);
      setResult(null);
      setRefAudio(null);
      void queryClient.invalidateQueries({ queryKey: VOICES_QUERY_KEY });
    }
    if (
      profile?.kind === "vieneu_preset" &&
      profile.preset_id &&
      (switchToVieNeu || provider === "vieneu")
    ) {
      // VieNeu lists presets directly, so select the preset this profile stands for.
      setSelectedVoice(profile.preset_id);
      setMode("preset");
    } else {
      setSelectedVoice(name);
      setMode("profile");
    }
    navigateTo("workspace");
    setProfileError(null);
  }

  function transcribeErrorMessage(reason: unknown): string {
    if (reason instanceof SidecarError) {
      const localized = copy.transcribeErrors[reason.code];
      if (localized) return localized;
      return reason.message || copy.transcribeErrors.transcription_failed;
    }
    return reason instanceof Error ? reason.message : copy.transcribeErrors.transcription_failed;
  }

  async function startTranscription() {
    const url = transcribeUrl.trim();
    if (!url) {
      setTranscribeError(copy.transcribeEnterUrl);
      return;
    }
    if (!isSupportedVideoUrl(url)) {
      setTranscribeError(copy.transcribeInvalidUrl);
      return;
    }
    setTranscribeError(null);
    setTranscribeSaved(false);
    setTranscribeResult(null);
    setTranscribeProgress(null);
    try {
      const completed = await transcribeMutation.mutateAsync(url);
      setTranscribeResult(completed);
      setTranscribeProgress(null);
    } catch (reason) {
      setTranscribeResult(null);
      setTranscribeProgress(null);
      setTranscribeError(transcribeErrorMessage(reason));
    }
  }

  async function cancelTranscription() {
    setIsCancellingTranscribe(true);
    try {
      await client.cancelTranscription().catch(() => undefined);
    } finally {
      setIsCancellingTranscribe(false);
    }
  }

  async function saveTranscriptSrt() {
    if (!transcribeResult) return;
    const destination = await save({
      defaultPath: srtFileName(transcribeResult.title),
      filters: [{ name: "SRT", extensions: ["srt"] }],
    });
    if (typeof destination !== "string") return;
    const path = destination.toLowerCase().endsWith(".srt") ? destination : `${destination}.srt`;
    try {
      await writeTextFile(path, transcribeResult.srt);
      setTranscribeSaved(true);
      setTranscribeError(null);
    } catch (reason) {
      setTranscribeError(reason instanceof Error ? reason.message : copy.exportFailed);
    }
  }

  async function exportAudio() {
    if (!result) return;
    const script = takes.find((take) => take.id === activeTakeId)?.text ?? "";
    const stem = toVoiceName(script.trim().split(/\s+/).slice(0, 6).join(" ")) || "volo-ai-output";
    const destination = await save({
      defaultPath: `${stem}.${result.format}`,
      filters: [{ name: result.format.toUpperCase(), extensions: [result.format] }],
    });
    if (typeof destination === "string") {
      try {
        await copyFile(result.audio_path, destination);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : copy.exportFailed);
      }
    }
  }

  if (
    !allProvidersReady &&
    view !== "profiles" &&
    view !== "history" &&
    view !== "settings" &&
    view !== "logs" &&
    !(view === "transcribe" && omniVoiceReady)
  )
    return (
      <>
        {visibleUpdate && (
          <div className="bg-(--background) px-6 pt-6">
            <div className="mx-auto max-w-4xl">
              <UpdateBanner
                copy={copy}
                tag={visibleUpdate.tag}
                onOpenRelease={() => void openUpdateRelease()}
                onDismiss={dismissUpdateBanner}
              />
            </div>
          </div>
        )}
        <SetupScreen
          copy={copy}
          providers={providerStatuses}
          progressEvents={modelProgress}
          providerErrors={modelPreparationErrors}
          preparingProviders={preparingProviders}
          isPreparing={isPreparing}
          isCancelling={isCancelling}
          setupError={setupError ?? modelStatusError}
          canPrepare={canPrepareAllModels}
          omniVoiceReady={omniVoiceReady}
          engineFailed={!engineStatus && statusQuery.isError}
          onRetryEngine={() => void refreshModelStatus()}
          onPrepareAll={() => void prepareBothModels()}
          onCancel={() => void cancelModelPreparation()}
          onOpenProfiles={() => navigateTo("profiles")}
          onOpenHistory={() => navigateTo("history")}
          onOpenSettings={() => navigateTo("settings")}
          onOpenLogs={() => navigateTo("logs")}
          onOpenTranscribe={() => navigateTo("transcribe")}
        />
      </>
    );

  const transition = { duration: prefersReducedMotion ? 0 : 0.22, ease: "easeOut" as const };
  const navItems: Array<[AppView, string, LucideIcon]> = [
    ["workspace", copy.synthesize, AudioLines],
    ["transcribe", copy.transcribe, Captions],
    ["profiles", copy.voiceProfiles, Library],
    ["history", copy.audioHistory, History],
    ["settings", copy.settings, Settings2],
    ["logs", copy.logs, Logs],
  ];
  return (
    <MotionConfig reducedMotion="user">
      <main className="flex h-screen overflow-hidden bg-(--background) text-(--foreground)">
        <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-(--border) bg-(--surface) px-4 py-5 md:flex">
          <div className="flex items-center gap-3 px-2 pb-10">
            <div className="grid size-10 place-items-center rounded-xl bg-(--accent) text-white shadow-[0_8px_20px_rgb(191_95_69/20%)]">
              <AudioLines className="size-5" />
            </div>
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-(--muted-foreground)">
                VOLO AI
              </p>
              <p className="mt-0.5 text-sm font-semibold">{copy.localVoiceStudio}</p>
            </div>
          </div>
          <nav aria-label={copy.workspace} className="space-y-1">
            <p className="mb-3 px-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-(--muted-foreground)">
              {copy.workspace}
            </p>
            {navItems.map(([item, label, Icon]) => (
              <Button
                variant="navigation"
                size="default"
                key={item as string}
                onClick={() => navigateTo(item as AppView)}
                aria-current={view === item ? "page" : undefined}
                className="group w-full gap-3 rounded-xl px-3 py-2.5 text-left"
              >
                <Icon data-icon="inline-start" />
                {label}
              </Button>
            ))}
          </nav>
          <div className="mt-auto border-t border-(--border) px-2 pt-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-(--muted-foreground)">
                {copy.theme}
              </p>
              <div className="rounded-lg border border-(--border) bg-(--surface-muted) p-0.5">
                <ToggleGroup
                  multiple={false}
                  value={[theme]}
                  onValueChange={(value) => {
                    if (value[0]) changeTheme(value[0] as ThemeMode);
                  }}
                  spacing={0}
                  aria-label={copy.theme}
                >
                  {(
                    [
                      ["light", Sun],
                      ["dark", Moon],
                      ["system", Monitor],
                    ] as const
                  ).map(([mode, Icon]) => (
                    <ToggleGroupItem
                      key={mode}
                      value={mode}
                      size="sm"
                      className="size-6 min-w-6 p-0"
                      aria-label={mode}
                      title={mode}
                    >
                      <Icon />
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>

            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-(--muted-foreground)">
              {copy.engine}
            </p>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
              <span
                className={`size-2 rounded-full ${modelReady ? "bg-(--success)" : "bg-(--muted-foreground)"}`}
              />
              {modelReady ? copy.offlineEngine : copy.engineUnavailable}
            </div>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-(--muted-foreground)">
              {language.toUpperCase()} · {provider.toUpperCase()}
            </p>
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col overflow-auto">
          <div className="mx-auto w-full max-w-[1440px] flex-1 px-5 py-6 sm:px-8 sm:py-8 lg:px-10">
            {visibleUpdate && (
              <UpdateBanner
                copy={copy}
                tag={visibleUpdate.tag}
                onOpenRelease={() => void openUpdateRelease()}
                onDismiss={dismissUpdateBanner}
              />
            )}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={view}
                initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -5 }}
                transition={transition}
              >
                {view === "settings" ? (
                  <SettingsView
                    copy={copy}
                    appLanguage={appLanguage}
                    theme={theme}
                    selectedProvider={provider}
                    providers={providerStatuses}
                    modelReady={omniVoiceReady}
                    engineOnline={engineOnline}
                    device={device}
                    resources={engineStatus?.resources}
                    dataDir={dataDir}
                    modelId={engineStatus?.model ?? "OmniVoice"}
                    tokenizerId={engineStatus?.tokenizer ?? "Audio tokenizer"}
                    asrModelId={engineStatus?.asr_model ?? "Whisper ASR"}
                    modelStatusError={modelStatusError}
                    setupError={modelPreparationErrors[provider] ?? setupError}
                    progressEvent={modelProgress[provider]}
                    nvidiaRuntime={engineStatus?.nvidia_runtime}
                    runtimeProgress={runtimeProgress}
                    runtimeError={runtimeError}
                    runtimeRestartRequired={runtimeRestartRequired}
                    isInstallingRuntime={runtimeInstallMutation.isPending}
                    isRemovingRuntime={runtimeRemoveMutation.isPending}
                    isRefreshingStatus={isRefreshingStatus}
                    isPreparing={isPreparing}
                    preparingProviders={preparingProviders}
                    localApi={localApi}
                    localApiError={localApiError}
                    isStartingLocalApi={apiStartMutation.isPending}
                    isStoppingLocalApi={apiStopMutation.isPending}
                    onStartLocalApi={() => apiStartMutation.mutate()}
                    onStopLocalApi={() => apiStopMutation.mutate()}
                    onSelectProvider={changeProvider}
                    onPrepareProvider={(target) => void prepareModel(target)}
                    onCancelPrepare={() => void cancelModelPreparation()}
                    onChangeLanguage={changeAppLanguage}
                    onChangeTheme={changeTheme}
                    onRefreshStatus={() => void refreshModelStatus()}
                    onInstallRuntime={() => {
                      setRuntimeError(null);
                      setRuntimeProgress(null);
                      runtimeInstallMutation.mutate();
                    }}
                    onCancelRuntime={cancelRuntimeInstall}
                    onRemoveRuntime={() => runtimeRemoveMutation.mutate()}
                    isCheckingUpdates={isCheckingUpdates}
                    manualUpdateFeedback={manualUpdateFeedback}
                    onCheckForUpdates={() => void checkForUpdatesManually()}
                    onOpenCommunityPage={(page) => void openCommunityPage(page)}
                    onBack={() => navigateTo("workspace")}
                  />
                ) : view === "logs" ? (
                  <LogsView
                    logs={logs}
                    copy={copy}
                    onClearLogs={handleClearLogs}
                    onExportDiagnostics={() => void handleExportDiagnostics()}
                    isExportingDiagnostics={isExportingDiagnostics}
                    diagnosticsIncomplete={
                      diagnosticsIncomplete || engineStatus?.diagnostics_complete === false
                    }
                  />
                ) : view === "transcribe" ? (
                  <TranscribeView
                    copy={copy}
                    url={transcribeUrl}
                    progress={transcribeProgress}
                    result={transcribeResult}
                    error={transcribeError}
                    saved={transcribeSaved}
                    isTranscribing={transcribeMutation.isPending}
                    isCancelling={isCancellingTranscribe}
                    onUrlChange={(value) => {
                      setTranscribeUrl(value);
                      if (transcribeError) setTranscribeError(null);
                    }}
                    onStart={() => void startTranscription()}
                    onCancel={() => void cancelTranscription()}
                    onSave={() => void saveTranscriptSrt()}
                  />
                ) : view === "history" ? (
                  <AudioHistoryView
                    copy={copy}
                    appLanguage={appLanguage}
                    items={audioHistory}
                    total={audioHistoryTotal}
                    nextCursor={audioHistoryCursor}
                    isLoading={isLoadingAudioHistory}
                    isLoadingMore={isLoadingMoreAudioHistory}
                    error={audioHistoryError}
                    deletingFileName={deletingAudioFile}
                    renamingFileName={renamingAudioFile}
                    onRetry={() => void refreshAudioHistory()}
                    onLoadMore={() => void loadMoreAudioHistory()}
                    onDelete={(fileName) => void deleteAudioHistory(fileName)}
                    onRename={renameAudioHistory}
                  />
                ) : view === "profiles" ? (
                  <VoiceProfilesView
                    voices={voices}
                    presetVoices={presetVoices}
                    isLoading={isLoadingVoices}
                    listError={voiceListError}
                    formError={profileError}
                    profileName={profileName}
                    profileKind={profileKind}
                    profilePresetId={profilePresetId}
                    refAudio={refAudio}
                    refText={refText}
                    designInstruction={designInstruction}
                    isSaving={isSavingProfile}
                    isImporting={isImportingVoice}
                    isImportingSeed={isImportingSeed}
                    isSeedingVieNeu={isSeedingVieNeu}
                    isCancellingSeed={isCancellingSeed}
                    seedProgress={seedProgress}
                    seedResult={seedResult}
                    seedError={seedError}
                    importStatus={voiceImportStatus}
                    seedImportStatus={seedImportStatus}
                    deletingVoice={deletingVoice}
                    copy={copy}
                    onChooseReference={() => void chooseReference()}
                    onImportVoiceFile={() => void importVoiceFile()}
                    onImportSeedFolder={() => void importSeedFolder()}
                    onSeedVieNeuVoices={() => void seedVieNeuVoices()}
                    onCancelSeed={() => void cancelSeedVieNeuVoices()}
                    onProfileNameChange={setProfileName}
                    onProfilePresetIdChange={setProfilePresetId}
                    onRefTextChange={setRefText}
                    onProfileKindChange={(kind) => {
                      setProfileKind(kind);
                      setError(null);
                      setProfileError(null);
                    }}
                    onDesignInstructionChange={setDesignInstruction}
                    onSave={saveProfile}
                    onRetry={() => void refreshVoices()}
                    onUse={useProfile}
                    onDelete={setConfirmDeleteName}
                  />
                ) : (
                  <WorkspaceView
                    copy={copy}
                    provider={provider}
                    providerStatuses={providerStatuses}
                    onProviderChange={changeProvider}
                    mode={mode}
                    language={language}
                    text={text}
                    speed={speed}
                    format={format}
                    advanced={advanced}
                    advancedError={advancedError}
                    vieneuAdvanced={vieneuAdvanced}
                    vieneuAdvancedError={vieneuAdvancedError}
                    voices={voices}
                    presetVoices={presetVoices}
                    selectedVoice={selectedVoice}
                    refAudio={refAudio}
                    result={result}
                    error={error}
                    isGenerating={isGenerating}
                    isImportingSeed={isImportingSeed}
                    takes={takes}
                    activeTakeId={activeTakeId}
                    onSelectTake={handleSelectTake}
                    onLanguageChange={changeSynthesisLanguage}
                    onTextChange={setText}
                    onSpeedChange={setSpeed}
                    onFormatChange={setFormat}
                    onAdvancedChange={(patch) =>
                      setAdvanced((current) => ({ ...current, ...patch }))
                    }
                    onVieNeuAdvancedChange={(patch) =>
                      setVieNeuAdvanced((current) => ({ ...current, ...patch }))
                    }
                    onVoiceSelectionChange={changeVoiceSelection}
                    onChooseReference={() => void chooseReference()}
                    onSynthesize={() => void synthesize()}
                    onCancelSynthesis={() => void cancelRender()}
                    onExport={() => void exportAudio()}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <footer className="sticky bottom-0 border-t border-(--border) bg-(--surface) px-5 py-3 sm:px-8 lg:px-10">
            <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-(--muted-foreground)">
              <span
                className={`flex items-center gap-2 ${engineOnline && modelReady ? "text-(--success)" : "text-(--destructive)"}`}
              >
                <span
                  className={`size-1.5 rounded-full ${engineOnline && modelReady ? "bg-(--success)" : "bg-(--destructive)"}`}
                />
                {engineOnline && modelReady ? copy.engineReady : copy.engineUnavailable}
              </span>
              <span>
                {copy.device} /{" "}
                {engineOnline
                  ? backendLabel(providerStatuses?.[provider]?.backend ?? device, copy)
                  : "OFFLINE"}
              </span>
              <span>
                {copy.sampleRate} / {provider === "vieneu" ? 48000 : 24000} HZ
              </span>
              <span className="ml-auto text-(--foreground)">{copy.allAudioLocal}</span>
            </div>
          </footer>
        </section>
        <ConfirmDialog
          open={Boolean(confirmDeleteName)}
          title={copy.deleteProfile}
          description={copy.confirmDeleteVoice}
          confirmLabel={copy.deleteProfile}
          cancelLabel={copy.cancel}
          onOpenChange={(open) => {
            if (!open) setConfirmDeleteName(null);
          }}
          onConfirm={() => {
            if (confirmDeleteName) void deleteProfile(confirmDeleteName);
            setConfirmDeleteName(null);
          }}
          busy={Boolean(deletingVoice)}
        />
      </main>
    </MotionConfig>
  );
}

export default App;
