import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureParentDir, getClipboardHistoryPath, getClipboardKeyPath, getDataDir } from "../paths.js";
import type { ClipboardConfig, ClipboardEntry, ClipboardStatus } from "../types.js";

const DEFAULT_CONFIG: ClipboardConfig = {
  version: 1,
  enabled: true,
  port: 19452,
  maxHistory: 500,
  maxSizeBytes: 10 * 1024 * 1024, // 10MB
  skipPatterns: [
    "password",
    "secret",
    "token",
    "-----BEGIN",
    "AKIA",
  ],
};

export function resolveConfigPath(configPath?: string): string {
  if (configPath) return configPath;
  return join(getDataDir(), "clipboard-config.json");
}

export function resolveHistoryPath(historyPath?: string): string {
  if (historyPath) return historyPath;
  return getClipboardHistoryPath();
}

function getDefaultConfig(): ClipboardConfig {
  return { ...DEFAULT_CONFIG, skipPatterns: [...DEFAULT_CONFIG.skipPatterns] };
}

function readConfig(configPath?: string): ClipboardConfig {
  const path = resolveConfigPath(configPath);
  if (!existsSync(path)) {
    return getDefaultConfig();
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ClipboardConfig;
  return { ...getDefaultConfig(), ...parsed };
}

function writeConfig(config: ClipboardConfig, configPath?: string): void {
  const path = resolveConfigPath(configPath);
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function readHistory(historyPath?: string): ClipboardEntry[] {
  const path = resolveHistoryPath(historyPath);
  if (!existsSync(path)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ClipboardEntry[];
  } catch {
    return [];
  }
}

function writeHistory(entries: ClipboardEntry[], historyPath?: string): void {
  const path = resolveHistoryPath(historyPath);
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function shouldSkipContent(content: string, skipPatterns: string[]): boolean {
  const lower = content.toLowerCase();
  return skipPatterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

export function sanitizeClipboardForRead(content: string, maxSizeBytes: number, skipPatterns: string[]): { ok: boolean; reason?: string } {
  if (Buffer.byteLength(content, "utf8") > maxSizeBytes) {
    return { ok: false, reason: "content exceeds size limit" };
  }
  if (shouldSkipContent(content, skipPatterns)) {
    return { ok: false, reason: "content matches skip pattern" };
  }
  return { ok: true };
}

export function getOrCreateClipboardKey(): string {
  const keyPath = getClipboardKeyPath();
  if (existsSync(keyPath)) {
    return readFileSync(keyPath, "utf8").trim();
  }
  const key = createHash("sha256").update(crypto.randomUUID()).digest("hex").slice(0, 32);
  ensureParentDir(keyPath);
  writeFileSync(keyPath, `${key}\n`, "utf8");
  return key;
}

export function getDefaultClipboardConfig(): ClipboardConfig {
  return getDefaultConfig();
}

export function getConfigPath(configPath?: string): string {
  return resolveConfigPath(configPath);
}

export function readClipboardConfig(configPath?: string): ClipboardConfig {
  return readConfig(configPath);
}

export function writeClipboardConfig(config: ClipboardConfig, configPath?: string): void {
  writeConfig(config, configPath);
}

export function readClipboardHistory(historyPath?: string): ClipboardEntry[] {
  return readHistory(historyPath);
}

export function addClipboardEntry(entry: ClipboardEntry, historyPath?: string): void {
  const entries = readHistory(historyPath);
  // Prevent duplicates by hash
  const existing = entries.find((e) => e.hash === entry.hash);
  if (existing) {
    existing.timestamp = entry.timestamp;
  } else {
    entries.unshift(entry);
  }
  // Trim to maxHistory
  const config = readConfig();
  if (entries.length > config.maxHistory) {
    entries.length = config.maxHistory;
  }
  writeHistory(entries, historyPath);
}

export function clearClipboardHistory(historyPath?: string): void {
  const path = resolveHistoryPath(historyPath);
  if (existsSync(path)) {
    rmSync(path);
  }
}

export function getClipboardStatus(historyPath?: string): ClipboardStatus {
  const history = readHistory(historyPath);
  const config = readConfig();
  return {
    running: false,
    port: config.port,
    historyCount: history.length,
  };
}
