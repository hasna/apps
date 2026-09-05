/**
 * files data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`the files data root` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the files-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const getHomeDir = resolveEffectiveHome;
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The resolver files data root: kind overrides honored,
 * `the files data root` on macOS, `~/.local/share/hasna/files` on Linux.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolverDataDir({ app: "files", home: getHomeDir(env), env, });
}

/**
 * The pre-ruling legacy root (`the files data root`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "files");
}

export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dataDirOverride = env["HASNA_FILES_DATA_DIR"]?.trim() || env["FILES_DATA_DIR"]?.trim();
  if (dataDirOverride) return resolve(dataDirOverride);
  const dir = env["HASNA_FILES_HOME"]?.trim() || env["FILES_HOME"]?.trim();
  if (dir) return resolve(dir);
  return undefined;
}

/** Alias kept for readability at call sites that want "the files data dir". */
export function getFilesDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return getDataRoot(env);
}

/**
 * The effective data dir, provisioned. Preserves the pre-resolver behavior of
 * `resolveDataDir()` in src/db/database.ts / src/lib/config.ts: the one-time
 * auto-migration copies a legacy `.files` data directory into the effective
 * data root when the root does not yet exist.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = getFilesDataDir(env);
  const oldDir = join(getHomeDir(env), ".files");
  if (!existsSync(dir) && existsSync(oldDir)) {
    mkdirSync(dirname(dir), { recursive: true });
    cpSync(oldDir, dir, { recursive: true });
  }
  return dir;
}

/** The effective data dir, created if missing. */
export function getDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = resolveDataDir(env);
  mkdirSync(dir, { recursive: true });
  return dir;
}


/**
 * The effective files data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  return resolve(getResolverDataRoot(env));
}
