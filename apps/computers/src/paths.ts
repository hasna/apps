import { createHash } from "node:crypto";
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface DbMigrationReceipt {
  migrated: boolean;
  from?: string;
  to?: string;
  reason?: "canonical-data-exists" | "no-legacy-data" | "legacy-not-a-file" | "copy-verification-failed";
}

/**
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. The canonical data root is ~/.hasna/computers, so a
 * home that cannot be resolved is a hard error — never a literal "~" path
 * (relative to cwd) and never an "undefined"-prefixed path.
 */
export function getHomeDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  if (!home || home === "~") {
    throw new Error("Cannot resolve the home directory: set HOME (or USERPROFILE) and try again");
  }
  return home;
}

/** Canonical data root: ~/.hasna/computers */
export function getDataRoot(): string {
  return join(getHomeDir(), ".hasna", "computers");
}

/** Canonical default database path: ~/.hasna/computers/computers.db */
export function getDefaultDbPath(): string {
  return join(getDataRoot(), "computers.db");
}

function filesEqual(a: string, b: string): boolean {
  if (statSync(a).size !== statSync(b).size) return false;
  return hashFile(a) === hashFile(b);
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * One-time migration of the legacy cwd-relative default (./computers.db) into
 * the canonical data root (~/.hasna/computers/computers.db). Idempotent and
 * resumable: it never runs when the canonical path already holds data, it
 * never overwrites an existing canonical database, it never deletes the
 * legacy file (copy + verify + flag), and it records a receipt next to the
 * migrated database. A copy that fails verification is removed (the copy is
 * our own staging artifact, never user data) and reported as not migrated.
 */
export function migrateLegacyDb(cwd = process.cwd()): DbMigrationReceipt {
  const target = getDefaultDbPath();
  if (existsSync(target)) return { migrated: false, reason: "canonical-data-exists" };
  const legacy = resolve(cwd, "computers.db");
  if (!existsSync(legacy)) return { migrated: false, reason: "no-legacy-data" };
  if (!statSync(legacy).isFile()) return { migrated: false, reason: "legacy-not-a-file" };

  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const staging = `${target}.migrating`;
  rmSync(staging, { force: true }); // our own staging artifact from an interrupted run
  copyFileSync(legacy, staging);
  if (!filesEqual(legacy, staging)) {
    rmSync(staging, { force: true });
    return { migrated: false, reason: "copy-verification-failed" };
  }
  try {
    // Atomic, no-clobber publish: linkSync fails with EEXIST if a canonical
    // database appeared concurrently, so the target is never overwritten.
    linkSync(staging, target);
    rmSync(staging, { force: true });
  } catch (error) {
    rmSync(staging, { force: true });
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { migrated: false, reason: "canonical-data-exists" };
    throw error;
  }
  try {
    writeFileSync(
      join(dirname(target), "migration-receipt.json"),
      JSON.stringify({ from: legacy, to: target, migratedAt: new Date().toISOString() }, null, 2) + "\n",
      { flag: "wx" },
    );
  } catch {
    // The receipt is best-effort; the migrated database itself is the durable record.
  }
  return { migrated: true, from: legacy, to: target };
}

/**
 * Resolve the database path for a command. An explicit value (--db flag or
 * COMPUTERS_DB) and ":memory:" win unchanged. The default is the canonical
 * ~/.hasna/computers/computers.db, with a one-time migration of a
 * cwd-relative ./computers.db into it.
 */
export function resolveDbPath(raw: string | undefined, cwd = process.cwd()): string {
  if (raw === ":memory:") return raw;
  if (raw !== undefined) return resolve(raw);
  migrateLegacyDb(cwd);
  return getDefaultDbPath();
}
