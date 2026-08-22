// Legacy / explicit directory sync — only use when the user explicitly points
// at a custom directory they own. Never called by default.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import type { SyncResult } from "../types/index.js";
import { resolveConfigStore, type ConfigStore } from "../data/config-store.js";
import { applyConfigsWithReport, expandPath } from "./apply.js";
import { detectAgent, detectCategory, detectFormat } from "./sync.js";
import { redactContent, redactFormatForTarget, type RedactFormat } from "./redact.js";

const SKIP = [".db", ".db-shm", ".db-wal", ".log", ".lock", ".DS_Store", "node_modules", ".git"];
function shouldSkip(p: string) { return SKIP.some((s) => p.includes(s)); }

export interface SyncFromDirOptions {
  store?: ConfigStore;
  dryRun?: boolean;
  recursive?: boolean;
}

export async function syncFromDir(dir: string, opts: SyncFromDirOptions = {}): Promise<SyncResult> {
  const store = opts.store ?? resolveConfigStore();
  const absDir = expandPath(dir);
  if (!existsSync(absDir)) return { added: 0, updated: 0, unchanged: 0, skipped: [`Not found: ${absDir}`] };

  const files = opts.recursive !== false
    ? walkDir(absDir)
    : readdirSync(absDir).map((f) => join(absDir, f)).filter((f) => statSync(f).isFile());

  const result: SyncResult = { added: 0, updated: 0, unchanged: 0, skipped: [] };
  const home = homedir();
  const allConfigs = await store.listConfigs();

  for (const file of files) {
    if (shouldSkip(file)) { result.skipped.push(file); continue; }
    try {
      const content = readFileSync(file, "utf-8");
      if (content.length > 500_000) { result.skipped.push(file + " (too large)"); continue; }
      const targetPath = file.replace(home, "~");
      // Always redact before storing (todos a3da5210). This legacy
      // explicit-directory ingest was the only path that persisted raw bytes;
      // the DIALECT comes from the path (redactFormatForTarget), because
      // detectFormat keys off extname only and a .env / extensionless shell
      // dotfile would otherwise route to redactGeneric.
      const redacted = redactContent(content, redactFormatForTarget(targetPath, detectFormat(file) as RedactFormat));
      const existing = allConfigs.find((c) => c.target_path === targetPath);
      if (!existing) {
        if (!opts.dryRun) await store.createConfig({ name: relative(absDir, file), category: detectCategory(file), agent: detectAgent(file), target_path: targetPath, format: detectFormat(file), content: redacted.content });
        result.added++;
      } else if (existing.content !== redacted.content) {
        if (!opts.dryRun) await store.updateConfig(existing.id, { content: redacted.content });
        result.updated++;
      } else { result.unchanged++; }
    } catch { result.skipped.push(file); }
  }
  return result;
}

export async function syncToDir(dir: string, opts: { store?: ConfigStore; dryRun?: boolean } = {}): Promise<SyncResult> {
  const store = opts.store ?? resolveConfigStore();
  const home = homedir();
  const absDir = expandPath(dir);
  const normalized = dir.startsWith("~/") ? dir : absDir.replace(home, "~");
  const configs = (await store.listConfigs()).filter((c) => c.target_path && (c.target_path.startsWith(normalized) || c.target_path.startsWith(absDir)));
  const result: SyncResult = { added: 0, updated: 0, unchanged: 0, skipped: [] };
  for (const config of configs) {
    if (config.kind === "reference") continue;
    try {
      const report = await applyConfigsWithReport([config], { dryRun: opts.dryRun, store });
      result.skipped.push(...report.skipped.map((entry) => `${entry.path} (${entry.owner})`));
      if (report.failures.length > 0) throw new Error(report.failures[0]!.message);
      for (const applied of report.results) {
        applied.changed ? result.updated++ : result.unchanged++;
      }
    } catch { result.skipped.push(config.target_path || config.id); }
  }
  return result;
}

function walkDir(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (shouldSkip(full)) continue;
    if (entry.isDirectory()) walkDir(full, files);
    else if (entry.isFile()) files.push(full);
  }
  return files;
}
