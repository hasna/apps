import { Database } from "bun:sqlite";
import { SqliteAdapter, ensureFeedbackTable } from "@hasna/cloud";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { runMigrations } from "./migrations";

let instance: Database | null = null;
let instancePath: string | null = null;
let _adapter: SqliteAdapter | null = null;

export function getDataDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "/tmp";
  const newDir = join(home, ".hasna", "crawl");
  migrateLegacyDataDir(home, newDir);
  mkdirSync(newDir, { recursive: true });
  return newDir;
}

function copyMissingRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copyMissingRecursive(srcPath, destPath);
      continue;
    }

    // Never overwrite a file that already exists in the canonical root.
    if (!existsSync(destPath)) {
      copyFileSync(srcPath, destPath);
    }
  }
}

function migrateLegacyDataDir(home: string, newDir: string): void {
  // Copy forward any legacy files that are missing from the canonical root —
  // even when the canonical root already exists — without deleting the legacy
  // source or overwriting existing canonical files. `.open-crawl` takes
  // precedence over `.crawl` on name collisions.
  for (const legacyName of [".open-crawl", ".crawl"]) {
    const legacyDir = join(home, legacyName);
    if (!existsSync(legacyDir)) continue;
    if (!statSync(legacyDir).isDirectory()) continue;
    copyMissingRecursive(legacyDir, newDir);
  }
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
  const path = resolveDbPath();
  if (instance && instancePath === path) return instance;
  if (instance) closeDb();

  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  _adapter = new SqliteAdapter(path);
  const db = _adapter.raw;

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");

  runMigrations(db);
  ensureFeedbackTable(_adapter);

  instance = db;
  instancePath = path;
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
    instancePath = null;
    _adapter = null;
  }
}
