import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import { FEEDBACK_TABLE_SQL, runMigrations } from "./migrations";
import { getDataRoot } from "./paths.js";

let instance: Database | null = null;
let instancePath: string | null = null;

export function getDataDir(): string {
  const root = getDataRoot();
  migrateLegacyDataDir(root);
  mkdirSync(root, { recursive: true });
  return root;
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

/** Whether `candidate` is the `ancestor` path or lives inside it. */
function isSameOrDescendant(candidate: string, ancestor: string): boolean {
  return candidate === ancestor || candidate.startsWith(ancestor + sep);
}

function migrateLegacyDataDir(dest: string): void {
  // Copy forward any legacy files that are missing from the effective data
  // root — even when the effective root already exists — without deleting the
  // legacy source or overwriting existing canonical files. `.open-crawl`
  // takes precedence over `.crawl` on name collisions, and the pre-XDG
  // canonical root `~/.hasna/crawl` (the newest legacy store, which absorbed
  // `.open-crawl`/`.crawl` on earlier upgrades) takes precedence over both so
  // a live store never becomes invisible when `HASNA_DATA_HOME` (or an exact
  // override) redirects the effective root. A legacy source is never copied
  // into itself or its own descendant (an exact override nested inside the
  // legacy root would otherwise recurse forever).
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "/tmp";
  const destResolved = resolve(dest);
  const legacyNames: string[] = [".hasna/crawl", ".open-crawl", ".crawl"];
  for (const legacyName of legacyNames) {
    const legacyDir = join(home, legacyName);
    if (!existsSync(legacyDir)) continue;
    if (!statSync(legacyDir).isDirectory()) continue;
    if (isSameOrDescendant(destResolved, resolve(legacyDir))) continue;
    copyMissingRecursive(legacyDir, dest);
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

  // busy_timeout MUST be the first statement: PRAGMA journal_mode below
  // takes schema locks that can transiently collide with a concurrent
  // process holding the WAL write lock, and without a busy handler that
  // collision surfaces immediately as SQLITE_BUSY "database is locked"
  // (measured as an intermittent full-suite failure in the CLI list path).
  db.exec("PRAGMA busy_timeout = 5000");
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
