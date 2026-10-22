import { useEffect, useRef, useState, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";
import type { UiCopy } from "../lib/i18n";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

const isLinuxWebView = navigator.userAgent.includes("Linux");

const AUDIO_MIME_TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  ogg: "audio/ogg",
};

function audioMimeType(path: string): string {
  const extension = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_MIME_TYPES[extension] ?? "application/octet-stream";
}

async function readAudioBlobUrl(path: string): Promise<string> {
  const bytes = await readFile(path);
  return URL.createObjectURL(new Blob([bytes], { type: audioMimeType(path) }));
}

export interface AudioPlayerProps {
  audioPath: string;
  format?: string;
  sampleRate?: number;
  voiceName?: string;
  copy: UiCopy;
  onExport?: () => void;
  autoPlay?: boolean;
  className?: string;
}

export function AudioPlayer({
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
  const [blobSource, setBlobSource] = useState<{ path: string; url: string } | null>(null);

  const src = isLinuxWebView
    ? blobSource && blobSource.path === audioPath
      ? blobSource.url
      : undefined
    : convertFileSrc(audioPath);

  useEffect(() => {
    if (!isLinuxWebView) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    readAudioBlobUrl(audioPath)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setBlobSource({ path: audioPath, url });
      })
      .catch((reason) => {
        console.error("Failed to read audio file for playback:", audioPath, reason);
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [audioPath]);

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
              <Badge variant="outline">
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
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => skip(-5)}
            title="-5s"
          >
            <Rewind data-icon="inline-start" />
          </Button>

          <Button
            variant="default"
            size="icon-lg"
            onClick={togglePlay}
            disabled={!src}
            className="rounded-2xl transition-transform hover:scale-105 active:scale-95"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause data-icon="inline-start" className="fill-current" />
            ) : (
              <Play data-icon="inline-start" className="fill-current" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => skip(5)}
            title="+5s"
          >
            <FastForward data-icon="inline-start" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => seek(0)}
            title="Replay from start"
          >
            <RotateCcw data-icon="inline-start" />
          </Button>
        </div>

        {/* Right side: Speed, Loop, Volume */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Rate switch */}
          <Button
            variant="outline"
            size="sm"
            onClick={cyclePlaybackRate}
            className="font-mono"
            title={copy.playbackSpeed}
          >
            {playbackRate}×
          </Button>

          {/* Loop toggle */}
          <Button
            variant={isLooping ? "default" : "ghost"}
            size="icon-sm"
            onClick={toggleLoop}
            aria-pressed={isLooping}
            title={copy.loop}
          >
            <Repeat data-icon="inline-start" />
          </Button>

          {/* Volume control */}
          <div className="flex items-center gap-1.5 pl-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleMute}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted || volume === 0 ? (
                <VolumeX data-icon="inline-start" />
              ) : (
                <Volume2 data-icon="inline-start" />
              )}
            </Button>
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
  audioPath,
  label,
  pauseLabel = "Pause",
}: {
  audioPath: string;
  label?: string;
  pauseLabel?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const blobSourceRef = useRef<{ path: string; url: string } | null>(null);
  const readCounter = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [blobSource, setBlobSource] = useState<{ path: string; url: string } | null>(null);

  const src = isLinuxWebView
    ? blobSource && blobSource.path === audioPath
      ? blobSource.url
      : undefined
    : convertFileSrc(audioPath);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (!isLinuxWebView || blobSourceRef.current?.path === audioPath) {
      audio.play().catch(console.error);
      return;
    }
    const readId = ++readCounter.current;
    readAudioBlobUrl(audioPath)
      .then((url) => {
        if (readId !== readCounter.current) {
          URL.revokeObjectURL(url);
          return;
        }
        const source = { path: audioPath, url };
        blobSourceRef.current = source;
        setBlobSource(source);
        const element = audioRef.current;
        if (element && element.paused) {
          element.src = url;
          element.play().catch(console.error);
        }
      })
      .catch((reason) => {
        console.error("Failed to read audio file for playback:", audioPath, reason);
      });
  };

  useEffect(() => {
    return () => {
      readCounter.current += 1;
      if (blobSourceRef.current) {
        URL.revokeObjectURL(blobSourceRef.current.url);
        blobSourceRef.current = null;
      }
    };
  }, [audioPath]);

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
      <Button
        variant={isPlaying ? "default" : "outline"}
        size="xs"
        onClick={toggle}
        aria-label={isPlaying ? pauseLabel : label ?? "Preview"}
        className="font-mono"
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
      </Button>
    </div>
  );
}
