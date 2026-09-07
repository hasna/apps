/**
 * @hasna/domains LOCAL data home resolution — the on-box SQLite store's root.
 *
 * This is NOT a credential chain. Credentials and the service authority come
 * from the ONE shared resolver in @hasna/contracts (see
 * `../lib/domains-resolver.ts`); this module only answers where the local
 * store lives when the operator explicitly opted into it.
 *
 * The default is the legacy `~/.hasna/domains` root, which IS the shared
 * `~/.hasna` root the resolver's disk tier already reads
 * (`~/.hasna/domains/config/credentials`), so the local data and the
 * credential file stay under one operator-known namespace. When `HASNA_HOME`
 * (the shared root override @hasna/contracts honours) is set, the local data
 * root follows it: `$HASNA_HOME/domains`.
 *
 * STRIPPED (2026-09-06, hasna/apps#1720 class B): the in-package reimplementation
 * of the deleted @hasna/paths resolver, the XDG data/config home layout,
 * `~/.config/hasna` / `$XDG_CONFIG_HOME` / `$XDG_DATA_HOME` consultation, and
 * the one-time migrations from the pre-XDG layout. Nothing in this package
 * consults those locations any more. An exact-app override
 * (`HASNA_DOMAINS_HOME` / `HASNA_DOMAINS_DIR` win over their legacy unprefixed
 * aliases) still names a concrete local store root and keeps the legacy layout
 * under it.
 *
 * Everything accepts an explicit env object (default `process.env`) so the
 * resolver is deterministic in tests.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const APP = "domains" as const;

/** The effective user home, mirroring the pre-existing domains resolution (`HOME` || `USERPROFILE` || os.homedir()). */
export function effectiveHome(env: NodeJS.ProcessEnv = process.env): string {
  return env["HOME"] || env["USERPROFILE"] || homedir();
}

/**
 * The exact-app override root, when set: `HASNA_DOMAINS_HOME` /
 * `HASNA_DOMAINS_DIR` (the canonical names) win over the legacy unprefixed
 * `DOMAINS_HOME` / `DOMAINS_DIR` aliases. Wins unconditionally and keeps the
 * legacy layout under the override root.
 */
export function exactAppOverride(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override =
    env["HASNA_DOMAINS_HOME"] ??
    env["HASNA_DOMAINS_DIR"] ??
    env["DOMAINS_HOME"] ??
    env["DOMAINS_DIR"];
  return override && override.trim() ? override.trim() : undefined;
}

/**
 * The effective local data home: the exact-app override wins unconditionally;
 * otherwise `$HASNA_HOME/domains` (the shared-root override) or the legacy
 * `~/.hasna/domains` default.
 */
export function appDataHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = exactAppOverride(env);
  if (override) return resolve(override);
  const hasnaHome = env["HASNA_HOME"]?.trim();
  if (hasnaHome) return resolve(join(hasnaHome, APP));
  return resolve(join(effectiveHome(env), ".hasna", APP));
}

/** The default SQLite db path, at the root of the effective data home. */
export function getDefaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(appDataHome(env), `${APP}.db`);
}

/** The default config path, at the root of the effective data home. */
export function getDefaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(appDataHome(env), "config.json");
}