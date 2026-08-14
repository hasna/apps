/**
 * Migration 004 — hooks tracking table.
 * Records installed/pinned hooks with their trusted script hashes
 * (mirrors the codewith trusted_hash model).
 */

import type { Database } from "bun:sqlite";

export const CREATE_HOOKS_TABLE = `
  CREATE TABLE IF NOT EXISTS hooks (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    version          TEXT NOT NULL,
    sha256           TEXT NOT NULL,
    source_type      TEXT NOT NULL,
    source_ref       TEXT,
    installed_at     TEXT NOT NULL,
    enabled          INTEGER NOT NULL DEFAULT 1,
    last_verified_at TEXT
  )
`;

export const CREATE_HOOKS_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_hooks_name ON hooks (name)`,
];

export function up(db: Database): void {
  db.exec(CREATE_HOOKS_TABLE);
  for (const idx of CREATE_HOOKS_INDEXES) {
    db.exec(idx);
  }
}
