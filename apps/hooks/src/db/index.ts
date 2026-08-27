/**
 * SQLite DB module for hooks — persistent storage at the effective data
 * root resolved through @hasna/paths (legacy ~/.hasna/hooks until adopted,
 * then the XDG data home) at hooks.db.
 *
 * Uses bun:sqlite with WAL mode for concurrent reads.
 * Supports HASNA_HOOKS_DATA_DIR / HOOKS_DATA_DIR and HASNA_HOOKS_DB_PATH / HOOKS_DB_PATH env overrides.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, cpSync } from "fs";
import { join } from "path";
import { getEffectiveDataRoot, getHomeDir } from "../lib/app-home.js";
import { runMigrations } from "./migrations";
import { runLegacyImport } from "./legacy-import";
import { runRetention } from "./retention";

let instance: Database | null = null;

function resolveDataDir(): string {
  const effective = getEffectiveDataRoot();
  const oldDir = join(getHomeDir(), ".hooks");

  // Auto-migrate: copy old data to the effective root if needed. The guard
  // is the store marker, NOT directory existence: the postinstall
  // (scripts/ensure-profiles-dir.mjs) pre-creates the effective root, so a
  // dir-existence guard would skip the migration and make a live ~/.hooks
  // store invisible on upgrade (release-review P1).
  if (existsSync(oldDir) && !existsSync(join(effective, "hooks.db"))) {
    mkdirSync(effective, { recursive: true });
    cpSync(oldDir, effective, { recursive: true });
  }

  return effective;
}

export function getDbPath(): string {
  // First-nonblank: a set-but-whitespace HASNA_HOOKS_DB_PATH must not
  // suppress a valid HOOKS_DB_PATH (release-review P1).
  const explicitDb = process.env.HASNA_HOOKS_DB_PATH?.trim() || process.env.HOOKS_DB_PATH?.trim();
  if (explicitDb) return explicitDb;

  const dataDir = resolveDataDir();
  return join(dataDir, "hooks.db");
}

function ensureDir(dbPath: string): void {
  const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getDb(): Database {
  if (instance) return instance;

  const dbPath = getDbPath();
  const isNew = dbPath === ":memory:" || !existsSync(dbPath);
  ensureDir(dbPath);

  instance = new Database(dbPath);
  // Configure the busy timeout immediately after open — a concurrent writer
  // during the very first open (migrations/retention) must wait, not fail
  // with SQLITE_BUSY (QA-4 bug 09094299).
  instance.exec("PRAGMA busy_timeout=5000");
  instance.exec("PRAGMA journal_mode=WAL");
  instance.exec("PRAGMA foreign_keys=ON");
  runMigrations(instance);
  runRetention(instance);
  instance.exec(`CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  if (isNew) {
    runLegacyImport(instance);
  }

  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export function createTestDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  return db;
}
