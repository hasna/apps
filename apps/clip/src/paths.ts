import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { ClipClientOptions } from "./types.js";

export const DEFAULT_PORT = 3741;

export function userHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || ".";
}

export function isInMemoryDb(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

export function resolveHomeDir(options: ClipClientOptions = {}): string {
  return resolve(options.homeDir ?? process.env["HASNA_CLIP_HOME"] ?? join(userHome(), ".hasna", "clip"));
}

export function resolveDbPath(options: ClipClientOptions = {}): string {
  return options.dbPath ?? process.env["HASNA_CLIP_DB_PATH"] ?? process.env["CLIP_DB_PATH"] ?? join(resolveHomeDir(options), "clip.db");
}

export function resolveArtifactDir(options: ClipClientOptions = {}): string {
  return resolve(options.artifactDir ?? process.env["HASNA_CLIP_ARTIFACT_DIR"] ?? join(resolveHomeDir(options), "artifacts"));
}

export function resolveConfigPath(options: ClipClientOptions = {}): string {
  return join(resolveHomeDir(options), "config.json");
}

export function ensureDir(path: string, options: { private?: boolean } = {}): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: options.private ? 0o700 : undefined });
  if (!options.private) return;
  try {
    chmodSync(path, 0o700);
  } catch {
    return;
  }
}

export function ensureParentDir(filePath: string): void {
  if (isInMemoryDb(filePath)) return;
  ensureDir(dirname(resolve(filePath)));
}

export function ensureClipHome(options: ClipClientOptions = {}): void {
  const homeDir = resolveHomeDir(options);
  const artifactDir = resolveArtifactDir(options);
  const dbPath = resolveDbPath(options);
  ensureDir(homeDir, { private: true });
  ensureDir(artifactDir, { private: true });
  if (isInMemoryDb(dbPath)) return;
  const dbParent = dirname(resolve(dbPath));
  const resolvedHome = resolve(homeDir);
  const dbParentIsUnderHome = dbParent === resolvedHome || dbParent.startsWith(`${resolvedHome}${sep}`);
  ensureDir(dbParent, { private: dbParentIsUnderHome });
}
