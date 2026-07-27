import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { FEEDBACK_TABLE_SQL, runMigrations } from "./migrations";

let instance: Database | null = null;
let instancePath: string | null = null;

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

/**
 * Replay the idempotent `feedback` schema after the migration ledger has run.
 *
 * Migration 6 owns the table; this re-executes the same statement so the
 * `send_feedback` CLI command and MCP tool cannot hit a missing table on a
 * database whose ledger claims migration 6 was applied.
 */
function ensureFeedbackTable(db: Database): void {
  db.exec(FEEDBACK_TABLE_SQL);
}

export function getDb(): Database {
  const path = resolveDbPath();
  if (instance && instancePath === path) return instance;
  if (instance) closeDb();

  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });

  // journal_mode is persistent, but foreign_keys and synchronous are
  // per-connection: they must be re-applied on every handle or ON DELETE
  // CASCADE silently stops firing.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");

  runMigrations(db);
  ensureFeedbackTable(db);

  instance = db;
  instancePath = path;
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
    instancePath = null;
  }
}
