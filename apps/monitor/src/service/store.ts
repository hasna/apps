import { randomUUID } from "node:crypto";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { canonicalJson } from "./definition.js";

/**
 * monitor v2 — durable store over the 008_monitor_v2 tables (design §5).
 *
 * The v2 execution-authority tables (slugs, slug_revisions,
 * slug_control_requests, slug_runs, slug_attempts, leases, slug_effects,
 * receipts, daemon_state) are local authority and are never merged with
 * another machine's lease state.
 */

export const RUN_STATES = [
  "admitted",
  "leased",
  "running",
  "retry_wait",
  "reconciling",
  "cancel_requested",
  "terminal",
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const NON_TERMINAL_RUN_STATES: RunState[] = [
  "admitted",
  "leased",
  "running",
  "retry_wait",
  "reconciling",
  "cancel_requested",
];

export type SlugRow = {
  id: string;
  name: string;
  description: string;
  desired_state: string;
  active_revision_id: string | null;
  execution_epoch: number;
  created_at: number;
  updated_at: number;
};

export type SlugRevisionRow = {
  id: string;
  slug_id: string;
  revision: number;
  definition_json: string;
  definition_digest: string;
  created_at: number;
  created_by: string;
};

export type RunRow = {
  id: string;
  slug_id: string;
  revision_id: string;
  admission_key: string;
  state: string;
  scheduled_at: number;
  admitted_at: number | null;
  started_at: number | null;
  finished_at: number | null;
  outcome: string | null;
  execution_epoch: number;
  attempt_count: number;
  last_attempt_id: string | null;
  terminal_receipt_id: string | null;
  created_at: number;
};

export type AttemptRow = {
  id: string;
  run_id: string;
  attempt_number: number;
  state: string;
  worker_id: string | null;
  lease_id: string | null;
  started_at: number | null;
  finished_at: number | null;
  exit_code: number | null;
  outcome: string | null;
  result_digest: string | null;
  created_at: number;
};

export type ReceiptRow = {
  id: string;
  run_id: string;
  attempt_id: string | null;
  lease_id: string | null;
  lease_generation: number | null;
  state: string;
  reason: string;
  durable_effect_pointer: string | null;
  evidence_pointer: string | null;
  result_digest: string | null;
  created_at: number;
};

export type LeaseRow = {
  id: string;
  attempt_id: string;
  run_id: string;
  worker_id: string;
  generation: number;
  fencing_token_digest: string;
  heartbeat_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
};

export type PagedResult<T> = {
  entries: T[];
  next_cursor: string | null;
  has_more: boolean;
};

function newId(): string {
  return randomUUID();
}

/**
 * Encode a paging cursor as "<created_at>:<id>". Stable ordering is
 * (created_at ASC, id ASC), which never duplicates and never skips rows
 * within a stable snapshot.
 */
export function encodeCursor(createdAt: number, id: string): string {
  return `${createdAt}:${id}`;
}

export function decodeCursor(
  cursor: string | null | undefined
): { createdAt: number; id: string } | null {
  if (!cursor) return null;
  const sep = cursor.indexOf(":");
  if (sep <= 0) return null;
  const createdAt = Number(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (!Number.isFinite(createdAt) || id.length === 0) return null;
  return { createdAt, id };
}

export class MonitorStore {
  constructor(private readonly db: Database) {}

  // ── slugs ────────────────────────────────────────────────────────────────

  getSlugByName(name: string): SlugRow | null {
    return this.db
      .prepare<SlugRow, [string]>(
        "SELECT * FROM slugs WHERE name = ?"
      )
      .get(name);
  }

  getSlugById(id: string): SlugRow | null {
    return this.db
      .prepare<SlugRow, [string]>("SELECT * FROM slugs WHERE id = ?")
      .get(id);
  }

  listSlugs(): SlugRow[] {
    return this.db
      .prepare<SlugRow, []>("SELECT * FROM slugs ORDER BY name ASC")
      .all();
  }

  insertSlug(name: string, description: string): SlugRow {
    const id = newId();
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT INTO slugs (id, name, description, desired_state, execution_epoch, created_at, updated_at)
         VALUES (?, ?, ?, 'stopped', 0, ?, ?)`
      )
      .run(id, name, description, now, now);
    return this.getSlugById(id) as SlugRow;
  }

  setSlugState(slugId: string, state: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        "UPDATE slugs SET desired_state = ?, updated_at = ? WHERE id = ?"
      )
      .run(state, now, slugId);
  }

  setSlugActiveRevision(slugId: string, revisionId: string): void {
    this.db
      .prepare(
        "UPDATE slugs SET active_revision_id = ?, updated_at = ? WHERE id = ?"
      )
      .run(revisionId, Math.floor(Date.now() / 1000), slugId);
  }

  incrementExecutionEpoch(slugId: string): number {
    const row = this.getSlugById(slugId);
    const next = (row?.execution_epoch ?? 0) + 1;
    this.db
      .prepare(
        "UPDATE slugs SET execution_epoch = ?, updated_at = ? WHERE id = ?"
      )
      .run(next, Math.floor(Date.now() / 1000), slugId);
    return next;
  }

  // ── slug_revisions ───────────────────────────────────────────────────────

  insertRevision(
    slugId: string,
    revision: number,
    definition: unknown,
    digest: string,
    createdBy: string
  ): SlugRevisionRow {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO slug_revisions (id, slug_id, revision, definition_json, definition_digest, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        slugId,
        revision,
        canonicalJson(definition),
        digest,
        Math.floor(Date.now() / 1000),
        createdBy
      );
    return this.getRevisionById(id) as SlugRevisionRow;
  }

  getRevisionById(id: string): SlugRevisionRow | null {
    return this.db
      .prepare<SlugRevisionRow, [string]>(
        "SELECT * FROM slug_revisions WHERE id = ?"
      )
      .get(id);
  }

  getRevision(slugId: string, revision: number): SlugRevisionRow | null {
    return this.db
      .prepare<SlugRevisionRow, [string, number]>(
        "SELECT * FROM slug_revisions WHERE slug_id = ? AND revision = ?"
      )
      .get(slugId, revision);
  }

  getActiveRevision(slugId: string): SlugRevisionRow | null {
    const slug = this.getSlugById(slugId);
    if (!slug?.active_revision_id) return null;
    return this.getRevisionById(slug.active_revision_id);
  }

  getLatestRevisionNumber(slugId: string): number {
    const row = this.db
      .prepare<{ revision: number }, [string]>(
        "SELECT COALESCE(MAX(revision), 0) AS revision FROM slug_revisions WHERE slug_id = ?"
      )
      .get(slugId);
    return row?.revision ?? 0;
  }

  // ── slug_control_requests ────────────────────────────────────────────────

  /**
   * Look up a stored control result scoped by slug, idempotency key, AND
   * operation — a key used for `start` must never replay a `stop` result.
   * Returns the stored result plus the request digest so the caller can
   * distinguish an exact replay from a conflicting reuse of the key.
   */
  getControlRequest(
    slugId: string,
    idempotencyKey: string,
    operation: string
  ): { result_json: string; request_digest: string } | null {
    const row = this.db
      .prepare<
        { result_json: string; request_digest: string },
        [string, string, string]
      >(
        `SELECT result_json, request_digest FROM slug_control_requests
         WHERE slug_id = ? AND idempotency_key = ? AND operation = ?`
      )
      .get(slugId, idempotencyKey, operation);
    return row ?? null;
  }

  /**
   * Atomically claim an idempotency key. The claim is ONE statement: INSERT
   * OR IGNORE against the UNIQUE(slug_id, idempotency_key, operation)
   * constraint, with a provisional empty result. A check-then-insert is not
   * atomic — a second writer between the two statements would both pass the
   * check and both execute the operation. With a claim, exactly one writer
   * wins (created: true) and executes; every other writer sees the existing
   * row and must NOT execute.
   */
  claimControlRequest(
    slugId: string,
    idempotencyKey: string,
    operation: string,
    requestDigest: string
  ): { created: boolean; existing: { result_json: string; request_digest: string } } {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO slug_control_requests
           (id, idempotency_key, slug_id, operation, request_digest, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, '', ?)`
      )
      .run(
        newId(),
        idempotencyKey,
        slugId,
        operation,
        requestDigest,
        Math.floor(Date.now() / 1000)
      );
    const existing =
      this.getControlRequest(slugId, idempotencyKey, operation) ?? {
        result_json: "",
        request_digest: requestDigest,
      };
    return { created: res.changes === 1, existing };
  }

  /**
   * Record the result on the row this caller claimed. Only the claim winner
   * calls this; losers never write to the row.
   */
  completeControlRequest(
    slugId: string,
    idempotencyKey: string,
    operation: string,
    resultJson: string
  ): void {
    this.db
      .prepare(
        `UPDATE slug_control_requests
         SET result_json = ?
         WHERE slug_id = ? AND idempotency_key = ? AND operation = ?`
      )
      .run(resultJson, slugId, idempotencyKey, operation);
  }

  // ── slug_runs ────────────────────────────────────────────────────────────

  insertRun(
    slugId: string,
    revisionId: string,
    admissionKey: string,
    executionEpoch: number,
    scheduledAt: number
  ): RunRow {
    const id = newId();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO slug_runs
           (id, slug_id, revision_id, admission_key, state, scheduled_at, admitted_at, execution_epoch, created_at)
         VALUES (?, ?, ?, ?, 'admitted', ?, ?, ?, ?)`
      )
      .run(
        id,
        slugId,
        revisionId,
        admissionKey,
        scheduledAt,
        scheduledAt,
        executionEpoch,
        Math.floor(Date.now() / 1000)
      );
    return this.getRunById(id) as RunRow;
  }

  getRunById(id: string): RunRow | null {
    return this.db
      .prepare<RunRow, [string]>("SELECT * FROM slug_runs WHERE id = ?")
      .get(id);
  }

  getRunByAdmissionKey(admissionKey: string): RunRow | null {
    return this.db
      .prepare<RunRow, [string]>(
        "SELECT * FROM slug_runs WHERE admission_key = ?"
      )
      .get(admissionKey);
  }

  setRunTerminal(
    runId: string,
    outcome: string,
    receiptId: string
  ): void {
    this.db
      .prepare(
        `UPDATE slug_runs
         SET state = 'terminal', outcome = ?, finished_at = ?, terminal_receipt_id = ?
         WHERE id = ?`
      )
      .run(outcome, Math.floor(Date.now() / 1000), receiptId, runId);
  }

  countNonTerminalRuns(slugId: string): number {
    const row = this.db
      .prepare<{ n: number }, [string]>(
        `SELECT COUNT(*) AS n FROM slug_runs
         WHERE slug_id = ? AND state IN ('admitted','leased','running','retry_wait','reconciling','cancel_requested')`
      )
      .get(slugId);
    return row?.n ?? 0;
  }

  countRunsByState(slugId: string, state: string): number {
    const row = this.db
      .prepare<{ n: number }, [string, string]>(
        "SELECT COUNT(*) AS n FROM slug_runs WHERE slug_id = ? AND state = ?"
      )
      .get(slugId, state);
    return row?.n ?? 0;
  }

  countActiveLeases(slugId: string): number {
    const row = this.db
      .prepare<{ n: number }, [string]>(
        `SELECT COUNT(*) AS n FROM leases
         WHERE revoked_at IS NULL
           AND run_id IN (SELECT id FROM slug_runs WHERE slug_id = ?)`
      )
      .get(slugId);
    return row?.n ?? 0;
  }

  countExpiredLeases(slugId: string, nowSec: number): number {
    const row = this.db
      .prepare<{ n: number }, [string, number]>(
        `SELECT COUNT(*) AS n FROM leases
         WHERE run_id IN (SELECT id FROM slug_runs WHERE slug_id = ?)
           AND expires_at IS NOT NULL AND expires_at < ? AND revoked_at IS NULL`
      )
      .get(slugId, nowSec);
    return row?.n ?? 0;
  }

  listRuns(
    slugId: string,
    opts: { state?: string; cursor: string | null; limit: number }
  ): PagedResult<RunRow> {
    const where = ["slug_id = ?"];
    const params: SQLQueryBindings[] = [slugId];
    if (opts.state) {
      where.push("state = ?");
      params.push(opts.state);
    }
    const cursor = decodeCursor(opts.cursor);
    if (cursor) {
      where.push("(created_at > ? OR (created_at = ? AND id > ?))");
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const limit = Math.max(1, Math.min(opts.limit, 1000));
    const rows = this.db
      .prepare<RunRow, SQLQueryBindings[]>(
        `SELECT * FROM slug_runs WHERE ${where.join(" AND ")}
         ORDER BY created_at ASC, id ASC LIMIT ${limit + 1}`
      )
      .all(...params) as RunRow[];
    return this.paginate(rows, limit);
  }

  listAttemptsForRuns(runIds: string[]): AttemptRow[] {
    if (runIds.length === 0) return [];
    const placeholders = runIds.map(() => "?").join(",");
    return this.db
      .prepare<AttemptRow, string[]>(
        `SELECT * FROM slug_attempts WHERE run_id IN (${placeholders})
         ORDER BY run_id ASC, attempt_number ASC`
      )
      .all(...runIds) as AttemptRow[];
  }

  // ── leases ───────────────────────────────────────────────────────────────

  revokeActiveLeasesForSlug(slugId: string): void {
    this.db
      .prepare(
        `UPDATE leases SET revoked_at = ?
         WHERE revoked_at IS NULL
           AND run_id IN (SELECT id FROM slug_runs WHERE slug_id = ?)`
      )
      .run(Math.floor(Date.now() / 1000), slugId);
  }

  // ── receipts ─────────────────────────────────────────────────────────────

  insertReceipt(
    runId: string,
    state: string,
    reason: string,
    opts: {
      attemptId?: string | null;
      leaseId?: string | null;
      leaseGeneration?: number | null;
      durableEffectPointer?: string | null;
      evidencePointer?: string | null;
      resultDigest?: string | null;
    } = {}
  ): ReceiptRow {
    const id = newId();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO receipts
           (id, run_id, attempt_id, lease_id, lease_generation, state, reason,
            durable_effect_pointer, evidence_pointer, result_digest, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        runId,
        opts.attemptId ?? null,
        opts.leaseId ?? null,
        opts.leaseGeneration ?? null,
        state,
        reason,
        opts.durableEffectPointer ?? null,
        opts.evidencePointer ?? null,
        opts.resultDigest ?? null,
        Math.floor(Date.now() / 1000)
      );
    return this.getReceiptById(id) as ReceiptRow;
  }

  getReceiptById(id: string): ReceiptRow | null {
    return this.db
      .prepare<ReceiptRow, [string]>(
        "SELECT * FROM receipts WHERE id = ?"
      )
      .get(id);
  }

  getReceiptByRun(runId: string): ReceiptRow | null {
    return this.db
      .prepare<ReceiptRow, [string]>(
        "SELECT * FROM receipts WHERE run_id = ?"
      )
      .get(runId);
  }

  listReceipts(
    slugId: string,
    opts: { runId?: string; cursor: string | null; limit: number }
  ): PagedResult<ReceiptRow> {
    const where = ["r.slug_id = ?"];
    const params: SQLQueryBindings[] = [slugId];
    if (opts.runId) {
      where.push("rc.run_id = ?");
      params.push(opts.runId);
    }
    const cursor = decodeCursor(opts.cursor);
    if (cursor) {
      where.push("(rc.created_at > ? OR (rc.created_at = ? AND rc.id > ?))");
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const limit = Math.max(1, Math.min(opts.limit, 1000));
    const rows = this.db
      .prepare<ReceiptRow, SQLQueryBindings[]>(
        `SELECT rc.* FROM receipts rc
         JOIN slug_runs r ON r.id = rc.run_id
         WHERE ${where.join(" AND ")}
         ORDER BY rc.created_at ASC, rc.id ASC LIMIT ${limit + 1}`
      )
      .all(...params) as ReceiptRow[];
    return this.paginate(rows, limit);
  }

  getLatestReceipt(slugId: string): ReceiptRow | null {
    return this.db
      .prepare<ReceiptRow, [string]>(
        `SELECT rc.* FROM receipts rc
         JOIN slug_runs r ON r.id = rc.run_id
         WHERE r.slug_id = ?
         ORDER BY rc.created_at DESC, rc.id DESC LIMIT 1`
      )
      .get(slugId);
  }

  hasReceiptForSlug(slugId: string): boolean {
    const row = this.db
      .prepare<{ n: number }, [string]>(
        `SELECT COUNT(*) AS n FROM receipts rc
         JOIN slug_runs r ON r.id = rc.run_id
         WHERE r.slug_id = ?`
      )
      .get(slugId);
    return (row?.n ?? 0) > 0;
  }

  private paginate<T extends { created_at: number; id: string }>(
    rows: T[],
    limit: number
  ): PagedResult<T> {
    const hasMore = rows.length > limit;
    const entries = hasMore ? rows.slice(0, limit) : rows;
    const last = entries[entries.length - 1];
    return {
      entries,
      next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
      has_more: hasMore,
    };
  }
}
