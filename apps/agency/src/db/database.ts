/**
 * SQLite database module for @hasna/agency.
 *
 * RECONSTRUCTION (2026-08-20): the published @hasna/agency@0.3.1 tarball
 * shipped no db/database.js module; the bundle carried only the scaffold
 * template that generates this exact module shape (the `databaseTs`
 * generator inside src/commands/new.ts). This file is that template
 * instantiated with name="agency", so the db/cloud-sync load path exists.
 * The runtime CLI does not import it (parity with the published bundle);
 * it is exported from src/index.ts so the ./sdk-style surface resolves.
 */
import { Database } from "bun:sqlite";
import { SqliteAdapter, ensureFeedbackTable, migrateDotfile } from "@hasna/cloud";
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

let _db: Database | null = null;
let _adapter: SqliteAdapter | null = null;

const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `,
  },
];

function getDbPath(): string {
  if (process.env["HASNA_AGENCY_DB_PATH"]) {
    return process.env["HASNA_AGENCY_DB_PATH"]!;
  }
  if (process.env["AGENCY_DB_PATH"]) {
    return process.env["AGENCY_DB_PATH"]!;
  }
  const home = homedir();
  return join(home, ".hasna", "agency", "agency.db");
}

function ensureDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = join(filePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function runMigrations(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);

  for (const migration of MIGRATIONS) {
    const applied = db.query("SELECT id FROM _migrations WHERE id = ?").get(migration.id);
    if (!applied) {
      db.run("BEGIN");
      try {
        db.run(migration.sql);
        db.run("INSERT INTO _migrations (id) VALUES (?)", [migration.id]);
        db.run("COMMIT");
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
    }
  }
}

export function getDatabase(): Database {
  if (_db) return _db;
  const dbPath = getDbPath();
  ensureDir(dbPath);
  _db = new Database(dbPath, { create: true });
  _db.exec("PRAGMA journal_mode=WAL");
  _db.exec("PRAGMA foreign_keys=ON");
  _db.exec("PRAGMA busy_timeout=5000");
  runMigrations(_db);
  return _db;
}

export function getAdapter(): SqliteAdapter {
  if (_adapter) return _adapter;
  const dbPath = getDbPath();
  ensureDir(dbPath);
  _adapter = new SqliteAdapter(dbPath);
  return _adapter;
}

export function resetDatabase(): void {
  _db = null;
  _adapter = null;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  _adapter = null;
}
