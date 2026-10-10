import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, resolveResource } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import {
  AlertCircle,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Clock,
  Copy,
  Download,
  FileAudio,
  FileText,
  FolderOpen,
  HardDrive,
  History,
  Languages,
  Library,
  LoaderCircle,
  Logs,
  Monitor,
  Moon,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import {
  SidecarClient,
  type AudioHistoryItem,
  type AudioFormat,
  type GenerationConfig,
  type Language,
  type ProviderId,
  type ProviderStatus,
  type ProgressEvent,
  type RequestLog,
  type StatusResult,
  type SynthesisResult,
  type VoiceKind,
  type VoiceMode,
  type VoiceProfile,
} from "./lib/sidecar";
import { createUiCopy, setAppLanguage, type AppLanguage, type UiCopy } from "./lib/i18n";
import { cn } from "./lib/utils";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Input,
  Label,
  Progress,
  Select,
  SelectItem,
  Separator,
  Skeleton,
  Textarea,
} from "./components/ui";
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
type AppView = "workspace" | "profiles" | "history" | "settings" | "logs";
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
type SeedImportResult = {
  imported: Array<{ id: string; name: string; language: string }>;
  skipped: Array<{ id: string; name: string; reason: string }>;
  errors: Array<{ id: string; message: string }>;
};
type ImportStatus = { message: string; tone: "success" | "error" };

async function importBundledSeedVoices(): Promise<void> {
  try {
    const seedDirectory = await resolveResource(BUNDLED_SEED_DIRECTORY);
    const result = await client.request<SeedImportResult>({
      type: "import_seed_voices",
      seed_dir: seedDirectory,
    });
    if (result.errors.length) {
      console.warn("[volo-ai] Some bundled voice seeds could not be imported", result.errors);
    }
  } catch (reason) {
    console.warn("[volo-ai] Could not import bundled voice seeds", reason);
  }
}

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

function voiceNameFromFile(path: string): string {
  const stem = fileName(path).replace(/\.[^.]+$/, "");
  return (
    stem
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^[^A-Za-z0-9]+/, "")
      .slice(0, 64) || "imported-voice"
  );
}

