/**
 * App-home resolution for @hasna/hooks — routes the local data root through
 * the @hasna/paths resolver (XDG / macOS home layout) with gated legacy
 * adoption.
 *
 * The XDG home migration (hotfixes plan 0f49f56a, task P3.3) moves the store
 * from `~/.hasna/hooks` toward `~/.local/share/hasna/hooks` on Linux and
 * `~/Library/Application Support/Hasna/hooks` on macOS. Nothing moves on disk
 * in this phase — the resolver root is adopted only when the operator has
 * deliberately opted in (`HASNA_DATA_HOME`) or the store has already been
 * physically migrated there, so a live store at the legacy home never becomes
 * invisible on upgrade.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** The store DB file whose presence at a root marks it as the live store. */
const STORE_MARKER = "hooks.db";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME || env.USERPROFILE || homedir();
}

/**
 * The @hasna/paths-resolved (XDG / macOS layout) data root for hooks: the
 * forward-looking home the XDG migration moves the store toward. The home
 * override mirrors the pre-existing $HOME-first resolution so the resolver
 * follows the same home the legacy path does.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: "hooks", home: getHomeDir(env), env });
}

/** The legacy (pre-XDG) data root: ~/.hasna/hooks */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "hooks");
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective data
 * root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there (`hooks.db`
 * exists). A machine that only redirects another kind (e.g. cache to tmpfs)
 * must NOT have its data home moved, and a live store at the legacy home must
 * never become invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, STORE_MARKER));
}

/**
 * The granular data-dir override root, when set: `HASNA_HOOKS_DATA_DIR`, then
 * `HOOKS_DATA_DIR`. This preserves the pre-existing exact-data-dir override
 * behavior verbatim (first-nonblank; a set-but-empty value falls through).
 */
export function getExplicitDataDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env.HASNA_HOOKS_DATA_DIR ?? env.HOOKS_DATA_DIR;
  if (typeof dir === "string" && dir.trim().length > 0) return dir.trim();
  return undefined;
}

/**
 * The exact-app override root, when set: `HASNA_HOOKS_HOME`, then `HOOKS_HOME`.
 * First-nonblank selection: a set-but-whitespace override must not suppress a
 * valid fallback (the same `?.trim() ||` semantics the emails lane settled as
 * release-review P1).
 */
export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env.HASNA_HOOKS_HOME?.trim() || env.HOOKS_HOME?.trim();
  if (dir) return resolve(dir);
  return undefined;
}

/**
 * The effective data root for hooks. Precedence: the granular data-dir
 * override (`HASNA_HOOKS_DATA_DIR`/`HOOKS_DATA_DIR`) wins; then the exact-app
 * override (`HASNA_HOOKS_HOME`/`HOOKS_HOME`); then the resolver (XDG) data
 * root once adopted; then the legacy `~/.hasna/hooks` default — a live store
 * never becomes invisible on upgrade. Store/lock/config paths are layered on
 * top of this by their own overrides, so an explicit path always wins
 * regardless.
 */
export function getEffectiveDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = getExplicitDataDir(env);
  if (explicit) return explicit;
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  const resolved = getResolverDataRoot(env);
  return adoptResolverDataRoot(resolved, env) ? resolve(resolved) : getLegacyDataRoot(env);
}

/**
 * The SQLite store path surfaced by help/status surfaces (e.g. `hooks log`,
 * registry hook descriptions). The explicit `HASNA_HOOKS_DB_PATH` /
 * `HOOKS_DB_PATH` override wins; otherwise `hooks.db` under the effective data
 * root. A status surface must never hardcode the legacy literal — the store can
 * live at the resolver home once adopted.
 */
export function getReportedDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = getExplicitDbPath(env);
  if (explicit) return explicit;
  return join(getEffectiveDataRoot(env), "hooks.db");
}

/** The explicit DB-path override, when set: `HASNA_HOOKS_DB_PATH`, then `HOOKS_DB_PATH`. */
function getExplicitDbPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const db = env.HASNA_HOOKS_DB_PATH ?? env.HOOKS_DB_PATH;
  if (typeof db === "string" && db.trim().length > 0) return db.trim();
  return undefined;
}
