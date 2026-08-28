import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/**
 * @hasna/snapshots home resolution.
 *
 * @hasna/snapshots stores its sqlite db (`snapshots.sqlite`, WAL sidecars)
 * and its exports / logs / plans subdirectories under a single data home.
 * Historically that home was `~/.hasna/snapshots`. This module resolves it
 * through `@hasna/paths` (XDG / macOS home layout) with a gated legacy
 * adoption: the legacy `~/.hasna/snapshots` stays the effective home until
 * the store is physically migrated to the XDG data home or the operator sets
 * the data-kind override `HASNA_DATA_HOME`. An existing live store never
 * becomes invisible on upgrade. The exact-app override `HASNA_SNAPSHOTS_DIR`
 * (the pre-existing per-app data-dir override) wins unconditionally; the
 * store-path override `HASNA_SNAPSHOTS_DB_PATH` is layered on top of the
 * effective home by `defaultDbPath`.
 */

/** Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then the OS user database. */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (!home) {
    throw new Error("Unable to resolve the user's home directory");
  }
  return home;
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data home for
 * snapshots. This is the forward-looking home the XDG migration (hotfixes
 * plan 0f49f56a, task P3.3) moves the store toward:
 * `~/.local/share/hasna/snapshots` on Linux,
 * `~/Library/Application Support/Hasna/snapshots` on macOS. The home override
 * mirrors the pre-existing $HOME-first resolution so the resolver follows the
 * same home the legacy path does.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: "snapshots", home: getHomeDir(env), env });
}

/** The legacy (pre-XDG) data home: ~/.hasna/snapshots */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "snapshots");
}

/**
 * Whether the resolver (XDG) data home should be adopted as the effective
 * data home. The resolver home is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`snapshots.sqlite` exists). A machine that only redirects another kind
 * (e.g. cache to tmpfs) must NOT have its data home moved, and a live store
 * at the legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "snapshots.sqlite"));
}

/** The exact-app override root, when set: `HASNA_SNAPSHOTS_DIR`. */
export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env["HASNA_SNAPSHOTS_DIR"];
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * The effective data home: an exact-app override (`HASNA_SNAPSHOTS_DIR`) wins
 * unconditionally; otherwise the resolver (XDG) data home once adopted;
 * otherwise the legacy `~/.hasna/snapshots` default. The store path
 * (`HASNA_SNAPSHOTS_DB_PATH`) is layered on top of this by `defaultDbPath`,
 * so an explicit store path always wins regardless.
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  const resolved = getResolverDataRoot(env);
  return adoptResolverDataRoot(resolved, env) ? resolve(resolved) : getLegacyDataRoot(env);
}

/**
 * The default sqlite store path: `HASNA_SNAPSHOTS_DB_PATH` (the pre-existing
 * exact store override) wins unconditionally; otherwise `snapshots.sqlite`
 * under the effective data home.
 */
export function getDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const store = env["HASNA_SNAPSHOTS_DB_PATH"];
  if (store && store.trim()) return resolve(store.trim());
  return join(getDataRoot(env), "snapshots.sqlite");
}
