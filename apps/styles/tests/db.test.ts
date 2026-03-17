import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";

// We create a test DB at a temp path instead of using the default ~/.styles/styles.db
let tmpDbPath: string;
let db: Database;

function createTestDb(): Database {
  tmpDbPath = join(tmpdir(), `styles-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

  const testDb = new Database(tmpDbPath, { create: true });
  testDb.exec("PRAGMA journal_mode=WAL");
  testDb.exec("PRAGMA foreign_keys=ON");

  testDb.exec(`
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
  `);

  return testDb;
}

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
  if (existsSync(tmpDbPath)) {
    unlinkSync(tmpDbPath);
  }
  // Also clean up WAL files
  const walPath = tmpDbPath + "-wal";
  const shmPath = tmpDbPath + "-shm";
  if (existsSync(walPath)) unlinkSync(walPath);
  if (existsSync(shmPath)) unlinkSync(shmPath);
});

describe("DB initialization", () => {
  test("all tables exist after init", () => {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("style_profiles");
    expect(tableNames).toContain("preferences");
    expect(tableNames).toContain("project_configs");
    expect(tableNames).toContain("templates");
    expect(tableNames).toContain("health_checks");
    expect(tableNames).toContain("health_violations");
  });

  test("WAL mode is enabled", () => {
    const row = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(row.journal_mode).toBe("wal");
  });
});

describe("preferences table", () => {
  test("can insert and retrieve a preference", () => {
    db.run(
      `INSERT INTO preferences (id, key, value, scope, project_path, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), "theme", "dark", "global", null, Date.now()]
    );

    const row = db
      .query("SELECT * FROM preferences WHERE key = 'theme'")
      .get() as { key: string; value: string; scope: string } | null;

    expect(row).toBeDefined();
    expect(row!.key).toBe("theme");
    expect(row!.value).toBe("dark");
    expect(row!.scope).toBe("global");
  });
});

describe("project_configs table", () => {
  test("can insert and retrieve a project_config", () => {
    const id = crypto.randomUUID();
    const projectPath = "/test/project";

    db.run(
      `INSERT INTO project_configs (id, project_path, profile_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [id, projectPath, null, Date.now()]
    );

    const row = db
      .query("SELECT * FROM project_configs WHERE id = ?")
      .get(id) as { id: string; project_path: string } | null;

    expect(row).toBeDefined();
    expect(row!.project_path).toBe(projectPath);
  });
});
