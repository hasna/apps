import type { Database } from "bun:sqlite";

/**
 * Remove the legacy `CHECK(source IN ('sdk','script','scanner'))` constraint from
 * the `logs` table on pre-existing on-box databases.
 *
 * Early builds created `logs.source` with a hardcoded CHECK that only allowed
 * three values. The current schema (see db/index.ts) declares `source TEXT NOT
 * NULL DEFAULT 'sdk'` with NO CHECK, because real sources include `cli`, `jsonl`,
 * `browser`, `node`, `mcp`, … (see the LogSource union). On an unmigrated legacy
 * DB, `logs run` (source `cli`) and `logs import-jsonl` (source `jsonl`) fail with
 * `CHECK constraint failed`. SQLite cannot drop a column CHECK in place, so we
 * rebuild the table.
 *
 * SAFETY:
 *  - Only rebuilds when a `CHECK(source …)` is actually present (idempotent no-op
 *    otherwise — fresh DBs are untouched).
 *  - Preserves `rowid` exactly, so the external-content `logs_fts` index and any
 *    `event_records.log_id` references stay valid.
 *  - Runs with foreign keys OFF so DROP TABLE does not trigger the implicit
 *    row-delete cascade (which would null `event_records.log_id`).
 */
export function migrateLogsSourceCheck(db: Database): void {
  const row = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'logs'",
    )
    .get() as { sql: string | null } | null;
  const sql = row?.sql;
  if (!sql) return; // no logs table yet — fresh DB, canonical schema applies

  // Only act when there is a CHECK constraint referencing `source`.
  if (!/CHECK\s*\(\s*source\b/i.test(sql)) return;

  // Canonical `logs` schema (must mirror db/index.ts), sans the source CHECK.
  const createCanonical = `
    CREATE TABLE logs_migrate_new (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
      level TEXT NOT NULL CHECK(level IN ('debug','info','warn','error','fatal')),
      source TEXT NOT NULL DEFAULT 'sdk',
      service TEXT,
      message TEXT NOT NULL,
      trace_id TEXT,
      session_id TEXT,
      agent TEXT,
      url TEXT,
      stack_trace TEXT,
      metadata TEXT
    )
  `;

  // Copy only columns present in BOTH the legacy table and the canonical schema,
  // preserving rowid so the external-content FTS mapping stays intact.
  const canonicalCols = [
    "id",
    "timestamp",
    "project_id",
    "page_id",
    "level",
    "source",
    "service",
    "message",
    "trace_id",
    "session_id",
    "agent",
    "url",
    "stack_trace",
    "metadata",
  ];
  const existing = (
    db.prepare("PRAGMA table_info(logs)").all() as Array<{ name: string }>
  ).map((c) => c.name);
  const common = canonicalCols.filter((c) => existing.includes(c));
  const colList = ["rowid", ...common].join(", ");

  const fkRow = db.prepare("PRAGMA foreign_keys").get() as {
    foreign_keys: number;
  } | null;
  const fkWasOn = fkRow?.foreign_keys === 1;

  // PRAGMA foreign_keys is a no-op inside a transaction, so toggle it outside one.
  if (fkWasOn) db.run("PRAGMA foreign_keys = OFF");
  try {
    db.run("DROP TABLE IF EXISTS logs_migrate_new");
    db.run(createCanonical);
    db.run(
      `INSERT INTO logs_migrate_new (${colList}) SELECT ${colList} FROM logs`,
    );
    db.run("DROP TABLE logs");
    db.run("ALTER TABLE logs_migrate_new RENAME TO logs");
  } finally {
    if (fkWasOn) db.run("PRAGMA foreign_keys = ON");
  }
}
