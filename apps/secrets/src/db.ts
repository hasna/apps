import { Database } from "bun:sqlite";
import { dirname, join } from "path";
import { homedir } from "os";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { assertTestVaultPathAllowed, isTestVaultRedirectContext, testVaultPath } from "./test-isolation.js";

function getDbPath(): string {
  // Support env var overrides
  const envPath = process.env.HASNA_SECRETS_DB_PATH ?? process.env.OPEN_SECRETS_DB;
  if (envPath) {
    // An EXPLICIT path aimed at the operator's own vault is refused (HC-00304).
    assertTestVaultPathAllowed(envPath);
    return envPath;
  }

  // A test process that configured nothing gets a throwaway vault rather than the
  // operator's. Isolation must not depend on every test author remembering to set
  // a path — that is the convention which already failed four times.
  //
  // Gated on the NARROW predicate. Swapping the path is silent, so it must only fire
  // for a process that really is a test run (preload marker, or a `*.test.ts`
  // entrypoint — `bun test` sets both). Keying this on bare NODE_ENV made the shipped
  // CLI discard writes and return empty reads at exit code 0 for anything running
  // under a foreign test runner.
  if (isTestVaultRedirectContext()) return testVaultPath();

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

  // Older vaults created the feedback table with a NOT NULL `service` column (no
  // default) and an `id` column with no generator default. CREATE TABLE IF NOT
  // EXISTS never rewrites an existing table, so canonical inserts — which omit
  // both — fail with "NOT NULL constraint failed: feedback.service". Rebuild the
  // table to the canonical shape, preserving any existing rows.
  rebuildLegacyFeedback(db);

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
 * Rebuild a legacy feedback table (identified by a leftover `service` column) into
 * the canonical schema. The legacy shape had `service TEXT NOT NULL` with no
 * default and an `id` with no generator default, both of which break canonical
 * inserts that omit them. Existing rows are copied across; the dropped `service`
 * value is discarded. No-op when the table is already canonical or absent.
 */
function rebuildLegacyFeedback(db: Database): void {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(feedback)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (cols.size === 0 || !cols.has("service")) return;

  const has = (c: string): boolean => cols.has(c);
  const pick = (c: string, fallback: string): string => (has(c) ? `NULLIF(${c}, '')` : fallback);

  db.exec("BEGIN");
  try {
    db.exec("ALTER TABLE feedback RENAME TO feedback_legacy");
    db.exec(`
      CREATE TABLE feedback (
        id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        message    TEXT NOT NULL,
        email      TEXT,
        category   TEXT DEFAULT 'general',
        version    TEXT,
        machine_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.exec(`
      INSERT INTO feedback (id, message, email, category, version, machine_id, created_at)
      SELECT
        COALESCE(${has("id") ? "NULLIF(id, '')" : "NULL"}, lower(hex(randomblob(16)))),
        message,
        ${pick("email", "NULL")},
        COALESCE(${has("category") ? "NULLIF(category, '')" : "NULL"}, 'general'),
        ${pick("version", "NULL")},
        ${pick("machine_id", "NULL")},
        COALESCE(${has("created_at") ? "NULLIF(created_at, '')" : "NULL"}, datetime('now'))
      FROM feedback_legacy;
    `);
    db.exec("DROP TABLE feedback_legacy");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
