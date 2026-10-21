const GITHUB_REPOSITORY = "az-forge/volo-ai";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`;
const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const INSTALLED_VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REQUEST_TIMEOUT_MS = 5_000;
const AUTOMATIC_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_AUTOMATIC_CHECK_KEY = "volo-ai.update-last-check";
const DISMISSED_TAG_KEY = "volo-ai.update-dismissed-tag";

export type UpdateCheckResult =
  { kind: "available"; tag: string; url: string } | { kind: "current" } | { kind: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function automaticCheckDue(now: number = Date.now()): boolean {
  try {
    const last = Number(window.localStorage.getItem(LAST_AUTOMATIC_CHECK_KEY));
    return !Number.isFinite(last) || last > now || now - last >= AUTOMATIC_CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

export function recordAutomaticCheck(now: number = Date.now()): void {
  try {
    window.localStorage.setItem(LAST_AUTOMATIC_CHECK_KEY, String(now));
  } catch {}
}

export function readDismissedTag(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_TAG_KEY);
  } catch {
    return null;
  }
}

export function dismissUpdateTag(tag: string): void {
  try {
    window.localStorage.setItem(DISMISSED_TAG_KEY, tag);
  } catch {}
}

export function clearDismissedTag(): void {
  try {
    window.localStorage.removeItem(DISMISSED_TAG_KEY);
  } catch {}
}

export function compareVersions(installedVersion: string, releaseTag: string): number | null {
  const installed = INSTALLED_VERSION_PATTERN.exec(installedVersion);
  const release = RELEASE_TAG_PATTERN.exec(releaseTag);
  if (!installed || !release) return null;
  for (let index = 1; index <= 3; index++) {
    const releasePart = BigInt(release[index]);
    const installedPart = BigInt(installed[index]);
    if (releasePart !== installedPart) return releasePart > installedPart ? 1 : -1;
  }
  return 0;
}

export function isSafeGithubReleaseUrl(value: unknown, tag: string): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname === `/${GITHUB_REPOSITORY}/releases/tag/${tag}`
    );
  } catch {
    return false;
  }
}

export function parseLatestRelease(value: unknown): { tag: string; url: string } | null {
  if (!isRecord(value)) return null;
  const tag = value.tag_name;
  if (
    typeof tag !== "string" ||
    !RELEASE_TAG_PATTERN.test(tag) ||
    value.draft !== false ||
    value.prerelease !== false ||
    !isSafeGithubReleaseUrl(value.html_url, tag)
  ) {
    return null;
  }
  return { tag, url: value.html_url };
}

export async function checkLatestRelease(
  installedVersion: string | null,
): Promise<UpdateCheckResult> {
  if (installedVersion === null || !INSTALLED_VERSION_PATTERN.test(installedVersion)) {
    return { kind: "unavailable" };
  }
  try {
    const response = await fetch(RELEASES_API, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { kind: "unavailable" };
    const release = parseLatestRelease(await response.json());
    if (!release) return { kind: "unavailable" };
    return compareVersions(installedVersion, release.tag) === 1
      ? { kind: "available", tag: release.tag, url: release.url }
      : { kind: "current" };
  } catch {
    return { kind: "unavailable" };
  }
}
