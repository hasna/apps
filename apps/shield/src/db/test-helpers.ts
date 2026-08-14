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

  // 002_feedback
  db.exec(`
    CREATE TABLE feedback (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      message TEXT NOT NULL,
      email TEXT,
      category TEXT DEFAULT 'general',
      version TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare("INSERT INTO _migrations (name) VALUES (?)").run("002_feedback");

  // 003_supply_chain
  db.exec(`
    CREATE TABLE advisories (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      package_name TEXT NOT NULL,
      ecosystem TEXT NOT NULL,
      affected_versions TEXT NOT NULL DEFAULT '[]',
      safe_versions TEXT NOT NULL DEFAULT '[]',
      attack_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'critical',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      cve_id TEXT,
      threat_actor TEXT,
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      tweet_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_advisories_package ON advisories(package_name, ecosystem);
    CREATE INDEX idx_advisories_severity ON advisories(severity);

    CREATE TABLE advisory_iocs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      advisory_id TEXT NOT NULL REFERENCES advisories(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      context TEXT,
      platform TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_advisory_iocs_advisory ON advisory_iocs(advisory_id);

    CREATE TABLE monitored_packages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      ecosystem TEXT NOT NULL,
      last_checked_at TEXT,
      check_interval_ms INTEGER NOT NULL DEFAULT 300000,
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_monitored_packages_name ON monitored_packages(name, ecosystem);

    CREATE TABLE registry_events (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      package_name TEXT NOT NULL,
      version TEXT NOT NULL,
      ecosystem TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      suspicious INTEGER NOT NULL DEFAULT 0,
      analysis TEXT,
      advisory_id TEXT REFERENCES advisories(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_registry_events_package ON registry_events(package_name, ecosystem);
    CREATE INDEX idx_registry_events_suspicious ON registry_events(suspicious);
  `);
  db.prepare("INSERT INTO _migrations (name) VALUES (?)").run("003_supply_chain");

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
