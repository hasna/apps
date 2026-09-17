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

/**
 * Process-wide refusal of the on-box store (hasna/apps#1720 fail-closed
 * ruling, todos #1942 pattern). A hosted surface — the CLI gate once a
 * registry credential resolved, the MCP server before its transport connects
 * — installs it at startup, and from then on EVERY getDb() call throws the
 * installed message instead of opening ~/.hasna/hooks/hooks.db. It is the one
 * choke point every local-only verb, tool and writer funnels through, so the
 * hosted route physically cannot answer from (or create) a local SQLite file.
 * The message names only sources and the opt-in, never a credential value.
 */
let localStoreRefusal: string | null = null;

/** Refuse every local-store open for the rest of this process. */
export function refuseLocalStore(message: string): void {
  localStoreRefusal = message;
}

/** Lift a refusal installed by {@link refuseLocalStore}. Test seam. */
export function allowLocalStore(): void {
  localStoreRefusal = null;
}

/** True while {@link refuseLocalStore} is in force for this process. */
export function isLocalStoreRefused(): boolean {
  return localStoreRefusal !== null;
}

/** The installed refusal text, or null when the store is not refused. */
export function localStoreRefusalMessage(): string | null {
  return localStoreRefusal;
}

function resolveDataDir(): string {
  const effective = getEffectiveDataRoot();
  const oldDir = join(getHomeDir(), ".hooks");

  // Auto-migrate: copy old data to the effective root if needed
  if (!existsSync(effective) && existsSync(oldDir)) {
    mkdirSync(effective, { recursive: true });
    cpSync(oldDir, effective, { recursive: true });
  }

  return effective;
}

export function getDbPath(): string {
  const explicitDb = process.env.HASNA_HOOKS_DB_PATH ?? process.env.HOOKS_DB_PATH;
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
  // A refusal installed by a hosted surface outranks everything else,
  // including an instance opened earlier in the process.
  if (localStoreRefusal !== null) throw new Error(localStoreRefusal);
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
