import { SqliteAdapter as Database } from "@hasna/cloud";
import { homedir } from "os";
import { join, dirname } from "path";
import { mkdirSync, existsSync, copyFileSync, readdirSync, statSync } from "fs";

export function getDataDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const newDir = join(home, ".hasna", "styles");
  const oldDir = join(home, ".styles");

  // Auto-migrate old dir to new location
  if (existsSync(oldDir) && !existsSync(newDir)) {
    mkdirSync(newDir, { recursive: true });
    for (const file of readdirSync(oldDir)) {
      const oldPath = join(oldDir, file);
      if (statSync(oldPath).isFile()) {
        copyFileSync(oldPath, join(newDir, file));
      }
    }
  }

  mkdirSync(newDir, { recursive: true });
  return newDir;
}

export const DB_PATH = join(getDataDir(), "styles.db");

let _db: Database | null = null;
let _dbPath: string = DB_PATH;

export function resetDb(): void {
  if (_db) { try { _db.close(); } catch { /* ignore */ } }
  _db = null;
}

export function setDbPath(path: string): void {
  resetDb();
  _dbPath = path;
}

export function getDb(): Database {
  if (_db) return _db;
  _db = initDb();
  return _db;
}

export function initDb(): Database {
  const dir = dirname(_dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(_dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS style_profiles (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      principles TEXT DEFAULT '[]',
      anti_patterns TEXT DEFAULT '[]',
      typography TEXT DEFAULT '{}',
      colors TEXT DEFAULT '{}',
      component_rules TEXT DEFAULT '{}',
      tags TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS preferences (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      project_path TEXT,
      updated_at INTEGER NOT NULL,
      UNIQUE(key, scope, project_path)
    );

    CREATE TABLE IF NOT EXISTS project_configs (
      id TEXT PRIMARY KEY,
      project_path TEXT UNIQUE NOT NULL,
      profile_id TEXT,
      active_template_id TEXT,
      custom_overrides TEXT DEFAULT '{}',
      hook_installed INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      style_profile_id TEXT,
      variables TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS health_checks (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      run_at INTEGER NOT NULL,
      violations TEXT DEFAULT '[]',
      score INTEGER NOT NULL DEFAULT 100,
      status TEXT NOT NULL DEFAULT 'pass',
      cerebras_used INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS health_violations (
      id TEXT PRIMARY KEY,
      check_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      rule TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'warning',
      auto_task_id TEXT
    );

    CREATE TABLE IF NOT EXISTS extracted_style_kits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      tokens TEXT NOT NULL,
      raw TEXT,
      screenshot TEXT,
      tags TEXT DEFAULT '[]',
      notes TEXT,
      extracted_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_presence (
      id TEXT NOT NULL DEFAULT '',
      agent TEXT PRIMARY KEY,
      session_id TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      project_id TEXT,
      status TEXT NOT NULL DEFAULT 'online',
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      message TEXT NOT NULL,
      email TEXT,
      category TEXT DEFAULT 'general',
      version TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  _db = db;
  return db;
}
