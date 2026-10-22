import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { getChangelogEntries, parseChangelog, renderChangelogMarkdown } =
  await import("../lib/changelog.ts");
const { GITHUB_REPOSITORY, getReleaseForTag } = await import("../lib/releases.ts");

const ASSET_BASE = `https://github.com/${GITHUB_REPOSITORY}/releases/download`;

function release(tag, overrides = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: "2026-10-01T12:00:00Z",
    assets: [],
    html_url: `https://github.com/${GITHUB_REPOSITORY}/releases/tag/${tag}`,
    body: "ignored release notes",
    ...overrides,
  };
}

function asset(tag, platform, format, overrides = {}) {
  const name = `volo-ai_${tag}_${platform}.${format}`;
  return {
    name,
    size: 1024,
    browser_download_url: `${ASSET_BASE}/${tag}/${name}`,
    ...overrides,
  };
}

function mockFetch(t, handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => {
    globalThis.fetch = previous;
  });
}

function mockFetchJson(t, payload, { status = 200, assertUrl } = {}) {
  mockFetch(t, async (input) => {
    if (assertUrl) assertUrl(input);
    return new Response(JSON.stringify(payload), { status });
  });
}

test("parses version entries in file order with their bodies", () => {
  const entries = parseChangelog(
    [
      "# Changelog",
      "",
      "Intro text before the first entry is ignored.",
      "",
      "## v0.2.0",
      "",
      "- Added a thing.",
      "- Fixed another thing.",
      "",
      "## v0.1.1",
      "",
      "- Initial notes.",
    ].join("\n"),
  );

  assert.deepEqual(entries, [
    { tag: "v0.2.0", body: "- Added a thing.\n- Fixed another thing." },
    { tag: "v0.1.1", body: "- Initial notes." },
  ]);
});

test("keeps entry order exactly as written", () => {
  const entries = parseChangelog("## v0.1.1\n- old\n## v0.2.0\n- new\n");
  assert.deepEqual(
    entries.map((entry) => entry.tag),
    ["v0.1.1", "v0.2.0"],
  );
});

test("only strict ## vMAJOR.MINOR.PATCH headings start entries", () => {
  const entries = parseChangelog(
    [
      "# v9.9.9",
      "## 1.0.0",
      "## v1.0",
      "## v1.0.0.4",
      "## v1.0.0-beta",
      "## v1.0.0 extra",
      "## v01.0.0",
      "## v1.01.0",
      "## v1.0.01",
      "vagrant text before any valid heading",
      "## v1.0.0",
      "### Highlights",
      "- note",
      "## v1.01.0",
      "## Highlights",
      "- still body",
    ].join("\n"),
  );

  assert.deepEqual(entries, [
    {
      tag: "v1.0.0",
      body: "### Highlights\n- note\n## v1.01.0\n## Highlights\n- still body",
    },
  ]);
});

test("duplicate version headings after the first are ignored", () => {
  const entries = parseChangelog(
    "## v1.0.0\n- first\n## v0.9.0\n- older\n## v1.0.0\n- duplicate\n## v1.0.1\n- later\n",
  );

  assert.deepEqual(
    entries.map((entry) => entry.tag),
    ["v1.0.0", "v0.9.0", "v1.0.1"],
  );
  assert.equal(entries[0].body, "- first");
});

test("empty and heading-free sources parse to no entries", () => {
  assert.deepEqual(parseChangelog(""), []);
  assert.deepEqual(parseChangelog("# Title\n\nsome text\n"), []);
});

test("a valid heading with no body keeps an empty body", () => {
  assert.deepEqual(parseChangelog("## v2.0.0\n"), [
    { tag: "v2.0.0", body: "" },
  ]);
});

test("CRLF sources parse like LF sources", () => {
  assert.deepEqual(parseChangelog("## v1.0.0\r\n- note\r\n"), [
    { tag: "v1.0.0", body: "- note" },
  ]);
});

