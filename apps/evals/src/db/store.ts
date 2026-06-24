import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { redactRunSecrets } from "../core/redaction.js";
import type { EvalRun } from "../types/index.js";

let _db: Database | null = null;

function getDbPath(): string {
  return process.env["EVALS_DB_PATH"] ?? join(homedir(), ".hasna", "evals", "evals.db");
}

export function getDatabase(): Database {
  if (_db) return _db;
  const path = getDbPath();
  if (path !== ":memory:") {
    mkdirSync(join(path, ".."), { recursive: true });
  }
  _db = new Database(path);
  _db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  migrate(_db);
  return _db;
}

export function closeDatabase(): void {
  _db?.close();
  _db = null;
}

// ─── Migrations ───────────────────────────────────────────────────────────────

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id          TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL,
      dataset     TEXT NOT NULL,
      stats       TEXT NOT NULL,
      adapter     TEXT,
      data        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS baselines (
      name        TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE INDEX IF NOT EXISTS runs_created_at ON runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS runs_dataset ON runs(dataset);
  `);
}

// ─── Run CRUD ─────────────────────────────────────────────────────────────────

export function saveRun(run: EvalRun): void {
  const db = getDatabase();
  const safeRun = redactRunSecrets(run);
  db.prepare(`
    INSERT OR REPLACE INTO runs (id, created_at, dataset, stats, adapter, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    safeRun.id,
    safeRun.createdAt,
    safeRun.dataset,
    JSON.stringify(safeRun.stats),
    safeRun.adapterConfig ? JSON.stringify(safeRun.adapterConfig) : null,
    JSON.stringify(safeRun)
  );
}

export function getRun(id: string): EvalRun | null {
  const db = getDatabase();
  const exact = db.prepare("SELECT data FROM runs WHERE id = ?").get(id) as { data: string } | null;
  if (exact) return JSON.parse(exact.data) as EvalRun;

  const rows = db
    .prepare("SELECT id, data FROM runs WHERE id LIKE ? || '%' ORDER BY created_at DESC LIMIT 3")
    .all(id) as Array<{ id: string; data: string }>;
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    const suffix = rows.length === 3 ? ", ..." : "";
    throw new Error(`Ambiguous run id prefix "${id}". Matches: ${rows.map((r) => r.id).join(", ")}${suffix}`);
  }
  return JSON.parse(rows[0]!.data) as EvalRun;
}

export function listRuns(limit = 20, dataset?: string, offset = 0): EvalRun[] {
  const db = getDatabase();
  const rows = dataset
    ? db.prepare("SELECT data FROM runs WHERE dataset = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(dataset, limit, offset) as Array<{ data: string }>
    : db.prepare("SELECT data FROM runs ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Array<{ data: string }>;
  return rows.map((r) => JSON.parse(r.data) as EvalRun);
}

export function countRuns(dataset?: string): number {
  const db = getDatabase();
  const row = dataset
    ? db.prepare("SELECT COUNT(*) AS count FROM runs WHERE dataset = ?").get(dataset) as { count: number }
    : db.prepare("SELECT COUNT(*) AS count FROM runs").get() as { count: number };
  return row.count;
}

export function deleteRun(id: string): void {
  getDatabase().prepare("DELETE FROM runs WHERE id = ?").run(id);
}

// ─── Baselines ────────────────────────────────────────────────────────────────

export function setBaseline(name: string, runId: string): void {
  getDatabase().prepare(`
    INSERT OR REPLACE INTO baselines (name, run_id, created_at) VALUES (?, ?, ?)
  `).run(name, runId, new Date().toISOString());
}

export function getBaseline(name: string): EvalRun | null {
  const db = getDatabase();
  const row = db.prepare("SELECT run_id FROM baselines WHERE name = ?").get(name) as { run_id: string } | null;
  if (!row) return null;
  return getRun(row.run_id);
}

export function listBaselines(): Array<{ name: string; runId: string; createdAt: string }> {
  const rows = getDatabase()
    .prepare("SELECT name, run_id, created_at FROM baselines ORDER BY created_at DESC")
    .all() as Array<{ name: string; run_id: string; created_at: string }>;
  return rows.map((r) => ({ name: r.name, runId: r.run_id, createdAt: r.created_at }));
}

export function clearBaseline(name: string): void {
  getDatabase().prepare("DELETE FROM baselines WHERE name = ?").run(name);
}
