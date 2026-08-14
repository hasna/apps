import { copyFileSync, existsSync, lstatSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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

/** Resolve the operator's data directory, migrating only service-owned files. */
export function ensureOperatorDataDir(): string {
  const home = homedir();
  const legacyDir = join(home, ".secrets");
  const targetDir = join(home, ".hasna", "secrets");

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