test("repository changelog.md parses to ordered version entries", async () => {
  const entries = await getChangelogEntries();
  assert.ok(entries.length >= 1);
  for (const entry of entries) {
    assert.match(entry.tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    assert.notEqual(entry.body, "");
  }
});

test("release lookup fetches the exact tag endpoint and keeps validated assets", async (t) => {
  const releasePayload = release("v1.0.0", {
    assets: [
      asset("v1.0.0", "macos_arm64", "dmg"),
      asset("v1.0.0", "windows_x64", "msix"),
      asset("v1.0.0", "linux_x64", "AppImage"),
      // Assets below must be filtered out.
      asset("v9.9.9", "macos_arm64", "dmg"),
      { name: "volo-ai_v1.0.0_cuda_manifest.json", size: 512, browser_download_url: `${ASSET_BASE}/v1.0.0/volo-ai_v1.0.0_cuda_manifest.json` },
      { name: "volo-ai_v1.0.0_macos_arm64.dmg", size: 1024, browser_download_url: "http://github.com/insecure" },
      { name: "volo-ai_v1.0.0_macos_arm64.zip", size: 1024, browser_download_url: "https://example.com/fake.zip" },
      { name: "volo-ai_v1.0.0_macos_arm64.exe", size: -1, browser_download_url: `${ASSET_BASE}/v1.0.0/volo-ai_v1.0.0_macos_arm64.exe` },
      { name: "volo-ai_v1.0.0_macos_arm64.dmg", size: 1024, browser_download_url: `${ASSET_BASE}/v1.0.0/volo-ai_v1.0.0_macos_arm64.dmg?query=1` },
    ],
  });

  mockFetchJson(t, releasePayload, {
    assertUrl(input) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      assert.equal(
        url,
        `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/tags/v1.0.0`,
      );
    },
  });

  const result = await getReleaseForTag("v1.0.0");
  assert.equal(result.kind, "available");
  assert.equal(result.tag, "v1.0.0");
  assert.equal(result.platforms.macos_arm64.length, 1);
  assert.equal(result.platforms.windows_x64.length, 1);
  assert.equal(result.platforms.linux_x64.length, 1);
  assert.equal(
    result.platforms.macos_arm64[0].url,
    `${ASSET_BASE}/v1.0.0/volo-ai_v1.0.0_macos_arm64.dmg`,
  );
});

test("release lookup rejects a mismatched response tag", async (t) => {
  mockFetchJson(t, release("v1.0.1"));

  const result = await getReleaseForTag("v1.0.0");
  assert.deepEqual(result, { kind: "unavailable" });
});

test("release lookup rejects drafts and prereleases", async (t) => {
  for (const overrides of [{ draft: true }, { prerelease: true }]) {
    mockFetchJson(t, release("v1.0.0", overrides));
    const result = await getReleaseForTag("v1.0.0");
    assert.deepEqual(result, { kind: "unavailable" });
  }
});

test("release lookup reports missing releases and API failures as unavailable", async (t) => {
  for (const status of [404, 500]) {
    mockFetchJson(t, { message: "nope" }, { status });
    assert.deepEqual(await getReleaseForTag("v1.0.0"), { kind: "unavailable" });
  }

  mockFetch(t, async () => {
    throw new Error("network down");
  });
  assert.deepEqual(await getReleaseForTag("v1.0.0"), { kind: "unavailable" });
});

test("release lookup returns no assets for a release without installers", async (t) => {
  mockFetchJson(t, release("v1.0.0", { assets: [] }));

  const result = await getReleaseForTag("v1.0.0");
  assert.equal(result.kind, "available");
  assert.deepEqual(result.platforms, {
    macos_arm64: [],
    windows_x64: [],
    linux_x64: [],
  });
});

test("release lookup refuses invalid tags without fetching", async (t) => {
  mockFetch(t, async () => {
    throw new Error("fetch must not be called");
  });

  for (const tag of [
    "1.0.0",
    "v1.0",
    "v1.0.0-beta",
    "latest",
    "v01.0.0",
    "v1.01.0",
    "v1.0.01",
  ]) {
    assert.deepEqual(await getReleaseForTag(tag), { kind: "unavailable" });
  }
});

test("changelog markdown drops authored links but keeps their text", () => {
  const html = renderChangelogMarkdown("See [the docs](https://example.com/docs) now.");
  assert.ok(!/<a[\s>]/i.test(html));
  assert.ok(!/href=/i.test(html));
  assert.match(html, /the docs/);
});

test("changelog markdown drops images", () => {
  const html = renderChangelogMarkdown("![screenshot](https://example.com/x.png)");
  assert.ok(!/<img[\s>]/i.test(html));
});

test("changelog markdown escapes raw HTML and does not autolink URLs", () => {
  const html = renderChangelogMarkdown(
    '<script>alert("x")</script> and https://example.com plus <https://example.com/auto>',
  );
  assert.ok(!/<script/i.test(html));
  assert.ok(!/<a[\s>]/i.test(html));
  assert.match(html, /alert/);
});

test("changelog markdown still renders basic formatting", () => {
  const html = renderChangelogMarkdown("## Notes\n\n- **bold** item\n- `code` item\n");
  assert.match(html, /<h2>Notes<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
});