function preferredVoiceForLanguage(voices: VoiceProfile[], language: Language): string {
  return (
    voices.find((voice) => voice.language === language && voice.is_default)?.name ??
    voices.find((voice) => voice.language === language)?.name ??
    "auto"
  );
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
    <header className="mb-7 flex items-end justify-between gap-5">
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

function SetupScreen({
  copy,
  provider,
  providers,
  progressEvent,
  isPreparing,
  isCancelling,
  setupError,
  onPrepare,
  onCancel,
  onProviderChange,
  onOpenHistory,
  onOpenSettings,
}: {
  copy: UiCopy;
  provider: ProviderId;
  providers: Record<ProviderId, ProviderStatus> | null;
  progressEvent: ProgressEvent | null;
  isPreparing: boolean;
  isCancelling: boolean;
  setupError: string | null;
  onPrepare: () => void;
  onCancel: () => void;
  onProviderChange: (provider: ProviderId) => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}) {
  const progress = Math.round((progressEvent?.progress ?? 0) * 100);
  const isOmniVoice = provider === "omnivoice";
  const assets = isOmniVoice
    ? [copy.setupAssetOmniVoice, copy.setupAssetTokenizer, copy.setupAssetWhisper]
    : [copy.setupAssetVieNeuModel, copy.setupAssetVieNeuVoices, copy.setupAssetVieNeuEncoder];
  const selectedStatus = providers?.[provider];
  const selectedReady = providerIsReady(selectedStatus);
  const assetsNeedDownload = !selectedStatus?.model_ready;
  const providerChoices: Array<[ProviderId, string]> = [
    ["omnivoice", copy.providerOmni],
    ["vieneu", copy.providerVieNeu],
  ];
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
                <SectionLabel>{copy.chooseProvider}</SectionLabel>
                <p className="mt-2 text-sm text-(--muted-foreground)">
                  {copy.selectProviderDescription}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {providerChoices.map(([id, label]) => (
                    <button
                      type="button"
                      key={id}
                      aria-pressed={provider === id}
                      onClick={() => onProviderChange(id)}
                      className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) ${provider === id ? "border-(--accent) bg-(--accent-soft)" : "border-(--border) bg-(--surface-muted) hover:border-(--border-strong)"}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{label}</span>
                        <Badge>
                          {providerIsReady(providers?.[id]) ? copy.ready : copy.unavailable}
                        </Badge>
                      </span>
                      {providers?.[id]?.unavailable_reason && (
                        <span className="mt-2 block text-xs leading-5 text-(--muted-foreground)">
                          {providers[id].unavailable_reason}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
              <div className="rounded-2xl border border-(--border) bg-(--surface-muted) p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <SectionLabel>{copy.modelPackage}</SectionLabel>
                    <p className="mt-2 text-sm font-semibold">
                      {progressEvent?.message ?? copy.verifyAssets}
                    </p>
                  </div>
                  <span className="font-mono text-lg font-semibold text-(--accent)">
                    {progress}%
                  </span>
                </div>
                <Progress value={progress} className="mt-5" />
                <div className="mt-4 flex items-center justify-between gap-4 text-xs text-(--muted-foreground)">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-(--success)" />
                    {copy.offlineReady}
                  </span>
                  <span className="font-mono uppercase">
                    {progressEvent?.asset ?? copy.waitingEngine}
                  </span>
                </div>
              </div>
              {setupError && (
                <div className="mt-4">
                  <ErrorMessage>{setupError}</ErrorMessage>
                </div>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  onClick={onPrepare}
                  disabled={isPreparing || isCancelling || (!assetsNeedDownload && !selectedReady)}
                >
                  {isPreparing ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  {isPreparing
                    ? copy.verifyAssets
                    : setupError
                      ? copy.retryDownload
                      : copy.downloadModel}
                </Button>
                {isPreparing && (
                  <Button variant="secondary" onClick={onCancel} disabled={isCancelling}>
                    <CircleStop className="size-4" />
                    {isCancelling ? copy.cancelling : copy.cancelDownload}
                  </Button>
                )}
                <Button variant="ghost" onClick={onOpenHistory}>
                  <History className="size-4" />
                  {copy.audioHistory}
                </Button>
                <Button variant="ghost" onClick={onOpenSettings}>
                  <Settings2 className="size-4" />
                  {copy.settings}
                </Button>
              </div>
              <p className="mt-4 text-xs leading-5 text-(--muted-foreground)">
                {copy.resumeDownload}
              </p>
              {!setupError && selectedStatus?.unavailable_reason && (
                <div className="mt-4">
                  <ErrorMessage>{selectedStatus.unavailable_reason}</ErrorMessage>
                </div>
              )}
            </CardContent>
          </Card>
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <div>
                  <SectionLabel>{copy.setupDownloads}</SectionLabel>
                  <CardTitle className="mt-2">
                    {isOmniVoice ? copy.setupAssets : copy.providerVieNeu}
                  </CardTitle>
                </div>
                <ShieldCheck className="size-5 text-(--success)" />
              </CardHeader>
              <CardContent className="space-y-2.5">
                {assets.map((asset) => (
                  <div
                    key={asset}
                    className="flex items-center gap-3 rounded-xl border border-(--border) bg-(--surface-muted) px-3.5 py-3 text-sm"
                  >
                    <CheckCircle2 className="size-4 text-(--success)" />
                    {asset}
                  </div>
                ))}
                <p className="pt-2 text-xs leading-5 text-(--muted-foreground)">
                  {isOmniVoice ? copy.setupAssetsDescription : copy.setupAssetsVieNeuDescription}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <SectionLabel>{copy.setupAfter}</SectionLabel>
                  <CardTitle className="mt-2">{copy.setupAfter}</CardTitle>
                </div>
                <Sparkles className="size-5 text-(--accent)" />
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm leading-6 text-(--muted-foreground)">
                  {copy.setupAfterDescription}
                </p>
                <div className="mt-5 flex items-center gap-2 text-xs font-semibold">
                  <HardDrive className="size-4 text-(--accent)" />
                  {isOmniVoice ? copy.setupStorageValue : copy.setupStorageVieNeuValue}
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
}: {
  logs: RequestLog[];
  copy: UiCopy;
  onClearLogs: () => void;
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
            <div className="flex rounded-xl border border-(--border) bg-(--surface) p-1">
              {(
                [
                  ["all", copy.filterAll],
                  ["success", copy.filterSuccess],
                  ["error", copy.filterError],
                ] as const
              ).map(([f, label]) => (
                <button
                  type="button"
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${filter === f ? "bg-(--accent-soft) text-(--accent)" : "text-(--muted-foreground) hover:text-(--foreground)"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {logs.length > 0 && (
              <Button variant="ghost" size="sm" onClick={onClearLogs} title={copy.clearLogs}>
                <Trash2 className="size-3.5 text-(--destructive)" />
                <span className="text-xs text-(--destructive)">{copy.clearLogs}</span>
              </Button>
            )}
            <Badge className="border-(--border) bg-(--surface-muted) text-(--muted-foreground)">
              <span className="mr-2 size-1.5 rounded-full bg-(--success)" />
              {copy.sessionOnly}
            </Badge>
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
                      className={
                        entry.status === "error"
                          ? "border-(--destructive-border) bg-(--destructive-surface) text-(--destructive)"
                          : entry.status === "pending"
                            ? "border-(--accent-border) bg-(--accent-soft) text-(--accent)"
                            : undefined
                      }
                    >
                      {entry.status === "pending" ? copy.running : entry.status.toUpperCase()}
                    </Badge>
                  </div>
                  {entry.status === "error" && (
                    <p className="mt-2 text-sm text-(--destructive)">
                      {entry.errorMessage ?? copy.failed}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.08em] text-(--muted-foreground)">
                    <span>{entry.operation}</span>
                    <span>
                      {copy.request} / {entry.id}
                    </span>
                    <span>{formatLogTime(entry.startedAt)}</span>
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
      <p className="mt-4 text-xs leading-5 text-(--muted-foreground)">{copy.logsPrivacy}</p>
    </div>
  );
}

function VoiceProfilesView({
  voices,
  isLoading,
  listError,
  formError,
  profileName,
  profileKind,
  refAudio,
  refText,
  designInstruction,
  isSaving,
  isImporting,
  isImportingSeed,
  importStatus,
  seedImportStatus,
  deletingVoice,
  copy,
  onChooseReference,
  onImportVoiceFile,
  onImportSeedFolder,
  onProfileNameChange,
  onRefTextChange,
  onProfileKindChange,
  onDesignInstructionChange,
  onSave,
  onRetry,
  onUse,
  onDelete,
}: {
  voices: VoiceProfile[];
  isLoading: boolean;
  listError: string | null;
  formError: string | null;
  profileName: string;
  profileKind: VoiceKind;
  refAudio: string | null;
  refText: string;
  designInstruction: string;
  isSaving: boolean;
  isImporting: boolean;
  isImportingSeed: boolean;
  importStatus: ImportStatus | null;
  seedImportStatus: ImportStatus | null;
  deletingVoice: string | null;
  copy: UiCopy;
  onChooseReference: () => void;
  onImportVoiceFile: () => void;
  onImportSeedFolder: () => void;
  onProfileNameChange: (value: string) => void;
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
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex flex-wrap gap-2">
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
            <div className="flex items-center gap-3 rounded-xl border border-(--border) bg-(--surface) px-4 py-3">
              <Library className="size-4 text-(--accent)" />
              <span className="font-mono text-xs font-semibold">
                {voices.length.toString().padStart(2, "0")} {copy.savedProfiles}
              </span>
            </div>
          </div>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-(--muted-foreground)">
        <FolderOpen className="size-3.5 text-(--accent)" />
        <span>{copy.voiceImportDescription}</span>
        <span>·</span>
        <span>{copy.seedImportDescription}</span>
      </div>
      {activeImportStatus && (
        <div
          className={`mb-5 rounded-xl border px-4 py-3 text-sm ${activeImportStatus.tone === "error" ? "border-(--destructive-border) bg-(--destructive-surface) text-(--destructive)" : "border-(--success-border) bg-(--success-surface) text-(--success)"}`}
          role={activeImportStatus.tone === "error" ? "alert" : "status"}
        >
          {activeImportStatus.message}
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <div>
              <SectionLabel>{copy.voiceLibrary}</SectionLabel>
              <CardTitle className="mt-2">{copy.savedProfiles}</CardTitle>
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
                  {voices.map((voice) => (
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
                              <Badge>{copy.profileReady}</Badge>
                              <Badge className="border-(--border) bg-(--surface) text-(--muted-foreground)">
                                {voice.kind === "design" ? copy.designVoice : copy.cloneVoice}
                              </Badge>
                              {voice.is_default && (
                                <Badge className="border-(--accent-border) bg-(--accent-soft) text-(--accent)">
                                  {copy.defaultVoice}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-[10px] uppercase tracking-[0.08em] text-(--muted-foreground)">
                              {voice.kind === "design" ? (
                                <Sparkles className="size-3" />
                              ) : (
                                <FileAudio className="size-3" />
                              )}
                              {voice.language} ·
                              {voice.kind === "design"
                                ? copy.designProfileSummary
                                : fileName(voice.ref_audio)}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="icon"
                          size="icon"
                          className="text-(--destructive) hover:border-(--destructive) hover:text-(--destructive)"
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
                              src={convertFileSrc(voice.ref_audio)}
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
                  ))}
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
              <div
                className="grid grid-cols-2 gap-1 rounded-xl border border-(--border) bg-(--surface-muted) p-1"
                role="group"
                aria-label={copy.createProfile}
              >
                {(["clone", "design"] as VoiceKind[]).map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    aria-pressed={profileKind === kind}
                    onClick={() => onProfileKindChange(kind)}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) ${profileKind === kind ? "bg-(--surface) text-(--foreground) shadow-sm" : "text-(--muted-foreground) hover:text-(--foreground)"}`}
                  >
                    {kind === "design" ? copy.designVoice : copy.cloneVoice}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-name">{copy.profileName}</Label>
                <Input
                  ref={nameInputRef}
                  id="profile-name"
                  value={profileName}
                  placeholder={copy.profileNamePlaceholder}
                  disabled={isSaving}
                  onChange={(event) => onProfileNameChange(event.target.value)}
                />
              </div>
              {profileKind === "clone" ? (
                <>
                  <div className="space-y-2">
                    <Label>{copy.referenceAudio}</Label>
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
                            src={convertFileSrc(refAudio)}
                            label={copy.previewAudio}
                            pauseLabel={copy.pauseAudio}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-transcript">{copy.referenceTranscript}</Label>
                    <Textarea
                      id="profile-transcript"
                      value={refText}
                      placeholder={copy.optionalTranscript}
                      disabled={isSaving}
                      onChange={(event) => onRefTextChange(event.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="profile-design-instruction">{copy.voiceDesignInstruction}</Label>
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
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isSaving}>
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
  dataDir,
  modelId,
  tokenizerId,
  asrModelId,
  modelStatusError,
  setupError,
  progressEvent,
  isRefreshingStatus,
  isPreparing,
  preparingProvider,
  onChangeLanguage,
  onChangeTheme,
  onSelectProvider,
  onPrepareProvider,
  onCancelPrepare,
  onRefreshStatus,
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
  dataDir: string | null;
  modelId: string;
  tokenizerId: string;
  asrModelId: string;
  modelStatusError: string | null;
  setupError: string | null;
  progressEvent: ProgressEvent | null;
  isRefreshingStatus: boolean;
  isPreparing: boolean;
  preparingProvider: ProviderId | null;
  onChangeLanguage: (language: AppLanguage) => void;
  onChangeTheme: (theme: ThemeMode) => void;
  onSelectProvider: (provider: ProviderId) => void;
  onPrepareProvider: (provider: ProviderId) => void;
  onCancelPrepare: () => void;
  onRefreshStatus: () => void;
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");
  const [copiedDataDir, setCopiedDataDir] = useState(false);
  const [copiedMcpConfig, setCopiedMcpConfig] = useState(false);
  const [mcpClient, setMcpClient] = useState<McpClientId>("codex");
  const mcpSetupConfig = dataDir ? buildMcpConfig(mcpClient, dataDir) : copy.loadingDataPath;

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
      <div
        className="mb-5 flex w-full gap-1 overflow-x-auto rounded-xl border border-(--border) bg-(--surface-muted) p-1"
        role="tablist"
        aria-label={copy.studioSettings}
      >
        {tabs.map(([value, label]) => (
          <button
            type="button"
            key={value}
            role="tab"
            aria-selected={activeTab === value}
            onClick={() => setActiveTab(value)}
            className={`min-w-28 flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) ${activeTab === value ? "bg-(--surface) text-(--foreground) shadow-sm" : "text-(--muted-foreground) hover:text-(--foreground)"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
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
                <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-(--surface-muted) p-1.5">
                  {(["en", "vi"] as AppLanguage[]).map((item) => (
                    <button
                      type="button"
                      key={item}
                      onClick={() => onChangeLanguage(item)}
                      aria-pressed={appLanguage === item}
                      className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) ${appLanguage === item ? "bg-(--surface) text-(--foreground) shadow-sm" : "text-(--muted-foreground) hover:text-(--foreground)"}`}
                    >
                      {item === "en" ? copy.english : copy.vietnamese}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <SectionLabel>{copy.theme}</SectionLabel>
                  <CardTitle className="mt-2">{copy.theme}</CardTitle>
                </div>
                <Sun className="size-5 text-(--accent)" />
              </CardHeader>
              <CardContent>
                <CardDescription>{copy.themeDescription}</CardDescription>
                <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl bg-(--surface-muted) p-1.5">
                  {(
                    [
                      ["light", copy.themeLight, Sun],
                      ["dark", copy.themeDark, Moon],
                      ["system", copy.themeSystem, Monitor],
                    ] as const
                  ).map(([item, label, Icon]) => (
                    <button
                      type="button"
                      key={item}
                      onClick={() => onChangeTheme(item)}
                      aria-pressed={theme === item}
                      className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) ${theme === item ? "bg-(--surface) text-(--foreground) shadow-sm" : "text-(--muted-foreground) hover:text-(--foreground)"}`}
                    >
                      <Icon className="size-3.5" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
        {activeTab === "model" && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <div>
                <SectionLabel>{copy.localEngine}</SectionLabel>
                <CardTitle className="mt-2">{copy.modelDetails}</CardTitle>
                <CardDescription className="mt-2">{copy.modelDescription}</CardDescription>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Badge
                  className={
                    !modelReady
                      ? "border-(--destructive-border) bg-(--destructive-surface) text-(--destructive)"
                      : undefined
                  }
                >
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
                    const isInstalling = preparingProvider === id;
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
                          <Badge>{providerIsReady(status) ? copy.ready : copy.unavailable}</Badge>
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
                <Metric label={copy.device} value={device.toUpperCase()} />
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
                  onValueChange={(value) => setMcpClient(value as McpClientId)}
                  aria-label={copy.mcpClientLabel}
                  className="max-w-xs"
                >
                  {mcpClients.map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
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
      </div>
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
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  min: string;
  step: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function AudioHistoryView({
  copy,
  appLanguage,
  items,
  isLoading,
  error,
  deletingFileName,
  onRetry,
  onDelete,
}: {
  copy: UiCopy;
  appLanguage: AppLanguage;
  items: AudioHistoryItem[];
  isLoading: boolean;
  error: string | null;
  deletingFileName: string | null;
  onRetry: () => void;
  onDelete: (fileName: string) => void;
}) {
  const [confirmDeleteFileName, setConfirmDeleteFileName] = useState<string | null>(null);
  const confirmedItem = items.find((item) => item.id === confirmDeleteFileName);
  const locale = appLanguage === "vi" ? "vi-VN" : "en-US";

  return (
    <div>
      <PageHeader
        eyebrow={copy.audioHistoryEyebrow}
        title={copy.audioHistoryTitle}
        description={copy.audioHistoryDescription}
        action={
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-(--muted-foreground) sm:inline">
              {items.length} {copy.audioHistoryCount}
            </span>
            <Button variant="secondary" onClick={onRetry} disabled={isLoading}>
              {isLoading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              <span>{copy.audioHistoryRetry}</span>
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-5">
          <ErrorMessage>{error}</ErrorMessage>
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

            return (
              <Card key={item.id}>
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="line-clamp-2 min-w-0 text-sm font-semibold leading-6">
                        {item.id}
                      </h2>
                      <Badge className="font-mono text-[9px] uppercase tracking-wider">
                        {item.format}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-(--muted-foreground)">
                      <span>{dateLabel}</span>
                      {item.provider && (
                        <span>{item.provider === "vieneu" ? "VieNeu" : "OmniVoice"}</span>
                      )}
                      {voiceName && <span>{voiceName}</span>}
                    </div>
                    {item.metadata_available && item.text && (
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-(--muted-foreground)">
                        {item.text}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <InlineAudioPreview
                      src={convertFileSrc(item.audio_path)}
                      label={copy.previewAudio}
                      pauseLabel={copy.pauseAudio}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${copy.audioHistoryDelete}: ${item.id}`}
                      title={copy.audioHistoryDelete}
                      disabled={Boolean(deletingFileName)}
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
  voices,
  presetVoices,
  selectedVoice,
  refAudio,
  result,
  audioUrl,
  error,
  isGenerating,
  takes,
  activeTakeId,
  onSelectTake,
  onLanguageChange,
  onTextChange,
  onSpeedChange,
  onFormatChange,
  onAdvancedChange,
  onVoiceSelectionChange,
  onChooseReference,
  onSynthesize,
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
  voices: VoiceProfile[];
  presetVoices: Array<{ id: string; name: string; label: string }>;
  selectedVoice: string;
  refAudio: string | null;
  result: SynthesisResult | null;
  audioUrl: string | null;
  error: string | null;
  isGenerating: boolean;
  takes: TakeItem[];
  activeTakeId: string | null;
  onSelectTake: (take: TakeItem) => void;
  onLanguageChange: (language: Language) => void;
  onTextChange: (text: string) => void;
  onSpeedChange: (speed: number) => void;
  onFormatChange: (format: AudioFormat) => void;
  onAdvancedChange: (patch: Partial<AdvancedDraft>) => void;
  onVoiceSelectionChange: (name: string) => void;
  onChooseReference: () => void;
  onSynthesize: () => void;
  onExport: () => void;
}) {
  const isOmniVoice = provider === "omnivoice";
  const visibleVoices = isOmniVoice ? voices : voices.filter((voice) => voice.kind === "clone");
  const selectedSource = isOmniVoice
    ? mode === "profile"
      ? `profile:${selectedVoice}`
      : "auto"
    : mode === "profile"
      ? `profile:${selectedVoice}`
      : mode === "file"
        ? "file"
        : `preset:${selectedVoice}`;

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const estSeconds = Math.max(1, Math.round(wordCount / 2.5));
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

  const activeVoiceName = useMemo(() => {
    if (mode === "profile") return selectedVoice;
    if (mode === "preset") {
      return presetVoices.find((p) => p.id === selectedVoice)?.label ?? selectedVoice;
    }
    if (refAudio) return fileName(refAudio);
    return copy.autoVoice;
  }, [mode, selectedVoice, presetVoices, refAudio, copy.autoVoice]);

  return (
    <div>
      <PageHeader
        eyebrow={copy.voiceWorkspace}
        title={copy.title}
        description={copy.workspaceDescription}
        action={
          <div className="flex flex-wrap gap-2">
            <Badge>{isOmniVoice ? copy.providerOmni : copy.providerVieNeu}</Badge>
            <Badge>
              <span className="mr-2 size-1.5 rounded-full bg-(--success)" />
              {copy.modelReady}
            </Badge>
          </div>
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
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
                    <Clock className="size-3" />
                    ~{estSeconds}s {copy.estimatedDuration}
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
                        <button
                          key={sample.titleKey}
                          type="button"
                          onClick={() => {
                            onTextChange(sample.text);
                            setSampleMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-(--foreground) hover:bg-(--surface-muted)"
                        >
                          <Sparkles className="size-3 text-(--accent)" />
                          <span>{copy[sample.titleKey as keyof UiCopy] as string}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Copy text */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyText}
                  className="h-8 px-2.5 text-xs text-(--muted-foreground) hover:text-(--foreground)"
                  title={copy.copyScript}
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
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Textarea
              aria-label={copy.untitledSpeech}
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              className="min-h-[310px] resize-none rounded-none border-0 bg-transparent px-6 py-6 text-base leading-8 shadow-none focus-visible:ring-0"
              spellCheck={false}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--border) px-6 py-3 text-xs text-(--muted-foreground)">
              <span>{copy.lineOne}</span>
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
                  {result ? copy.renderedTake : copy.nothingRendered}
                </h2>
              </div>
              {result && <Badge>{copy.ready}</Badge>}
            </div>

            {audioUrl && result ? (
              <div className="mt-4">
                <AudioPlayer
                  src={audioUrl}
                  audioPath={result.audio_path}
                  format={result.format}
                  sampleRate={provider === "vieneu" ? 48000 : 24000}
                  voiceName={activeVoiceName}
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
                    {takes.length} {copy.take.toLowerCase()}(s)
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {takes.map((take, index) => {
                    const isActive = activeTakeId === take.id;
                    const takeNum = takes.length - index;
                    return (
                      <button
                        type="button"
                        key={take.id}
                        onClick={() => onSelectTake(take)}
                        className={cn(
                          "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition-all",
                          isActive
                            ? "border-(--accent) bg-(--surface) font-semibold text-(--accent) shadow-sm"
                            : "border-(--border) bg-(--surface) text-(--muted-foreground) hover:border-(--border-strong) hover:text-(--foreground)",
                        )}
                      >
                        <Play className={cn("size-3", isActive ? "fill-current" : "")} />
                        <span>
                          {copy.take} #{takeNum}
                        </span>
                        <span className="font-mono text-[10px] uppercase opacity-75">
                          {take.voiceName} · {take.format}
                        </span>
                      </button>
                    );
                  })}
                </div>
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
                <Badge className="text-[9px]">
                  {providerIsReady(providerStatuses?.[provider]) ? copy.ready : copy.unavailable}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-(--border) bg-(--surface-muted) p-1">
                {(
                  [
                    ["omnivoice", copy.providerOmni],
                    ["vieneu", copy.providerVieNeu],
                  ] as const
                ).map(([pId, label]) => (
                  <button
                    type="button"
                    key={pId}
                    onClick={() => onProviderChange(pId)}
                    aria-pressed={provider === pId}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) ${provider === pId ? "bg-(--surface) text-(--foreground) shadow-sm" : "text-(--muted-foreground) hover:text-(--foreground)"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>{copy.synthesisLanguage}</Label>
              <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-(--surface-muted) p-1.5">
                {(["en", "vi"] as Language[]).map((item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={language === item}
                    onClick={() => onLanguageChange(item)}
                    className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) ${language === item ? "bg-(--surface) text-(--foreground) shadow-sm" : "text-(--muted-foreground) hover:text-(--foreground)"}`}
                  >
                    {item === "en" ? copy.english : copy.vietnamese}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>{copy.voiceSource}</Label>
              <div className="mt-2 space-y-3">
                <Select
                  value={selectedSource}
                  onValueChange={onVoiceSelectionChange}
                  aria-label={copy.voiceSource}
                >
                  {isOmniVoice ? (
                    <SelectItem value="auto">
                      {copy.autoVoice} · {copy.autoVoiceDescription}
                    </SelectItem>
                  ) : (
                    presetVoices.map((voice) => (
                      <SelectItem key={voice.id} value={`preset:${voice.id}`}>
                        {voice.label}
                      </SelectItem>
                    ))
                  )}
                  {!isOmniVoice && <SelectItem value="file">{copy.referenceFile}</SelectItem>}
                  {visibleVoices.map((voice) => (
                    <SelectItem key={`${voice.name}-label`} value={`profile:${voice.name}`}>
                      {voice.name} · {voice.language.toUpperCase()}
                      {voice.is_default ? ` · ${copy.defaultVoice}` : ""}
                    </SelectItem>
                  ))}
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="speed">{copy.speed}</Label>
                  <div className="flex items-center gap-1.5">
                    {[0.8, 1.0, 1.25, 1.5].map((preset) => (
                      <button
                        type="button"
                        key={preset}
                        onClick={() => onSpeedChange(preset)}
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors",
                          Math.abs(speed - preset) < 0.04
                            ? "border-(--accent) bg-(--accent-soft) text-(--accent)"
                            : "border-(--border) bg-(--surface) text-(--muted-foreground) hover:text-(--foreground)",
                        )}
                      >
                        {preset}×
                      </button>
                    ))}
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
              <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-(--surface-muted) p-1.5">
                {(["wav", "mp3"] as AudioFormat[]).map((item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={format === item}
                    onClick={() => onFormatChange(item)}
                    className={`rounded-lg px-3 py-2.5 font-mono text-xs font-bold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) ${format === item ? "bg-(--surface) text-(--foreground) shadow-sm" : "text-(--muted-foreground) hover:text-(--foreground)"}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            {isOmniVoice && (
              <details className="group rounded-xl border border-(--border) bg-(--surface-muted)">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)">
                  <span>{copy.advancedSettings}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAdvancedChange(DEFAULT_ADVANCED);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-(--border) bg-(--surface) px-2 py-0.5 text-[10px] font-medium text-(--muted-foreground) transition-colors hover:border-(--accent) hover:text-(--accent)"
                      title={copy.resetDefaults}
                    >
                      <RotateCcw className="size-2.5" />
                      <span>{copy.resetDefaults}</span>
                    </button>
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
                  <div className="grid grid-cols-2 gap-2 border-t border-(--border) pt-3">
                    {(
                      [
                        ["denoise", copy.denoise],
                        ["preprocess_prompt", copy.preprocessPrompt],
                        ["postprocess_output", copy.postprocessOutput],
                        ["normalize_text", copy.normalizeText],
                      ] as const
                    ).map(([key, label]) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 text-xs text-(--muted-foreground) cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={advanced[key]}
                          disabled={isGenerating}
                          onChange={(event) => onAdvancedChange({ [key]: event.target.checked })}
                          className="size-4 accent-(--accent)"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </details>
            )}
            {advancedError && <ErrorMessage>{advancedError}</ErrorMessage>}
            <div className="grid gap-2">
              <Button size="lg" onClick={onSynthesize} disabled={isGenerating}>
                {isGenerating ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4 fill-current" />
                )}
                {isGenerating ? copy.rendering : copy.renderSpeech}
              </Button>
              {result && (
                <Button variant="secondary" onClick={onExport}>
                  <Download className="size-4" />
                  {copy.export} {result.format.toUpperCase()}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function App() {
  const { t, i18n: translator } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const [view, setView] = useState<AppView>("workspace");
  const [provider, setProvider] = useState<ProviderId>(readProvider);
  const [modelProgress, setModelProgress] = useState<ProgressEvent | null>(null);
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
  const [refAudio, setRefAudio] = useState<string | null>(null);
  const [refText, setRefText] = useState("");
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [audioHistory, setAudioHistory] = useState<AudioHistoryItem[]>([]);
  const [isLoadingAudioHistory, setIsLoadingAudioHistory] = useState(false);
  const [audioHistoryError, setAudioHistoryError] = useState<string | null>(null);
  const [deletingAudioFile, setDeletingAudioFile] = useState<string | null>(null);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voiceListError, setVoiceListError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isImportingVoice, setIsImportingVoice] = useState(false);
  const [isImportingSeed, setIsImportingSeed] = useState(false);
  const [voiceImportStatus, setVoiceImportStatus] = useState<ImportStatus | null>(null);
  const [seedImportStatus, setSeedImportStatus] = useState<ImportStatus | null>(null);
  const [deletingVoice, setDeletingVoice] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState(() =>
    readProvider() === "vieneu" ? "" : "auto",
  );
  const [profileName, setProfileName] = useState("");
  const [profileKind, setProfileKind] = useState<VoiceKind>("clone");
  const [designInstruction, setDesignInstruction] = useState("");
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparingProvider, setPreparingProvider] = useState<ProviderId | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineOnline, setEngineOnline] = useState(false);
  const [engineStatus, setEngineStatus] = useState<StatusResult | null>(null);
  const [logs, setLogs] = useState<RequestLog[]>(() => client.getLogs());
  const [device, setDevice] = useState("unknown");
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [modelStatusError, setModelStatusError] = useState<string | null>(null);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [takes, setTakes] = useState<TakeItem[]>([]);
  const [activeTakeId, setActiveTakeId] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, [theme]);

  const appLanguage: AppLanguage = translator.language === "vi" ? "vi" : "en";
  const copy: UiCopy = createUiCopy(t);
  const providerStatuses = engineStatus?.providers ?? null;
  const modelReady = providerStatuses
    ? providerIsReady(providerStatuses[provider])
    : provider === "omnivoice" && Boolean(engineStatus?.model_ready);
  const omniVoiceReady = providerStatuses
    ? providerIsReady(providerStatuses.omnivoice)
    : Boolean(engineStatus?.model_ready);
  const presetVoices = engineStatus?.providers?.vieneu?.preset_voices ?? [];
  const audioUrl = useMemo(() => (result ? convertFileSrc(result.audio_path) : null), [result]);

  useEffect(() => {
    const unsubscribe = client.onProgress(setModelProgress);
    const unsubscribeLogs = client.onLog(() => setLogs(client.getLogs()));
    let active = true;
    void (async () => {
      try {
        const status = await client.request<StatusResult>({ type: "status" });
        if (!active) return;
        setEngineOnline(true);
        setDevice(status.device);
        setEngineStatus(status);
        const selectedReady = status.providers
          ? providerIsReady(status.providers[provider])
          : provider === "omnivoice" && status.model_ready;
        if (selectedReady) {
          if (provider === "omnivoice") await importBundledSeedVoices();
          await refreshVoices();
        }
      } catch (reason) {
        if (active)
          setSetupError(
            reason instanceof Error ? reason.message : translator.t("errors.engineUnavailable"),
          );
      }
    })();
    return () => {
      active = false;
      unsubscribe();
      unsubscribeLogs();
      void client.stop();
    };
  }, []);

  useEffect(() => {
    if (view !== "settings") return;
    void appDataDir()
      .then(setDataDir)
      .catch(() => setDataDir(copy.unavailable));
  }, [view]);

  useEffect(() => {
    if (view !== "profiles" || !modelReady) return;
    void refreshVoices();
  }, [view, modelReady]);

  useEffect(() => {
    if (view !== "history") return;
    void refreshAudioHistory();
  }, [view]);

  useEffect(() => {
    if (provider !== "vieneu" || !engineStatus) return;
    const defaultVoice = engineStatus.providers?.vieneu?.default_voice;
    const manifestVoices = engineStatus.providers?.vieneu?.preset_voices ?? [];
    setMode((current) => (current === "profile" || current === "file" ? current : "preset"));
    setSelectedVoice((current) =>
      manifestVoices.some((voice) => voice.id === current) ? current : (defaultVoice ?? ""),
    );
  }, [provider, engineStatus]);

  async function prepareModel(target: ProviderId = provider) {
    setSetupError(null);
    setIsPreparing(true);
    setPreparingProvider(target);
    try {
      await client.request<{ model_ready: boolean }>({ type: "prepare_model", provider: target });
      const status = await client.request<StatusResult>({ type: "status" });
      setEngineStatus(status);
      setEngineOnline(true);
      setDevice(status.device);
      if (target === "omnivoice" && target === provider) await importBundledSeedVoices();
      if (target === provider) await refreshVoices();
    } catch (reason) {
      setSetupError(
        reason instanceof Error ? reason.message : translator.t("errors.modelSetupFailed"),
      );
    } finally {
      setIsPreparing(false);
      setPreparingProvider(null);
    }
  }

  async function refreshModelStatus() {
    setIsRefreshingStatus(true);
    setModelStatusError(null);
    try {
      const status = await client.request<StatusResult>({ type: "status" });
      setEngineOnline(true);
      setDevice(status.device);
      setEngineStatus(status);
    } catch (reason) {
      setModelStatusError(
        reason instanceof Error ? reason.message : translator.t("errors.engineUnavailable"),
      );
    } finally {
      setIsRefreshingStatus(false);
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
    setIsLoadingVoices(true);
    setVoiceListError(null);
    try {
      const response = await client.request<{ voices: VoiceProfile[] }>({ type: "list_voices" });
      setVoices(response.voices);
      setSelectedVoice((current) => {
        if (mode !== "profile") return current;
        const selected = response.voices.find((voice) => voice.name === current);
        return selected?.language === language
          ? current
          : preferredVoiceForLanguage(response.voices, language);
      });
    } catch (reason) {
      setVoiceListError(reason instanceof Error ? reason.message : copy.couldNotLoadProfiles);
    } finally {
      setIsLoadingVoices(false);
    }
  }

  async function refreshAudioHistory() {
    setIsLoadingAudioHistory(true);
    setAudioHistoryError(null);
    try {
      const response = await client.request<{ items: AudioHistoryItem[] }>({
        type: "list_audio_history",
      });
      setAudioHistory(response.items);
    } catch (reason) {
      setAudioHistoryError(
        reason instanceof Error
          ? `${copy.audioHistoryLoadFailed}: ${reason.message}`
          : copy.audioHistoryLoadFailed,
      );
    } finally {
      setIsLoadingAudioHistory(false);
    }
  }

  function changeAppLanguage(next: AppLanguage) {
    setAppLanguage(next);
  }

  function changeProvider(next: ProviderId) {
    setProvider(next);
    localStorage.setItem("volo-ai.provider", next);
    setView("workspace");
    setSetupError(null);
    setError(null);
    setResult(null);
    setRefAudio(null);
    if (next === "omnivoice") {
      setMode("auto");
      setSelectedVoice("auto");
      if (omniVoiceReady) void importBundledSeedVoices();
    } else {
      setMode("preset");
      setSelectedVoice(engineStatus?.providers?.vieneu?.default_voice ?? "");
    }
    void refreshVoices();
  }

  function changeSynthesisLanguage(next: Language) {
    setLanguage(next);
    localStorage.setItem("volo-ai.synthesis-language", next);
    if (mode === "profile") {
      setSelectedVoice((current) => {
        const selected = voices.find((voice) => voice.name === current);
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
    setIsImportingVoice(true);
    setVoiceImportStatus(null);
    setSeedImportStatus(null);
    setProfileError(null);
    try {
      await client.request({
        type: "save_voice",
        name,
        ref_audio: selected,
        language,
      });
      await refreshVoices();
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
    } finally {
      setIsImportingVoice(false);
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
    setIsImportingSeed(true);
    setSeedImportStatus(null);
    setVoiceImportStatus(null);
    try {
      const result = await client.request<SeedImportResult>({
        type: "import_seed_voices",
        seed_dir: selected,
      });
      await refreshVoices();
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
    } finally {
      setIsImportingSeed(false);
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
    }
    setAdvancedError(null);
    setIsGenerating(true);
    setResult(null);
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
      } else if (mode === "preset") {
        request.preset_id = selectedVoice;
      } else if (mode === "profile") {
        request.voice_name = selectedVoice;
      } else {
        request.ref_audio = refAudio;
      }
      const response = await client.request<SynthesisResult>(request);
      setResult(response);
      const activeVoiceLabel =
        mode === "profile"
          ? selectedVoice
          : mode === "preset"
            ? (presetVoices.find((p) => p.id === selectedVoice)?.label ?? selectedVoice)
            : (refAudio ? fileName(refAudio) : copy.autoVoice);
      const newTake: TakeItem = {
        id: String(Date.now()),
        timestamp: Date.now(),
        provider,
        voiceName: activeVoiceLabel,
        format: response.format,
        audioPath: response.audio_path,
        text,
      };
      setTakes((prev) => [newTake, ...prev.slice(0, 4)]);
      setActiveTakeId(newTake.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.synthesisFailed);
    } finally {
      setIsGenerating(false);
    }
  }

  function handleSelectTake(take: TakeItem) {
    setActiveTakeId(take.id);
    setResult({ audio_path: take.audioPath, format: take.format });
  }

  function handleClearLogs() {
    client.clearLogs();
    setLogs([]);
  }

  function changeTheme(next: ThemeMode) {
    setTheme(next);
    applyTheme(next);
  }

  async function saveProfile() {
    if (!omniVoiceReady) {
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
    setIsSavingProfile(true);
    setProfileError(null);
    try {
      if (profileKind === "design") {
        await client.saveDesignVoice(profileName.trim(), designInstruction.trim(), language);
      } else {
        await client.request({
          type: "save_voice",
          name: profileName.trim(),
          ref_audio: refAudio,
          ref_text: refText || undefined,
          language,
        });
      }
      setProfileName("");
      setDesignInstruction("");
      await refreshVoices();
      setError(null);
      setProfileError(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : copy.couldNotSaveVoice;
      setError(message);
      setProfileError(message);
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function deleteProfile(name = selectedVoice) {
    if (name === "auto") return;
    setDeletingVoice(name);
    setProfileError(null);
    try {
      const response = await client.request<{ deleted: boolean }>({ type: "delete_voice", name });
      if (!response.deleted) throw new Error(copy.couldNotDeleteVoice);
      if (selectedVoice === name) setSelectedVoice("auto");
      await refreshVoices();
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
    setAudioHistoryError(null);
    try {
      const response = await client.request<{ deleted: boolean }>({
        type: "delete_audio_history",
        file_name: audioId,
      });
      if (!response.deleted) {
        setAudioHistoryError(copy.audioHistoryDeleteFailed);
        return;
      }
      setAudioHistory((current) => current.filter((entry) => entry.id !== audioId));
      setTakes((current) => current.filter((take) => fileName(take.audioPath) !== audioId));
      if (result && fileName(result.audio_path) === audioId) {
        setResult(null);
        setActiveTakeId(null);
      }
    } catch (reason) {
      setAudioHistoryError(
        reason instanceof Error
          ? `${copy.audioHistoryDeleteFailed}: ${reason.message}`
          : copy.audioHistoryDeleteFailed,
      );
    } finally {
      setDeletingAudioFile(null);
    }
  }

  function useProfile(name: string) {
    if (provider === "vieneu" && voices.find((voice) => voice.name === name)?.kind === "design") {
      setError(copy.vieneuDesignUnsupported);
      return;
    }
    setSelectedVoice(name);
    setMode("profile");
    setView("workspace");
    setProfileError(null);
  }

  async function exportAudio() {
    if (!result) return;
    const destination = await save({
      defaultPath: `volo-ai-output.${result.format}`,
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

  if (!modelReady && view !== "history" && view !== "settings")
    return (
      <SetupScreen
        copy={copy}
        provider={provider}
        providers={providerStatuses}
        progressEvent={modelProgress}
        isPreparing={isPreparing}
        isCancelling={isCancelling}
        setupError={setupError}
        onPrepare={() => void prepareModel()}
        onCancel={() => void cancelModelPreparation()}
        onProviderChange={changeProvider}
        onOpenHistory={() => setView("history")}
        onOpenSettings={() => setView("settings")}
      />
    );

  const transition = { duration: prefersReducedMotion ? 0 : 0.22, ease: "easeOut" as const };
  const navItems: Array<[AppView, string, LucideIcon]> = [
    ["workspace", copy.synthesize, AudioLines],
    ["profiles", copy.voiceProfiles, Library],
    ["history", copy.audioHistory, History],
    ["settings", copy.settings, Settings2],
    ["logs", copy.logs, Logs],
  ];
  return (
    <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen bg-(--background) text-(--foreground)">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-(--border) bg-(--surface) px-4 py-5 md:flex">
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
              <button
                type="button"
                key={item as string}
                onClick={() => setView(item as AppView)}
                aria-current={view === item ? "page" : undefined}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) ${view === item ? "bg-(--accent-soft) text-(--accent)" : "text-(--muted-foreground) hover:bg-(--surface-muted) hover:text-(--foreground)"}`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-auto border-t border-(--border) px-2 pt-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-(--muted-foreground)">
                {copy.theme}
              </p>
              <div className="flex items-center rounded-lg border border-(--border) bg-(--surface-muted) p-0.5">
                {(
                  [
                    ["light", Sun],
                    ["dark", Moon],
                    ["system", Monitor],
                  ] as const
                ).map(([mode, Icon]) => (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => changeTheme(mode)}
                    className={`flex size-6 items-center justify-center rounded-md text-xs transition-colors ${theme === mode ? "bg-(--surface) text-(--foreground) shadow-sm" : "text-(--muted-foreground) hover:text-(--foreground)"}`}
                    title={mode}
                  >
                    <Icon className="size-3" />
                  </button>
                ))}
              </div>
            </div>

            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-(--muted-foreground)">
              {copy.engine}
            </p>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
              <span className={`size-2 rounded-full ${modelReady ? "bg-(--success)" : "bg-(--muted-foreground)"}`} />
              {modelReady ? copy.offlineEngine : copy.engineUnavailable}
            </div>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-(--muted-foreground)">
              {language.toUpperCase()} · {provider.toUpperCase()}
            </p>
          </div>
        </aside>
        <section className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1440px] px-5 py-6 sm:px-8 sm:py-8 lg:px-10">
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
                    dataDir={dataDir}
                    modelId={engineStatus?.model ?? "OmniVoice"}
                    tokenizerId={engineStatus?.tokenizer ?? "Audio tokenizer"}
                    asrModelId={engineStatus?.asr_model ?? "Whisper ASR"}
                    modelStatusError={modelStatusError}
                    setupError={setupError}
                    progressEvent={modelProgress}
                    isRefreshingStatus={isRefreshingStatus}
                    isPreparing={isPreparing}
                    preparingProvider={preparingProvider}
                    onSelectProvider={changeProvider}
                    onPrepareProvider={(target) => void prepareModel(target)}
                    onCancelPrepare={() => void cancelModelPreparation()}
                    onChangeLanguage={changeAppLanguage}
                    onChangeTheme={changeTheme}
                    onRefreshStatus={() => void refreshModelStatus()}
                    onBack={() => setView("workspace")}
                  />
                ) : view === "logs" ? (
                  <LogsView logs={logs} copy={copy} onClearLogs={handleClearLogs} />
                ) : view === "history" ? (
                  <AudioHistoryView
                    copy={copy}
                    appLanguage={appLanguage}
                    items={audioHistory}
                    isLoading={isLoadingAudioHistory}
                    error={audioHistoryError}
                    deletingFileName={deletingAudioFile}
                    onRetry={() => void refreshAudioHistory()}
                    onDelete={(fileName) => void deleteAudioHistory(fileName)}
                  />
                ) : view === "profiles" ? (
                  <VoiceProfilesView
                    voices={voices}
                    isLoading={isLoadingVoices}
                    listError={voiceListError}
                    formError={profileError}
                    profileName={profileName}
                    profileKind={profileKind}
                    refAudio={refAudio}
                    refText={refText}
                    designInstruction={designInstruction}
                    isSaving={isSavingProfile}
                    isImporting={isImportingVoice}
                    isImportingSeed={isImportingSeed}
                    importStatus={voiceImportStatus}
                    seedImportStatus={seedImportStatus}
                    deletingVoice={deletingVoice}
                    copy={copy}
                    onChooseReference={() => void chooseReference()}
                    onImportVoiceFile={() => void importVoiceFile()}
                    onImportSeedFolder={() => void importSeedFolder()}
                    onProfileNameChange={setProfileName}
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
                    voices={voices}
                    presetVoices={presetVoices}
                    selectedVoice={selectedVoice}
                    refAudio={refAudio}
                    result={result}
                    audioUrl={audioUrl}
                    error={error}
                    isGenerating={isGenerating}
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
                    onVoiceSelectionChange={changeVoiceSelection}
                    onChooseReference={() => void chooseReference()}
                    onSynthesize={() => void synthesize()}
                    onExport={() => void exportAudio()}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <footer className="border-t border-(--border) bg-(--surface) px-5 py-3 sm:px-8 lg:px-10">
            <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-(--muted-foreground)">
              <span className="flex items-center gap-2 text-(--success)">
                <span className="size-1.5 rounded-full bg-(--success)" />
                {copy.engineReady}
              </span>
              <span>
                {copy.device} / {engineOnline ? "AUTO" : "OFFLINE"}
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
