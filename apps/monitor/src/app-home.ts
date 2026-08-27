/**
 * Monitor home resolution — the effective local home for the monitor package,
 * resolved through @hasna/paths.
 *
 * Resolution order:
 *   1. exact-app override — `MONITOR_CONFIG_DIR` (the shipped override), then
 *      the wave-convention alias `HASNA_MONITOR_HOME` — wins unconditionally;
 *   2. the @hasna/paths data home (XDG / macOS home layout) once adopted;
 *   3. otherwise the legacy `~/.hasna/monitor` default.
 *
 * Gated legacy adoption: the legacy `~/.hasna/monitor` home stays effective
 * until the store has actually been migrated to the XDG data home (a
 * `config.json` or `monitor.db` exists at the resolver home) or the operator
 * sets the data-kind override `HASNA_DATA_HOME`. An existing local store never
 * becomes invisible on upgrade.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** Env var name for the exact-app home alias that follows the wave convention. */
export const HASNA_MONITOR_HOME_ENV = "HASNA_MONITOR_HOME";

/**
 * The effective user home, honoring a runtime `HOME` override. `os.homedir()`
 * snapshots `HOME` at process start and (under Bun) ignores later
 * reassignment, so tests that set `process.env.HOME` to a temp dir would
 * otherwise resolve the *real* home. In production `HOME` is set at startup,
 * so this resolves identically.
 */
export function effectiveHome(): string {
  return process.env["HOME"] || homedir();
}

/** Pre-XDG default home: `~/.hasna/monitor`. */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "monitor");
}

/**
 * The @hasna/paths-resolved data home for monitor (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({
    app: "monitor",
    home: process.env["HOME"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) home should be adopted as the monitor home.
 * The resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`config.json` or
 * `monitor.db` exists). A machine that only redirects another kind (e.g. cache
 * to tmpfs) must NOT have its data home moved, and a live store at the legacy
 * home must never become invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return (
    existsSync(join(resolved, "config.json")) ||
    existsSync(join(resolved, "monitor.db"))
  );
}

/**
 * The exact-app override root, when set: the shipped `MONITOR_CONFIG_DIR`
 * wins; `HASNA_MONITOR_HOME` is the wave-convention alias.
 */
export function exactMonitorDir(): string | undefined {
  const dir = process.env["MONITOR_CONFIG_DIR"];
  if (dir && dir.trim()) return dir.trim();
  const home = process.env[HASNA_MONITOR_HOME_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/** Whether an exact-app override root is set (used to skip legacy migration). */
export function hasExactMonitorOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["MONITOR_CONFIG_DIR"]?.trim()) || Boolean(env[HASNA_MONITOR_HOME_ENV]?.trim());
}

/**
 * Effective monitor home: an exact-app override (`MONITOR_CONFIG_DIR`, then
 * the `HASNA_MONITOR_HOME` alias) wins unconditionally; otherwise the resolver
 * (XDG) data home once adopted; otherwise the legacy `~/.hasna/monitor`
 * default.
 */
export function getMonitorDir(): string {
  const exact = exactMonitorDir();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}
