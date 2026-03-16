import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

let db: Database | null = null;

function getDbPath(): string {
  if (process.env["SIGNATURES_DB_PATH"]) {
    return process.env["SIGNATURES_DB_PATH"];
  }

  // Check for git root .signatures/
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, ".git"))) {
      const localPath = join(dir, ".signatures", "signatures.db");
      mkdirSync(dirname(localPath), { recursive: true });
      return localPath;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Default global
  const globalPath = join(homedir(), ".signatures", "signatures.db");
  mkdirSync(dirname(globalPath), { recursive: true });
  return globalPath;
}

export function getDatabase(): Database {
  if (db) return db;

  const path = getDbPath();
  const isMemory = path === ":memory:";

  db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  runMigrations(db);
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function runMigrations(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    database
      .query<{ name: string }, []>("SELECT name FROM migrations")
      .all()
      .map((r: { name: string }) => r.name)
  );

  for (const [name, sql] of MIGRATIONS) {
    if (!applied.has(name)) {
      database.exec(sql);
      database
        .query("INSERT INTO migrations (name) VALUES (?)")
        .run(name);
    }
  }
}

const MIGRATIONS: [string, string][] = [
  [
    "001_initial_schema",
    `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT NOT NULL DEFAULT 'application/pdf',
      status TEXT NOT NULL DEFAULT 'draft',
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_tags (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (document_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS signatures (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      font_family TEXT,
      font_size INTEGER NOT NULL DEFAULT 48,
      color TEXT NOT NULL DEFAULT '#000000',
      text_value TEXT,
      image_path TEXT,
      image_prompt TEXT,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signature_fields (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL,
      height REAL,
      field_type TEXT NOT NULL DEFAULT 'signature',
      label TEXT,
      required INTEGER NOT NULL DEFAULT 1,
      detected INTEGER NOT NULL DEFAULT 0,
      assigned_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signature_placements (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      signature_id TEXT NOT NULL REFERENCES signatures(id) ON DELETE CASCADE,
      field_id TEXT REFERENCES signature_fields(id) ON DELETE SET NULL,
      page INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL,
      height REAL,
      signed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signing_sessions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      signer_name TEXT,
      signer_email TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      token TEXT UNIQUE NOT NULL,
      source TEXT NOT NULL DEFAULT 'local',
      connector_name TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      id UNINDEXED,
      name,
      description,
      file_name,
      content='documents',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
      INSERT INTO documents_fts(rowid, id, name, description, file_name)
      VALUES (new.rowid, new.id, new.name, new.description, new.file_name);
    END;

    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, id, name, description, file_name)
      VALUES ('delete', old.rowid, old.id, old.name, old.description, old.file_name);
      INSERT INTO documents_fts(rowid, id, name, description, file_name)
      VALUES (new.rowid, new.id, new.name, new.description, new.file_name);
    END;

    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, id, name, description, file_name)
      VALUES ('delete', old.rowid, old.id, old.name, old.description, old.file_name);
    END;

    CREATE VIRTUAL TABLE IF NOT EXISTS signatures_fts USING fts5(
      id UNINDEXED,
      name,
      text_value,
      content='signatures',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS signatures_ai AFTER INSERT ON signatures BEGIN
      INSERT INTO signatures_fts(rowid, id, name, text_value)
      VALUES (new.rowid, new.id, new.name, new.text_value);
    END;

    CREATE TRIGGER IF NOT EXISTS signatures_au AFTER UPDATE ON signatures BEGIN
      INSERT INTO signatures_fts(signatures_fts, rowid, id, name, text_value)
      VALUES ('delete', old.rowid, old.id, old.name, old.text_value);
      INSERT INTO signatures_fts(rowid, id, name, text_value)
      VALUES (new.rowid, new.id, new.name, new.text_value);
    END;

    CREATE TRIGGER IF NOT EXISTS signatures_ad AFTER DELETE ON signatures BEGIN
      INSERT INTO signatures_fts(signatures_fts, rowid, id, name, text_value)
      VALUES ('delete', old.rowid, old.id, old.name, old.text_value);
    END;
    `,
  ],
];
