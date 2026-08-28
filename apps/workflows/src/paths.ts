/**
 * Workflows data-home resolution — the effective local data home for the
 * @hasna/workflows package, resolved through @hasna/paths.
 *
 * Resolution order:
 *   1. exact-app override — `HASNA_WORKFLOWS_DATA_DIR` / `WORKFLOWS_DATA_DIR`
 *      (the shipped overrides, applied in `resolveWorkflowsConfig`) — wins
 *      unconditionally;
 *   2. the @hasna/paths data home (XDG / macOS home layout) once adopted;
 *   3. otherwise the legacy `~/.hasna/workflows` default.
 *
 * Gated legacy adoption: the legacy `~/.hasna/workflows` home stays effective
 * until the store has actually been migrated to the XDG data home
 * (`workflows.db` exists at the resolver home) or the operator sets the
 * data-kind override `HASNA_DATA_HOME`. An existing local store never becomes
 * invisible on upgrade.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataDir } from "@hasna/paths";

/** The workflows app slug used by the @hasna/paths resolver. */
export const APP = "workflows" as const;

/** The store database file name, the marker that a store lives at a data home. */
export const STORE_DB_FILE = "workflows.db";

/**
 * The effective user home, mirroring the pre-existing resolution
 * (`HOME` || `USERPROFILE` || os.homedir()).
 */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["HOME"] || env["USERPROFILE"] || homedir();
}

/** Pre-XDG legacy workflows data home: ~/.hasna/workflows. */
export function getLegacyDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", APP);
}

/**
 * The @hasna/paths-resolved workflows data home (XDG / macOS home layout):
 * `~/.local/share/hasna/workflows` on Linux, `~/Library/Application
 * Support/Hasna/workflows` on macOS. The home override mirrors the
 * pre-existing `$HOME`-first resolution so the resolver follows the same home
 * the legacy path does.
 */
export function getResolverDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: APP, home: getHomeDir(env), env });
}

/**
 * Whether the resolver (XDG) data home should be adopted as the effective
 * workflows data home. The resolver home is adopted only when the operator
 * has set `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to
 * the XDG layout) or the store has already been physically migrated there
 * (`workflows.db` exists). A machine that only redirects another kind (e.g.
 * cache to tmpfs) must NOT have its data home moved, and a live store at the
 * legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataDir(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, STORE_DB_FILE));
}

/**
 * The effective workflows data home: the resolver home once adopted,
 * otherwise the legacy `~/.hasna/workflows` default.
 */
export function getEffectiveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const resolved = getResolverDataDir(env);
  return adoptResolverDataDir(resolved, env) ? resolved : getLegacyDataDir(env);
}
