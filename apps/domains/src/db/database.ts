/**
 * Database connection for open-domains
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { MIGRATIONS } from "./migrations.js";
import { exactAppOverride, getDefaultDbPath } from "../lib/app-home.js";

let _db: Database | null = null;

/**
 * The default data root — the effective local data home (see `app-home.ts`).
 * Env overrides (HASNA_DOMAINS_DB_PATH wins over the legacy DOMAINS_DB_PATH
 * alias) and the exact-app overrides (HASNA_DOMAINS_HOME / HASNA_DOMAINS_DIR
 * win over DOMAINS_HOME / DOMAINS_DIR) are honored unchanged and win over the
 * default. Setting any of them IS the explicit local-store opt-in
 * (`src/lib/local-opt-in.ts`).
 */
export function getDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env["HASNA_DOMAINS_DB_PATH"]) return env["HASNA_DOMAINS_DB_PATH"];
  if (env["DOMAINS_DB_PATH"]) return env["DOMAINS_DB_PATH"];

  // Exact-app override wins and keeps the legacy layout under the override root.
  const explicit = exactAppOverride(env);
  if (explicit) {
    return join(explicit, "domains.db");
  }

  return getDefaultDbPath(env);
}

export function getDatabase(): Database {
  if (_db) return _db;

  const dbPath = getDbPath();
  if (dbPath !== ":memory:") {
    const dir = dirname(resolve(dbPath));
    mkdirSync(dir, { recursive: true });
  }

  _db = new Database(dbPath);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = _db
    .query("SELECT id FROM _migrations ORDER BY id")
    .all() as { id: number }[];
  const appliedIds = new Set(applied.map((r) => r.id));

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) continue;

    _db.exec("BEGIN");
    try {
      _db.exec(migration.sql);
      _db.prepare("INSERT INTO _migrations (id, name) VALUES (?, ?)").run(
        migration.id,
        migration.name
      );
      _db.exec("COMMIT");
    } catch (error) {
      _db.exec("ROLLBACK");
      throw new Error(
        `Migration ${migration.id} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
