/**
 * Skills app-home resolution through the @hasna/paths resolver.
 *
 * Skills keeps its global config (`config.json`), auth (`auth.json`), the
 * default SQLite database (`server.db`), the corpus cache (`skills/`), and the
 * portable-skill tree (`installed/`, `custom/`) under one data root.
 * Historically that root was `~/.hasna/skills`. This module resolves the root
 * through `@hasna/paths` (XDG / macOS home layout) with a gated legacy
 * adoption: the legacy `~/.hasna/skills` stays the effective data root until
 * the store is physically migrated to the XDG data home (`server.db` or
 * `config.json` present there) or the operator sets the data-kind override
 * `HASNA_DATA_HOME`. An existing live store never becomes invisible on
 * upgrade. The exact-app overrides win unconditionally, in this order:
 * `HASNA_SKILLS_DIR` (the shipped override), then the wave-convention aliases
 * `HASNA_SKILLS_HOME` and `SKILLS_HOME`.
 *
 * Nothing moves on disk in this phase — the package just resolves the new
 * paths.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** Env var that relocates the skills data directory (the shipped override). */
export const DATA_DIR_ENV = "HASNA_SKILLS_DIR";

/** Wave-convention exact-app home aliases, honoured after HASNA_SKILLS_DIR. */
export const HASNA_SKILLS_HOME_ENV = "HASNA_SKILLS_HOME";
export const SKILLS_HOME_ENV = "SKILLS_HOME";

/** Filename of the default SQLite database inside the skills data directory. */
export const DEFAULT_SQLITE_FILENAME = "server.db";

/** Filename of the global config file inside the skills data directory. */
export const GLOBAL_CONFIG_FILENAME = "config.json";

/**
 * The effective user home, mirroring the pre-existing skills resolution
 * (`HOME` || `USERPROFILE` || `os.homedir()`). Read at call time so a runtime
 * `HOME` reassignment (e.g. a test temp home) is honoured — `os.homedir()`
 * snapshots `HOME` at process start and, under Bun, ignores later changes.
 */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir() || "/tmp";
}

/** The legacy (pre-XDG) data root: `~/.hasna/skills`. */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "skills");
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for skills:
 * `~/.local/share/hasna/skills` on Linux, `~/Library/Application
 * Support/Hasna/skills` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution so the resolver follows the same home the legacy
 * path does.
 */
export function resolverDataRoot(home: string = effectiveHome()): string {
  return dataDir({ app: "skills", home });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there (`server.db`
 * — the default SQLite store — or `config.json` exists). A machine that only
 * redirects another kind (e.g. cache to tmpfs) must NOT have its data home
 * moved, and a live store at the legacy home must never become invisible on
 * upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return (
    existsSync(join(resolved, DEFAULT_SQLITE_FILENAME)) ||
    existsSync(join(resolved, GLOBAL_CONFIG_FILENAME))
  );
}

/**
 * The exact-app override root, when set: the shipped `HASNA_SKILLS_DIR` wins,
 * then the wave-convention aliases `HASNA_SKILLS_HOME` and `SKILLS_HOME`.
 * First non-blank override wins; a blank or whitespace-only primary must not
 * shadow a valid secondary (nullish `??` does not fall through on `""`).
 */
export function exactDataRoot(): string | undefined {
  for (const key of [DATA_DIR_ENV, HASNA_SKILLS_HOME_ENV, SKILLS_HOME_ENV] as const) {
    const dir = process.env[key]?.trim();
    if (dir) return resolve(dir);
  }
  return undefined;
}

/** Whether an exact-app override root is set (used to skip legacy migration). */
export function hasExactOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    Boolean(env[DATA_DIR_ENV]?.trim()) ||
    Boolean(env[HASNA_SKILLS_HOME_ENV]?.trim()) ||
    Boolean(env[SKILLS_HOME_ENV]?.trim())
  );
}

/**
 * Whether the operator named a data root at all — an exact-app override or the
 * data-kind `HASNA_DATA_HOME`. Used to decide when the legacy `~/.skills` /
 * `~/.skillsrc` migration must be skipped: copying a stray legacy tree into an
 * operator-chosen directory would be a surprising write.
 */
export function hasOperatorOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  return hasExactOverride(env) || Boolean(env.HASNA_DATA_HOME?.trim());
}

/**
 * The effective data root: an exact-app override (`HASNA_SKILLS_DIR`, then
 * `HASNA_SKILLS_HOME` / `SKILLS_HOME`) wins unconditionally; otherwise the
 * resolver (XDG) data root once adopted; otherwise the legacy `~/.hasna/skills`
 * default. Write-free: callers that need the directory to exist create it.
 */
export function getDataRoot(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  const resolved = resolverDataRoot();
  return adoptResolverDataRoot(resolved) ? resolve(resolved) : resolve(legacyDataRoot());
}

/**
 * The skills app data root for an explicit home root, mirroring getDataRoot()
 * with the home injected. Used by the sync-home snapshot mapping to enumerate
 * the skills corpus under a staged home mirror (`homesRoot`) or the real home.
 */
export function skillsDataRootForHome(home: string): string {
  const resolved = resolverDataRoot(home);
  return adoptResolverDataRoot(resolved) ? resolve(resolved) : resolve(join(home, ".hasna", "skills"));
}
