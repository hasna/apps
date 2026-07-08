import { Database } from "bun:sqlite";
import { dirname, join } from "path";
import { homedir } from "os";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";

function getDbPath(): string {
  // Support env var overrides
  const envPath = process.env.HASNA_SECRETS_DB_PATH ?? process.env.OPEN_SECRETS_DB;
  if (envPath) return envPath;

  const home = homedir();
  migrateLegacyDotfile("secrets");
  const newDir = join(home, ".hasna", "secrets");
  if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true, mode: 0o700 });
  return join(newDir, "vault.db");
}

function getDbDir(): string {
  return dirname(getDbPath());
}

let _db: Database | null = null;

export function getDb(): Database {
  const path = getDbPath();
  // Open fresh db if path changed (supports test isolation)
  if (_db && (_db as any).filename !== path) {
    _db.close();
    _db = null;
  }
  if (!_db) {
    const dir = getDbDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    _db = new Database(path);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
    migrate(_db);
  }
  return _db;
}

export function closeDb(): void {
  if (_db) { _db.close(); _db = null; }
}

export function resetDb(): void {
  closeDb();
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS secrets (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'other',
      label      TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vault_items (
      id         TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      title      TEXT NOT NULL,
      subtitle   TEXT,
      domains    TEXT NOT NULL DEFAULT '[]',
      tags       TEXT NOT NULL DEFAULT '[]',
      favorite   INTEGER NOT NULL DEFAULT 0,
      data       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_vault_items_kind ON vault_items(kind);
    CREATE INDEX IF NOT EXISTS idx_vault_items_title ON vault_items(title);

    CREATE TABLE IF NOT EXISTS audit_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      action    TEXT NOT NULL,
      key       TEXT NOT NULL,
      agent     TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'human',
      registered_at TEXT NOT NULL,
      last_seen  TEXT
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      message    TEXT NOT NULL,
      email      TEXT,
      category   TEXT DEFAULT 'general',
      version    TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Idempotent column upgrades for vaults created by older versions. CREATE TABLE
  // IF NOT EXISTS never alters an existing table, so pre-existing installs miss
  // columns added later (e.g. feedback.category). Add any missing columns with
  // constant-safe defaults so writes never hit "no such column".
  ensureColumns(db, "feedback", {
    category: "TEXT DEFAULT 'general'",
    version: "TEXT",
    machine_id: "TEXT",
    created_at: "TEXT",
  });
  ensureColumns(db, "users", { type: "TEXT NOT NULL DEFAULT 'human'" });
  ensureColumns(db, "secrets", { label: "TEXT", expires_at: "TEXT" });
}

/**
 * Add any columns in `columns` that the table is missing. Column definitions must
 * use only constant defaults (SQLite forbids non-constant defaults in ADD COLUMN).
 * Table/column names are internal constants — never user input.
 */
function ensureColumns(db: Database, table: string, columns: Record<string, string>): void {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const [name, def] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}

function migrateLegacyDotfile(name: string): void {
  const home = homedir();
  const legacyDir = join(home, `.${name}`);
  const targetDir = join(home, ".hasna", name);
  if (!existsSync(legacyDir) || existsSync(targetDir)) return;
  copyTree(legacyDir, targetDir);
}

function copyTree(source: string, target: string): void {
  const stat = statSync(source);
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const entry of readdirSync(source)) {
      copyTree(join(source, entry), join(target, entry));
    }
    return;
  }
  if (stat.isFile()) {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    if (!existsSync(target)) copyFileSync(source, target);
  }
}
