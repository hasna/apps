/**
 * secrets data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/secrets` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the secrets-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { copyFileSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const operatorHome = resolveEffectiveHome;

const SQLITE_DB_FILE = "vault.db";
const SQLITE_SIDECAR_FILES = ["vault.db-wal", "vault.db-shm", "vault.db-journal"] as const;

// ~/.secrets is also the global env-file credential store. Only these non-DB
// files are independently owned by this service; directory trees and every
// other file must stay there. The SQLite DB and its sidecars migrate as a group.
const LEGACY_SERVICE_FILES = [
  "vault.key",
  "vault.key.enc",
  "kms.json",
  "aws.json",
  ".serve-token",
] as const;


/**
 * The resolver secrets data root: kind overrides honored,
 * `~/.hasna/secrets` on macOS, `~/.local/share/hasna/secrets` on Linux.
 */
export function resolverOperatorDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolverDataDir({ app: "secrets", home: operatorHome(env), env, });
}

/**
 * The pre-ruling legacy root (`~/.hasna/secrets`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyOperatorDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(operatorHome(env), ".hasna", "secrets");
}

function copyOwnedFileIfMissing(legacyDir: string, targetDir: string, name: string): boolean {
  const source = join(legacyDir, name);
  const target = join(targetDir, name);
  if (!existsSync(source) || existsSync(target)) return false;

  // Do not follow a link out of the shared credential store, even when its
  // name happens to match a service-owned file.
  if (!lstatSync(source).isFile()) return false;
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  copyFileSync(source, target);
  return true;
}

/**
 * The effective secrets data root (ruling #1668 — the resolver root IS
 * the convention on every platform); file-level store overrides are layered
 * on top by the individual store layers and always win regardless.
 */
export function effectiveOperatorDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(resolverOperatorDataDir(env));
}

export function ensureOperatorDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const legacyDir = join(operatorHome(env), ".secrets");
  const targetDir = effectiveOperatorDataDir(env);

  if (existsSync(legacyDir)) {
    const copiedVaultDb = copyOwnedFileIfMissing(legacyDir, targetDir, SQLITE_DB_FILE);
    if (copiedVaultDb) {
      for (const name of SQLITE_SIDECAR_FILES) copyOwnedFileIfMissing(legacyDir, targetDir, name);
    }

    for (const name of LEGACY_SERVICE_FILES) {
      copyOwnedFileIfMissing(legacyDir, targetDir, name);
    }
  }

  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  return targetDir;
}