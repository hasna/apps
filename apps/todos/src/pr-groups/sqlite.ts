import type { Database } from "bun:sqlite";
import {
  type PrGroupAttemptRecord,
  type PrGroupEventListOptions,
  type PrGroupEventRecord,
  type PrGroupLedgerPersistence,
  type PrGroupLedgerTransaction,
  type PrGroupRecord,
} from "./types.js";

const sqliteTransactionTails = new WeakMap<Database, Promise<void>>();

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function groupFromRow(row: Record<string, unknown>): PrGroupRecord {
  return {
    ...row,
    schema_version: Number(row["schema_version"]),
    pr_number: row["pr_number"] === null ? null : Number(row["pr_number"]),
    repair_cycle_count: Number(row["repair_cycle_count"]),
    repair_cycle_limit: Number(row["repair_cycle_limit"]),
    revision: Number(row["revision"]),
  } as unknown as PrGroupRecord;
}

function attemptFromRow(row: Record<string, unknown>): PrGroupAttemptRecord {
  return {
    ...row,
    schema_version: Number(row["schema_version"]),
    pr_number: row["pr_number"] === null ? null : Number(row["pr_number"]),
  } as unknown as PrGroupAttemptRecord;
}

function eventFromRow(row: Record<string, unknown>): PrGroupEventRecord {
  return {
    ...row,
    schema_version: Number(row["schema_version"]),
    sequence: Number(row["sequence"]),
    pr_number: row["pr_number"] === null ? null : Number(row["pr_number"]),
    repair_cycle: row["repair_cycle"] === null ? null : Number(row["repair_cycle"]),
    ci_proof: row["ci_proof"]
      ? parseJson(String(row["ci_proof"]))
      : null,
    cleanup_proof: row["cleanup_proof"]
      ? parseJson(String(row["cleanup_proof"]))
      : null,
    metadata: parseJson<Record<string, unknown>>(String(row["metadata"] ?? "{}")),
  } as unknown as PrGroupEventRecord;
}

class SqlitePrGroupTransaction implements PrGroupLedgerTransaction {
  constructor(private readonly db: Database) {}

  async getGroup(id: string): Promise<PrGroupRecord | null> {
    const row = this.db.query("SELECT * FROM pr_groups WHERE id = ? LIMIT 1").get(id) as Record<string, unknown> | null;
    return row ? groupFromRow(row) : null;
  }

