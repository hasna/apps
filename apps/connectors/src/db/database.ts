import { SqliteAdapter } from "./sqlite-adapter.js";

export { SqliteAdapter } from "./sqlite-adapter.js";
export type Database = SqliteAdapter;
import { dirname, join } from "path";
import { mkdirSync, existsSync, readdirSync, copyFileSync, statSync } from "fs";
import { connectorsHome, effectiveHome } from "../lib/paths.js";

function mergeDirectoryContents(sourceDir: string, targetDir: string): void {
  if (!existsSync(sourceDir)) {
    return;
  }

  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);

    try {
      const sourceStat = statSync(sourcePath);

      if (sourceStat.isDirectory()) {
        mergeDirectoryContents(sourcePath, targetPath);
        continue;
      }

      if (!existsSync(targetPath)) {
        copyFileSync(sourcePath, targetPath);
      }
    } catch {
      // Skip entries that can't be copied.
    }
  }
}

/**
 * Get the connectors home directory.
 * Resolved through @hasna/paths (XDG / macOS home layout) with a gated
 * legacy adoption: `~/.hasna/connectors` stays the effective home until the
 * store is migrated to the XDG data home or HASNA_DATA_HOME is set. The
 * exact-app HASNA_CONNECTORS_DIR override wins. Auto-migrates from
 * historical ~/.connectors/ and ~/.connect/ trees into the effective home.
 */
export function getConnectorsHome(): string {
  const newDir = connectorsHome();
  const home = effectiveHome();
  const legacyDirs = [join(home, ".connectors"), join(home, ".connect")];

  mkdirSync(newDir, { recursive: true });

  for (const legacyDir of legacyDirs) {
    try {
      mergeDirectoryContents(legacyDir, newDir);
    } catch {
      // Ignore legacy migration failures and keep using the new directory.
    }
  }

  return newDir;
}

const DB_DIR = getConnectorsHome();
const DB_PATH = join(DB_DIR, "connectors.db");

let _db: SqliteAdapter | null = null;
let _dbPath: string | null = null;

export function getDatabase(path?: string): SqliteAdapter {
  const dbPath = path ?? DB_PATH;
  if (_db) {
    if (_dbPath === dbPath) return _db;
    _db.close();
    _db = null;
    _dbPath = null;
  }
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  _db = new SqliteAdapter(dbPath);
  _dbPath = dbPath;
  _db.run("PRAGMA journal_mode = WAL");
  migrate(_db);
  return _db;
}

export function closeDatabase(): void {
  _db?.close();
  _db = null;
  _dbPath = null;
}

/** ISO timestamp string */
export function now(): string {
  return new Date().toISOString();
}

/** 8-char UUID prefix */
export function shortUuid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function migrate(db: Database): void {
  // Migration 1: agents table
  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      session_id TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Migration 2: resource_locks table for concurrent multi-agent coordination
  db.run(`
    CREATE TABLE IF NOT EXISTS resource_locks (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL CHECK(resource_type IN ('connector', 'agent', 'profile', 'token')),
      resource_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      lock_type TEXT NOT NULL DEFAULT 'exclusive' CHECK(lock_type IN ('advisory', 'exclusive')),
      locked_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_locks_exclusive
      ON resource_locks(resource_type, resource_id)
      WHERE lock_type = 'exclusive'
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_resource_locks_agent ON resource_locks(agent_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_resource_locks_expires ON resource_locks(expires_at)`);

  // Migration 3: connector_rate_usage table
  db.run(`
    CREATE TABLE IF NOT EXISTS connector_rate_usage (
      agent_id TEXT NOT NULL,
      connector TEXT NOT NULL,
      window_start TEXT NOT NULL,
      call_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agent_id, connector, window_start)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_rate_usage_window ON connector_rate_usage(connector, window_start)`);

  // Migration 4: connector_jobs — scheduled connector runs
  db.run(`
    CREATE TABLE IF NOT EXISTS connector_jobs (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      connector TEXT NOT NULL,
      command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '[]',
      cron TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      strip INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_run_at TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_enabled ON connector_jobs(enabled)`);

  // Migration 5: connector_job_runs — output history per job
  db.run(`
    CREATE TABLE IF NOT EXISTS connector_job_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES connector_jobs(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      exit_code INTEGER,
      raw_output TEXT,
      stripped_output TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_job_runs_job ON connector_job_runs(job_id, started_at DESC)`);

  // Migration 6: connector_workflows — sequential pipelines
  db.run(`
    CREATE TABLE IF NOT EXISTS connector_workflows (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  // Migration 7: connector_usage — track connector usage for hot ranking
  db.run(`
    CREATE TABLE IF NOT EXISTS connector_usage (
      id TEXT PRIMARY KEY,
      connector TEXT NOT NULL,
      action TEXT NOT NULL,
      agent_id TEXT,
      timestamp TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_usage_connector ON connector_usage(connector, timestamp DESC)`);

  // Migration 8: connector_promotions — manual hot connector promotion
  db.run(`
    CREATE TABLE IF NOT EXISTS connector_promotions (
      connector TEXT UNIQUE NOT NULL,
      promoted_at TEXT NOT NULL
    )
  `);

  // Migration 9: add project_id to agents for set_focus support
  try {
    db.run(`ALTER TABLE agents ADD COLUMN project_id TEXT`);
  } catch (_) { /* column already exists */ }

  // Migration 10: feedback table
  db.run(`
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
}
