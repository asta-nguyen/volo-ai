"use client";

import { useEffect } from "react";
import type { PlatformKey } from "@/lib/releases";

type UserAgentData = {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
};

async function detectPlatform(): Promise<PlatformKey | null> {
  const agentData = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  const name = `${agentData?.platform ?? ""} ${navigator.userAgent}`;
  if (/android|iphone|ipad|ipod|cros/i.test(name)) return null;
  if (/win/i.test(name)) return "windows_x64";
  if (/linux/i.test(name)) return "linux_x64";
  if (/mac/i.test(name)) {
    // The macOS build is Apple Silicon only; Chromium can tell an Intel Mac apart.
    const details = await agentData?.getHighEntropyValues?.(["architecture"]).catch(() => null);
    return details?.architecture === "x86" ? null : "macos_arm64";
  }
  return null;
}

/** Marks the download row that matches the visitor's computer. */
export function PlatformHint() {
  useEffect(() => {
    void detectPlatform().then((key) => {
      if (key) document.querySelector(`[data-platform="${key}"]`)?.setAttribute("data-recommended", "");
    });
  }, []);
  return null;
}
