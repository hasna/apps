import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, cpSync } from "fs";
import { runMigrations } from "./migrations";

let instance: Database | null = null;

function resolveDbPath(): string {
  // Support env var overrides
  const envPath = Bun.env.HASNA_SEARCH_DB_PATH ?? Bun.env.SEARCH_DB_PATH;
  if (envPath) return envPath;

  const home = Bun.env.HOME ?? "/tmp";
  const newDir = `${home}/.hasna/search`;
  const oldDir = `${home}/.open-search`;

  // Auto-migrate from old location if new dir doesn't exist yet
  if (!existsSync(newDir) && existsSync(oldDir)) {
    try {
      mkdirSync(`${home}/.hasna`, { recursive: true });
      cpSync(oldDir, newDir, { recursive: true });
    } catch {
      // Fall through
    }
  }

  mkdirSync(newDir, { recursive: true });
  return `${newDir}/data.db`;
}

export function getDb(): Database {
  if (instance) return instance;

  const path = resolveDbPath();
  const db = new Database(path, { create: true });

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");

  runMigrations(db);

  instance = db;
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
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
