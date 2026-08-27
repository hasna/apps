import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/**
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. A home that cannot be resolved is a hard error — never
 * a literal "~" path (relative to cwd) and never an "undefined"-prefixed path.
 */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (!home) {
    throw new Error("Unable to resolve the user's home directory");
  }
  return home;
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for orgs.
 * This is the forward-looking home the XDG migration (hotfixes plan
 * 0f49f56a, task P3.3) moves the store toward: `~/.local/share/hasna/orgs`
 * on Linux, `~/Library/Application Support/Hasna/orgs` on macOS. The home
 * override mirrors the pre-existing $HOME-first resolution so the resolver
 * follows the same home the legacy path does.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: "orgs", home: getHomeDir(env), env });
}

/** The legacy (pre-XDG) data root: ~/.hasna/orgs */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "orgs");
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`orgs.json` exists). A machine that only redirects another kind (e.g.
 * cache to tmpfs) must NOT have its data home moved, and a live store at the
 * legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "orgs.json"));
}

/** The exact-app override root, when set: `HASNA_ORGS_HOME`. */
export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env.HASNA_ORGS_HOME;
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * The effective data root: an exact-app override (`HASNA_ORGS_HOME`) wins
 * unconditionally; otherwise the resolver (XDG) data root once adopted;
 * otherwise the legacy `~/.hasna/orgs` default. The store path
 * (`OPEN_ORGS_STORE`) and audit path (`OPEN_ORGS_AUDIT`) are layered on top
 * of this by the store layer, so an explicit store/audit path always wins.
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  const resolved = getResolverDataRoot(env);
  return adoptResolverDataRoot(resolved, env) ? resolve(resolved) : getLegacyDataRoot(env);
}
