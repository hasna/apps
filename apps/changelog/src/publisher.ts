import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateChangelogMarkdown } from "./markdown.js";
import { LocalChangelogStore } from "./storage.js";
import type { PublishChangelogOptions, PublishChangelogResult } from "./types.js";

export async function publishChangelog(options: PublishChangelogOptions = {}): Promise<PublishChangelogResult> {
  const cwd = options.cwd ?? process.cwd();
  const targetPath = resolve(cwd, options.targetPath ?? "CHANGELOG.md");
  const store = options.store ?? new LocalChangelogStore();
  const entries = options.entries ?? await store.listEntries({
    appId: options.appId,
    version: options.version,
    kind: options.kind,
    category: options.category,
    tag: options.tag,
    limit: options.limit ?? 500,
  });
  const markdown = generateChangelogMarkdown(entries, options);
  const existing = existsSync(targetPath) ? await readFile(targetPath, "utf8") : "";
  const changed = existing !== markdown;
  const mode = options.write ? "write" : "dry-run";

  if (options.write) {
    mkdirSync(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, markdown, "utf8");
  }

  return {
    mode,
    targetPath,
    markdown,
    changed,
    bytes: Buffer.byteLength(markdown, "utf8"),
  };
}
