import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import MarkdownIt from "markdown-it";

export type ChangelogEntry = {
  tag: string;
  body: string;
};

const VERSION_HEADING = /^## (v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))[ \t]*$/;
const CHANGELOG_PATH = path.join(process.cwd(), "..", "..", "changelog.md");

const markdown = new MarkdownIt({ html: false, linkify: false });
markdown.renderer.rules.link_open = () => "";
markdown.renderer.rules.link_close = () => "";
markdown.renderer.rules.image = () => "";

export function parseChangelog(source: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const seen = new Set<string>();
  let tag: string | null = null;
  let body: string[] = [];

  const flush = () => {
    if (tag !== null && !seen.has(tag)) {
      seen.add(tag);
      entries.push({ tag, body: body.join("\n").trim() });
    }
  };

  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    const heading = line.match(VERSION_HEADING);
    if (heading) {
      flush();
      tag = heading[1];
      body = [];
    } else if (tag !== null) {
      body.push(line);
    }
  }
  flush();

  return entries;
}

export async function getChangelogEntries(): Promise<ChangelogEntry[]> {
  return parseChangelog(await readFile(CHANGELOG_PATH, "utf8"));
}

export function renderChangelogMarkdown(body: string): string {
  return markdown.render(body);
}
