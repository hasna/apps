import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** Env var names for the exact-app data-directory overrides. */
export const HASNA_ACTIONS_DIR_ENV = "HASNA_ACTIONS_DIR";
export const HASNA_ACTIONS_HOME_ENV = "HASNA_ACTIONS_HOME";

/**
 * Resolves the actions data home via the @hasna/paths resolver (XDG / macOS home
 * layout). Once the resolver home is adopted, the store lives at the data home
 * (~/.local/share/hasna/actions on Linux; ~/Library/Application Support/Hasna/actions
 * on macOS). Until then the legacy `~/.hasna/actions` default stays the effective
 * home, so an existing store and its layout never become invisible on upgrade.
 */

/** Pre-XDG default home: ~/.hasna/actions. */
export const LEGACY_HOME_DIR = join(homedir(), ".hasna", "actions");

/** The @hasna/paths-resolved data home for actions (XDG layout). */
export function resolverHome(): string {
  return dataDir({ app: "actions" });
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The resolver
 * home is adopted only when the operator has set `HASNA_DATA_HOME` (the data-kind
 * override — a deliberate opt-in to the XDG layout) or the store has already been
 * physically migrated there (`actions.db` exists). A machine that only redirects
 * another kind (e.g. cache to tmpfs) must NOT have its data home moved, and a live
 * store at the legacy home must never become invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "actions.db"));
}

/** The exact-app override root, when set: `HASNA_ACTIONS_DIR` wins over `HASNA_ACTIONS_HOME`. */
export function exactActionsHome(): string | undefined {
  const dir = process.env[HASNA_ACTIONS_DIR_ENV];
  if (dir && dir.trim()) return dir.trim();
  const home = process.env[HASNA_ACTIONS_HOME_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/**
 * Effective actions data home: an exact-app override (`HASNA_ACTIONS_DIR`, then the
 * `HASNA_ACTIONS_HOME` fallback) wins unconditionally; otherwise the resolver data
 * home once adopted; otherwise the legacy `~/.hasna/actions` default.
 */
export function getActionsHome(): string {
  const exact = exactActionsHome();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(LEGACY_HOME_DIR);
}

/** The live store path — at the root of the effective actions data home. */
export function getDefaultDbPath(): string {
  return join(getActionsHome(), "actions.db");
}
