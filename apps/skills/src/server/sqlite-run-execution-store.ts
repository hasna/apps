/**
 * SQLite run-execution store — SERVER side.
 *
 * Moved out of `src/sdk/execution/storage.ts` (fail-closed re-cut, owner ruling
 * 2026-09-07 / hasna/apps#1720): the published `./sdk` surface must not open
 * SQLite. The `RunExecutionStore` interface and the in-memory implementation
 * stay in the SDK; this durable twin is server code.
 */
import { Database } from "bun:sqlite";
import type {
  AttemptReceipt,
  AttemptRecord,
  ExecutionRunRow,
  ExecutionRunStatus,
  FrozenAdmission,
  RunTransitionRecord,
  TerminalRunStatus,
} from "../sdk/execution/types.js";
import { isTerminalStatus } from "../sdk/execution/types.js";
import {
  newRunId,
  type ClaimAttemptInput,
  type ClaimResult,
  type CreateAttemptInput,
  type LaunchIntentResult,
  type RunExecutionStore,
} from "../sdk/execution/storage.js";

/**
 * SQLite backend. `:memory:` is supported for tests; a path gives the durable
 * twin. All writes go through a single connection, so the CAS claim and the
 * launch-intent write are atomic by construction — the same property the
 * postgres backend must provide through row locking.
 */
export class SqliteRunExecutionStore implements RunExecutionStore {
  readonly durable = true;
  private db: Database;

  constructor(path: string = ":memory:") {
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run(SCHEMA_SQL);
  }

