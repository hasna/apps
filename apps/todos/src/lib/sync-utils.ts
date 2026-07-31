import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SyncConflict } from "./sync-types.js";

export const TODO_SYNC_FINGERPRINT_KEY = "todos_sync_fingerprint";

export const HOME = process.env["HOME"] || process.env["USERPROFILE"] || "~";

export function getHomeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || "~";
}

export function getTodosGlobalDir(): string {
  return join(getHomeDir(), ".hasna", "todos");
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
