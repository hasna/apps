/**
 * @hasna/domains home resolution — the legacy `~/.hasna/domains` root,
 * resolved through the @hasna/paths resolver (XDG / macOS home layout).
 *
 * The legacy `~/.hasna/domains` default stays the effective home until the
 * XDG data home is adopted — the operator sets `HASNA_DATA_HOME` (the
 * data-kind override — a deliberate opt-in to the XDG layout), or the store
 * has already been physically migrated there (`domains.db` exists at the
 * resolver home) — so an existing local store and config never become
 * invisible on upgrade. An exact-app override (`HASNA_DOMAINS_HOME` /
 * `DOMAINS_HOME`, and the pre-existing `HASNA_DOMAINS_DIR` / `DOMAINS_DIR`
 * names) wins unconditionally and keeps the legacy layout under the override
 * root.
 *
 * Everything accepts an explicit env object (default `process.env`) so the
 * resolver is deterministic in tests and honors the same `$HOME`-first home
 * resolution the package has always used.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

export const APP = "domains" as const;

/** The effective user home, mirroring the pre-existing domains resolution (`HOME` || `USERPROFILE` || os.homedir()). */
export function effectiveHome(env: NodeJS.ProcessEnv = process.env): string {
  return env["HOME"] || env["USERPROFILE"] || homedir();
}

/** Pre-XDG default home: ~/.hasna/domains. */
export function legacyHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(effectiveHome(env), ".hasna", APP);
}

/**
 * The @hasna/paths-resolved data home for domains (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution, and the
 * env object is passed through so `HASNA_DATA_HOME` in the caller's env (not
 * only process.env) is honored.
 */
export function resolverHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = env["HOME"] || env["USERPROFILE"];
  return dataDir({ app: APP, home, env });
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (a deliberate opt-in to the XDG layout) or the store has already been
 * physically migrated there (`domains.db` exists). A machine that only
 * redirects another kind (e.g. cache to tmpfs) must NOT have its data home
 * moved, and a live store at the legacy home must never become invisible on
 * upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "domains.db"));
}

/**
 * The exact-app override root, when set: `HASNA_DOMAINS_HOME` / `DOMAINS_HOME`
 * (the wave-wide names), then the pre-existing `HASNA_DOMAINS_DIR` /
 * `DOMAINS_DIR` aliases. Wins unconditionally and keeps the legacy layout
 * under the override root.
 */
export function exactAppOverride(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override =
    env["HASNA_DOMAINS_HOME"] ??
    env["DOMAINS_HOME"] ??
    env["HASNA_DOMAINS_DIR"] ??
    env["DOMAINS_DIR"];
  return override && override.trim() ? override.trim() : undefined;
}

/**
 * The effective app home: the exact-app override wins unconditionally;
 * otherwise the resolver (XDG) data home once adopted (`HASNA_DATA_HOME` set,
 * or the store already migrated there); otherwise the legacy
 * `~/.hasna/domains` default — an existing store and config never become
 * invisible on upgrade.
 */
export function appHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = exactAppOverride(env);
  if (override) return resolve(override);
  const resolved = resolverHome(env);
  return adoptResolverHome(resolved, env) ? resolve(resolved) : resolve(legacyHomeDir(env));
}

/** The default SQLite db path, at the root of the effective home. */
export function getDefaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(appHome(env), `${APP}.db`);
}

/** The default config path, at the root of the effective home. */
export function getDefaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(appHome(env), "config.json");
}
