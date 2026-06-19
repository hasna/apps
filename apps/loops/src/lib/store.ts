import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CatchUpPolicy, CreateLoopInput, Loop, LoopRun, LoopStatus, RunStatus } from "../types.js";
import { genId, nowIso } from "./ids.js";
import { dbPath } from "./paths.js";
import { initialNextRun } from "./schedule.js";

interface LoopRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  schedule_json: string;
  target_json: string;
  next_run_at: string | null;
  retry_scheduled_for: string | null;
  catch_up: string;
  catch_up_limit: number;
  overlap: string;
  max_attempts: number;
  retry_delay_ms: number;
  lease_ms: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  loop_id: string;
  loop_name: string;
  scheduled_for: string;
  attempt: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  claimed_by: string | null;
  lease_expires_at: string | null;
  pid: number | null;
  exit_code: number | null;
  duration_ms: number | null;
  stdout: string | null;
  stderr: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DaemonLease {
  id: string;
  pid: number;
  hostname: string;
  heartbeatAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

interface LeaseRow {
  id: string;
  pid: number;
  hostname: string;
  heartbeat_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

function rowToLoop(row: LoopRow): Loop {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status as LoopStatus,
    schedule: JSON.parse(row.schedule_json) as Loop["schedule"],
    target: JSON.parse(row.target_json) as Loop["target"],
    nextRunAt: row.next_run_at ?? undefined,
    retryScheduledFor: row.retry_scheduled_for ?? undefined,
    catchUp: row.catch_up as Loop["catchUp"],
    catchUpLimit: row.catch_up_limit,
    overlap: row.overlap as Loop["overlap"],
    maxAttempts: row.max_attempts,
    retryDelayMs: row.retry_delay_ms,
    leaseMs: row.lease_ms,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: RunRow): LoopRun {
  return {
    id: row.id,
    loopId: row.loop_id,
    loopName: row.loop_name,
    scheduledFor: row.scheduled_for,
    attempt: row.attempt,
    status: row.status as RunStatus,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    claimedBy: row.claimed_by ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    pid: row.pid ?? undefined,
    exitCode: row.exit_code ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    stdout: row.stdout ?? undefined,
    stderr: row.stderr ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToLease(row: LeaseRow): DaemonLease {
  return {
    id: row.id,
    pid: row.pid,
    hostname: row.hostname,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ClaimRunResult {
  run: LoopRun;
  loop: Loop;
}

export class Store {
  private db: Database;

  constructor(path?: string) {
    const file = path ?? dbPath();
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new Database(file);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS loops (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        schedule_json TEXT NOT NULL,
        target_json TEXT NOT NULL,
        next_run_at TEXT,
        retry_scheduled_for TEXT,
        catch_up TEXT NOT NULL,
        catch_up_limit INTEGER NOT NULL,
        overlap TEXT NOT NULL,
        max_attempts INTEGER NOT NULL,
        retry_delay_ms INTEGER NOT NULL,
        lease_ms INTEGER NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_loops_status_next ON loops(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_loops_name ON loops(name);

      CREATE TABLE IF NOT EXISTS loop_runs (
        id TEXT PRIMARY KEY,
        loop_id TEXT NOT NULL,
        loop_name TEXT NOT NULL,
        scheduled_for TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        claimed_by TEXT,
        lease_expires_at TEXT,
        pid INTEGER,
        exit_code INTEGER,
        duration_ms INTEGER,
        stdout TEXT,
        stderr TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(loop_id, scheduled_for)
      );
      CREATE INDEX IF NOT EXISTS idx_runs_loop ON loop_runs(loop_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON loop_runs(status);
      CREATE INDEX IF NOT EXISTS idx_runs_scheduled ON loop_runs(scheduled_for);

      CREATE TABLE IF NOT EXISTS daemon_lease (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        hostname TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  createLoop(input: CreateLoopInput, from: Date = new Date()): Loop {
    const now = nowIso();
    const loop: Loop = {
      id: genId(),
      name: input.name,
      description: input.description,
      status: "active",
      schedule: input.schedule,
      target: input.target,
      nextRunAt: initialNextRun(input.schedule, from),
      catchUp: input.catchUp ?? "latest",
      catchUpLimit: input.catchUpLimit ?? 50,
      overlap: input.overlap ?? "skip",
      maxAttempts: input.maxAttempts ?? 1,
      retryDelayMs: input.retryDelayMs ?? 60_000,
      leaseMs: input.leaseMs ?? 30 * 60_000,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .query(
        `INSERT INTO loops (id, name, description, status, schedule_json, target_json, next_run_at, retry_scheduled_for,
          catch_up, catch_up_limit, overlap, max_attempts, retry_delay_ms, lease_ms, expires_at, created_at, updated_at)
         VALUES ($id, $name, $description, $status, $schedule, $target, $nextRun, NULL, $catchUp, $catchUpLimit,
          $overlap, $maxAttempts, $retryDelay, $leaseMs, $expiresAt, $created, $updated)`,
      )
      .run({
        $id: loop.id,
        $name: loop.name,
        $description: loop.description ?? null,
        $status: loop.status,
        $schedule: JSON.stringify(loop.schedule),
        $target: JSON.stringify(loop.target),
        $nextRun: loop.nextRunAt ?? null,
        $catchUp: loop.catchUp,
        $catchUpLimit: loop.catchUpLimit,
        $overlap: loop.overlap,
        $maxAttempts: loop.maxAttempts,
        $retryDelay: loop.retryDelayMs,
        $leaseMs: loop.leaseMs,
        $expiresAt: loop.expiresAt ?? null,
        $created: loop.createdAt,
        $updated: loop.updatedAt,
      });
    return loop;
  }

  getLoop(id: string): Loop | undefined {
    const row = this.db.query<LoopRow, [string]>("SELECT * FROM loops WHERE id = ?").get(id);
    return row ? rowToLoop(row) : undefined;
  }

  findLoopByName(name: string): Loop | undefined {
    const row = this.db.query<LoopRow, [string]>("SELECT * FROM loops WHERE name = ? ORDER BY created_at DESC LIMIT 1").get(name);
    return row ? rowToLoop(row) : undefined;
  }

  requireLoop(idOrName: string): Loop {
    return this.getLoop(idOrName) ?? this.findLoopByName(idOrName) ?? (() => {
      throw new Error(`loop not found: ${idOrName}`);
    })();
  }

  listLoops(opts: { status?: LoopStatus; limit?: number } = {}): Loop[] {
    const limit = opts.limit ?? 200;
    const rows = opts.status
      ? this.db
          .query<LoopRow, [string, number]>("SELECT * FROM loops WHERE status = ? ORDER BY next_run_at ASC LIMIT ?")
          .all(opts.status, limit)
      : this.db.query<LoopRow, [number]>("SELECT * FROM loops ORDER BY status ASC, next_run_at ASC LIMIT ?").all(limit);
    return rows.map(rowToLoop);
  }

  dueLoops(now: Date): Loop[] {
    const rows = this.db
      .query<LoopRow, [string]>(
        `SELECT * FROM loops
         WHERE status = 'active'
           AND next_run_at IS NOT NULL
           AND next_run_at <= ?
         ORDER BY next_run_at ASC`,
      )
      .all(now.toISOString());
    return rows.map(rowToLoop);
  }

  updateLoop(
    id: string,
    patch: Partial<Pick<Loop, "status" | "nextRunAt" | "retryScheduledFor" | "expiresAt">>,
  ): Loop {
    const current = this.getLoop(id);
    if (!current) throw new Error(`loop not found: ${id}`);
    const merged: Loop = { ...current, ...patch, updatedAt: nowIso() };
    this.db
      .query(
        `UPDATE loops SET status=$status, next_run_at=$nextRun, retry_scheduled_for=$retrySlot,
         expires_at=$expiresAt, updated_at=$updated WHERE id=$id`,
      )
      .run({
        $id: id,
        $status: merged.status,
        $nextRun: merged.nextRunAt ?? null,
        $retrySlot: merged.retryScheduledFor ?? null,
        $expiresAt: merged.expiresAt ?? null,
        $updated: merged.updatedAt,
      });
    return merged;
  }

  deleteLoop(idOrName: string): boolean {
    const loop = this.requireLoop(idOrName);
    const res = this.db.query("DELETE FROM loops WHERE id = ?").run(loop.id);
    return res.changes > 0;
  }

  hasRunningRun(loopId: string): boolean {
    const row = this.db
      .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM loop_runs WHERE loop_id = ? AND status = 'running'")
      .get(loopId);
    return (row?.count ?? 0) > 0;
  }

  createSkippedRun(loop: Loop, scheduledFor: string, reason: string): LoopRun {
    const now = nowIso();
    const run: LoopRun = {
      id: genId(),
      loopId: loop.id,
      loopName: loop.name,
      scheduledFor,
      attempt: 1,
      status: "skipped",
      finishedAt: now,
      error: reason,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .query(
        `INSERT OR IGNORE INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
          claimed_by, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at)
         VALUES ($id, $loopId, $loopName, $scheduledFor, $attempt, $status, NULL, $finished, NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, $error, $created, $updated)`,
      )
      .run({
        $id: run.id,
        $loopId: run.loopId,
        $loopName: run.loopName,
        $scheduledFor: run.scheduledFor,
        $attempt: run.attempt,
        $status: run.status,
        $finished: run.finishedAt ?? null,
        $error: run.error ?? null,
        $created: run.createdAt,
        $updated: run.updatedAt,
      });
    return this.getRunBySlot(loop.id, scheduledFor) ?? run;
  }

  getRun(id: string): LoopRun | undefined {
    const row = this.db.query<RunRow, [string]>("SELECT * FROM loop_runs WHERE id = ?").get(id);
    return row ? rowToRun(row) : undefined;
  }

  getRunBySlot(loopId: string, scheduledFor: string): LoopRun | undefined {
    const row = this.db
      .query<RunRow, [string, string]>("SELECT * FROM loop_runs WHERE loop_id = ? AND scheduled_for = ?")
      .get(loopId, scheduledFor);
    return row ? rowToRun(row) : undefined;
  }

  claimRun(loop: Loop, scheduledFor: string, runnerId: string, now: Date = new Date()): ClaimRunResult | undefined {
    const startedAt = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + loop.leaseMs).toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.getRunBySlot(loop.id, scheduledFor);

      if (existing) {
        if (existing.status === "running") {
          const res = this.db
            .query(
              `UPDATE loop_runs SET status='running', started_at=$started, finished_at=NULL,
               claimed_by=$claimedBy, lease_expires_at=$lease, pid=NULL, exit_code=NULL,
               duration_ms=NULL, stdout=NULL, stderr=NULL, error=NULL, updated_at=$updated
               WHERE id=$id AND status='running' AND lease_expires_at <= $now`,
            )
            .run({
              $id: existing.id,
              $started: startedAt,
              $claimedBy: runnerId,
              $lease: leaseExpiresAt,
              $updated: startedAt,
              $now: startedAt,
            });
          this.db.exec("COMMIT");
          if (res.changes !== 1) return undefined;
          const run = this.getRun(existing.id);
          return run ? { run, loop } : undefined;
        }

        if (existing.status === "succeeded" || existing.status === "skipped") {
          this.db.exec("COMMIT");
          return undefined;
        }

        const attempt = existing.attempt + 1;
        const res = this.db
          .query(
            `UPDATE loop_runs SET attempt=$attempt, status='running', started_at=$started, finished_at=NULL,
             claimed_by=$claimedBy, lease_expires_at=$lease, pid=NULL, exit_code=NULL,
             duration_ms=NULL, stdout=NULL, stderr=NULL, error=NULL, updated_at=$updated
             WHERE id=$id
               AND status IN ('failed', 'timed_out', 'abandoned')
               AND attempt < $maxAttempts`,
          )
          .run({
            $id: existing.id,
            $attempt: attempt,
            $started: startedAt,
            $claimedBy: runnerId,
            $lease: leaseExpiresAt,
            $updated: startedAt,
            $maxAttempts: loop.maxAttempts,
          });
        this.db.exec("COMMIT");
        if (res.changes !== 1) return undefined;
        const run = this.getRun(existing.id);
        return run ? { run, loop } : undefined;
      }

      const id = genId();
      const res = this.db
        .query(
          `INSERT OR IGNORE INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at,
            claimed_by, lease_expires_at, pid, exit_code, duration_ms, stdout, stderr, error, created_at, updated_at)
           VALUES ($id, $loopId, $loopName, $scheduledFor, 1, 'running', $started, NULL, $claimedBy, $lease,
            NULL, NULL, NULL, NULL, NULL, NULL, $created, $updated)`,
        )
        .run({
          $id: id,
          $loopId: loop.id,
          $loopName: loop.name,
          $scheduledFor: scheduledFor,
          $started: startedAt,
          $claimedBy: runnerId,
          $lease: leaseExpiresAt,
          $created: startedAt,
          $updated: startedAt,
        });
      this.db.exec("COMMIT");
      if (res.changes !== 1) return undefined;
      const run = this.getRun(id);
      return run ? { run, loop } : undefined;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  finalizeRun(
    id: string,
    patch: Pick<LoopRun, "status" | "finishedAt" | "durationMs" | "stdout" | "stderr"> &
      Partial<Pick<LoopRun, "exitCode" | "error" | "pid">>,
  ): LoopRun {
    const finishedAt = patch.finishedAt ?? nowIso();
    this.db
      .query(
        `UPDATE loop_runs SET status=$status, finished_at=$finished, lease_expires_at=NULL, pid=$pid, exit_code=$exitCode,
         duration_ms=$durationMs, stdout=$stdout, stderr=$stderr, error=$error, updated_at=$updated WHERE id=$id`,
      )
      .run({
        $id: id,
        $status: patch.status,
        $finished: finishedAt,
        $pid: patch.pid ?? null,
        $exitCode: patch.exitCode ?? null,
        $durationMs: patch.durationMs ?? null,
        $stdout: patch.stdout ?? null,
        $stderr: patch.stderr ?? null,
        $error: patch.error ?? null,
        $updated: finishedAt,
      });
    const run = this.getRun(id);
    if (!run) throw new Error(`run not found after finalize: ${id}`);
    return run;
  }

  listRuns(opts: { loopId?: string; status?: RunStatus; limit?: number } = {}): LoopRun[] {
    const limit = opts.limit ?? 100;
    let rows: RunRow[];
    if (opts.loopId && opts.status) {
      rows = this.db
        .query<RunRow, [string, string, number]>(
          "SELECT * FROM loop_runs WHERE loop_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(opts.loopId, opts.status, limit);
    } else if (opts.loopId) {
      rows = this.db
        .query<RunRow, [string, number]>("SELECT * FROM loop_runs WHERE loop_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(opts.loopId, limit);
    } else if (opts.status) {
      rows = this.db
        .query<RunRow, [string, number]>("SELECT * FROM loop_runs WHERE status = ? ORDER BY created_at DESC LIMIT ?")
        .all(opts.status, limit);
    } else {
      rows = this.db.query<RunRow, [number]>("SELECT * FROM loop_runs ORDER BY created_at DESC LIMIT ?").all(limit);
    }
    return rows.map(rowToRun);
  }

  recoverExpiredRunLeases(now: Date = new Date()): LoopRun[] {
    const rows = this.db
      .query<RunRow, [string]>("SELECT * FROM loop_runs WHERE status = 'running' AND lease_expires_at <= ?")
      .all(now.toISOString());
    const recovered: LoopRun[] = [];
    for (const row of rows) {
      this.db
        .query(
          `UPDATE loop_runs SET status='abandoned', finished_at=$finished, lease_expires_at=NULL,
           error='run lease expired before completion', updated_at=$updated WHERE id=$id`,
        )
        .run({ $id: row.id, $finished: now.toISOString(), $updated: now.toISOString() });
      const run = this.getRun(row.id);
      if (run) recovered.push(run);
    }
    return recovered;
  }

  expireLoops(now: Date = new Date()): Loop[] {
    const rows = this.db
      .query<LoopRow, [string]>(
        "SELECT * FROM loops WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?",
      )
      .all(now.toISOString());
    const expired: Loop[] = [];
    for (const row of rows) expired.push(this.updateLoop(row.id, { status: "expired", nextRunAt: undefined }));
    return expired;
  }

  countLoops(status?: LoopStatus): number {
    const row = status
      ? this.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM loops WHERE status = ?").get(status)
      : this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM loops").get();
    return row?.count ?? 0;
  }

  countRuns(status?: RunStatus): number {
    const row = status
      ? this.db.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM loop_runs WHERE status = ?").get(status)
      : this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM loop_runs").get();
    return row?.count ?? 0;
  }

  acquireDaemonLease(input: {
    id: string;
    pid: number;
    hostname: string;
    ttlMs: number;
    now?: Date;
  }): DaemonLease | undefined {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.query<LeaseRow, []>("SELECT * FROM daemon_lease LIMIT 1").get();
      if (existing && existing.expires_at > now.toISOString() && existing.id !== input.id) {
        this.db.exec("COMMIT");
        return undefined;
      }
      this.db.query("DELETE FROM daemon_lease").run();
      this.db
        .query(
          `INSERT INTO daemon_lease (id, pid, hostname, heartbeat_at, expires_at, created_at, updated_at)
           VALUES ($id, $pid, $hostname, $heartbeat, $expires, $created, $updated)`,
        )
        .run({
          $id: input.id,
          $pid: input.pid,
          $hostname: input.hostname,
          $heartbeat: now.toISOString(),
          $expires: expiresAt,
          $created: now.toISOString(),
          $updated: now.toISOString(),
        });
      this.db.exec("COMMIT");
      return this.getDaemonLease();
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      throw error;
    }
  }

  heartbeatDaemonLease(id: string, ttlMs: number, now: Date = new Date()): DaemonLease | undefined {
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const res = this.db
      .query(
        `UPDATE daemon_lease SET heartbeat_at=$heartbeat, expires_at=$expires, updated_at=$updated WHERE id=$id`,
      )
      .run({ $id: id, $heartbeat: now.toISOString(), $expires: expiresAt, $updated: now.toISOString() });
    if (res.changes !== 1) return undefined;
    return this.getDaemonLease();
  }

  releaseDaemonLease(id: string): void {
    this.db.query("DELETE FROM daemon_lease WHERE id = ?").run(id);
  }

  getDaemonLease(): DaemonLease | undefined {
    const row = this.db.query<LeaseRow, []>("SELECT * FROM daemon_lease LIMIT 1").get();
    return row ? rowToLease(row) : undefined;
  }

  close(): void {
    this.db.close();
  }
}
