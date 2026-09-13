import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
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
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import {
  SidecarClient,
  type AudioFormat,
  type GenerationConfig,
  type Language,
  type ProgressEvent,
  type RequestLog,
  type SynthesisResult,
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
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
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-[var(--foreground)] sm:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
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
      className="flex items-start gap-3 rounded-xl border border-[var(--destructive-border)] bg-[var(--destructive-surface)] px-3.5 py-3 text-sm leading-5 text-[var(--destructive)]"
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
    <main className="flex min-h-screen items-center justify-center overflow-auto bg-[var(--background)] px-6 py-10 text-[var(--foreground)]">
      <div className="w-full max-w-4xl">
        <div className="mb-9 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-[var(--accent)] text-white shadow-[0_12px_30px_rgb(191_95_69/22%)]">
            <AudioLines className="size-5" />
          </div>
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
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
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <Download className="size-5" />
              </div>
            </CardHeader>
            <CardContent className="p-7">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <SectionLabel>{copy.modelPackage}</SectionLabel>
                    <p className="mt-2 text-sm font-semibold">
                      {progressEvent?.message ?? copy.verifyAssets}
                    </p>
                  </div>
                  <span className="font-mono text-lg font-semibold text-[var(--accent)]">
                    {progress}%
                  </span>
                </div>
                <Progress value={progress} className="mt-5" />
                <div className="mt-4 flex items-center justify-between gap-4 text-xs text-[var(--muted-foreground)]">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-[var(--success)]" />
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
              <p className="mt-4 text-xs leading-5 text-[var(--muted-foreground)]">
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
                <ShieldCheck className="size-5 text-[var(--success)]" />
              </CardHeader>
              <CardContent className="space-y-2.5">
                {assets.map((asset) => (
                  <div
                    key={asset}
                    className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-3 text-sm"
                  >
                    <CheckCircle2 className="size-4 text-[var(--success)]" />
                    {asset}
                  </div>
                ))}
                <p className="pt-2 text-xs leading-5 text-[var(--muted-foreground)]">
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
                <Sparkles className="size-5 text-[var(--accent)]" />
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                  {copy.setupAfterDescription}
                </p>
                <div className="mt-5 flex items-center gap-2 text-xs font-semibold">
                  <HardDrive className="size-4 text-[var(--accent)]" />
                  {copy.setupStorageValue}
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
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
          <Badge className="border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted-foreground)]">
            <span className="mr-2 size-1.5 rounded-full bg-[var(--success)]" />
            {copy.sessionOnly}
          </Badge>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          [logs.length, copy.requests, "text-[var(--foreground)]"],
          [successCount, copy.success, "text-[var(--success)]"],
          [errorCount, copy.errors, "text-[var(--destructive)]"],
        ].map(([value, label, color]) => (
          <Card key={String(label)} className="rounded-xl">
            <CardContent className="p-4">
              <p className={`text-2xl font-semibold tracking-[-0.04em] ${color}`}>{value}</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        {logs.length === 0 ? (
          <CardContent className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
            <div className="grid size-12 place-items-center rounded-2xl bg-[var(--surface-muted)] text-[var(--muted-foreground)]">
              <Logs className="size-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold">{copy.noRequests}</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
              {copy.logsEmpty}
            </p>
          </CardContent>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {logs.map((entry) => (
              <motion.article
                key={entry.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-4 p-5"
              >
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${entry.status === "success" ? "bg-[var(--success)]" : entry.status === "error" ? "bg-[var(--destructive)]" : "animate-pulse bg-[var(--accent)]"}`}
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
                          ? "border-[var(--destructive-border)] bg-[var(--destructive-surface)] text-[var(--destructive)]"
                          : entry.status === "pending"
                            ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
                            : undefined
                      }
                    >
                      {entry.status === "pending" ? copy.running : entry.status.toUpperCase()}
                    </Badge>
                  </div>
                  {entry.status === "error" && (
                    <p className="mt-2 text-sm text-[var(--destructive)]">
                      {entry.errorMessage ?? copy.failed}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
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
      <p className="mt-4 text-xs leading-5 text-[var(--muted-foreground)]">{copy.logsPrivacy}</p>
    </div>
  );
}

function VoiceProfilesView({
  voices,
  isLoading,
  listError,
  formError,
  profileName,
  refAudio,
  refText,
  isSaving,
  deletingVoice,
  copy,
  onChooseReference,
  onProfileNameChange,
  onRefTextChange,
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
  refAudio: string | null;
  refText: string;
  isSaving: boolean;
  deletingVoice: string | null;
  copy: UiCopy;
  onChooseReference: () => void;
  onProfileNameChange: (value: string) => void;
  onRefTextChange: (value: string) => void;
  onSave: () => Promise<void>;
  onRetry: () => void;
  onUse: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <PageHeader
        eyebrow={copy.profilesEyebrow}
        title={copy.profilesTitle}
        description={copy.profilesDescription}
        action={
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <Library className="size-4 text-[var(--accent)]" />
            <span className="font-mono text-xs font-semibold">
              {voices.length.toString().padStart(2, "0")} {copy.savedProfiles}
            </span>
          </div>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <div>
              <SectionLabel>{copy.voiceLibrary}</SectionLabel>
              <CardTitle className="mt-2">{copy.savedProfiles}</CardTitle>
            </div>
            {isLoading && <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />}
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
              <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-muted)] p-8 text-center">
                <div className="grid size-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                  <AudioLines className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold">{copy.emptyProfilesTitle}</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
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
                      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 transition-colors hover:border-[var(--border-strong)]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-white">
                            <AudioLines className="size-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate font-semibold">{voice.name}</h3>
                              <Badge>{copy.profileReady}</Badge>
                            </div>
                            <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                              <FileAudio className="size-3" />
                              {fileName(voice.ref_audio)}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="icon"
                          size="icon"
                          className="text-[var(--destructive)] hover:border-[var(--destructive)] hover:text-[var(--destructive)]"
                          aria-label={`${copy.deleteProfile}: ${voice.name}`}
                          onClick={() => onDelete(voice.name)}
                          disabled={deletingVoice === voice.name}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                        <div className="flex gap-3 text-xs text-[var(--muted-foreground)]">
                          <span>{copy.sourceAudio}</span>
                          <span>·</span>
                          <span>
                            {voice.ref_text?.trim() ? copy.transcriptIncluded : copy.noTranscript}
                          </span>
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
            <Plus className="size-5 text-[var(--accent)]" />
          </CardHeader>
          <CardContent>
            <CardDescription>{copy.createProfileDescription}</CardDescription>
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
              <div className="space-y-2">
                <Label>{copy.referenceAudio}</Label>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={onChooseReference}
                  disabled={isSaving}
                >
                  <FolderOpen className="size-4 text-[var(--accent)]" />
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
  onChangeLanguage,
  onBack,
}: {
  copy: UiCopy;
  appLanguage: AppLanguage;
  modelReady: boolean;
  engineOnline: boolean;
  device: string;
  dataDir: string | null;
  onChangeLanguage: (language: AppLanguage) => void;
  onBack: () => void;
}) {
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
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <SectionLabel>{copy.appLanguage}</SectionLabel>
              <CardTitle className="mt-2">{copy.interfaceLanguage}</CardTitle>
            </div>
            <Languages className="size-5 text-[var(--accent)]" />
          </CardHeader>
          <CardContent>
            <CardDescription>{copy.appLanguageDescription}</CardDescription>
            <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-[var(--surface-muted)] p-1.5">
              {(["en", "vi"] as AppLanguage[]).map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() => onChangeLanguage(item)}
                  aria-pressed={appLanguage === item}
                  className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${appLanguage === item ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
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
              <SectionLabel>{copy.localEngine}</SectionLabel>
              <CardTitle className="mt-2">{copy.omnivoiceStatus}</CardTitle>
            </div>
            <Badge
              className={
                !modelReady
                  ? "border-[var(--destructive-border)] bg-[var(--destructive-surface)] text-[var(--destructive)]"
                  : undefined
              }
            >
              {modelReady ? copy.ready : copy.unavailable}
            </Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-5">
            <Metric
              label={copy.connection}
              value={engineOnline ? copy.offlineEngine : copy.unavailable}
            />
            <Metric label={copy.device} value={device.toUpperCase()} />
            <Metric label={copy.languages} value="EN · VI" />
            <Metric label={copy.sampleRate} value="24 KHZ" />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <SectionLabel>{copy.localStorage}</SectionLabel>
              <CardTitle className="mt-2">{copy.appDataDirectory}</CardTitle>
            </div>
            <HardDrive className="size-5 text-[var(--accent)]" />
          </CardHeader>
          <CardContent>
            <code className="block overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3.5 font-mono text-xs text-[var(--foreground)]">
              {dataDir ?? copy.loadingDataPath}
            </code>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
              {copy.storageDescription}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
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
  mode,
  text,
  speed,
  format,
  instruct,
  advanced,
  advancedError,
  refAudio,
  refText,
  voices,
  selectedVoice,
  profileName,
  result,
  audioUrl,
  error,
  isGenerating,
  onLanguageChange,
  onModeChange,
  onTextChange,
  onSpeedChange,
  onFormatChange,
  onInstructChange,
  onAdvancedChange,
  onChooseReference,
  onRefTextChange,
  onSelectedVoiceChange,
  onProfileNameChange,
  onSaveProfile,
  onRequestDelete,
  onSynthesize,
  onExport,
}: {
  copy: UiCopy;
  language: Language;
  mode: VoiceMode;
  text: string;
  speed: number;
  format: AudioFormat;
  instruct: string;
  advanced: AdvancedDraft;
  advancedError: string | null;
  refAudio: string | null;
  refText: string;
  voices: VoiceProfile[];
  selectedVoice: string;
  profileName: string;
  result: SynthesisResult | null;
  audioUrl: string | null;
  error: string | null;
  isGenerating: boolean;
  onLanguageChange: (language: Language) => void;
  onModeChange: (mode: VoiceMode) => void;
  onTextChange: (text: string) => void;
  onSpeedChange: (speed: number) => void;
  onFormatChange: (format: AudioFormat) => void;
  onInstructChange: (instruct: string) => void;
  onAdvancedChange: (patch: Partial<AdvancedDraft>) => void;
  onChooseReference: () => void;
  onRefTextChange: (text: string) => void;
  onSelectedVoiceChange: (name: string) => void;
  onProfileNameChange: (name: string) => void;
  onSaveProfile: () => void;
  onRequestDelete: () => void;
  onSynthesize: () => void;
  onExport: () => void;
}) {
  const voiceModes: {
    value: VoiceMode;
    label: string;
    description: string;
    icon: React.ReactNode;
  }[] = [
    {
      value: "auto",
      label: copy.autoVoice,
      description: copy.autoVoiceDescription,
      icon: <WandSparkles className="size-4" />,
    },
    {
      value: "file",
      label: copy.cloneFromFile,
      description: copy.cloneFromFileDescription,
      icon: <FileAudio className="size-4" />,
    },
    {
      value: "profile",
      label: copy.savedProfile,
      description: copy.savedProfileDescription,
      icon: <Library className="size-4" />,
    },
    {
      value: "design",
      label: copy.voiceDesign,
      description: copy.voiceDesignDescription,
      icon: <Sparkles className="size-4" />,
    },
  ];
  return (
    <div>
      <PageHeader
        eyebrow={copy.voiceWorkspace}
        title={copy.title}
        description={copy.workspaceDescription}
        action={
          <Badge>
            <span className="mr-2 size-1.5 rounded-full bg-[var(--success)]" />
            {copy.modelReady}
          </Badge>
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-[var(--border)] pb-5">
            <div>
              <SectionLabel>{copy.scriptCanvas}</SectionLabel>
              <CardTitle className="mt-2">{copy.untitledSpeech}</CardTitle>
            </div>
            <span className="font-mono text-xs font-semibold text-[var(--muted-foreground)]">
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-6 py-3 text-xs text-[var(--muted-foreground)]">
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
          <div className="border-t border-[var(--border)] bg-[var(--surface-muted)] p-5">
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
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-5 text-sm text-[var(--muted-foreground)]">
                <Play className="size-4 text-[var(--accent)]" />
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
            <SlidersHorizontal className="size-5 text-[var(--accent)]" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label>{copy.synthesisLanguage}</Label>
              <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-[var(--surface-muted)] p-1.5">
                {(["en", "vi"] as Language[]).map((item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={language === item}
                    onClick={() => onLanguageChange(item)}
                    className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${language === item ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                  >
                    {item === "en" ? copy.english : copy.vietnamese}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>{copy.voiceSource}</Label>
              <div className="mt-2 space-y-2">
                {voiceModes.map((item) => (
                  <button
                    type="button"
                    key={item.value}
                    aria-pressed={mode === item.value}
                    onClick={() => onModeChange(item.value)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${mode === item.value ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]"}`}
                  >
                    <span
                      className={`grid size-8 place-items-center rounded-lg ${mode === item.value ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-muted)] text-[var(--muted-foreground)]"}`}
                    >
                      {item.icon}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{item.label}</span>
                      <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                        {item.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {mode === "file" && (
              <div className="space-y-3">
                <Label>{copy.referenceFile}</Label>
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={onChooseReference}
                >
                  <FolderOpen className="size-4 text-[var(--accent)]" />
                  <span className="truncate">
                    {refAudio ? fileName(refAudio) : copy.chooseAudio}
                  </span>
                </Button>
                {refAudio && (
                  <p className="text-xs leading-5 text-[var(--warning)]">
                    {copy.referenceLanguageWarning}
                  </p>
                )}
                <Textarea
                  aria-label={copy.optionalTranscript}
                  placeholder={copy.optionalTranscript}
                  value={refText}
                  onChange={(event) => onRefTextChange(event.target.value)}
                  className="min-h-20"
                />
                <div className="flex gap-2">
                  <Input
                    aria-label={copy.saveAsProfile}
                    placeholder={copy.saveAsProfile}
                    value={profileName}
                    onChange={(event) => onProfileNameChange(event.target.value)}
                  />
                  <Button
                    variant="icon"
                    size="icon"
                    aria-label={copy.saveVoiceProfile}
                    onClick={onSaveProfile}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>
            )}
            {mode === "profile" && (
              <div className="space-y-3">
                <Label>{copy.voiceLibrary}</Label>
                <Select
                  value={selectedVoice}
                  onValueChange={onSelectedVoiceChange}
                  placeholder={copy.selectSavedVoice}
                  aria-label={copy.voiceLibrary}
                >
                  <SelectItem value="auto">{copy.selectSavedVoice}</SelectItem>
                  {voices.map((voice) => (
                    <SelectItem key={voice.name} value={voice.name}>
                      {voice.name}
                    </SelectItem>
                  ))}
                </Select>
                {selectedVoice !== "auto" && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={onRequestDelete}
                  >
                    <Trash2 className="size-3.5" />
                    {copy.deleteVoiceProfile}
                  </Button>
                )}
                {voices.length === 0 && (
                  <p className="text-xs leading-5 text-[var(--muted-foreground)]">
                    {copy.noProfiles}
                  </p>
                )}
              </div>
            )}
            {mode === "design" && (
              <div className="space-y-3">
                <Label htmlFor="voice-instruction">{copy.voiceDesignInstruction}</Label>
                <Textarea
                  id="voice-instruction"
                  aria-invalid={Boolean(error)}
                  placeholder={copy.voiceDesignPlaceholder}
                  value={instruct}
                  disabled={isGenerating}
                  onChange={(event) => onInstructChange(event.target.value)}
                  className="min-h-20"
                />
                <p className="text-xs leading-5 text-[var(--muted-foreground)]">
                  {copy.voiceDesignExample}
                </p>
              </div>
            )}
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="speed">{copy.speed}</Label>
                <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 font-mono text-xs font-semibold">
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
                className="w-full accent-[var(--accent)]"
              />
            </div>
            <div>
              <Label>{copy.outputFormat}</Label>
              <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-[var(--surface-muted)] p-1.5">
                {(["wav", "mp3"] as AudioFormat[]).map((item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={format === item}
                    onClick={() => onFormatChange(item)}
                    className={`rounded-lg px-3 py-2.5 font-mono text-xs font-bold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${format === item ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <details className="group rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                {copy.advancedSettings}
                <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
              </summary>
              <div className="border-t border-[var(--border)] px-3.5 pb-3.5 pt-3">
                <p className="text-xs leading-5 text-[var(--muted-foreground)]">
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
                      className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]"
                    >
                      <input
                        type="checkbox"
                        checked={advanced[key]}
                        disabled={isGenerating}
                        onChange={(event) => onAdvancedChange({ [key]: event.target.checked })}
                        className="size-4 accent-[var(--accent)]"
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
  const [instruct, setInstruct] = useState("");
  const [advanced, setAdvanced] = useState<AdvancedDraft>(DEFAULT_ADVANCED);
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [refAudio, setRefAudio] = useState<string | null>(null);
  const [refText, setRefText] = useState("");
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voiceListError, setVoiceListError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [deletingVoice, setDeletingVoice] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState("auto");
  const [profileName, setProfileName] = useState("");
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineOnline, setEngineOnline] = useState(false);
  const [logs, setLogs] = useState<RequestLog[]>(() => client.getLogs());
  const [device, setDevice] = useState("unknown");
  const [dataDir, setDataDir] = useState<string | null>(null);
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
        const status = await client.request<{
          model_ready: boolean;
          device: string;
          languages: Language[];
        }>({ type: "status" });
        if (!active) return;
        setEngineOnline(true);
        setDevice(status.device);
        if (status.model_ready) {
          setModelReady(true);
          await refreshVoices();
        } else await prepareModel();
      } catch (reason) {
        if (active)
          setSetupError(reason instanceof Error ? reason.message : copy.engineUnavailable);
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
      await refreshVoices();
    } catch (reason) {
      setSetupError(reason instanceof Error ? reason.message : copy.modelSetupFailed);
    } finally {
      setIsPreparing(false);
    }
  }

  async function cancelModelPreparation() {
    if (!isPreparing) return;
    setIsCancelling(true);
    try {
      await client.cancelPreparation();
    } catch (reason) {
      setSetupError(reason instanceof Error ? reason.message : copy.modelSetupFailed);
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
  }

  async function chooseReference() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "flac", "ogg"] }],
    });
    if (typeof selected === "string") setRefAudio(selected);
  }

  async function synthesize() {
    setError(null);
    if (!text.trim()) return setError(copy.enterText);
    if (mode === "file" && !refAudio) return setError(copy.chooseReference);
    if (mode === "profile" && selectedVoice === "auto") return setError(copy.selectProfile);
    if (mode === "design" && !instruct.trim()) return setError(copy.voiceDesignInstructionRequired);
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
        ref_audio: mode === "file" ? refAudio : undefined,
        ref_text: mode === "file" ? refText || undefined : undefined,
        instruct: mode === "design" ? instruct.trim() : undefined,
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
    if (!refAudio || !profileName.trim()) {
      const message = copy.chooseFileAndName;
      setError(message);
      setProfileError(message);
      return;
    }
    setIsSavingProfile(true);
    setProfileError(null);
    try {
      await client.request({
        type: "save_voice",
        name: profileName.trim(),
        ref_audio: refAudio,
        ref_text: refText || undefined,
      });
      setProfileName("");
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
      <main className="flex min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] px-4 py-5 md:flex">
          <div className="flex items-center gap-3 px-2 pb-10">
            <div className="grid size-10 place-items-center rounded-xl bg-[var(--accent)] text-white shadow-[0_8px_20px_rgb(191_95_69/20%)]">
              <AudioLines className="size-5" />
            </div>
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                VOLO AI
              </p>
              <p className="mt-0.5 text-sm font-semibold">{copy.localVoiceStudio}</p>
            </div>
          </div>
          <nav aria-label={copy.workspace} className="space-y-1">
            <p className="mb-3 px-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
              {copy.workspace}
            </p>
            {navItems.map(([item, label, Icon]) => (
              <button
                type="button"
                key={item as string}
                onClick={() => setView(item as AppView)}
                aria-current={view === item ? "page" : undefined}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${view === item ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted-foreground)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"}`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-auto border-t border-[var(--border)] px-2 pt-5">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
              {copy.engine}
            </p>
            <div className="mt-3 flex items-center gap-2 text-sm font-semibold">
              <span className="size-2 rounded-full bg-[var(--success)]" />
              {copy.offlineEngine}
            </div>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--muted-foreground)]">
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
                    onChangeLanguage={changeAppLanguage}
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
                    refAudio={refAudio}
                    refText={refText}
                    isSaving={isSavingProfile}
                    deletingVoice={deletingVoice}
                    copy={copy}
                    onChooseReference={() => void chooseReference()}
                    onProfileNameChange={setProfileName}
                    onRefTextChange={setRefText}
                    onSave={saveProfile}
                    onRetry={() => void refreshVoices()}
                    onUse={useProfile}
                    onDelete={setConfirmDeleteName}
                  />
                ) : (
                  <WorkspaceView
                    copy={copy}
                    language={language}
                    mode={mode}
                    text={text}
                    speed={speed}
                    format={format}
                    instruct={instruct}
                    advanced={advanced}
                    advancedError={advancedError}
                    refAudio={refAudio}
                    refText={refText}
                    voices={voices}
                    selectedVoice={selectedVoice}
                    profileName={profileName}
                    result={result}
                    audioUrl={audioUrl}
                    error={error}
                    isGenerating={isGenerating}
                    onLanguageChange={changeSynthesisLanguage}
                    onModeChange={setMode}
                    onTextChange={setText}
                    onSpeedChange={setSpeed}
                    onFormatChange={setFormat}
                    onInstructChange={setInstruct}
                    onAdvancedChange={(patch) =>
                      setAdvanced((current) => ({ ...current, ...patch }))
                    }
                    onChooseReference={() => void chooseReference()}
                    onRefTextChange={setRefText}
                    onSelectedVoiceChange={setSelectedVoice}
                    onProfileNameChange={setProfileName}
                    onSaveProfile={() => void saveProfile()}
                    onRequestDelete={() => setConfirmDeleteName(selectedVoice)}
                    onSynthesize={() => void synthesize()}
                    onExport={() => void exportAudio()}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <footer className="border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3 sm:px-8 lg:px-10">
            <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
              <span className="flex items-center gap-2 text-[var(--success)]">
                <span className="size-1.5 rounded-full bg-[var(--success)]" />
                {copy.engineReady}
              </span>
              <span>
                {copy.device} / {engineOnline ? "AUTO" : "OFFLINE"}
              </span>
              <span>{copy.sampleRate} / 24000 HZ</span>
              <span className="ml-auto text-[var(--foreground)]">{copy.allAudioLocal}</span>
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
