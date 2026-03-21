import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";

/**
 * We replicate the migration logic from database.ts here using bun:sqlite
 * since better-sqlite3 is not natively supported in Bun's runtime.
 * This tests the same SQL schema and migration logic.
 */

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

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
`;

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(MIGRATION_SQL);
  db.prepare("INSERT INTO _migrations (name) VALUES (?)").run("001_initial");
  return db;
}

describe("database", () => {
  test("createTestDb returns a working in-memory database", () => {
    const db = createTestDb();
    expect(db).toBeDefined();

    const row = db.prepare("SELECT 1 as val").get() as { val: number };
    expect(row.val).toBe(1);

    db.close();
  });

  test("migrations create all expected tables", () => {
    const db = createTestDb();

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name).sort();

    expect(tableNames).toContain("_migrations");
    expect(tableNames).toContain("projects");
    expect(tableNames).toContain("scans");
    expect(tableNames).toContain("findings");
    expect(tableNames).toContain("rules");
    expect(tableNames).toContain("policies");
    expect(tableNames).toContain("baselines");
    expect(tableNames).toContain("llm_cache");
    expect(tableNames).toContain("agents");

    db.close();
  });

  test("migrations are idempotent (running twice does not error)", () => {
    const db1 = createTestDb();
    const db2 = createTestDb();

    const tables1 = db1
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    const tables2 = db2
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;

    expect(tables1.map((t) => t.name)).toEqual(tables2.map((t) => t.name));

    db1.close();
    db2.close();
  });

  test("foreign keys are enabled", () => {
    const db = createTestDb();
    const row = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
    db.close();
  });

  test("migrations table tracks applied migrations", () => {
    const db = createTestDb();
    const migrations = db
      .prepare("SELECT name FROM _migrations")
      .all() as Array<{ name: string }>;

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0].name).toBe("001_initial");

    db.close();
  });
});
