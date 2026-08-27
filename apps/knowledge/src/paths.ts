/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { dataDir } from '@hasna/paths';

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
