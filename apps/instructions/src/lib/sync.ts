import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import type { Config, ConfigAgent, ConfigCategory, ConfigFormat, SyncResult } from "../types/index.js";
import { getDatabase } from "../db/database.js";
import { createConfig, getConfigById, listConfigs, updateConfig } from "../db/configs.js";
import { applyConfig, expandPath } from "./apply.js";

// Auto-detect category from path patterns
export function detectCategory(filePath: string): ConfigCategory {
  const p = filePath.toLowerCase().replace(homedir(), "~");
  if (p.includes("/.claude/rules/") || p.endsWith("claude.md") || p.endsWith("agents.md") || p.endsWith("gemini.md")) return "rules";
  if (p.includes("/.claude/") || p.includes("/.codex/") || p.includes("/.gemini/") || p.includes("/.cursor/")) return "agent";
  if (p.includes(".mcp.json") || p.includes("mcp")) return "mcp";
  if (p.includes(".zshrc") || p.includes(".zprofile") || p.includes(".bashrc") || p.includes(".bash_profile")) return "shell";
  if (p.includes(".gitconfig") || p.includes(".gitignore")) return "git";
  if (p.includes(".npmrc") || p.includes("tsconfig") || p.includes("bunfig")) return "tools";
  if (p.includes(".secrets")) return "secrets_schema";
  return "tools";
}

export function detectAgent(filePath: string): ConfigAgent {
  const p = filePath.toLowerCase().replace(homedir(), "~");
  if (p.includes("/.claude/") || p.endsWith("claude.md")) return "claude";
  if (p.includes("/.codex/") || p.endsWith("agents.md")) return "codex";
  if (p.includes("/.gemini/") || p.endsWith("gemini.md")) return "gemini";
  if (p.includes(".zshrc") || p.includes(".zprofile") || p.includes(".bashrc")) return "zsh";
  if (p.includes(".gitconfig") || p.includes(".gitignore")) return "git";
  if (p.includes(".npmrc")) return "npm";
  return "global";
}

export function detectFormat(filePath: string): ConfigFormat {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".toml") return "toml";
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".ini" || ext === ".cfg") return "ini";
  return "text";
}

const SKIP_PATTERNS = [".db", ".db-shm", ".db-wal", ".log", ".lock", ".DS_Store", "node_modules", ".git"];

function shouldSkip(p: string): boolean {
  return SKIP_PATTERNS.some((pat) => p.includes(pat));
}

function walkDir(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (shouldSkip(full)) continue;
    if (entry.isDirectory()) {
      walkDir(full, files);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

export interface SyncFromDirOptions {
  db?: ReturnType<typeof getDatabase>;
  dryRun?: boolean;
  recursive?: boolean;
}

export async function syncFromDir(
  dir: string,
  opts: SyncFromDirOptions = {}
): Promise<SyncResult> {
  const d = opts.db || getDatabase();
  const absDir = expandPath(dir);
  if (!existsSync(absDir)) {
    return { added: 0, updated: 0, unchanged: 0, skipped: [`Directory not found: ${absDir}`] };
  }

  const files = opts.recursive !== false ? walkDir(absDir) : readdirSync(absDir)
    .map((f) => join(absDir, f))
    .filter((f) => statSync(f).isFile());

  const result: SyncResult = { added: 0, updated: 0, unchanged: 0, skipped: [] };
  const allConfigs = listConfigs(undefined, d);

  for (const file of files) {
    if (shouldSkip(file)) { result.skipped.push(file); continue; }
    try {
      const content = readFileSync(file, "utf-8");
      const targetPath = file.startsWith(homedir()) ? file.replace(homedir(), "~") : file;
      const existing = allConfigs.find((c) => c.target_path === targetPath);

      if (!existing) {
        if (!opts.dryRun) {
          const name = relative(absDir, file);
          createConfig({
            name,
            category: detectCategory(file),
            agent: detectAgent(file),
            target_path: targetPath,
            format: detectFormat(file),
            content,
          }, d);
        }
        result.added++;
      } else if (existing.content !== content) {
        if (!opts.dryRun) {
          updateConfig(existing.id, { content }, d);
        }
        result.updated++;
      } else {
        result.unchanged++;
      }
    } catch {
      result.skipped.push(file);
    }
  }
  return result;
}

export interface SyncToDirOptions {
  db?: ReturnType<typeof getDatabase>;
  dryRun?: boolean;
}

export async function syncToDir(
  dir: string,
  opts: SyncToDirOptions = {}
): Promise<SyncResult> {
  const d = opts.db || getDatabase();
  const absDir = expandPath(dir);
  const normalizedDir = dir.startsWith("~/") ? dir : absDir.replace(homedir(), "~");
  const configs = listConfigs(undefined, d).filter(
    (c) => c.target_path && (c.target_path.startsWith(normalizedDir) || c.target_path.startsWith(absDir))
  );

  const result: SyncResult = { added: 0, updated: 0, unchanged: 0, skipped: [] };

  for (const config of configs) {
    if (config.kind === "reference") continue;
    try {
      const r = await applyConfig(config, { dryRun: opts.dryRun, db: d });
      if (r.changed) {
        existsSync(expandPath(config.target_path!)) ? result.updated++ : result.added++;
      } else {
        result.unchanged++;
      }
    } catch {
      result.skipped.push(config.target_path || config.id);
    }
  }
  return result;
}

export function diffConfig(config: Config): string {
  if (!config.target_path) return "(reference — no target path)";
  const path = expandPath(config.target_path);
  if (!existsSync(path)) return `(file not found on disk: ${path})`;
  const diskContent = readFileSync(path, "utf-8");
  if (diskContent === config.content) return "(no diff — identical)";

  // Simple unified diff
  const stored = config.content.split("\n");
  const disk = diskContent.split("\n");
  const lines: string[] = [`--- stored (DB)`, `+++ disk (${path})`];
  const maxLen = Math.max(stored.length, disk.length);
  for (let i = 0; i < maxLen; i++) {
    const s = stored[i];
    const d = disk[i];
    if (s === d) { if (s !== undefined) lines.push(` ${s}`); }
    else {
      if (s !== undefined) lines.push(`-${s}`);
      if (d !== undefined) lines.push(`+${d}`);
    }
  }
  return lines.join("\n");
}

export { Config };
