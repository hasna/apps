/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
// --- Local path resolver -------------------------------------------------
// @hasna/paths was deleted (hasna/apps#1535, 2026-09-03); this in-package
// implementation preserves the resolver contract (XDG / macOS home layout
// honoring HASNA_{CONFIG,DATA,STATE,CACHE}_HOME, with the same env-override
// and home-override semantics the deleted package had).
import { homedir as pathsResolverHomedir } from "node:os";
import { join as pathsResolverJoin } from "node:path";

export type PathKind = "config" | "data" | "state" | "cache";

const PATHS_RESOLVER_KIND_ENV: Record<PathKind, string> = {
  config: "HASNA_CONFIG_HOME",
  data: "HASNA_DATA_HOME",
  state: "HASNA_STATE_HOME",
  cache: "HASNA_CACHE_HOME",
};

export interface PathsResolverOptions {
  app: string;
  internal?: boolean;
  platform?: string;
  home?: string;
  env?: Record<string, string | undefined>;
}

const PATHS_RESOLVER_APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function pathsResolverAssertApp(app: string): void {
  if (typeof app !== "string" || app.length === 0) {
    throw new TypeError("paths: app must be a non-empty string");
  }
  if (!PATHS_RESOLVER_APP_SLUG_RE.test(app)) {
    throw new TypeError(
      `paths: invalid app slug "${app}" — expected lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`,
    );
  }
}

function pathsResolverAssertKind(kind: PathKind): void {
  if (!(Object.keys(PATHS_RESOLVER_KIND_ENV) as string[]).includes(kind)) {
    throw new TypeError(
      `paths: invalid path kind "${kind}" — expected one of ${Object.keys(PATHS_RESOLVER_KIND_ENV).join(", ")}`,
    );
  }
}

function pathsResolverBaseDir(kind: PathKind, options: PathsResolverOptions): string {
  pathsResolverAssertKind(kind);
  const env: Record<string, string | undefined> = options.env ?? process.env;
  const override = env[PATHS_RESOLVER_KIND_ENV[kind]];
  if (typeof override === "string" && override.length > 0) return override;
  const home = options.home ?? pathsResolverHomedir();
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    switch (kind) {
      case "config":
      case "data":
        return pathsResolverJoin(home, "Library", "Application Support", "Hasna");
      case "cache":
        return pathsResolverJoin(home, "Library", "Caches", "Hasna");
      case "state":
        return pathsResolverJoin(home, "Library", "Logs", "Hasna");
    }
  }
  switch (kind) {
    case "config":
      return pathsResolverJoin(home, ".config", "hasna");
    case "data":
      return pathsResolverJoin(home, ".local", "share", "hasna");
    case "state":
      return pathsResolverJoin(home, ".local", "state", "hasna");
    case "cache":
      return pathsResolverJoin(home, ".cache", "hasna");
  }
}

function pathsResolverResolve(kind: PathKind, options: PathsResolverOptions): string {
  pathsResolverAssertApp(options.app);
  const appSegment = options.internal === true ? pathsResolverJoin("internal", options.app) : options.app;
  return pathsResolverJoin(pathsResolverBaseDir(kind, options), appSegment);
}
export function dataDir(options: PathsResolverOptions): string {
  return pathsResolverResolve("data", options);
}

/** Env var name for the exact-app data-home override. */
export const KNOWLEDGE_DATA_HOME_ENV = 'HASNA_KNOWLEDGE_HOME';

/**
 * The effective user home, mirroring the pre-existing knowledge resolution
 * (`HOME` || `USERPROFILE` || `os.homedir()`). Read at call time because the
 * config/CLI tests switch `$HOME` mid-process and bun's `os.homedir()` does
 * not follow that switch. A home that cannot be resolved is a hard error —
 * never a literal "~" path (relative to cwd) and never an
 * "undefined"-prefixed path.
 */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (!home) throw new Error('Could not resolve the user home directory');
  return home;
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data home for
 * knowledge. This is the forward-looking home the XDG migration (hotfixes
 * plan 0f49f56a, task P3.3) moves the store toward:
 * `~/.local/share/hasna/knowledge` on Linux, `~/Library/Application
 * Support/Hasna/knowledge` on macOS. The home override mirrors the
 * pre-existing $HOME-first resolution so the resolver follows the same home
 * the legacy path does.
 */
export function getResolverDataHome(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: 'knowledge', home: getHomeDir(env), env });
}

/** The legacy (pre-XDG) data home: ~/.hasna/knowledge */
export function getLegacyDataHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), '.hasna', 'knowledge');
}

/**
 * Whether the resolver (XDG) data home should be adopted as the effective
 * data home. The resolver home is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`knowledge.db` or `config.json` exists — the two files a live local
 * workspace always carries). A machine that only redirects another kind
 * (e.g. cache to tmpfs) must NOT have its data home moved, and a live store
 * at the legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === 'string' && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, 'knowledge.db')) || existsSync(join(resolved, 'config.json'));
}

/** The exact-app override root, when set: `HASNA_KNOWLEDGE_HOME`. */
export function getExactDataHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env[KNOWLEDGE_DATA_HOME_ENV]?.trim();
  if (dir) return resolve(dir);
  return undefined;
}

/**
 * The effective knowledge data home: an exact-app override
 * (`HASNA_KNOWLEDGE_HOME`) wins unconditionally; otherwise the resolver (XDG)
 * data home once adopted (`HASNA_DATA_HOME` set, or `knowledge.db` /
 * `config.json` already migrated there); otherwise the legacy
 * `~/.hasna/knowledge` default — an existing store never becomes invisible on
 * upgrade.
 */
export function getDataHome(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataHome(env);
  if (exact) return exact;
  const resolved = getResolverDataHome(env);
  return adoptResolverDataHome(resolved, env) ? resolve(resolved) : getLegacyDataHome(env);
}
