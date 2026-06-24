import { Database } from "bun:sqlite";
import { SqliteAdapter, ensureFeedbackTable, migrateDotfile } from "@hasna/cloud";
import { dirname, join } from "path";
import { homedir } from "os";
import { chmodSync, existsSync, mkdirSync } from "fs";

const LEGACY_MIGRATION_MARKER_KEY = "legacy-open-secrets-vault";

function getDbPath(): string {
  // Support env var overrides
  const envPath = process.env.HASNA_SECRETS_DB_PATH ?? process.env.OPEN_SECRETS_DB;
  if (envPath) return envPath;

  const home = homedir();
  migrateDotfile("secrets");
  const newDir = join(home, ".hasna", "secrets");
  if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true, mode: 0o700 });
  const dbPath = join(newDir, "vault.db");
  migrateLegacyOpenSecretsVault(dbPath);
  return dbPath;
}

function getDbDir(path = getDbPath()): string {
  return dirname(path);
}

let _db: Database | null = null;
let _adapter: SqliteAdapter | null = null;

export function getDb(): Database {
  const path = getDbPath();
  // Open fresh db if path changed (supports test isolation)
  if (_db && (_db as any).filename !== path) {
    _db.close();
    _db = null;
    _adapter = null;
  }
  if (!_db) {
    const dir = getDbDir(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    _adapter = new SqliteAdapter(path);
    _db = _adapter.raw;
    migrate(_db);
    ensureFeedbackTable(_adapter);
  }
  return _db;
}

export function closeDb(): void {
  if (_db) { _db.close(); _db = null; _adapter = null; }
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
  `);
}

function migrateLegacyOpenSecretsVault(canonicalPath: string): void {
  const legacyPath = join(homedir(), ".open-secrets", "vault.db");
  if (!existsSync(legacyPath)) return;

  const canonicalDir = dirname(canonicalPath);
  if (!existsSync(canonicalDir)) mkdirSync(canonicalDir, { recursive: true, mode: 0o700 });
  const canonicalExisted = existsSync(canonicalPath);
  const canonicalDb = new Database(canonicalPath, { create: true });
  let legacyDb: Database | null = null;

  try {
    migrate(canonicalDb);
    ensureMigrationMetadataTable(canonicalDb);
    if (hasMigrationMarker(canonicalDb)) return;

    try {
      legacyDb = new Database(legacyPath, { readonly: true });
    } catch {
      return;
    }

    try {
      if (!legacyIntegrityOk(legacyDb)) return;
      if (!hasCompatibleLegacySecretsTable(legacyDb)) return;
    } catch {
      return;
    }

    let legacySecrets: LegacySecretRow[];
    let legacyAuditEntries: LegacyAuditRow[] = [];
    try {
      legacySecrets = readLegacySecrets(legacyDb);
      if (hasCompatibleLegacyAuditTable(legacyDb)) {
        legacyAuditEntries = readLegacyAuditEntries(legacyDb);
      }
    } catch {
      return;
    }
    const secretsToImport = legacySecrets.filter((row) => !canonicalSecretExists(canonicalDb, row.key));
    const auditEntriesToImport = legacyAuditEntries.filter((row) => !canonicalAuditEntryExists(canonicalDb, row));

    if (canonicalExisted && (secretsToImport.length > 0 || auditEntriesToImport.length > 0)) {
      backupCanonicalVault(canonicalDb, canonicalDir);
    }

    canonicalDb.exec("BEGIN IMMEDIATE");
    try {
      if (secretsToImport.length > 0) {
        const insertSecret = canonicalDb.prepare(`
          INSERT OR IGNORE INTO secrets (key, value, type, label, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of secretsToImport) {
          insertSecret.run(row.key, row.value, row.type ?? "other", row.label ?? null, row.expires_at ?? null, row.created_at, row.updated_at);
        }
      }

      if (auditEntriesToImport.length > 0) {
        const insertAudit = canonicalDb.prepare(`
          INSERT INTO audit_log (action, key, agent, timestamp)
          VALUES (?, ?, ?, ?)
        `);
        for (const row of auditEntriesToImport) {
          insertAudit.run(row.action, row.key, row.agent, row.timestamp);
        }
      }
      writeMigrationMarker(canonicalDb, legacyPath, secretsToImport.length, auditEntriesToImport.length);

      canonicalDb.exec("COMMIT");
    } catch (error) {
      canonicalDb.exec("ROLLBACK");
      throw error;
    }
  } finally {
    if (legacyDb) legacyDb.close();
    canonicalDb.close();
  }
}

