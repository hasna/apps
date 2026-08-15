/**
 * Pure filesystem path helpers for the on-box data directory and SQLite file.
 *
 * These resolve *paths* only — they never open a database handle or import
 * `bun:sqlite`. They are split out of `database.ts` so client code (CLI
 * `backup`/`init`) can reference the on-box paths without importing the SQLite
 * transport, keeping direct SQLite access confined to the LocalStore.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function ensurePrivateDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

export function getDataDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  const hasnaDir = join(home, ".hasna");
  const newDir = join(home, ".hasna", "contacts");
  const oldDir = join(home, ".contacts");

  // Auto-migrate old dir to new location
  if (existsSync(oldDir) && !existsSync(newDir)) {
    ensurePrivateDir(hasnaDir);
    ensurePrivateDir(newDir);
    for (const file of readdirSync(oldDir)) {
      const oldPath = join(oldDir, file);
      if (statSync(oldPath).isFile()) {
        const newPath = join(newDir, file);
        copyFileSync(oldPath, newPath);
        chmodSync(newPath, 0o600);
      }
    }
  }

  ensurePrivateDir(hasnaDir);
  ensurePrivateDir(newDir);
  return newDir;
}

export function getDbPath(): string {
  if (process.env["HASNA_CONTACTS_DB_PATH"]) return process.env["HASNA_CONTACTS_DB_PATH"];
  if (process.env["CONTACTS_DB_PATH"]) return process.env["CONTACTS_DB_PATH"];
  return join(getDataDir(), "contacts.db");
}
