/**
 * Test helpers for DB modules.
 *
 * Because every CRUD module imports `getDb()` from `./database.js` (which returns
 * a singleton backed by a real file using better-sqlite3), we use `mock.module`
 * to replace `getDb` with one that returns a bun:sqlite in-memory database.
 *
 * bun:sqlite and better-sqlite3 have compatible APIs for prepare/exec/transaction/close,
 * which is all the CRUD modules use.
 *
 * Usage in each test file:
 *   import { setupTestDb, teardownTestDb } from "./test-helpers.js";
 *   let cleanup: () => void;
 *   beforeEach(() => { cleanup = setupTestDb(); });
 *   afterEach(() => { cleanup(); });
 */

import { Database } from "bun:sqlite";
import { mock } from "bun:test";

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Run the same migration SQL as database.ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE scans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      scanner_types TEXT NOT NULL DEFAULT '[]',
      findings_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      duration_ms INTEGER,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_scans_project ON scans(project_id);
    CREATE INDEX idx_scans_status ON scans(status);

    CREATE TABLE rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      scanner_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      pattern TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_rules_scanner ON rules(scanner_type);
    CREATE INDEX idx_rules_severity ON rules(severity);

    CREATE TABLE findings (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      rule_id TEXT NOT NULL REFERENCES rules(id),
      scanner_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      file TEXT NOT NULL,
      line INTEGER NOT NULL,
      "column" INTEGER,
      end_line INTEGER,
      message TEXT NOT NULL,
      code_snippet TEXT,
      fingerprint TEXT NOT NULL,
      suppressed INTEGER NOT NULL DEFAULT 0,
      suppressed_reason TEXT,
      llm_explanation TEXT,
      llm_fix TEXT,
      llm_exploitability REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_findings_scan ON findings(scan_id);
    CREATE INDEX idx_findings_severity ON findings(severity);
    CREATE INDEX idx_findings_fingerprint ON findings(fingerprint);
    CREATE INDEX idx_findings_file ON findings(file);

    CREATE TABLE policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      block_on_severity TEXT,
      auto_fix INTEGER NOT NULL DEFAULT 0,
      notify INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE baselines (
      id TEXT PRIMARY KEY,
      finding_fingerprint TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_baselines_fingerprint ON baselines(finding_fingerprint);

    CREATE TABLE llm_cache (
      id TEXT PRIMARY KEY,
      finding_fingerprint TEXT NOT NULL,
      analysis_type TEXT NOT NULL,
      result TEXT NOT NULL,
      model TEXT NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_llm_cache_fingerprint ON llm_cache(finding_fingerprint);
    CREATE UNIQUE INDEX idx_llm_cache_lookup ON llm_cache(finding_fingerprint, analysis_type);

    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.prepare("INSERT INTO _migrations (name) VALUES (?)").run("001_initial");

  return db;
}

let _testDb: InstanceType<typeof Database> | null = null;

/**
 * Set up a fresh in-memory DB and mock the database module so all CRUD
 * modules that call `getDb()` get this test DB.
 *
 * Returns a cleanup function that closes the DB.
 */
export function setupTestDb(): () => void {
  _testDb = createTestDb();
  const db = _testDb;

  // Mock database.js so that getDb() returns our bun:sqlite in-memory DB.
  // bun:sqlite and better-sqlite3 share the same API surface for
  // prepare/exec/transaction/close, which is all the CRUD modules use.
  mock.module("./database.js", () => ({
    getDb: () => db,
    getTestDb: () => createTestDb(),
    closeDb: () => {},
  }));

  return () => {
    if (db) {
      try {
        db.close();
      } catch {
        // already closed
      }
    }
    _testDb = null;
  };
}

/**
 * Get the current test DB (for direct assertions).
 */
export function getCurrentTestDb(): InstanceType<typeof Database> {
  if (!_testDb) throw new Error("No test DB -- call setupTestDb() first");
  return _testDb;
}
