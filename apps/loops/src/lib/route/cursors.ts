import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../paths.js";
import { stableHash } from "./fields.js";

/** Round-robin route cursors plus JSON evidence files for route-tasks commands. */

interface RouteCursor {
  lastFingerprint?: string;
  updatedAt?: string;
}

export interface RouteSelection<T> {
  selected: T[];
  cursor: {
    key: string;
    total: number;
    maxActions: number;
    previousFingerprint?: string;
    startIndex: number;
    lastFingerprint?: string;
  };
}

function routeCursorsPath(): string {
  return join(dataDir(), "route-cursors.json");
}

function readRouteCursors(): Record<string, RouteCursor> {
  const path = routeCursorsPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeRouteCursor(key: string, lastFingerprint: string | undefined): void {
  if (!lastFingerprint) return;
  const cursors = readRouteCursors();
  cursors[key] = { lastFingerprint, updatedAt: new Date().toISOString() };
  writeFileSync(routeCursorsPath(), JSON.stringify(cursors, null, 2), { mode: 0o600 });
}

export function writeRouteEvidence(kind: string, value: unknown, evidenceDir: string | undefined): string | undefined {
  if (!evidenceDir) return undefined;
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\./g, "");
  const evidencePath = join(evidenceDir, `${kind}-${stamp}-${randomUUID().slice(0, 8)}.json`);
  writeFileSync(evidencePath, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
  return evidencePath;
}

export function selectRouteItems<T>(items: T[], maxActions: number, cursorKey: string, fingerprintOf: (item: T) => string): RouteSelection<T> {
  const total = items.length;
  const boundedMax = Math.max(0, Math.floor(Number.isFinite(maxActions) ? maxActions : 0));
  if (total === 0 || boundedMax === 0) {
    return { selected: [], cursor: { key: cursorKey, total, maxActions: boundedMax, startIndex: 0 } };
  }
  const cursors = readRouteCursors();
  const previousFingerprint = cursors[cursorKey]?.lastFingerprint;
  const previousIndex = previousFingerprint ? items.findIndex((item) => fingerprintOf(item) === previousFingerprint) : -1;
  const startIndex = previousIndex >= 0 ? (previousIndex + 1) % total : 0;
  const selected: T[] = [];
  const count = Math.min(boundedMax, total);
  for (let index = 0; index < count; index += 1) selected.push(items[(startIndex + index) % total]);
  return {
    selected,
    cursor: {
      key: cursorKey,
      total,
      maxActions: boundedMax,
      previousFingerprint,
      startIndex,
      lastFingerprint: selected.length ? fingerprintOf(selected[selected.length - 1]) : undefined,
    },
  };
}

export function routeCursorKey(kind: "health" | "hygiene", parts: unknown[], opts: { autoRoute?: boolean; routeProjectPath?: string }): string {
  const routeMode = opts.autoRoute ? ["auto-route", opts.routeProjectPath ?? "cwd"] : [];
  return `${kind}:${stableHash([...parts, ...routeMode])}`;
}
