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
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Download,
  FileAudio,
  FolderOpen,
  HardDrive,
  Languages,
  Library,
  LoaderCircle,
  Logs,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  SidecarClient,
  type AudioFormat,
  type GenerationConfig,
  type Language,
  type ProgressEvent,
  type RequestLog,
  type StatusResult,
  type SynthesisResult,
  type VoiceKind,
  type VoiceMode,
  type VoiceProfile,
} from "./lib/sidecar";
import { createUiCopy, setAppLanguage, type AppLanguage, type UiCopy } from "./lib/i18n";
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

const client = new SidecarClient();
type AppView = "workspace" | "profiles" | "settings" | "logs";
type SettingsTab = "general" | "model" | "storage";
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
  progressEvent,
  isPreparing,
  isCancelling,
  setupError,
  onPrepare,
  onCancel,
}: {
  copy: UiCopy;
  progressEvent: ProgressEvent | null;
  isPreparing: boolean;
  isCancelling: boolean;
  setupError: string | null;
  onPrepare: () => void;
  onCancel: () => void;
}) {
  const progress = Math.round((progressEvent?.progress ?? 0) * 100);
  const assets = [copy.setupAssetOmniVoice, copy.setupAssetTokenizer, copy.setupAssetWhisper];
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
                <Button onClick={onPrepare} disabled={isPreparing || isCancelling}>
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
                  <CardTitle className="mt-2">{copy.setupAssets}</CardTitle>
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
                  {copy.setupAssetsDescription}
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

function LogsView({ logs, copy }: { logs: RequestLog[]; copy: UiCopy }) {
  const successCount = logs.filter((entry) => entry.status === "success").length;
  const errorCount = logs.filter((entry) => entry.status === "error").length;
  return (
    <div>
      <PageHeader
        eyebrow={copy.logsEyebrow}
        title={copy.localActivity}
        description={copy.logsDescription}
        action={
          <Badge className="border-(--border) bg-(--surface-muted) text-(--muted-foreground)">
            <span className="mr-2 size-1.5 rounded-full bg-(--success)" />
            {copy.sessionOnly}
          </Badge>
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
        {logs.length === 0 ? (
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
            {logs.map((entry) => (
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
                        <Button size="sm" onClick={() => onUse(voice.name)}>
                          <Play className="size-3.5" />
                          {copy.useProfile}
                        </Button>
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
                  <Label htmlFor="profile-design-instruction">
                    {copy.voiceDesignInstruction}
                  </Label>
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
  modelReady,
  engineOnline,
  device,
  dataDir,
  modelId,
  tokenizerId,
  asrModelId,
  modelStatusError,
  isRefreshingStatus,
  onChangeLanguage,
  onRefreshStatus,
  onBack,
}: {
  copy: UiCopy;
  appLanguage: AppLanguage;
  modelReady: boolean;
  engineOnline: boolean;
  device: string;
  dataDir: string | null;
  modelId: string;
  tokenizerId: string;
  asrModelId: string;
  modelStatusError: string | null;
  isRefreshingStatus: boolean;
  onChangeLanguage: (language: AppLanguage) => void;
  onRefreshStatus: () => void;
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");
  const tabs: Array<[SettingsTab, string]> = [
    ["model", copy.modelTab],
    ["general", copy.generalTab],
    ["storage", copy.storageTab],
  ];
  const assets = [copy.setupAssetOmniVoice, copy.setupAssetTokenizer, copy.setupAssetWhisper];
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
              {modelStatusError && (
                <div className="mt-5">
                  <ErrorMessage>{modelStatusError}</ErrorMessage>
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
              <code className="block overflow-x-auto rounded-xl border border-(--border) bg-(--surface-muted) p-3.5 font-mono text-xs text-(--foreground)">
                {dataDir ?? copy.loadingDataPath}
              </code>
              <p className="mt-3 text-sm leading-6 text-(--muted-foreground)">
                {copy.storageDescription}
              </p>
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

function WorkspaceView({
  copy,
  language,
  text,
  speed,
  format,
  advanced,
  advancedError,
  voices,
  selectedVoice,
  result,
  audioUrl,
  error,
  isGenerating,
  onLanguageChange,
  onTextChange,
  onSpeedChange,
  onFormatChange,
  onAdvancedChange,
  onVoiceSelectionChange,
  onSynthesize,
  onExport,
}: {
  copy: UiCopy;
  language: Language;
  text: string;
  speed: number;
  format: AudioFormat;
  advanced: AdvancedDraft;
  advancedError: string | null;
  voices: VoiceProfile[];
  selectedVoice: string;
  result: SynthesisResult | null;
  audioUrl: string | null;
  error: string | null;
  isGenerating: boolean;
  onLanguageChange: (language: Language) => void;
  onTextChange: (text: string) => void;
  onSpeedChange: (speed: number) => void;
  onFormatChange: (format: AudioFormat) => void;
  onAdvancedChange: (patch: Partial<AdvancedDraft>) => void;
  onVoiceSelectionChange: (name: string) => void;
  onSynthesize: () => void;
  onExport: () => void;
}) {
  return (
    <div>
      <PageHeader
        eyebrow={copy.voiceWorkspace}
        title={copy.title}
        description={copy.workspaceDescription}
        action={
          <Badge>
            <span className="mr-2 size-1.5 rounded-full bg-(--success)" />
            {copy.modelReady}
          </Badge>
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-(--border) pb-5">
            <div>
              <SectionLabel>{copy.scriptCanvas}</SectionLabel>
              <CardTitle className="mt-2">{copy.untitledSpeech}</CardTitle>
            </div>
            <span className="font-mono text-xs font-semibold text-(--muted-foreground)">
              {text.length.toString().padStart(3, "0")} {copy.characters}
            </span>
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
                <h2 className="mt-2 text-base font-semibold">
                  {result ? copy.renderedTake : copy.nothingRendered}
                </h2>
              </div>
              {result && <Badge>{copy.ready}</Badge>}
            </div>
            {audioUrl ? (
              <audio className="mt-5 h-10 w-full" controls src={audioUrl} />
            ) : (
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-dashed border-(--border-strong) px-4 py-5 text-sm text-(--muted-foreground)">
                <Play className="size-4 text-(--accent)" />
                {copy.generateTake}
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
                  value={selectedVoice}
                  onValueChange={onVoiceSelectionChange}
                  aria-label={copy.voiceSource}
                >
                  <SelectItem value="auto">
                    {copy.autoVoice} · {copy.autoVoiceDescription}
                  </SelectItem>
                  {voices.map((voice) => (
                    <SelectItem key={voice.name} value={voice.name}>
                      {voice.name} · {voice.language.toUpperCase()}
                      {voice.is_default ? ` · ${copy.defaultVoice}` : ""}
                    </SelectItem>
                  ))}
                </Select>
                {voices.length === 0 && (
                  <p className="text-xs leading-5 text-(--muted-foreground)">
                    {copy.noProfiles}
                  </p>
                )}
              </div>
            </div>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="speed">{copy.speed}</Label>
                <span className="rounded-md bg-(--surface-muted) px-2 py-1 font-mono text-xs font-semibold">
                  {speed.toFixed(2)}×
                </span>
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
            <details className="group rounded-xl border border-(--border) bg-(--surface-muted)">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)">
                {copy.advancedSettings}
                <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
              </summary>
              <div className="border-t border-(--border) px-3.5 pb-3.5 pt-3">
                <p className="text-xs leading-5 text-(--muted-foreground)">
                  {copy.advancedSettingsDescription}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <AdvancedNumberField
                    label={copy.fixedDuration}
                    value={advanced.duration}
                    min="0.1"
                    step="0.1"
                    disabled={isGenerating}
                    onChange={(value) => onAdvancedChange({ duration: value })}
                  />
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
                  <AdvancedNumberField
                    label={copy.layerPenaltyFactor}
                    value={advanced.layer_penalty_factor}
                    min="0"
                    step="0.1"
                    disabled={isGenerating}
                    onChange={(value) => onAdvancedChange({ layer_penalty_factor: value })}
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
                <div className="mt-4 grid gap-2">
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
                      className="flex items-center gap-2 text-xs text-(--muted-foreground)"
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
  const [modelReady, setModelReady] = useState(false);
  const [modelProgress, setModelProgress] = useState<ProgressEvent | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>(readSynthesisLanguage);
  const [mode, setMode] = useState<VoiceMode>("auto");
  const [text, setText] = useState("The quietest tools often do the most important work.");
  const [speed, setSpeed] = useState(1);
  const [format, setFormat] = useState<AudioFormat>("wav");
  const [advanced, setAdvanced] = useState<AdvancedDraft>(DEFAULT_ADVANCED);
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [refAudio, setRefAudio] = useState<string | null>(null);
  const [refText, setRefText] = useState("");
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voiceListError, setVoiceListError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isImportingVoice, setIsImportingVoice] = useState(false);
  const [isImportingSeed, setIsImportingSeed] = useState(false);
  const [voiceImportStatus, setVoiceImportStatus] = useState<ImportStatus | null>(null);
  const [seedImportStatus, setSeedImportStatus] = useState<ImportStatus | null>(null);
  const [deletingVoice, setDeletingVoice] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState("auto");
  const [profileName, setProfileName] = useState("");
  const [profileKind, setProfileKind] = useState<VoiceKind>("clone");
  const [designInstruction, setDesignInstruction] = useState("");
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
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

  const appLanguage: AppLanguage = translator.language === "vi" ? "vi" : "en";
  const copy: UiCopy = createUiCopy(t);
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
        if (status.model_ready) {
          setModelReady(true);
          await importBundledSeedVoices();
          await refreshVoices();
        } else await prepareModel();
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

  async function prepareModel() {
    setSetupError(null);
    setIsPreparing(true);
    try {
      await client.request<{ model_ready: boolean }>({ type: "prepare_model" });
      setModelReady(true);
      await importBundledSeedVoices();
      await refreshVoices();
    } catch (reason) {
      setSetupError(
        reason instanceof Error ? reason.message : translator.t("errors.modelSetupFailed"),
      );
    } finally {
      setIsPreparing(false);
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
      setModelReady(status.model_ready);
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

  function changeAppLanguage(next: AppLanguage) {
    setAppLanguage(next);
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

  function changeVoiceSelection(name: string) {
    if (name === "auto") {
      setMode("auto");
      setSelectedVoice("auto");
      return;
    }
    setMode("profile");
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
    if (mode === "profile" && selectedVoice === "auto") return setError(copy.selectProfile);
    let steps: number | undefined;
    let duration: number | undefined;
    let generationConfig: GenerationConfig;
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
    setAdvancedError(null);
    setIsGenerating(true);
    setResult(null);
    try {
      const response = await client.request<SynthesisResult>({
        type: "synthesize",
        text,
        language,
        voice: mode,
        voice_name: mode === "profile" ? selectedVoice : undefined,
        speed,
        format,
        steps,
        duration,
        normalize_text: advanced.normalize_text,
        generation_config: generationConfig,
      });
      setResult(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.synthesisFailed);
    } finally {
      setIsGenerating(false);
    }
  }

  async function saveProfile() {
    if (!profileName.trim()) {
      const message = copy.profileNameRequired;
      setError(message);
      setProfileError(message);
      return;
    }
    if (profileKind === "clone" && !refAudio) {
      const message = copy.chooseReference;
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

  function useProfile(name: string) {
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

  if (!modelReady)
    return (
      <SetupScreen
        copy={copy}
        progressEvent={modelProgress}
        isPreparing={isPreparing}
        isCancelling={isCancelling}
        setupError={setupError}
        onPrepare={() => void prepareModel()}
        onCancel={() => void cancelModelPreparation()}
      />
    );

  const transition = { duration: prefersReducedMotion ? 0 : 0.22, ease: "easeOut" as const };
  const navItems: Array<[AppView, string, LucideIcon]> = [
    ["workspace", copy.synthesize, AudioLines],
    ["profiles", copy.voiceProfiles, Library],
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
          <div className="mt-auto border-t border-(--border) px-2 pt-5">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-(--muted-foreground)">
              {copy.engine}
            </p>
            <div className="mt-3 flex items-center gap-2 text-sm font-semibold">
              <span className="size-2 rounded-full bg-(--success)" />
              {copy.offlineEngine}
            </div>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-(--muted-foreground)">
              {language.toUpperCase()} · LOCAL
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
                    modelReady={modelReady}
                    engineOnline={engineOnline}
                    device={device}
                    dataDir={dataDir}
                    modelId={engineStatus?.model ?? "OmniVoice"}
                    tokenizerId={engineStatus?.tokenizer ?? "Audio tokenizer"}
                    asrModelId={engineStatus?.asr_model ?? "Whisper ASR"}
                    modelStatusError={modelStatusError}
                    isRefreshingStatus={isRefreshingStatus}
                    onChangeLanguage={changeAppLanguage}
                    onRefreshStatus={() => void refreshModelStatus()}
                    onBack={() => setView("workspace")}
                  />
                ) : view === "logs" ? (
                  <LogsView logs={logs} copy={copy} />
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
                    language={language}
                    text={text}
                    speed={speed}
                    format={format}
                    advanced={advanced}
                    advancedError={advancedError}
                    voices={voices}
                    selectedVoice={selectedVoice}
                    result={result}
                    audioUrl={audioUrl}
                    error={error}
                    isGenerating={isGenerating}
                    onLanguageChange={changeSynthesisLanguage}
                    onTextChange={setText}
                    onSpeedChange={setSpeed}
                    onFormatChange={setFormat}
                    onAdvancedChange={(patch) =>
                      setAdvanced((current) => ({ ...current, ...patch }))
                    }
                    onVoiceSelectionChange={changeVoiceSelection}
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
              <span>{copy.sampleRate} / 24000 HZ</span>
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
