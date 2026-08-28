import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { scrubLegacyCredentialRows } from "./legacy-credential-scrub.js";
import { getDataRoot, getHomeDir } from "../lib/paths.js";

let _db: Database | null = null;
const DATABASE_INIT_ERROR = "Unable to initialize Shield database safely";

// The retired HASNA_SHIELD_STORAGE_MODE / HASNA_SECURITY_STORAGE_MODE
// variables are deliberately NOT read: storage is local SQLite, selected by
// the environment contract (SECURITY_DB path override) only.

function getDbPath(): string {
  if (process.env.SECURITY_DB) return process.env.SECURITY_DB;
  const projectSecurity = join(process.cwd(), ".security", "shield.db");
  if (existsSync(dirname(projectSecurity))) return projectSecurity;
  const projectShield = join(process.cwd(), ".shield", "shield.db");
  if (existsSync(dirname(projectShield))) return projectShield;

  // Global store: the effective data root's shield.db (with one-time legacy
  // consolidation from ~/.hasna/shield and ~/.security). The data root
  // resolves through the @hasna/paths resolver with gated legacy adoption —
  // see src/lib/paths.ts.
  const dbPath = join(getDataRoot(), "shield.db");
  const legacyShieldPath = join(getHomeDir(), ".hasna", "shield", "shield.db");
  const legacySecurityPath = join(getHomeDir(), ".security", "security.db");
  if (!existsSync(dbPath)) {
    const legacyPath = existsSync(legacyShieldPath)
      ? legacyShieldPath
      : existsSync(legacySecurityPath)
        ? legacySecurityPath
        : null;
    if (legacyPath) {
      mkdirSync(dirname(dbPath), { recursive: true });
      copyFileSync(legacyPath, dbPath);
    }
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  return dbPath;
}

/**
 * Resolves — and prepares, exactly as `getDb()` would — the SQLite file this
 * store lives in, without opening a connection or touching the singleton.
 * `hasna.contract.json` declares that location to fleet tooling, so the
 * contract test asserts the declaration against this resolver instead of a
 * hardcoded string that could silently drift from `getDbPath()`.
 */
export function resolveDbPath(): string {
  return getDbPath();
}

let _postInitCallbacks: Array<(db: Database) => void> = [];
let _initialized = false;

function failDatabaseInitialization(db: Database | null): never {
  // A callback may have closed the original candidate and recursively
  // published a replacement. Detach first, then close every distinct handle
  // involved in the failed initialization so no live singleton can escape.
  const published = _db;
  _db = null;
  _initialized = false;
  const failedHandles = new Set<Database>();
  if (db) failedHandles.add(db);
  if (published) failedHandles.add(published);
  for (const handle of failedHandles) {
    try { handle.close(); } catch {}
  }
  // Do not repeat paths, legacy values, callback text, or SQLite diagnostics.
  throw new Error(DATABASE_INIT_ERROR);
}

export function onDbInit(cb: (db: Database) => void): void {
  _postInitCallbacks.push(cb);
  if (!_initialized) return;
  const db = _db;
  if (!db) {
    // closeDb() intentionally releases the singleton. Defer the newly
    // registered callback until the next successful initialization.
    _initialized = false;
    return;
  }
  try {
    // Pass the published handle: a callback must not re-resolve getDb()
    // through an import seam that tests may mock, or it would run against a
    // different database than the one being initialized.
    cb(db);
    if (_db !== db) throw new Error("database connection changed during initialization");
    db.exec("SELECT 1");
  } catch {
    failDatabaseInitialization(db);
  }
}

export function getDb(): Database {
  if (_db) {
    // Verify the connection is still alive
    try {
      _db.exec("SELECT 1");
    } catch {
      // Stale handle — reset and reconnect
      try { _db.close(); } catch {}
      _db = null;
      _initialized = false;
    }
  }
  if (_db) return _db;
  let db: Database | null = null;
  try {
    const dbPath = getDbPath();
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    runMigrations(db);
    scrubLegacyCredentialRows(db);
    // Publish before callbacks so a callback can safely call getDb() without
    // recursively opening another connection. Initialization is not marked
    // complete until every callback returns and the candidate remains live.
    _db = db;
    if (!_initialized) {
      for (const cb of _postInitCallbacks) cb(db);
      if (_db !== db) throw new Error("database connection changed during initialization");
      db.exec("SELECT 1");
      _initialized = true;
    }
    return db;
  } catch {
    // Never publish or retain a connection whose path preparation, constructor,
    // migrations, credential scrub, or post-init callbacks did not finish. A
    // later call must retry every boundary before state becomes observable.
    failDatabaseInitialization(db);
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function getTestDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}

function runMigrations(db: Database): void {
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
    const applyMigration = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(migration.name);
    });
    if (typeof applyMigration === "function") applyMigration();
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
        rule_id TEXT NOT NULL,
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
  {
    name: "002_feedback",
    sql: `
      CREATE TABLE feedback (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        message TEXT NOT NULL,
        email TEXT,
        category TEXT DEFAULT 'general',
        version TEXT,
        machine_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: "003_supply_chain",
    sql: `
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
      CREATE INDEX idx_advisories_attack_type ON advisories(attack_type);
      CREATE INDEX idx_advisories_detected ON advisories(detected_at);

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
      CREATE INDEX idx_advisory_iocs_type ON advisory_iocs(type);
      CREATE INDEX idx_advisory_iocs_value ON advisory_iocs(value);

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
      CREATE INDEX idx_registry_events_advisory ON registry_events(advisory_id);
    `,
  },
];
