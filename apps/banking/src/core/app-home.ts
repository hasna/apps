import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** Env var name for the exact-app data-directory override. */
export const HASNA_BANKING_HOME_ENV = "HASNA_BANKING_HOME";

/**
 * Resolves the banking data home via the @hasna/paths resolver (XDG / macOS home
 * layout). Once the resolver home is adopted, the store lives at the data home
 * (~/.local/share/hasna/banking on Linux; ~/Library/Application Support/Hasna/banking
 * on macOS). Until then the legacy `~/.hasna/banking` default stays the effective
 * home, so an existing store and its layout never become invisible on upgrade.
 */

/** Pre-XDG default home: ~/.hasna/banking. */
export const LEGACY_HOME_DIR = join(homedir(), ".hasna", "banking");

/** The @hasna/paths-resolved data home for banking (XDG layout). */
export function resolverHome(): string {
  return dataDir({ app: "banking" });
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The resolver
 * home is adopted only when the operator has set `HASNA_DATA_HOME` (the data-kind
 * override — a deliberate opt-in to the XDG layout) or the store has already been
 * physically migrated there (`banking.db` exists). A machine that only redirects
 * another kind (e.g. cache to tmpfs) must NOT have its data home moved, and a live
 * store at the legacy home must never become invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "banking.db"));
}

/** The exact-app override root, when set: `HASNA_BANKING_HOME`. */
export function exactBankingHome(): string | undefined {
  const home = process.env[HASNA_BANKING_HOME_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/**
 * Effective banking data home: an exact-app override (`HASNA_BANKING_HOME`) wins
 * unconditionally; otherwise the resolver data home once adopted; otherwise the
 * legacy `~/.hasna/banking` default.
 */
export function getBankingHome(): string {
  const exact = exactBankingHome();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(LEGACY_HOME_DIR);
}

/** The live store path — at the root of the effective banking data home. */
export function getDefaultDbPath(): string {
  return join(getBankingHome(), "banking.db");
}
