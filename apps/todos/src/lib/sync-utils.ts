import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SyncConflict } from "./sync-types.js";
import { getTodosDir } from "./paths.js";

export const TODO_SYNC_FINGERPRINT_KEY = "todos_sync_fingerprint";

// A literal "~" is NOT a home directory. Nothing in Node expands it — only a
// shell does, and only unquoted at the start of a word — so `join("~", ...)`
// yields a RELATIVE path and every write lands under whatever the process cwd
// happens to be. With HOME unset that silently scattered the global store into
// the working directory: the suite left a literal `the todos data root/` folder
// inside this repository, and the stray `the todos data root/config.json` it
// produced is what failed the 0.15.0 publish (run 30822824396, "1 change
// found"). Worse than the failed release, a user or daemon running with no
// HOME (cron, systemd, a container) got a DIFFERENT task database per cwd
// instead of one global store.
//
// `homedir()` consults HOME first and otherwise resolves the passwd entry, so
// it returns a real absolute path in exactly the case the old fallback broke.
export function getHomeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

export const HOME = getHomeDir();

/**
 * The effective (global) todos data dir, resolved through @hasna/paths
 * (XDG / macOS home layout): the resolver data home once adopted, otherwise
 * the legacy `the todos data root` default. File-level store overrides
 * (`HASNA_TODOS_DB_PATH` / `TODOS_DB_PATH`) are layered on top by the store
 * layers and always win regardless.
 */
export function getTodosGlobalDir(): string {
  return getTodosDir();
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"));
}

export function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function writeJsonFile(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function readHighWaterMark(dir: string): number {
  const path = join(dir, ".highwatermark");
  if (!existsSync(path)) return 1;
  const val = parseInt(readFileSync(path, "utf-8").trim(), 10);
  return isNaN(val) ? 1 : val;
}

export function writeHighWaterMark(dir: string, value: number): void {
  writeFileSync(join(dir, ".highwatermark"), String(value));
}

export function getFileMtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function appendSyncConflict(
  metadata: Record<string, unknown>,
  conflict: SyncConflict,
  limit = 5,
): Record<string, unknown> {
  const current = Array.isArray(metadata["sync_conflicts"]) ? metadata["sync_conflicts"] as SyncConflict[] : [];
  const next = [conflict, ...current].slice(0, limit);
  return { ...metadata, sync_conflicts: next };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries.map(([key, entryValue]) => [key, canonicalize(entryValue)]));
}

function withoutSyncFingerprintMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const { [TODO_SYNC_FINGERPRINT_KEY]: _fingerprint, ...rest } = metadata;
  return rest;
}

function syncFingerprint(record: { metadata?: Record<string, unknown> }): string {
  const metadata = withoutSyncFingerprintMetadata(record.metadata || {});
  const canonical = canonicalize({ ...record, metadata });
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export function withSyncFingerprint<T extends { metadata: Record<string, unknown> }>(record: T): T {
  const metadata = withoutSyncFingerprintMetadata(record.metadata);
  return {
    ...record,
    metadata: {
      ...metadata,
      [TODO_SYNC_FINGERPRINT_KEY]: syncFingerprint({ ...record, metadata }),
    },
  };
}

export function hasSyncFingerprintChanged(record: { metadata?: Record<string, unknown> }): boolean | null {
  const stored = record.metadata?.[TODO_SYNC_FINGERPRINT_KEY];
  if (typeof stored !== "string" || stored.length === 0) return null;
  return stored !== syncFingerprint(record);
}
