import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join, dirname } from "path";
import { mkdirSync, existsSync } from "fs";

export const DB_PATH = join(homedir(), ".styles", "styles.db");

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

  const db = new Database(_dbPath, { create: true });

  // Enable WAL mode for better concurrent read performance
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");

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
  `);

  _db = db;
  return db;
}
