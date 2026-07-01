import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { generateChangelogMarkdown } from "./markdown.js";
import { LocalChangelogStore, resolveChangelogDataDir } from "./storage.js";
import type { PublishChangelogOptions, PublishChangelogResult } from "./types.js";

function diffLines(before: string, after: string): string {
  if (before === after) return "";
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines = ["--- current", "+++ generated"];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max; index += 1) {
    const left = beforeLines[index];
    const right = afterLines[index];
    if (left === right) continue;
    if (left !== undefined) lines.push(`-${left}`);
    if (right !== undefined) lines.push(`+${right}`);
  }
  return `${lines.join("\n")}\n`;
}

async function writeBackup(targetPath: string, existing: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = basename(targetPath).replace(/[^A-Za-z0-9._-]/g, "_");
  const backupPath = join(resolveChangelogDataDir(), "backups", `${safeName}.${timestamp}.bak`);
  mkdirSync(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, existing, "utf8");
  return backupPath;
}

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
  const diff = options.diff ? diffLines(existing, markdown) : undefined;
  let backupPath: string | undefined;

  if (options.write) {
    mkdirSync(dirname(targetPath), { recursive: true });
    if (changed && existing && (options.backup ?? true)) {
      backupPath = await writeBackup(targetPath, existing);
    }
    await writeFile(targetPath, markdown, "utf8");
  }

  return {
    mode,
    targetPath,
    markdown,
    diff,
    backupPath,
    changed,
    bytes: Buffer.byteLength(markdown, "utf8"),
  };
}
