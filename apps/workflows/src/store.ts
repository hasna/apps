/**
 * The three-table store (slice B) — SQLite via bun:sqlite.
 *
 * Exactly three tables:
 *   runs       — one row per graph execution.
 *   run_nodes  — one row per node execution within a run.
 *   memos      — cross-run node memoization cache keyed by
 *                graphName:nodeId:inputHash.
 *
 * Claims/leases are NOT a table: they live in the session WAL + daemon
 * memory (slice D) so the relational schema stays at three tables.
 *
 * The server may be deployed on PostgreSQL via workflows-serve's HTTP API
 * (client never opens Postgres directly — repo law); this store is the
 * local/embedded engine.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const RUN_STATUSES = ["pending", "running", "completed", "failed", "cancelled", "interrupted"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const NODE_STATUSES = ["pending", "running", "completed", "failed", "skipped"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export interface RunRow {
  id: string;
  graphName: string;
  graphVersion: string;
  status: RunStatus;
  attempts: number;
  contextJson: string;
  resultJson: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunNodeRow {
  id: string;
  runId: string;
  nodeId: string;
  status: NodeStatus;
  attempts: number;
  lane: string | null;
  exitCode: number | null;
  outputJson: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface MemoRow {
  key: string;
  graphName: string;
  nodeId: string;
  inputHash: string;
  outputJson: string;
  hitCount: number;
  createdAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface CreateRunInput {
  graphName: string;
  graphVersion: string;
  context?: unknown;
}

export interface CreateRunNodeInput {
  runId: string;
  nodeId: string;
  lane?: string;
}

export interface WorkflowsStore {
  /** The data dir this store was opened on (resolves relative memoWatch paths). */
  readonly dataDir: string;
  close(): void;
  listTables(): string[];
  createRun(input: CreateRunInput): RunRow;
  getRun(id: string): RunRow | undefined;
  listRuns(opts?: { status?: RunStatus; limit?: number }): RunRow[];
  setRunStatus(id: string, status: RunStatus, patch?: { result?: unknown; error?: string | null; startedAt?: string; finishedAt?: string }): void;
  /** Persist the run's durable execution state (the engine's cursor + steps). */
  setRunContext(id: string, context: unknown): void;
  bumpAttempts(id: string): void;
  createRunNode(input: CreateRunNodeInput): RunNodeRow;
  getRunNode(id: string): RunNodeRow | undefined;
  listRunNodes(runId: string): RunNodeRow[];
  /** The newest run_nodes row for a (run, node) pair — a node may own one row
   * per while iteration, and `nodes show` + engine row-reuse need the latest. */
  getLatestRunNode(runId: string, nodeId: string): RunNodeRow | undefined;
  setRunNodeStatus(id: string, status: NodeStatus, patch?: { exitCode?: number | null; output?: unknown; error?: string | null; startedAt?: string; finishedAt?: string }): void;
  bumpAttemptsNode(id: string): void;
  memoPut(key: string, graphName: string, nodeId: string, inputHash: string, outputJson: string): void;
  memoGet(key: string): MemoRow | undefined;
  memoHit(key: string): void;
  memoList(): MemoRow[];
  memoClear(): void;
}

/**
 * Bounded SQLite busy containment. Multiple CLI/daemon processes share one
 * store (stress V1 F1, measured 2026-08-30: 2/3 concurrent runs died rc=1
 * with stderr exactly "database is locked"): SQLite's default immediate-fail
 * policy must become a finite busy wait (PRAGMA busy_timeout) plus a bounded
 * retry for the busy call itself, so a contended writer waits instead of
 * failing while contention is transient.
 */
const BUSY_TIMEOUT_MS = 3000;
const BUSY_RETRIES = 2;
const BUSY_RETRY_SLEEP_MS = 50;

function isBusyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = String((err as { code?: unknown }).code ?? "");
  return code.includes("BUSY") || /\bdatabase is locked\b/i.test(err.message);
}

function retryBusy<T>(fn: () => T): T {
  let last: unknown;
  for (let attempt = 0; attempt <= BUSY_RETRIES; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (!isBusyError(err)) throw err;
      last = err;
      Bun.sleepSync(BUSY_RETRY_SLEEP_MS);
    }
  }
  throw last;
}

