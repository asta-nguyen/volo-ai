import { useEffect, useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Repeat,
  Download,
  Copy,
  Check,
  FastForward,
  Rewind,
  Music2,
} from "lucide-react";
import { Button, Badge } from "./ui";
import { cn } from "../lib/utils";
import type { UiCopy } from "../lib/i18n";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export interface AudioPlayerProps {
  src: string;
  audioPath?: string;
  format?: string;
  sampleRate?: number;
  voiceName?: string;
  copy: UiCopy;
  onExport?: () => void;
  autoPlay?: boolean;
  className?: string;
}

export function AudioPlayer({
  src,
  audioPath,
  format = "wav",
  sampleRate,
  voiceName,
  copy,
  onExport,
  autoPlay = false,
  className,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLooping, setIsLooping] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState(0);

  // Sync state with audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      setDuration(audio.duration || 0);
      if (autoPlay) {
        audio.play().catch(() => setIsPlaying(false));
      }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [src, autoPlay]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(console.error);
    } else {
      audio.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(time, audio.duration || 0));
    audio.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  const handleProgressBarClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = progressBarRef.current?.getBoundingClientRect();
    if (!rect || !duration) return;
    const clickX = event.clientX - rect.left;
    const fraction = Math.max(0, Math.min(1, clickX / rect.width));
    seek(fraction * duration);
  };

  const handleProgressBarMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = progressBarRef.current?.getBoundingClientRect();
    if (!rect || !duration) return;
    const moveX = event.clientX - rect.left;
    const fraction = Math.max(0, Math.min(1, moveX / rect.width));
    setHoverPosition(fraction * 100);
    setHoverTime(fraction * duration);
  };

  const handleProgressBarMouseLeave = () => {
    setHoverTime(null);
  };

  const skip = (delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    seek(audio.currentTime + delta);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (newVolume: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = newVolume;
    setVolume(newVolume);
    if (newVolume > 0 && isMuted) {
      audio.muted = false;
      setIsMuted(false);
    }
  };

  const cyclePlaybackRate = () => {
    const rates = [1, 1.25, 1.5, 2, 0.75];
    const nextRate = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    const audio = audioRef.current;
    if (audio) audio.playbackRate = nextRate;
    setPlaybackRate(nextRate);
  };

  const toggleLoop = () => {
    const audio = audioRef.current;
    if (audio) audio.loop = !isLooping;
    setIsLooping(!isLooping);
  };

  const handleCopyPath = async () => {
    if (!audioPath) return;
    try {
      await navigator.clipboard.writeText(audioPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const progressFraction = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-4 rounded-2xl border border-(--border) bg-(--surface) p-5 shadow-sm transition-all",
        className,
      )}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Top row: Track info & tags */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-(--accent-soft) text-(--accent)">
            <Music2 className="size-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-(--foreground)">
                {voiceName ? voiceName : copy.renderedTake}
              </span>
              <Badge className="font-mono text-[9px] uppercase tracking-wider">
                {format.toUpperCase()}
              </Badge>
              {sampleRate && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-(--muted-foreground)">
                  {Math.round(sampleRate / 1000)} kHz
                </span>
              )}
            </div>
            {audioPath && (
              <p className="max-w-xs truncate font-mono text-[10px] text-(--muted-foreground) sm:max-w-md">
                {audioPath.split(/[\\/]/).pop()}
              </p>
            )}
          </div>
        </div>

        {/* Secondary actions: Copy path & Export */}
        <div className="flex items-center gap-1.5">
          {audioPath && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyPath}
              className="h-8 px-2.5 text-xs text-(--muted-foreground) hover:text-(--foreground)"
              title={copy.copyAudioPath}
            >
              {copied ? (
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
          )}

          {onExport && (
            <Button variant="secondary" size="sm" onClick={onExport} className="h-8 gap-1.5 text-xs">
              <Download className="size-3.5" />
              <span>{copy.export}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Middle row: Interactive Waveform / Scrubber Bar */}
      <div className="space-y-1.5">
        <div
          ref={progressBarRef}
          onClick={handleProgressBarClick}
          onMouseMove={handleProgressBarMouseMove}
          onMouseLeave={handleProgressBarMouseLeave}
          className="relative h-3 w-full cursor-pointer rounded-full bg-(--surface-muted) py-0.5 transition-all hover:h-3.5"
        >
          {/* Progress fill */}
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-(--accent) transition-[width] duration-75"
            style={{ width: `${progressFraction}%` }}
          />

          {/* Scrubber thumb */}
          <div
            className="absolute top-1/2 -ml-2 size-4 -translate-y-1/2 rounded-full border-2 border-(--surface) bg-(--accent) shadow-md transition-transform group-hover:scale-110"
            style={{ left: `${progressFraction}%` }}
          />

          {/* Hover preview tooltip */}
          {hoverTime !== null && (
            <div
              className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-md bg-(--foreground) px-1.5 py-0.5 font-mono text-[10px] font-semibold text-(--background) shadow"
              style={{ left: `${hoverPosition}%` }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        {/* Timestamps */}
        <div className="flex items-center justify-between font-mono text-[11px] font-medium text-(--muted-foreground)">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Bottom row: Playback Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        {/* Play / Pause / Skip controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => skip(-5)}
            className="flex size-8 items-center justify-center rounded-lg text-(--muted-foreground) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)"
            title="-5s"
          >
            <Rewind className="size-4" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            className="flex size-11 items-center justify-center rounded-2xl bg-(--accent) text-white shadow-[0_8px_20px_rgb(191_95_69/25%)] transition-all hover:scale-105 hover:bg-(--accent-strong) active:scale-95"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="ml-0.5 size-5 fill-current" />
            )}
          </button>

          <button
            type="button"
            onClick={() => skip(5)}
            className="flex size-8 items-center justify-center rounded-lg text-(--muted-foreground) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)"
            title="+5s"
          >
            <FastForward className="size-4" />
          </button>

          <button
            type="button"
            onClick={() => seek(0)}
            className="flex size-8 items-center justify-center rounded-lg text-(--muted-foreground) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)"
            title="Replay from start"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>

        {/* Right side: Speed, Loop, Volume */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Rate switch */}
          <button
            type="button"
            onClick={cyclePlaybackRate}
            className="inline-flex h-8 items-center rounded-lg border border-(--border) bg-(--surface) px-2.5 font-mono text-xs font-semibold text-(--foreground) transition-colors hover:border-(--accent) hover:text-(--accent)"
            title={copy.playbackSpeed}
          >
            {playbackRate}×
          </button>

          {/* Loop toggle */}
          <button
            type="button"
            onClick={toggleLoop}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg border transition-colors",
              isLooping
                ? "border-(--accent) bg-(--accent-soft) text-(--accent)"
                : "border-transparent text-(--muted-foreground) hover:bg-(--surface-muted) hover:text-(--foreground)",
            )}
            title={copy.loop}
          >
            <Repeat className="size-3.5" />
          </button>

          {/* Volume control */}
          <div className="flex items-center gap-1.5 pl-1">
            <button
              type="button"
              onClick={toggleMute}
              className="flex size-8 items-center justify-center rounded-lg text-(--muted-foreground) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="size-4" />
              ) : (
                <Volume2 className="size-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className="h-1.5 w-16 cursor-pointer accent-(--accent) sm:w-20"
              aria-label={copy.volume}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function InlineAudioPreview({
  src,
  label,
  pauseLabel = "Pause",
}: {
  src: string;
  label?: string;
  pauseLabel?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(console.error);
    } else {
      audio.pause();
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  return (
    <div className="inline-flex items-center gap-2">
      <audio ref={audioRef} src={src} preload="none" />
      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? pauseLabel : label ?? "Preview"}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[11px] font-semibold transition-all",
          isPlaying
            ? "border-(--accent) bg-(--accent-soft) text-(--accent)"
            : "border-(--border) bg-(--surface) text-(--muted-foreground) hover:border-(--border-strong) hover:text-(--foreground)",
        )}
      >
        {isPlaying ? (
          <>
            <Pause className="size-3 fill-current" />
            <span>{pauseLabel}</span>
            <span className="flex items-end gap-0.5 pl-0.5">
              <span className="size-1 animate-pulse rounded-full bg-(--accent)" />
              <span className="size-1.5 animate-pulse rounded-full bg-(--accent)" />
              <span className="size-1 animate-pulse rounded-full bg-(--accent)" />
            </span>
          </>
        ) : (
          <>
            <Play className="size-3 fill-current" />
            <span>{label ?? "Preview"}</span>
          </>
        )}
      </button>
    </div>
  );
}
