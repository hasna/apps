import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SyncConflict } from "./sync-types.js";

export const HOME = process.env["HOME"] || process.env["USERPROFILE"] || "~";

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