  async admit(admission: FrozenAdmission): Promise<ExecutionRunRow> {
    this.db
      .query(
        `INSERT OR IGNORE INTO execution_runs (
           run_id, contract_version, tenant_id, skill_id, skill_version, bundle_digest,
           runtime_image_digest, dependency_layer_tag, input_digest, runtime,
           policy_json, limits_json, idempotency_key, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        admission.runId,
        admission.contractVersion,
        admission.tenantId,
        admission.skillId,
        admission.skillVersion,
        admission.bundleDigest,
        admission.runtimeImageDigest,
        admission.dependencyLayerTag,
        admission.inputDigest,
        admission.runtime,
        JSON.stringify(admission.policy),
        JSON.stringify(admission.limits),
        admission.idempotencyKey,
        "admitted",
        admission.createdAt,
        admission.createdAt,
      );
    const row = this.readRun(admission.runId);
    if (!row) throw new Error(`admission did not persist run ${admission.runId}`);
    return row;
  }

  async getRun(runId: string): Promise<ExecutionRunRow | null> {
    return this.readRun(runId);
  }

  async getRunByKey(tenantId: string, idempotencyKey: string): Promise<ExecutionRunRow | null> {
    const row = this.db
      .query<DbRunRow, [string, string]>(
        `SELECT * FROM execution_runs WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1`,
      )
      .get(tenantId, idempotencyKey);
    return row ? rowToRun(row) : null;
  }

  async getRunByDigests(input: {
    tenantId: string;
    skillId: string;
    skillVersion: string;
    bundleDigest: string;
    inputDigest: string;
  }): Promise<ExecutionRunRow | null> {
    const row = this.db
      .query<DbRunRow, [string, string, string, string, string]>(
        `SELECT * FROM execution_runs
         WHERE tenant_id = ? AND skill_id = ? AND skill_version = ? AND bundle_digest = ? AND input_digest = ?
         LIMIT 1`,
      )
      .get(input.tenantId, input.skillId, input.skillVersion, input.bundleDigest, input.inputDigest);
    return row ? rowToRun(row) : null;
  }

  async listAttempts(runId: string): Promise<AttemptRecord[]> {
    const rows = this.db
      .query<DbAttemptRow, [string]>(`SELECT * FROM execution_attempts WHERE run_id = ? ORDER BY attempt_number ASC`)
      .all(runId);
    return rows.map(rowToAttempt);
  }

  async createAttempt(input: CreateAttemptInput): Promise<AttemptRecord> {
    const attemptId = `${input.runId}/attempt/${input.attemptNumber}`;
    this.db
      .query(
        `INSERT OR IGNORE INTO execution_attempts (
           run_id, attempt_id, attempt_number, lease_generation, status, launch_state
         ) VALUES (?, ?, ?, 0, 'pending', 'unlaunched')`,
      )
      .run(input.runId, attemptId, input.attemptNumber);
    const row = this.readAttempt(attemptId);
    if (!row) throw new Error(`attempt did not persist ${attemptId}`);
    return row;
  }

  async claimAttempt(input: ClaimAttemptInput): Promise<ClaimResult> {
    const run = this.readRun(input.runId);
    if (!run) return { ok: false, reason: "RUN_TERMINAL" };
    if (run.status === "cancelled") return { ok: false, reason: "RUN_CANCELLED" };
    if (isTerminalStatus(run.status)) return { ok: false, reason: "RUN_TERMINAL" };

    const attempt = this.readAttempt(input.attemptId);
    if (!attempt) return { ok: false, reason: "NO_SUCH_ATTEMPT" };
    if (attempt.status === "terminal") return { ok: false, reason: "ATTEMPT_TERMINAL" };
    // Single-statement CAS: the WHERE clause carries the expected generation,
    // so two processes cannot both claim the same generation.
    const result = this.db
      .query(
        `UPDATE execution_attempts
         SET lease_generation = lease_generation + 1, worker_id = ?, claimed_at = ?, status = 'leased'
         WHERE attempt_id = ? AND lease_generation = ? AND status != 'terminal'`,
      )
      .run(input.workerId, new Date().toISOString(), input.attemptId, input.expectedLeaseGeneration);
    if (result.changes !== 1) return { ok: false, reason: "STALE_GENERATION" };
    const next = this.readAttempt(input.attemptId);
    if (!next) return { ok: false, reason: "NO_SUCH_ATTEMPT" };
    return { ok: true, attempt: next, leaseGeneration: next.leaseGeneration };
  }

  async recordLaunchIntent(input: {
    runId: string;
    attemptId: string;
    clientToken: string;
    requestDigest: string;
    startedBy: string;
  }): Promise<LaunchIntentResult> {
    const run = this.readRun(input.runId);
    if (!run) return { ok: false, reason: "RUN_TERMINAL" };
    if (run.status === "cancelled") return { ok: false, reason: "RUN_CANCELLED" };
    if (isTerminalStatus(run.status)) return { ok: false, reason: "RUN_TERMINAL" };
    const attempt = this.readAttempt(input.attemptId);
    if (!attempt) return { ok: false, reason: "NO_SUCH_ATTEMPT" };
    if (attempt.status === "terminal") return { ok: false, reason: "ATTEMPT_TERMINAL" };
    this.db
      .query(
        `UPDATE execution_attempts
         SET client_token = ?, request_digest = ?, started_by = ?, launch_state = 'launching'
         WHERE attempt_id = ?`,
      )
      .run(input.clientToken, input.requestDigest, input.startedBy, input.attemptId);
    this.db
      .query(`UPDATE execution_runs SET current_attempt_id = ?, updated_at = ? WHERE run_id = ?`)
      .run(input.attemptId, new Date().toISOString(), input.runId);
    const next = this.readAttempt(input.attemptId);
    if (!next) return { ok: false, reason: "NO_SUCH_ATTEMPT" };
    return { ok: true, attempt: next };
  }

  async recordLaunchState(input: {
    runId: string;
    attemptId: string;
    launchState: AttemptRecord["launchState"];
    taskId?: string | null;
  }): Promise<AttemptRecord | null> {
    if (input.taskId === undefined) {
      this.db.query(`UPDATE execution_attempts SET launch_state = ? WHERE attempt_id = ?`).run(input.launchState, input.attemptId);
    } else {
      this.db
        .query(`UPDATE execution_attempts SET launch_state = ?, task_id = ? WHERE attempt_id = ?`)
        .run(input.launchState, input.taskId, input.attemptId);
    }
    return this.readAttempt(input.attemptId);
  }

  async recordTransition(transition: RunTransitionRecord): Promise<void> {
    this.db
      .query(
        `INSERT INTO execution_transitions (run_id, attempt_id, from_status, to_status, at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(transition.runId, transition.attemptId, transition.from, transition.to, transition.at);
  }

  async markAttemptTerminal(runId: string, attemptId: string): Promise<AttemptRecord | null> {
    this.db
      .query(
        `UPDATE execution_attempts SET status = 'terminal' WHERE attempt_id = ? AND run_id = ? AND status != 'terminal'`,
      )
      .run(attemptId, runId);
    return this.readAttempt(attemptId);
  }

  async writeReceipt(receipt: AttemptReceipt): Promise<AttemptReceipt> {
    this.db
      .query(
        `INSERT OR REPLACE INTO execution_receipts (
           run_id, attempt_id, lease_generation, client_token, request_digest, started_by,
           task_id, launched_at, completed_at, runtime_image_digest, bundle_digest,
           dependency_layer_tag, policy_json, limits_json, exit_code, status,
           artifact_pointers_json, log_pointers_json, cost_cents
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.runId,
        receipt.attemptId,
        receipt.leaseGeneration,
        receipt.clientToken,
        receipt.requestDigest,
        receipt.startedBy,
        receipt.taskId,
        receipt.launchedAt,
        receipt.completedAt,
        receipt.runtimeImageDigest,
        receipt.bundleDigest,
        receipt.dependencyLayerTag,
        JSON.stringify(receipt.policy),
        JSON.stringify(receipt.limits),
        receipt.exitCode,
        receipt.status,
        JSON.stringify(receipt.artifactPointers),
        JSON.stringify(receipt.logPointers),
        receipt.costCents,
      );
    return receipt;
  }

  async getReceipt(runId: string, attemptId: string): Promise<AttemptReceipt | null> {
    const row = this.db
      .query<DbReceiptRow, [string, string]>(`SELECT * FROM execution_receipts WHERE run_id = ? AND attempt_id = ?`)
      .get(runId, attemptId);
    return row ? rowToReceipt(row) : null;
  }

  async finalizeRun(runId: string, status: TerminalRunStatus, receiptId: string): Promise<ExecutionRunRow | null> {
    this.db
      .query(`UPDATE execution_runs SET status = ?, terminal_receipt_id = ?, updated_at = ? WHERE run_id = ?`)
      .run(status, receiptId, new Date().toISOString(), runId);
    this.db
      .query(`UPDATE execution_attempts SET status = 'terminal' WHERE run_id = ? AND status != 'terminal'`)
      .run(runId);
    return this.readRun(runId);
  }

  async setRunStatus(runId: string, status: ExecutionRunStatus): Promise<ExecutionRunRow | null> {
    this.db.query(`UPDATE execution_runs SET status = ?, updated_at = ? WHERE run_id = ?`).run(status, new Date().toISOString(), runId);
    return this.readRun(runId);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private readRun(runId: string): ExecutionRunRow | null {
    const row = this.db.query<DbRunRow, [string]>(`SELECT * FROM execution_runs WHERE run_id = ?`).get(runId);
    return row ? rowToRun(row) : null;
  }

  private readAttempt(attemptId: string): AttemptRecord | null {
    const row = this.db.query<DbAttemptRow, [string]>(`SELECT * FROM execution_attempts WHERE attempt_id = ?`).get(attemptId);
    return row ? rowToAttempt(row) : null;
  }
}

interface DbRunRow {
  run_id: string;
  contract_version: number;
  tenant_id: string;
  skill_id: string;
  skill_version: string;
  bundle_digest: string;
  runtime_image_digest: string;
  dependency_layer_tag: string | null;
  input_digest: string;
  runtime: string;
  policy_json: string;
  limits_json: string;
  idempotency_key: string;
  status: string;
  created_at: string;
  updated_at: string;
  current_attempt_id: string | null;
  terminal_receipt_id: string | null;
}

interface DbAttemptRow {
  run_id: string;
  attempt_id: string;
  attempt_number: number;
  lease_generation: number;
  worker_id: string | null;
  claimed_at: string | null;
  status: string;
  client_token: string | null;
  request_digest: string | null;
  task_id: string | null;
  launch_state: string;
  started_by: string | null;
}

interface DbReceiptRow {
  run_id: string;
  attempt_id: string;
  lease_generation: number;
  client_token: string;
  request_digest: string;
  started_by: string;
  task_id: string | null;
  launched_at: string;
  completed_at: string | null;
  runtime_image_digest: string;
  bundle_digest: string;
  dependency_layer_tag: string | null;
  policy_json: string;
  limits_json: string;
  exit_code: number | null;
  status: string | null;
  artifact_pointers_json: string;
  log_pointers_json: string;
  cost_cents: number | null;
}

function rowToRun(row: DbRunRow): ExecutionRunRow {
  return {
    admission: {
      contractVersion: row.contract_version,
      runId: row.run_id,
      tenantId: row.tenant_id,
      skillId: row.skill_id,
      skillVersion: row.skill_version,
      bundleDigest: row.bundle_digest,
      runtimeImageDigest: row.runtime_image_digest,
      dependencyLayerTag: row.dependency_layer_tag,
      inputDigest: row.input_digest,
      runtime: row.runtime as FrozenAdmission["runtime"],
      policy: JSON.parse(row.policy_json),
      limits: JSON.parse(row.limits_json),
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
    },
    status: row.status as ExecutionRunStatus,
    currentAttemptId: row.current_attempt_id,
    terminalReceiptId: row.terminal_receipt_id,
    updatedAt: row.updated_at,
  };
}

function rowToAttempt(row: DbAttemptRow): AttemptRecord {
  return {
    runId: row.run_id,
    attemptId: row.attempt_id,
    attemptNumber: row.attempt_number,
    leaseGeneration: row.lease_generation,
    workerId: row.worker_id,
    claimedAt: row.claimed_at,
    status: row.status as AttemptRecord["status"],
    clientToken: row.client_token,
    requestDigest: row.request_digest,
    taskId: row.task_id,
    launchState: row.launch_state as AttemptRecord["launchState"],
    startedBy: row.started_by,
  };
}

function rowToReceipt(row: DbReceiptRow): AttemptReceipt {
  return {
    runId: row.run_id,
    attemptId: row.attempt_id,
    leaseGeneration: row.lease_generation,
    clientToken: row.client_token,
    requestDigest: row.request_digest,
    startedBy: row.started_by,
    taskId: row.task_id,
    launchedAt: row.launched_at,
    completedAt: row.completed_at,
    runtimeImageDigest: row.runtime_image_digest,
    bundleDigest: row.bundle_digest,
    dependencyLayerTag: row.dependency_layer_tag,
    policy: JSON.parse(row.policy_json),
    limits: JSON.parse(row.limits_json),
    exitCode: row.exit_code,
    status: row.status as AttemptReceipt["status"],
    artifactPointers: JSON.parse(row.artifact_pointers_json),
    logPointers: JSON.parse(row.log_pointers_json),
    costCents: row.cost_cents,
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS execution_runs (
  run_id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  bundle_digest TEXT NOT NULL,
  runtime_image_digest TEXT NOT NULL,
  dependency_layer_tag TEXT,
  input_digest TEXT NOT NULL,
  runtime TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  limits_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  current_attempt_id TEXT,
  terminal_receipt_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS execution_runs_idem ON execution_runs (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS execution_runs_digests ON execution_runs (tenant_id, skill_id, skill_version, bundle_digest, input_digest);

CREATE TABLE IF NOT EXISTS execution_attempts (
  run_id TEXT NOT NULL REFERENCES execution_runs (run_id),
  attempt_id TEXT PRIMARY KEY,
  attempt_number INTEGER NOT NULL,
  lease_generation INTEGER NOT NULL,
  worker_id TEXT,
  claimed_at TEXT,
  status TEXT NOT NULL,
  client_token TEXT,
  request_digest TEXT,
  task_id TEXT,
  launch_state TEXT NOT NULL,
  started_by TEXT
);
CREATE INDEX IF NOT EXISTS execution_attempts_run ON execution_attempts (run_id, attempt_number);

CREATE TABLE IF NOT EXISTS execution_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  attempt_id TEXT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS execution_transitions_run ON execution_transitions (run_id);

CREATE TABLE IF NOT EXISTS execution_receipts (
  run_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  lease_generation INTEGER NOT NULL,
  client_token TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  started_by TEXT NOT NULL,
  task_id TEXT,
  launched_at TEXT NOT NULL,
  completed_at TEXT,
  runtime_image_digest TEXT NOT NULL,
  bundle_digest TEXT NOT NULL,
  dependency_layer_tag TEXT,
  policy_json TEXT NOT NULL,
  limits_json TEXT NOT NULL,
  exit_code INTEGER,
  status TEXT,
  artifact_pointers_json TEXT NOT NULL,
  log_pointers_json TEXT NOT NULL,
  cost_cents INTEGER,
  PRIMARY KEY (run_id, attempt_id)
);
`;
