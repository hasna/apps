/**
 * Database connection for open-domains
 */

import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { MIGRATIONS } from "./migrations.js";

let _db: Database | null = null;

function getDbPath(): string {
  if (process.env["DOMAINS_DB_PATH"]) return process.env["DOMAINS_DB_PATH"];
  if (process.env["HASNA_DOMAINS_DB_PATH"]) return process.env["HASNA_DOMAINS_DB_PATH"];

  const explicit = process.env["DOMAINS_DIR"] ?? process.env["HASNA_DOMAINS_DIR"];
  if (explicit) {
    return join(explicit, "domains.db");
  }

  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const legacyDir = join(home, ".hasna", "domains");
  if (existsSync(legacyDir)) return join(legacyDir, "domains.db");

  const xdgData = process.env["XDG_DATA_HOME"] || join(home, ".local", "share");
  const newDir = join(xdgData, "open-domains");
  migrateDotfile("domains", newDir);
  return join(newDir, "domains.db");
}

function migrateDotfile(name: string, newDir: string): void {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
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
