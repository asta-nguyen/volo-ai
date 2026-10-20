import "server-only";

export const PLATFORM_KEYS = ["macos_arm64", "windows_x64", "linux_x64"] as const;

export type PlatformKey = (typeof PLATFORM_KEYS)[number];

export type ReleaseAsset = {
  name: string;
  url: string;
  size: number;
  format: string;
};

export type LatestRelease =
  | {
      kind: "available";
      tag: string;
      publishedAt: string;
      notesUrl: string;
      platforms: Record<PlatformKey, ReleaseAsset[]>;
    }
  | { kind: "no-release" }
  | { kind: "unavailable" };

export const GITHUB_REPOSITORY = "az-forge/volo-ai";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`;
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
const ASSET_FORMATS = new Set([
  ".app.tar.gz",
  ".msixbundle",
  ".appimage",
  ".appx",
  ".msix",
  ".snap",
  ".dmg",
  ".msi",
  ".deb",
  ".rpm",
  ".exe",
  ".tar.gz",
  ".zip",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSafeGithubUrl(value: unknown, expectedPath: string): value is string {
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
      url.pathname === expectedPath
    );
  } catch {
    return false;
  }
}

function parseRelease(value: unknown): LatestRelease {
  if (!isRecord(value)) return { kind: "unavailable" };

  const tag = value.tag_name;
  const publishedAt = value.published_at;
  if (
    typeof tag !== "string" ||
    !RELEASE_TAG_PATTERN.test(tag) ||
    value.draft !== false ||
    value.prerelease !== false ||
    typeof publishedAt !== "string" ||
    !Number.isFinite(Date.parse(publishedAt)) ||
    !Array.isArray(value.assets) ||
    !isSafeGithubUrl(value.html_url, `/${GITHUB_REPOSITORY}/releases/tag/${tag}`)
  ) {
    return { kind: "unavailable" };
  }

  const assetPattern = new RegExp(
    `^volo-ai_${escapeRegExp(tag)}_(macos_arm64|windows_x64|linux_x64)(\\.[a-z0-9]+(?:\\.[a-z0-9]+)*)$`,
    "i",
  );
  const platforms: Record<PlatformKey, ReleaseAsset[]> = {
    macos_arm64: [],
    windows_x64: [],
    linux_x64: [],
  };

  for (const asset of value.assets) {
    if (!isRecord(asset)) continue;
    const { name, size, browser_download_url: url } = asset;
    if (
      typeof name !== "string" ||
      typeof size !== "number" ||
      !Number.isSafeInteger(size) ||
      size <= 0
    ) {
      continue;
    }

    const match = name.match(assetPattern);
    if (!match) continue;

    const platform = match[1].toLowerCase() as PlatformKey;
    const format = match[2].toLowerCase();
    if (
      !ASSET_FORMATS.has(format) ||
      !isSafeGithubUrl(url, `/${GITHUB_REPOSITORY}/releases/download/${tag}/${name}`)
    ) {
      continue;
    }

    platforms[platform].push({ name, url, size, format });
  }

  for (const key of PLATFORM_KEYS) {
    platforms[key].sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    kind: "available",
    tag,
    publishedAt,
    notesUrl: value.html_url,
    platforms,
  };
}

export async function getLatestRelease(): Promise<LatestRelease> {
  try {
    const response = await fetch(RELEASES_API, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "volo-ai-download-site",
      },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5_000),
    });

    if (response.status === 404) return { kind: "no-release" };
    if (!response.ok) return { kind: "unavailable" };

    return parseRelease(await response.json());
  } catch {
    return { kind: "unavailable" };
  }
}
