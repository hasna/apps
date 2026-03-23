import { Database } from "bun:sqlite";
import { SqliteAdapter, ensureFeedbackTable, migrateDotfile } from "@hasna/cloud";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { runMigrations } from "./migrations";

let instance: Database | null = null;
let _adapter: SqliteAdapter | null = null;

export function getDataDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "/tmp";
  migrateDotfile("crawl");
  const newDir = join(home, ".hasna", "crawl");
  mkdirSync(newDir, { recursive: true });
  return newDir;
}

function resolveDbPath(): string {
  if (Bun.env.HASNA_CRAWL_DB_PATH) {
    return Bun.env.HASNA_CRAWL_DB_PATH;
  }
  if (Bun.env.CRAWL_DB_PATH) {
    return Bun.env.CRAWL_DB_PATH;
  }
  return join(getDataDir(), "data.db");
}

export function getDb(): Database {
  if (instance) return instance;

  const path = resolveDbPath();
  _adapter = new SqliteAdapter(path);
  const db = _adapter.raw;

  db.exec("PRAGMA synchronous = NORMAL");

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
