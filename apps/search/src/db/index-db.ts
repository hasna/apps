import { Database } from "bun:sqlite";
import { getConfigDir } from "../lib/config.js";
import { runIndexMigrations } from "./index-migrations.js";

let instance: Database | null = null;

export function getIndexDbPath(): string {
  const envPath = Bun.env.HASNA_SEARCH_INDEX_DB_PATH ?? Bun.env.SEARCH_INDEX_DB_PATH;
  if (envPath) return envPath;

  return `${getConfigDir()}/index.db`;
}

function configure(db: Database): Database {
  // busy_timeout must come first: WAL switching and migrations can hit
  // SQLITE_BUSY from a concurrent process and need the wait behavior.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");
  runIndexMigrations(db);
  return db;
}

export function getIndexDb(): Database {
  if (instance) return instance;
  instance = configure(new Database(getIndexDbPath()));
  return instance;
}

export function closeIndexDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export function getIndexDbForTesting(): Database {
  return configure(new Database(":memory:"));
}
