/**
 * Database connection for open-domains
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { MIGRATIONS } from "./migrations.js";
import {
  exactAppOverride,
  getDefaultDbPath,
  legacyHomeDir,
  resolverHome,
} from "../lib/app-home.js";

let _db: Database | null = null;

function canonicalHome(env: NodeJS.ProcessEnv): string {
  return env["HOME"] || env["USERPROFILE"] || homedir();
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export interface LegacyDataDirMigrationReport {
  dryRun: boolean;
  wouldCopy: string[];
  copied: string[];
}

/**
 * One-time migration from the previous XDG default data directory
 * ($XDG_DATA_HOME/open-domains) into the resolver (ruling #1668) data root —
 * the domains data root on macOS, the XDG data root elsewhere.
 *
 * Copies (never deletes) the SQLite db plus any WAL/SHM sidecars, verifies the
 * copy by size and sha256, and records a receipt next to the canonical db.
 * Idempotent: skipped once the canonical db exists or the receipt is present.
 * Resumable: a crash after the copy but before the receipt is harmless, because
 * the next run sees the canonical db and skips. Existing canonical data is
 * never overwritten. dryRun reports exactly what would be copied and writes
 * nothing.
 */
export function migrateLegacyDataDir(
  env: NodeJS.ProcessEnv = process.env,
  dryRun = false,
): LegacyDataDirMigrationReport {
  const report: LegacyDataDirMigrationReport = { dryRun, wouldCopy: [], copied: [] };
  const home = canonicalHome(env);
  const xdgData = env["XDG_DATA_HOME"]?.trim() || join(home, ".local", "share");
  const oldDir = join(xdgData, "open-domains");
  const oldDb = join(oldDir, "domains.db");
  if (!existsSync(oldDb)) return report;

  const canonicalDir = resolverHome(env);
  const newDb = join(canonicalDir, "domains.db");
  if (existsSync(newDb)) return report;
  if (existsSync(join(canonicalDir, ".migrated-from-xdg.receipt.json"))) return report;

  if (dryRun) {
    for (const name of ["domains.db", "domains.db-wal", "domains.db-shm"]) {
      if (existsSync(join(oldDir, name)) && !existsSync(join(canonicalDir, name))) {
        report.wouldCopy.push(name);
      }
    }
    return report;
  }

  mkdirSync(canonicalDir, { recursive: true });
  const copied: Array<{ name: string; bytes: number; sha256: string }> = [];
  for (const name of ["domains.db", "domains.db-wal", "domains.db-shm"]) {
    const from = join(oldDir, name);
    if (!existsSync(from)) continue;
    const to = join(canonicalDir, name);
    if (existsSync(to)) continue;
    copyFileSync(from, to);
    copied.push({ name, bytes: statSync(to).size, sha256: sha256File(to) });
    report.copied.push(name);
  }

  if (statSync(newDb).size !== statSync(oldDb).size || sha256File(newDb) !== sha256File(oldDb)) {
    throw new Error(
      `Refusing migration: copied ${newDb} does not byte-match ${oldDb}; the canonical root was not populated.`,
    );
  }

  writeFileSync(
    join(canonicalDir, ".migrated-from-xdg.receipt.json"),
    `${JSON.stringify(
      {
        migratedAt: new Date().toISOString(),
        from: oldDir,
        to: canonicalDir,
        files: copied,
      },
      null,
      2,
    )}\n`,
  );
  return report;
}

/**
 * The default data root — the effective domains home, resolved through
 * `@hasna/paths` (legacy `the domains data root` until the XDG data home is
 * adopted). Env overrides (DOMAINS_DB_PATH / HASNA_DOMAINS_DB_PATH) and the
 * exact-app overrides (HASNA_DOMAINS_HOME / DOMAINS_HOME / HASNA_DOMAINS_DIR /
 * DOMAINS_DIR) are honored unchanged and win over the default.
 */
export function getDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env["DOMAINS_DB_PATH"]) return env["DOMAINS_DB_PATH"];
  if (env["HASNA_DOMAINS_DB_PATH"]) return env["HASNA_DOMAINS_DB_PATH"];

  // Exact-app override wins and keeps the legacy layout under the override root.
  const explicit = exactAppOverride(env);
  if (explicit) {
    return join(explicit, "domains.db");
  }

  // The one-time migrations from the pre-XDG layouts target the resolver
  // data root (ruling #1668) and are idempotent.
  migrateLegacyDataDir(env);
  migrateDotfile("domains", resolverHome(env), env);

  return getDefaultDbPath(env);
}

function migrateDotfile(name: string, newDir: string, env: NodeJS.ProcessEnv): void {
  const home = canonicalHome(env);
  const oldDir = join(home, `.${name}`);
  if (!existsSync(oldDir) || existsSync(newDir)) return;
  mkdirSync(newDir, { recursive: true });
  for (const file of readdirSync(oldDir)) {
    const oldPath = join(oldDir, file);
    if (statSync(oldPath).isFile()) copyFileSync(oldPath, join(newDir, file));
  }
}

export function getDatabase(): Database {
  if (_db) return _db;

  const dbPath = getDbPath();
  if (dbPath !== ":memory:") {
    const dir = dirname(resolve(dbPath));
    mkdirSync(dir, { recursive: true });
  }

  _db = new Database(dbPath);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = _db
    .query("SELECT id FROM _migrations ORDER BY id")
    .all() as { id: number }[];
  const appliedIds = new Set(applied.map((r) => r.id));

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) continue;

    _db.exec("BEGIN");
    try {
      _db.exec(migration.sql);
      _db.prepare("INSERT INTO _migrations (id, name) VALUES (?, ?)").run(
        migration.id,
        migration.name
      );
      _db.exec("COMMIT");
    } catch (error) {
      _db.exec("ROLLBACK");
      throw new Error(
        `Migration ${migration.id} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
