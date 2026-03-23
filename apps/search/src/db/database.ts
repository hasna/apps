import { Database } from "bun:sqlite";
import { SqliteAdapter, ensureFeedbackTable, migrateDotfile } from "@hasna/cloud";
import { mkdirSync } from "fs";
import { runMigrations } from "./migrations";

let instance: Database | null = null;
let _adapter: SqliteAdapter | null = null;

function resolveDbPath(): string {
  // Support env var overrides
  const envPath = Bun.env.HASNA_SEARCH_DB_PATH ?? Bun.env.SEARCH_DB_PATH;
  if (envPath) return envPath;

  const home = Bun.env.HOME ?? "/tmp";
  migrateDotfile("search");
  const newDir = `${home}/.hasna/search`;
  mkdirSync(newDir, { recursive: true });
  return `${newDir}/data.db`;
}

export function getDb(): Database {
  if (instance) return instance;

  const path = resolveDbPath();
  _adapter = new SqliteAdapter(path);
  const db = _adapter.raw;

  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");

  runMigrations(db);
  ensureFeedbackTable(_adapter);

  instance = db;
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
    _adapter = null;
  }
}

export function getDbForTesting(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");
  runMigrations(db);
  return db;
}
