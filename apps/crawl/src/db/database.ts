import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { runMigrations } from "./migrations";

let instance: Database | null = null;

function resolveDbPath(): string {
  if (Bun.env.CRAWL_DB_PATH) {
    return Bun.env.CRAWL_DB_PATH;
  }
  const home = Bun.env.HOME ?? "/tmp";
  const dir = `${home}/.open-crawl`;
  mkdirSync(dir, { recursive: true });
  return `${dir}/data.db`;
}

export function getDb(): Database {
  if (instance) return instance;

  const path = resolveDbPath();
  const db = new Database(path, { create: true });

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");

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