interface LegacySecretRow {
  key: string;
  value: string;
  type: string;
  label: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LegacyAuditRow {
  action: "get" | "set" | "delete";
  key: string;
  agent: string;
  timestamp: string;
}

function ensureMigrationMetadataTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_metadata (
      key TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      migrated_at TEXT NOT NULL,
      imported_secrets INTEGER NOT NULL DEFAULT 0,
      imported_audit_entries INTEGER NOT NULL DEFAULT 0
    )
  `);
}

function hasMigrationMarker(db: Database): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM migration_metadata WHERE key = ?")
      .get(LEGACY_MIGRATION_MARKER_KEY)
  );
}

function writeMigrationMarker(db: Database, legacyPath: string, importedSecrets: number, importedAuditEntries: number): void {
  db.prepare(`
    INSERT INTO migration_metadata (key, source, migrated_at, imported_secrets, imported_audit_entries)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      source = excluded.source,
      migrated_at = excluded.migrated_at,
      imported_secrets = excluded.imported_secrets,
      imported_audit_entries = excluded.imported_audit_entries
  `).run(
    LEGACY_MIGRATION_MARKER_KEY,
    redactHomePath(legacyPath),
    new Date().toISOString(),
    importedSecrets,
    importedAuditEntries
  );
}

function hasCompatibleLegacySecretsTable(db: Database): boolean {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(secrets)").all() as Array<{ name: string }>)
      .map((column) => column.name)
  );
  return ["key", "value", "type", "label", "expires_at", "created_at", "updated_at"].every((name) => columns.has(name));
}

function legacyIntegrityOk(db: Database): boolean {
  const rows = db.prepare("PRAGMA quick_check").all() as Array<Record<string, string>>;
  return rows.length > 0 && rows.every((row) => Object.values(row).every((value) => value === "ok"));
}

function hasCompatibleLegacyAuditTable(db: Database): boolean {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(audit_log)").all() as Array<{ name: string }>)
      .map((column) => column.name)
  );
  return ["action", "key", "agent", "timestamp"].every((name) => columns.has(name));
}

function readLegacySecrets(db: Database): LegacySecretRow[] {
  return db.prepare(`
    SELECT key, value, COALESCE(type, 'other') AS type, label, expires_at, created_at, updated_at
    FROM secrets
    WHERE key IS NOT NULL
      AND value IS NOT NULL
      AND created_at IS NOT NULL
      AND updated_at IS NOT NULL
  `).all() as LegacySecretRow[];
}

function readLegacyAuditEntries(db: Database): LegacyAuditRow[] {
  return db.prepare(`
    SELECT action, key, agent, timestamp
    FROM audit_log
    WHERE action IN ('get', 'set', 'delete')
      AND key IS NOT NULL
      AND agent IS NOT NULL
      AND timestamp IS NOT NULL
  `).all() as LegacyAuditRow[];
}

function canonicalSecretExists(db: Database, key: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM secrets WHERE key = ?").get(key));
}

function canonicalAuditEntryExists(db: Database, row: LegacyAuditRow): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM audit_log WHERE action = ? AND key = ? AND agent = ? AND timestamp = ?")
      .get(row.action, row.key, row.agent, row.timestamp)
  );
}

function backupCanonicalVault(db: Database, canonicalDir: string): void {
  try { chmodSync(canonicalDir, 0o700); } catch { /* best effort for existing dirs */ }
  const backupPath = nextBackupPath(canonicalDir);
  const previousUmask = process.umask(0o077);
  try {
    db.exec(`VACUUM main INTO '${sqlString(backupPath)}'`);
  } finally {
    process.umask(previousUmask);
  }
  chmodSync(backupPath, 0o600);
}

function nextBackupPath(canonicalDir: string): string {
  let timestamp = Date.now();
  let path = join(canonicalDir, `vault.db.pre-open-secrets-migration-${timestamp}.bak`);
  while (existsSync(path)) {
    timestamp++;
    path = join(canonicalDir, `vault.db.pre-open-secrets-migration-${timestamp}.bak`);
  }
  return path;
}

function sqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function redactHomePath(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return "<legacy-open-secrets-vault>";
}
