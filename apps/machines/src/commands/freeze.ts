import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { readManifest } from "../manifests.js";
import { ensureParentDir, getFreezePath, getManifestPath } from "../paths.js";
import type { FreezeEntry } from "../types.js";

// Supply-chain freeze gate. Ported from the skill-package-update loop concept:
// a package implicated in an active supply-chain incident is FROZEN — the
// reconcile loop must not install or update it until a sweep clears it.
// Freeze entries live in <dataDir>/freeze.json and can also be declared
// fleet-wide in the machines.json manifest under `freeze`.

const freezeEntrySchema = z.object({
  name: z.string().min(1),
  reason: z.string().optional(),
  frozenAt: z.string().optional(),
  until: z.string().optional(),
});

const freezeFileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().optional(),
  packages: z.array(freezeEntrySchema),
});

export interface FreezeFile {
  version: 1;
  updatedAt?: string;
  packages: FreezeEntry[];
}

export function readFreezeFile(path = getFreezePath()): FreezeFile {
  if (!existsSync(path)) {
    return { version: 1, packages: [] };
  }
  return freezeFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeFreezeFile(file: FreezeFile, path = getFreezePath()): string {
  ensureParentDir(path);
  const payload: FreezeFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    packages: [...file.packages].sort((left, right) => left.name.localeCompare(right.name)),
  };
  freezeFileSchema.parse(payload);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return path;
}

export function addFreeze(entry: FreezeEntry, path = getFreezePath()): FreezeFile {
  const file = readFreezeFile(path);
  const next: FreezeEntry = {
    frozenAt: new Date().toISOString(),
    ...entry,
  };
  file.packages = [...file.packages.filter((existing) => existing.name !== entry.name), next];
  writeFreezeFile(file, path);
  return readFreezeFile(path);
}

export function removeFreeze(name: string, path = getFreezePath()): { removed: boolean; file: FreezeFile } {
  const file = readFreezeFile(path);
  const before = file.packages.length;
  file.packages = file.packages.filter((entry) => entry.name !== name);
  const removed = file.packages.length !== before;
  if (removed) writeFreezeFile(file, path);
  return { removed, file: readFreezeFile(path) };
}

function freezeEntryActive(entry: FreezeEntry, now: Date): boolean {
  if (!entry.until) return true;
  const until = new Date(entry.until);
  if (Number.isNaN(until.valueOf())) return true;
  return now.valueOf() < until.valueOf();
}

/** Effective freeze list: freeze.json entries plus manifest-declared entries. */
export function listActiveFreezes(options: {
  freezePath?: string;
  manifestPath?: string;
  now?: Date;
  /** Full override: skips freeze.json and the manifest entirely. */
  entries?: FreezeEntry[];
  /**
   * Manifest-declared freeze entries from an already-loaded manifest; merged
   * with freeze.json from disk (unlike `entries`, this never bypasses the
   * operator's `machines freeze add` gate).
   */
  manifestEntries?: FreezeEntry[];
} = {}): FreezeEntry[] {
  const now = options.now ?? new Date();
  const entries = options.entries ?? [
    ...readFreezeFile(options.freezePath ?? getFreezePath()).packages,
    ...(options.manifestEntries ?? readManifestSafe(options.manifestPath).freeze ?? []),
  ];
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.name) || !freezeEntryActive(entry, now)) return false;
    seen.add(entry.name);
    return true;
  });
}

function readManifestSafe(path?: string): { freeze?: FreezeEntry[] } {
  try {
    return readManifest(path ?? getManifestPath());
  } catch {
    return {};
  }
}

/** Freeze gate check: returns the blocking entry when a package is frozen. */
export function findFreeze(packageName: string, entries: FreezeEntry[], now = new Date()): FreezeEntry | null {
  return entries.find((entry) => entry.name === packageName && freezeEntryActive(entry, now)) ?? null;
}
