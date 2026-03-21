import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

let _db: Database.Database | null = null;

function getDbPath(): string {
  if (process.env.OPEN_SECURITY_DB) return process.env.OPEN_SECURITY_DB;
  const local = join(process.cwd(), ".open-security", "security.db");
  if (existsSync(dirname(local))) return local;
  const global = join(homedir(), ".open-security", "security.db");
  mkdirSync(dirname(global), { recursive: true });
  return global;
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = getDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("busy_timeout = 5000");
  runMigrations(_db);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function getTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare("SELECT name FROM _migrations").all().map((r: any) => r.name)
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(migration.name);
    })();
  }
}

const MIGRATIONS = [
  {
    name: "001_initial",
    sql: `
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
    `,
  },
];