export function openStore(dataDir: string): WorkflowsStore {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "workflows.db"));
  // Stress V1 F1 (measured 2026-08-30): concurrent CLI processes on one data
  // dir died with SQLITE_BUSY. Wait for a contended writer for a bounded
  // window instead of failing on first contact; retryBusy below covers the
  // residual gap after the busy handler exhausts its window.
  retryBusy(() => db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`));
  retryBusy(() => db.exec("PRAGMA journal_mode = WAL"));
  retryBusy(() => db.exec("PRAGMA foreign_keys = ON"));
  retryBusy(() =>
    db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id            TEXT PRIMARY KEY,
      graph_name    TEXT NOT NULL,
      graph_version TEXT NOT NULL,
      status        TEXT NOT NULL,
      attempts      INTEGER NOT NULL DEFAULT 0,
      context_json  TEXT NOT NULL,
      result_json   TEXT,
      error         TEXT,
      started_at    TEXT,
      finished_at   TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_nodes (
      id          TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      node_id     TEXT NOT NULL,
      status      TEXT NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      lane        TEXT,
      exit_code   INTEGER,
      output_json TEXT,
      error       TEXT,
      started_at  TEXT,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS memos (
      key         TEXT PRIMARY KEY,
      graph_name  TEXT NOT NULL,
      node_id     TEXT NOT NULL,
      input_hash  TEXT NOT NULL,
      output_json TEXT NOT NULL,
      hit_count   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_run_nodes_run ON run_nodes(run_id);
  `),
  );

  const rowToRun = (r: Record<string, unknown>): RunRow => ({
    id: String(r.id),
    graphName: String(r.graph_name),
    graphVersion: String(r.graph_version),
    status: r.status as RunStatus,
    attempts: Number(r.attempts),
    contextJson: String(r.context_json),
    resultJson: r.result_json === null ? null : String(r.result_json),
    error: r.error === null ? null : String(r.error),
    startedAt: r.started_at === null ? null : String(r.started_at),
    finishedAt: r.finished_at === null ? null : String(r.finished_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  });

  const rowToNode = (r: Record<string, unknown>): RunNodeRow => ({
    id: String(r.id),
    runId: String(r.run_id),
    nodeId: String(r.node_id),
    status: r.status as NodeStatus,
    attempts: Number(r.attempts),
    lane: r.lane === null ? null : String(r.lane),
    exitCode: r.exit_code === null ? null : Number(r.exit_code),
    outputJson: r.output_json === null ? null : String(r.output_json),
    error: r.error === null ? null : String(r.error),
    startedAt: r.started_at === null ? null : String(r.started_at),
    finishedAt: r.finished_at === null ? null : String(r.finished_at),
  });

  const rowToMemo = (r: Record<string, unknown>): MemoRow => ({
    key: String(r.key),
    graphName: String(r.graph_name),
    nodeId: String(r.node_id),
    inputHash: String(r.input_hash),
    outputJson: String(r.output_json),
    hitCount: Number(r.hit_count),
    createdAt: String(r.created_at),
  });

  return {
    dataDir,

    close() {
      db.close();
    },

    listTables(): string[] {
      const rows = retryBusy(() =>
        db
          .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
          .all(),
      );
      return rows.map((r) => r.name);
    },

    createRun(input: CreateRunInput): RunRow {
      const id = randomUUID();
      const now = nowIso();
      retryBusy(() =>
        db
          .query(
            `INSERT INTO runs (id, graph_name, graph_version, status, attempts, context_json, created_at, updated_at)
             VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)`,
          )
          .run(id, input.graphName, input.graphVersion, JSON.stringify(input.context ?? {}), now, now),
      );
      return this.getRun(id)!;
    },

    getRun(id: string): RunRow | undefined {
      const row = retryBusy(() => db.query(`SELECT * FROM runs WHERE id = ?`).get(id) as Record<string, unknown> | null);
      return row ? rowToRun(row) : undefined;
    },

    listRuns(opts: { status?: RunStatus; limit?: number } = {}): RunRow[] {
      const limit = Math.min(opts.limit ?? 100, 1000);
      if (opts.status) {
        const status: RunStatus = opts.status; // narrowed for the closure
        const rows = retryBusy(() =>
          db.query(`SELECT * FROM runs WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?`).all(status, limit),
        );
        return rows.map((r) => rowToRun(r as Record<string, unknown>));
      }
      const rows = retryBusy(() => db.query(`SELECT * FROM runs ORDER BY created_at DESC, id DESC LIMIT ?`).all(limit));
      return rows.map((r) => rowToRun(r as Record<string, unknown>));
    },

    setRunStatus(id: string, status: RunStatus, patch: { result?: unknown; error?: string | null; startedAt?: string; finishedAt?: string } = {}): void {
      const now = nowIso();
      const existing = this.getRun(id);
      const resultJson = patch.result !== undefined ? JSON.stringify(patch.result) : (existing?.resultJson ?? null);
      const error = patch.error !== undefined ? patch.error : (existing?.error ?? null);
      // entering "running" stamps started_at once; the first observed start wins
      const startedAt =
        patch.startedAt !== undefined
          ? patch.startedAt
          : status === "running" && existing?.startedAt === null
            ? now
            : (existing?.startedAt ?? null);
      const terminal = status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
      const finishedAt =
        patch.finishedAt !== undefined
          ? patch.finishedAt
          : terminal && existing?.finishedAt === null
            ? now
            : (existing?.finishedAt ?? null);
      retryBusy(() =>
        db
          .query(
            `UPDATE runs SET status = ?, result_json = ?, error = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
          )
          .run(status, resultJson, error, startedAt, finishedAt, now, id),
      );
    },

    bumpAttempts(id: string): void {
      retryBusy(() => db.query(`UPDATE runs SET attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(nowIso(), id));
    },

    setRunContext(id: string, context: unknown): void {
      retryBusy(() => db.query(`UPDATE runs SET context_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(context), nowIso(), id));
    },

    createRunNode(input: CreateRunNodeInput): RunNodeRow {
      const id = randomUUID();
      retryBusy(() =>
        db
          .query(
            `INSERT INTO run_nodes (id, run_id, node_id, status, attempts, lane)
             VALUES (?, ?, ?, 'pending', 0, ?)`,
          )
          .run(id, input.runId, input.nodeId, input.lane ?? null),
      );
      return this.getRunNode(id)!;
    },

    getRunNode(id: string): RunNodeRow | undefined {
      const row = retryBusy(() => db.query(`SELECT * FROM run_nodes WHERE id = ?`).get(id) as Record<string, unknown> | null);
      return row ? rowToNode(row) : undefined;
    },

    listRunNodes(runId: string): RunNodeRow[] {
      const rows = retryBusy(() => db.query(`SELECT * FROM run_nodes WHERE run_id = ? ORDER BY rowid ASC`).all(runId));
      return rows.map((r) => rowToNode(r as Record<string, unknown>));
    },

    getLatestRunNode(runId: string, nodeId: string): RunNodeRow | undefined {
      const row = retryBusy(() =>
        db.query(`SELECT * FROM run_nodes WHERE run_id = ? AND node_id = ? ORDER BY rowid DESC LIMIT 1`).get(runId, nodeId) as
          | Record<string, unknown>
          | null,
      );
      return row ? rowToNode(row) : undefined;
    },

    setRunNodeStatus(id: string, status: NodeStatus, patch: { exitCode?: number | null; output?: unknown; error?: string | null; startedAt?: string; finishedAt?: string } = {}): void {
      const now = nowIso();
      const existing = this.getRunNode(id);
      if (!existing) return;
      const exitCode = patch.exitCode !== undefined ? patch.exitCode : existing.exitCode;
      const outputJson = patch.output !== undefined ? JSON.stringify(patch.output) : existing.outputJson;
      const error = patch.error !== undefined ? patch.error : existing.error;
      const startedAt =
        patch.startedAt !== undefined
          ? patch.startedAt
          : status === "running" && existing.startedAt === null
            ? now
            : existing.startedAt;
      const terminal = status === "completed" || status === "failed" || status === "skipped";
      const finishedAt =
        patch.finishedAt !== undefined ? patch.finishedAt : terminal && existing.finishedAt === null ? now : existing.finishedAt;
      retryBusy(() =>
        db
          .query(
            `UPDATE run_nodes SET status = ?, exit_code = ?, output_json = ?, error = ?, started_at = ?, finished_at = ? WHERE id = ?`,
          )
          .run(status, exitCode, outputJson, error, startedAt, finishedAt, id),
      );
    },

    bumpAttemptsNode(id: string): void {
      retryBusy(() => db.query(`UPDATE run_nodes SET attempts = attempts + 1 WHERE id = ?`).run(id));
    },

    memoPut(key: string, graphName: string, nodeId: string, inputHash: string, outputJson: string): void {
      retryBusy(() =>
        db
          .query(
            `INSERT INTO memos (key, graph_name, node_id, input_hash, output_json, hit_count, created_at)
             VALUES (?, ?, ?, ?, ?, 0, ?)
             ON CONFLICT(key) DO UPDATE SET output_json = excluded.output_json`,
          )
          .run(key, graphName, nodeId, inputHash, outputJson, nowIso()),
      );
    },

    memoGet(key: string): MemoRow | undefined {
      const row = retryBusy(() => db.query(`SELECT * FROM memos WHERE key = ?`).get(key) as Record<string, unknown> | null);
      return row ? rowToMemo(row) : undefined;
    },

    memoHit(key: string): void {
      retryBusy(() => db.query(`UPDATE memos SET hit_count = hit_count + 1 WHERE key = ?`).run(key));
    },

    memoList(): MemoRow[] {
      const rows = retryBusy(() => db.query(`SELECT * FROM memos ORDER BY created_at DESC LIMIT 1000`).all());
      return rows.map((r) => rowToMemo(r as Record<string, unknown>));
    },

    memoClear(): void {
      retryBusy(() => db.exec(`DELETE FROM memos`));
    },
  };
}