  async insertGroup(group: PrGroupRecord): Promise<boolean> {
    const result = this.db.query(`
      INSERT OR IGNORE INTO pr_groups (
        schema_version, id, identity_key, root_request_id, repository,
        leaf_task_id, branch, pr_number, base_sha, state,
        active_attempt_id, active_generation, repair_cycle_count, repair_cycle_limit,
        terminal_attempt_id, terminal_generation,
        terminal_outcome, terminal_head_sha, terminal_at, cleanup_eligible_at,
        revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      group.schema_version, group.id, group.identity_key, group.root_request_id, group.repository,
      group.leaf_task_id, group.branch, group.pr_number, group.base_sha, group.state,
      group.active_attempt_id, group.active_generation, group.repair_cycle_count, group.repair_cycle_limit,
      group.terminal_attempt_id, group.terminal_generation,
      group.terminal_outcome, group.terminal_head_sha, group.terminal_at, group.cleanup_eligible_at,
      group.revision, group.created_at, group.updated_at,
    );
    return result.changes === 1;
  }

  async updateGroup(group: PrGroupRecord): Promise<void> {
    this.db.query(`
      UPDATE pr_groups SET
        state = ?, active_attempt_id = ?, active_generation = ?,
        repair_cycle_count = ?, repair_cycle_limit = ?,
        terminal_attempt_id = ?, terminal_generation = ?, terminal_outcome = ?,
        terminal_head_sha = ?, terminal_at = ?, cleanup_eligible_at = ?,
        revision = ?, updated_at = ?
      WHERE id = ?
    `).run(
      group.state, group.active_attempt_id, group.active_generation,
      group.repair_cycle_count, group.repair_cycle_limit,
      group.terminal_attempt_id, group.terminal_generation, group.terminal_outcome,
      group.terminal_head_sha, group.terminal_at, group.cleanup_eligible_at,
      group.revision, group.updated_at, group.id,
    );
  }

  async getAttempt(id: string): Promise<PrGroupAttemptRecord | null> {
    const row = this.db.query("SELECT * FROM pr_group_attempts WHERE id = ? LIMIT 1").get(id) as Record<string, unknown> | null;
    return row ? attemptFromRow(row) : null;
  }

  async listAttempts(groupId: string): Promise<PrGroupAttemptRecord[]> {
    return (this.db.query(
      "SELECT * FROM pr_group_attempts WHERE group_id = ? ORDER BY created_at ASC, id ASC",
    ).all(groupId) as Record<string, unknown>[]).map(attemptFromRow);
  }

  async insertAttempt(attempt: PrGroupAttemptRecord): Promise<boolean> {
    const result = this.db.query(`
      INSERT OR IGNORE INTO pr_group_attempts (
        schema_version, id, group_id, leaf_task_id, dispatch_attempt, writer_generation,
        previous_attempt_id, worktree, branch, repository, pr_number, base_sha,
        provider, provider_run_id, profile_alias,
        status, admitted_at, started_at, last_heartbeat_at, handed_off_at, fenced_at,
        terminal_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attempt.schema_version, attempt.id, attempt.group_id, attempt.leaf_task_id,
      attempt.dispatch_attempt, attempt.writer_generation, attempt.previous_attempt_id,
      attempt.worktree, attempt.branch, attempt.repository, attempt.pr_number, attempt.base_sha,
      attempt.provider, attempt.provider_run_id,
      attempt.profile_alias, attempt.status, attempt.admitted_at, attempt.started_at,
      attempt.last_heartbeat_at, attempt.handed_off_at, attempt.fenced_at,
      attempt.terminal_at, attempt.created_at, attempt.updated_at,
    );
    return result.changes === 1;
  }

  async updateAttempt(attempt: PrGroupAttemptRecord): Promise<void> {
    this.db.query(`
      UPDATE pr_group_attempts SET
        status = ?, started_at = ?, last_heartbeat_at = ?, handed_off_at = ?,
        fenced_at = ?, terminal_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      attempt.status, attempt.started_at, attempt.last_heartbeat_at, attempt.handed_off_at,
      attempt.fenced_at, attempt.terminal_at, attempt.updated_at, attempt.id,
    );
  }

  async getEventByIdempotency(groupId: string, key: string): Promise<PrGroupEventRecord | null> {
    const row = this.db.query(
      "SELECT * FROM pr_group_events WHERE group_id = ? AND idempotency_key = ? LIMIT 1",
    ).get(groupId, key) as Record<string, unknown> | null;
    return row ? eventFromRow(row) : null;
  }

  async findEventByReceiptKey(receiptKey: string): Promise<PrGroupEventRecord | null> {
    const row = this.db.query(
      "SELECT * FROM pr_group_events WHERE receipt_key = ? ORDER BY sequence DESC LIMIT 1",
    ).get(receiptKey) as Record<string, unknown> | null;
    return row ? eventFromRow(row) : null;
  }

  async findEvent(groupId: string, filters: {
    event_type: PrGroupEventRecord["event_type"];
    attempt_id?: string;
    head_sha?: string | null;
    outcome?: PrGroupEventRecord["outcome"];
    receipt_key?: string;
  }): Promise<PrGroupEventRecord | null> {
    const clauses = ["group_id = ?", "event_type = ?"];
    const values: string[] = [groupId, filters.event_type];
    for (const key of ["attempt_id", "head_sha", "outcome", "receipt_key"] as const) {
      if (!(key in filters)) continue;
      if (filters[key] === null) clauses.push(`${key} IS NULL`);
      else {
        clauses.push(`${key} = ?`);
        values.push(String(filters[key]));
      }
    }
    const row = this.db.query(
      `SELECT * FROM pr_group_events WHERE ${clauses.join(" AND ")} ORDER BY sequence DESC LIMIT 1`,
    ).get(...values) as Record<string, unknown> | null;
    return row ? eventFromRow(row) : null;
  }

  async listEvents(groupId: string, options: PrGroupEventListOptions = {}): Promise<PrGroupEventRecord[]> {
    const limit = options.limit ?? 500;
    const after = options.after_sequence ?? 0;
    return (this.db.query(`
      SELECT * FROM pr_group_events
      WHERE group_id = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `).all(groupId, after, limit) as Record<string, unknown>[]).map(eventFromRow);
  }

  async nextSequence(groupId: string): Promise<number> {
    const row = this.db.query(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM pr_group_events WHERE group_id = ?",
    ).get(groupId) as { sequence: number };
    return Number(row.sequence);
  }

  async insertEvent(event: PrGroupEventRecord): Promise<boolean> {
    const result = this.db.query(`
      INSERT OR IGNORE INTO pr_group_events (
        schema_version, id, group_id, attempt_id, writer_generation, sequence,
        idempotency_key, event_type, state, message, head_sha, receipt_key,
        review_receipt_key, conditional_merge_receipt_key, outcome,
        repository, pr_number, base_sha, actor_id, actor_run_id,
        expected_reviewer_id, expected_reviewer_run_id, repair_cycle, ci_proof,
        cleanup_proof, metadata, payload_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.schema_version, event.id, event.group_id, event.attempt_id,
      event.writer_generation, event.sequence, event.idempotency_key, event.event_type,
      event.state, event.message, event.head_sha, event.receipt_key,
      event.review_receipt_key, event.conditional_merge_receipt_key, event.outcome,
      event.repository, event.pr_number, event.base_sha, event.actor_id, event.actor_run_id,
      event.expected_reviewer_id, event.expected_reviewer_run_id, event.repair_cycle,
      event.ci_proof ? JSON.stringify(event.ci_proof) : null,
      event.cleanup_proof ? JSON.stringify(event.cleanup_proof) : null,
      JSON.stringify(event.metadata), event.payload_hash, event.created_at,
    );
    return result.changes === 1;
  }
}

export class SqlitePrGroupLedgerPersistence implements PrGroupLedgerPersistence {
  readonly authority = "local" as const;
  private readonly tx: SqlitePrGroupTransaction;

  constructor(private readonly db: Database) {
    this.tx = new SqlitePrGroupTransaction(db);
  }

  async transaction<T>(fn: (tx: PrGroupLedgerTransaction) => Promise<T>): Promise<T> {
    const previous = sqliteTransactionTails.get(this.db) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    sqliteTransactionTails.set(this.db, current);
    await previous;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const result = await fn(this.tx);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch {}
      throw error;
    } finally {
      release();
      if (sqliteTransactionTails.get(this.db) === current) sqliteTransactionTails.delete(this.db);
    }
  }

  getGroup(id: string): Promise<PrGroupRecord | null> {
    return this.tx.getGroup(id);
  }

  listAttempts(groupId: string): Promise<PrGroupAttemptRecord[]> {
    return this.tx.listAttempts(groupId);
  }

  listEvents(groupId: string, options?: PrGroupEventListOptions): Promise<PrGroupEventRecord[]> {
    return this.tx.listEvents(groupId, options);
  }

  async listReceiptEvents(groupId: string, limit: number): Promise<PrGroupEventRecord[]> {
    return (this.db.query(`
      SELECT * FROM pr_group_events
      WHERE group_id = ? AND event_type IN (
        'review_receipt', 'conditional_merge_receipt', 'merge_outcome', 'cleanup_eligible'
      )
      ORDER BY sequence ASC LIMIT ?
    `).all(groupId, limit) as Record<string, unknown>[]).map(eventFromRow);
  }

  async countEvents(groupId: string): Promise<number> {
    const row = this.db.query(
      "SELECT COUNT(*) AS count FROM pr_group_events WHERE group_id = ?",
    ).get(groupId) as { count: number };
    return Number(row.count);
  }

  async getLatestEvent(groupId: string): Promise<PrGroupEventRecord | null> {
    const row = this.db.query(
      "SELECT * FROM pr_group_events WHERE group_id = ? ORDER BY sequence DESC LIMIT 1",
    ).get(groupId) as Record<string, unknown> | null;
    return row ? eventFromRow(row) : null;
  }
}
