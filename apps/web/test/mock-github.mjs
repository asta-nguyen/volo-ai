// Deterministic GitHub Releases fixture for the changelog route check.
// Load before `next start` with:
//   NODE_OPTIONS="--import $PWD/test/mock-github.mjs"
// /releases/tags/v0.2.0 returns a stable release with platform installers;
// /releases/tags/v0.1.1 returns 404 so that entry shows the no-installer
// status; /releases/latest returns 404. Any other api.github.com request
// returns 404 so the check never hits the network; non-GitHub requests
// still pass through to the real fetch.

const REPO = "az-forge/volo-ai";
const originalFetch = globalThis.fetch;

function asset(tag, platform, format, size = 1024) {
  const name = `volo-ai_${tag}_${platform}.${format}`;
  return {
    name,
    size,
    browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${name}`,
  };
}

function release(tag, assets) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: "2026-10-21T12:00:00Z",
    html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
    body: "Mock release notes that the changelog page must not render.",
    assets,
  };
}

globalThis.fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const parsed = new URL(url);

  if (
    parsed.hostname === "api.github.com" &&
    parsed.pathname === `/repos/${REPO}/releases/tags/v0.2.0`
  ) {
    return Response.json(
      release("v0.2.0", [
        asset("v0.2.0", "macos_arm64", "dmg", 80 * 1024 * 1024),
        asset("v0.2.0", "windows_x64", "msix", 90 * 1024 * 1024),
        asset("v0.2.0", "linux_x64", "AppImage", 85 * 1024 * 1024),
        // Auxiliary runtime assets must be filtered out of the page.
        {
          name: "volo-ai_v0.2.0_cuda_manifest.json",
          size: 512,
          browser_download_url: `https://github.com/${REPO}/releases/download/v0.2.0/volo-ai_v0.2.0_cuda_manifest.json`,
        },
      ]),
    );
  }

  if (
    parsed.hostname === "api.github.com" &&
    parsed.pathname === `/repos/${REPO}/releases/tags/v0.1.1`
  ) {
    return new Response("not found", { status: 404 });
  }

  if (
    parsed.hostname === "api.github.com" &&
    parsed.pathname === `/repos/${REPO}/releases/latest`
  ) {
    return new Response("not found", { status: 404 });
  }

  if (parsed.hostname === "api.github.com") {
    return new Response("not found", { status: 404 });
  }

  return originalFetch(input, init);
};
