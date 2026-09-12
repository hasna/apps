import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { hasInstructionsEnvAuthorityIntent } from "../lib/local-opt-in.js";
import { getRawStoreRoot } from "../lib/raw-store-root.js";

// Pure helpers, re-exported so every existing importer keeps working. They now
// live in ../lib/ids.ts because importing them from HERE pulled bun:sqlite into
// the CLI and MCP bundles (W12 fail-closed residue, 2026-09-11).
export { now, slugify, uuid } from "../lib/ids.js";

function getDbPath(): string {
  if (process.env["HASNA_INSTRUCTIONS_DB_PATH"]) {
    return process.env["HASNA_INSTRUCTIONS_DB_PATH"];
  }
  const dir = getRawStoreRoot();
  mkdirSync(dir, { recursive: true });
  return join(dir, "instructions.db");
}

const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'file',
    category TEXT NOT NULL,
    agent TEXT NOT NULL DEFAULT 'global',
    target_path TEXT,
    format TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL DEFAULT '',
    description TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    is_template INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS config_snapshots (
    id TEXT PRIMARY KEY,
    config_id TEXT NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profile_configs (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    config_id TEXT NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, config_id)
  );

  CREATE TABLE IF NOT EXISTS machines (
    id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL UNIQUE,
    os TEXT,
    last_applied_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  );

  INSERT OR IGNORE INTO schema_version (version) VALUES (1);
  `,
  `
  ALTER TABLE profiles ADD COLUMN selectors TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE profiles ADD COLUMN variables TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE machines ADD COLUMN arch TEXT;
  `,
  `
  ALTER TABLE configs ADD COLUMN outputs TEXT NOT NULL DEFAULT '[]';
  `,
  `
  ALTER TABLE profile_configs ADD COLUMN binding TEXT NOT NULL DEFAULT '{"schema":"hasna.instructions.profile-config-binding/v1","activation":{"mode":"always"},"required":true,"fallback":"fail"}';
  `,
  `
  CREATE TABLE IF NOT EXISTS profile_assets (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    source_config_id TEXT NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
    asset_key TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    binding TEXT NOT NULL,
    PRIMARY KEY (profile_id, asset_key)
  );
  CREATE INDEX IF NOT EXISTS profile_assets_source_config_idx ON profile_assets (source_config_id);
  `,
];

let _db: Database | null = null;

export function getDatabase(path?: string): Database {
  if (_db) return _db;
  // The on-box SQLite store must never be opened by a process whose environment
  // configures a hosted Instructions authority or credential. Opening it there
  // is SILENT LOCAL DRIFT — every read and write lands in a different store
  // than the one the run is configured against, and nothing about the run looks
  // wrong — so it fails loudly instead.
  //
  // This is a data-safety invariant, NOT a transport gate. Routing already
  // happens at resolveConfigStore() (which never returns LocalConfigStore once
  // the environment configures an authority), so no command reaches here in a
  // hosted run. The public `LocalConfigStore` class IS a public SDK export,
  // however, so a consumer can call this directly and bypass that routing
  // entirely (hasna/apps#1886 review finding P1). That is the case this guard
  // exists for.
  //
  // The deliberate opt-out is explicit: pass a `path` (as the tests do) or an
  // injected `Database`. The check reads the ENVIRONMENT alone — never the
  // Keychain or the credential files, whose reads would break the hermetic
  // opt-in short-circuit.
  if (!path && hasInstructionsEnvAuthorityIntent(process.env)) {
    throw new Error(
      "instructions: refusing to open the on-box SQLite store — the environment configures a hosted " +
        "Instructions authority or credential (HASNA_INSTRUCTIONS_*), and reading or writing the local store " +
        "here would silently drift from the shared dataset. Pass an explicit database path (or an injected " +
        "Database) to work against the on-box store deliberately.",
    );
  }
  const dbPath = path || getDbPath();
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  applyMigrations(db);
  ensureFeedbackTable(db);
  _db = db;
  return db;
}

export function resetDatabase(): void {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
  }
  _db = null;
}

/**
 * Destroy the on-disk local database: close the handle and delete the db file
 * plus its WAL/SHM sidecars. Used by `init --force`. Resolves the path from the
 * db module (honoring HASNA_INSTRUCTIONS_DB_PATH); a no-op for the
 * in-memory (`:memory:`) database. Only the on-box SQLite store calls this —
 * destroying the shared cloud store from a client is forbidden.
 */
export function resetLocalDatabase(): void {
  resetDatabase();
  const dbPath = getDbPath();
  if (dbPath === ":memory:") return;
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(p)) rmSync(p);
  }
}

function applyMigrations(db: Database): void {
  let currentVersion = 0;
  try {
    const row = db.query<{ version: number }, []>(
      "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
    ).get();
    currentVersion = row?.version ?? 0;
  } catch {
    // schema_version doesn't exist yet — fresh DB, start from 0
    currentVersion = 0;
  }

  const applyOne = db.transaction((index: number) => {
    if (!migrationEffectAlreadyPresent(db, index)) db.exec(MIGRATIONS[index]!);
    db.run(`INSERT OR REPLACE INTO schema_version (version) VALUES (${index + 1})`);
  });
  for (let i = currentVersion; i < MIGRATIONS.length; i++) applyOne(i);
}

function migrationEffectAlreadyPresent(db: Database, index: number): boolean {
  // Migration 4 can be observed in this state after an interrupted older
  // process: its ALTER committed but schema_version still says 3. Treat the
  // column as the durable effect, preserve its rows, and finish the receipt.
  if (index !== 3) return false;
  return db.query<{ name: string }, []>("PRAGMA table_info(profile_configs)").all()
    .some((column) => column.name === "binding");
}

function ensureFeedbackTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      message TEXT NOT NULL,
      email TEXT,
      category TEXT DEFAULT 'general',
      version TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Older databases created the feedback table before these columns existed.
  // CREATE TABLE IF NOT EXISTS won't backfill them, so insertFeedback would fail
  // with "table feedback has no column named category". Add any missing column
  // idempotently so both fresh and legacy on-disk stores accept the same insert.
  const existing = new Set(
    db
      .query<{ name: string }, []>("PRAGMA table_info(feedback)")
      .all()
      .map((r) => r.name),
  );
  const required: Array<[string, string]> = [
    ["email", "TEXT"],
    ["category", "TEXT DEFAULT 'general'"],
    ["version", "TEXT"],
    ["machine_id", "TEXT"],
    ["created_at", "TEXT"],
  ];
  for (const [name, def] of required) {
    if (!existing.has(name)) db.exec(`ALTER TABLE feedback ADD COLUMN ${name} ${def}`);
  }
}

export interface FeedbackInput {
  message: string;
  email?: string | null;
  category?: string | null;
  version?: string | null;
}

export function insertFeedback(input: FeedbackInput, db?: Database): void {
  const d = db || getDatabase();
  d.run(
    "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
    [input.message, input.email ?? null, input.category ?? "general", input.version ?? null],
  );
}
