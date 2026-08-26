import { Database } from "bun:sqlite";
import type { TypedDb } from "../types/db-adapter.js";
import { join } from "node:path";
import { existsSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { effectiveHome, getBrowserHome } from "../lib/app-home.js";
import { ensureOwnerOnlyDir, ensureOwnerOnlyFile, ensureSqliteArtifactsOwnerOnly, sanitizeBrowserDbRow } from "../lib/security.js";

export interface FeedbackInput {
  service?: string;
  version?: string;
  message: string;
  email?: string;
  machineId?: string;
}

export interface FeedbackEntry {
  id: string;
  service: string;
  version: string;
  message: string;
  email: string;
  machine_id: string;
  created_at: string;
}

export function getDataDir(): string {
  const newDir = getBrowserHome();
  const oldDir = join(effectiveHome(), ".browser");

  // Auto-migrate: if old dir exists and new doesn't, copy files over
  if (existsSync(oldDir) && !existsSync(newDir)) {
    ensureOwnerOnlyDir(newDir);
    try {
      for (const file of readdirSync(oldDir)) {
        const oldPath = join(oldDir, file);
        const newPath = join(newDir, file);
        try {
          if (statSync(oldPath).isFile()) {
            copyFileSync(oldPath, newPath);
            ensureOwnerOnlyFile(newPath);
          }
        } catch {
          // Skip files that can't be copied
        }
      }
    } catch {
      // If we can't read old directory, continue with new
    }
  }

  ensureOwnerOnlyDir(newDir);
  return newDir;
}

let _db: TypedDb | null = null;
let _dbPath: string | null = null;

export function getDatabase(path?: string): TypedDb {
  const resolvedPath = path ?? process.env["BROWSER_DB_PATH"] ?? join(getDataDir(), "browser.db");
  // Re-create if path changed (e.g. test isolation)
  if (_db && _dbPath === resolvedPath) return _db;
  if (_db) { try { _db.close(); } catch {} _db = null; }

  ensureSqliteArtifactsOwnerOnly(resolvedPath);

  _db = new Database(resolvedPath) as unknown as TypedDb;
  _dbPath = resolvedPath;
  ensureSqliteArtifactsOwnerOnly(resolvedPath);
  _db.exec("PRAGMA busy_timeout=5000;");
  _db.exec("PRAGMA journal_mode=WAL;");
  _db.exec("PRAGMA foreign_keys=ON;");

  runMigrations(_db);
  ensureSqliteArtifactsOwnerOnly(resolvedPath);
  // Ensure feedback table has `service` column (handle old installs that had different schema)
  try {
    const cols = (_db.query("PRAGMA table_info(feedback)").all() as Array<{ name: string }>).map(c => c.name);
    if (cols.length > 0 && !cols.includes("service")) {
      _db.exec("ALTER TABLE feedback ADD COLUMN service TEXT NOT NULL DEFAULT 'browser'");
    }
  } catch {}
  return _db;
}

export function resetDatabase(): void {
  if (_db) { try { _db.close(); } catch {} }
  _db = null;
  _dbPath = null;
}

export function saveFeedback(input: FeedbackInput, db = getDatabase()): FeedbackEntry {
  const sanitized = sanitizeBrowserDbRow("feedback", {
    message: input.message,
    email: input.email ?? "",
  }, getDataDir());
  const entry: FeedbackEntry = {
    id: randomUUID(),
    service: input.service ?? "browser",
    version: input.version ?? "",
    message: typeof sanitized.message === "string" ? sanitized.message : input.message,
    email: typeof sanitized.email === "string" ? sanitized.email : input.email ?? "",
    machine_id: input.machineId ?? process.env["HOSTNAME"] ?? "",
    created_at: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO feedback (id, service, version, message, email, machine_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.service,
    entry.version,
    entry.message,
    entry.email,
    entry.machine_id,
    entry.created_at,
  );
  return entry;
}

export function listFeedback(limit = 50, db = getDatabase()): FeedbackEntry[] {
  return db
    .query<FeedbackEntry, [number]>(
      "SELECT id, service, version, message, email, machine_id, created_at FROM feedback ORDER BY created_at DESC LIMIT ?"
    )
    .all(limit);
}

function runMigrations(db: TypedDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version   INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrations: Array<{ version: number; sql: string }> = [
    {
      version: 1,
      sql: `
        CREATE TABLE IF NOT EXISTS projects (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL UNIQUE,
          path        TEXT NOT NULL,
          description TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS agents (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          description TEXT,
          session_id  TEXT,
          project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
          working_dir TEXT,
          last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS heartbeats (
          id         TEXT PRIMARY KEY,
          agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          session_id TEXT,
          timestamp  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id         TEXT PRIMARY KEY,
          engine     TEXT NOT NULL,
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
          start_url  TEXT,
          status     TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          closed_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS snapshots (
          id              TEXT PRIMARY KEY,
          session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          url             TEXT NOT NULL,
          title           TEXT,
          html            TEXT,
          screenshot_path TEXT,
          timestamp       TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS network_log (
          id               TEXT PRIMARY KEY,
          session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          method           TEXT NOT NULL,
          url              TEXT NOT NULL,
          status_code      INTEGER,
          request_headers  TEXT,
          response_headers TEXT,
          request_body     TEXT,
          body_size        INTEGER,
          duration_ms      INTEGER,
          resource_type    TEXT,
          timestamp        TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS console_log (
          id          TEXT PRIMARY KEY,
          session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          level       TEXT NOT NULL DEFAULT 'log',
          message     TEXT NOT NULL,
          source      TEXT,
          line_number INTEGER,
          timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS recordings (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          start_url  TEXT,
          steps      TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS crawl_results (
          id         TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          start_url  TEXT NOT NULL,
          depth      INTEGER NOT NULL DEFAULT 1,
          pages      TEXT NOT NULL DEFAULT '[]',
          links      TEXT NOT NULL DEFAULT '[]',
          errors     TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
        CREATE INDEX IF NOT EXISTS idx_snapshots_session ON snapshots(session_id);
        CREATE INDEX IF NOT EXISTS idx_network_log_session ON network_log(session_id);
        CREATE INDEX IF NOT EXISTS idx_console_log_session ON console_log(session_id);
        CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
        CREATE INDEX IF NOT EXISTS idx_heartbeats_agent ON heartbeats(agent_id);
        CREATE INDEX IF NOT EXISTS idx_recordings_project ON recordings(project_id);
        CREATE INDEX IF NOT EXISTS idx_crawl_results_project ON crawl_results(project_id);
      `,
    },
    {
      version: 2,
      sql: `
        -- Gallery entries
        CREATE TABLE IF NOT EXISTS gallery_entries (
          id                    TEXT PRIMARY KEY,
          session_id            TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          project_id            TEXT REFERENCES projects(id) ON DELETE SET NULL,
          url                   TEXT,
          title                 TEXT,
          path                  TEXT NOT NULL,
          thumbnail_path        TEXT,
          format                TEXT,
          width                 INTEGER,
          height                INTEGER,
          original_size_bytes   INTEGER,
          compressed_size_bytes INTEGER,
          compression_ratio     REAL,
          tags                  TEXT NOT NULL DEFAULT '[]',
          notes                 TEXT,
          is_favorite           INTEGER NOT NULL DEFAULT 0,
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Session name column (migration 2 adds it)
        ALTER TABLE sessions ADD COLUMN name TEXT;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name) WHERE name IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_gallery_session ON gallery_entries(session_id);
        CREATE INDEX IF NOT EXISTS idx_gallery_project ON gallery_entries(project_id);
        CREATE INDEX IF NOT EXISTS idx_gallery_favorite ON gallery_entries(is_favorite);
        CREATE INDEX IF NOT EXISTS idx_gallery_created ON gallery_entries(created_at);
      `,
    },
    {
      version: 3,
      sql: `
        -- Session lock/claim for multi-agent ownership
        ALTER TABLE sessions ADD COLUMN locked_by TEXT;
        ALTER TABLE sessions ADD COLUMN locked_at TEXT;
      `,
    },
    {
      version: 4,
      sql: `
        CREATE TABLE IF NOT EXISTS session_events (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          details TEXT DEFAULT '{}',
          timestamp TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, timestamp);
      `,
    },
    {
      version: 5,
      sql: `
        CREATE TABLE IF NOT EXISTS session_tags (
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          tag TEXT NOT NULL,
          PRIMARY KEY (session_id, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_session_tags_tag ON session_tags(tag);
      `,
    },
    {
      version: 6,
      sql: `
        CREATE TABLE IF NOT EXISTS auth_flows (
          id                 TEXT PRIMARY KEY,
          name               TEXT NOT NULL UNIQUE,
          domain             TEXT NOT NULL,
          recording_id       TEXT REFERENCES recordings(id),
          storage_state_path TEXT,
          created_at         TEXT DEFAULT (datetime('now')),
          last_used          TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_auth_flows_domain ON auth_flows(domain);
        CREATE INDEX IF NOT EXISTS idx_auth_flows_name ON auth_flows(name);
      `,
    },
    {
      version: 8,
      sql: `
        CREATE TABLE IF NOT EXISTS datasets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          source_url TEXT,
          source_type TEXT NOT NULL DEFAULT 'page',
          data TEXT NOT NULL DEFAULT '[]',
          schema TEXT,
          row_count INTEGER DEFAULT 0,
          last_refresh TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS api_endpoints (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          url TEXT NOT NULL,
          method TEXT DEFAULT 'GET',
          response_schema TEXT,
          sample_response TEXT,
          status_code INTEGER,
          content_type TEXT,
          discovered_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_api_endpoints_session ON api_endpoints(session_id);
      `,
    },
    {
      version: 9,
      sql: `
        DROP TABLE IF EXISTS script_runs;
        DROP TABLE IF EXISTS script_steps;
        DROP TABLE IF EXISTS scripts;
      `,
    },
    {
      version: 10,
      sql: `
        CREATE TABLE IF NOT EXISTS feedback (
          id TEXT PRIMARY KEY,
          service TEXT NOT NULL DEFAULT 'browser',
          version TEXT DEFAULT '',
          message TEXT NOT NULL,
          email TEXT DEFAULT '',
          machine_id TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `,
    },
    {
      version: 11,
      sql: `
        CREATE TABLE IF NOT EXISTS video_recordings (
          id          TEXT PRIMARY KEY,
          session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
          name        TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'recording',
          path        TEXT,
          download_id TEXT,
          url         TEXT,
          title       TEXT,
          format      TEXT NOT NULL DEFAULT 'webm',
          width       INTEGER NOT NULL,
          height      INTEGER NOT NULL,
          size_bytes  INTEGER,
          duration_ms INTEGER,
          started_at  TEXT NOT NULL DEFAULT (datetime('now')),
          stopped_at  TEXT,
          error       TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_video_recordings_session ON video_recordings(session_id);
        CREATE INDEX IF NOT EXISTS idx_video_recordings_project ON video_recordings(project_id);
        CREATE INDEX IF NOT EXISTS idx_video_recordings_status ON video_recordings(status);
        CREATE INDEX IF NOT EXISTS idx_video_recordings_started ON video_recordings(started_at);
      `,
    },
    {
      version: 12,
      sql: `
        ALTER TABLE sessions ADD COLUMN remote_session_id TEXT;
        ALTER TABLE sessions ADD COLUMN persistence_id TEXT;
        ALTER TABLE sessions ADD COLUMN browser_live_view_url TEXT;
        CREATE INDEX IF NOT EXISTS idx_sessions_remote_session ON sessions(remote_session_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_persistence ON sessions(persistence_id);
      `,
    },
    {
      version: 13,
      sql: `
        DROP TABLE IF EXISTS workflows;
      `,
    },
    {
      version: 14,
      sql: `
        DROP TABLE IF EXISTS script_runs;
        DROP TABLE IF EXISTS script_steps;
        DROP TABLE IF EXISTS scripts;
        DROP TABLE IF EXISTS cron_events;
        DROP TABLE IF EXISTS cron_jobs;
        DROP TABLE IF EXISTS watch_events;
        DROP TABLE IF EXISTS watch_jobs;
      `,
    },
  ];

  db.exec("BEGIN IMMEDIATE;");
  try {
    const applied = new Set(
      (db.query("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
        (r) => r.version
      )
    );

    for (const m of migrations) {
      if (!applied.has(m.version)) {
        db.exec(m.sql);
        db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(m.version);
        applied.add(m.version);
      }
    }
    db.exec("COMMIT;");
  } catch (err) {
    try { db.exec("ROLLBACK;"); } catch {}
    throw err;
  }
}
