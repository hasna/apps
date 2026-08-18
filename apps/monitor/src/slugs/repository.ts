/**
 * SlugRepository — typed access to the monitor v2 persistence model
 * (design §5). One repository over the v2 tables created by migration
 * 008_monitor_v2.sql, through the DbAdapter so it works against both the
 * SQLite and PostgreSQL adapters.
 *
 * Uniqueness is enforced by the schema (see the migration); idempotent
 * paths (control requests, run admission, effects, receipts) use
 * ON CONFLICT DO NOTHING followed by a select, so a repeated operation
 * returns the existing row rather than raising.
 */

import { randomUUID } from "crypto";
import type { DbAdapter } from "../db/adapter.js";

// ── Row types (mirror 008_monitor_v2.sql) ───────────────────────────────────

export type DesiredState = "stopped" | "draining" | "running";
export type RunState =
  | "admitted"
  | "leased"
  | "running"
  | "retry_wait"
  | "reconciling"
  | "cancel_requested"
  | "terminal";
export type AttemptState =
  | "leased"
  | "running"
  | "reconciling"
  | "succeeded"
  | "failed"
  | "unknown"
  | "cancelled"
  | "expired";
export type EffectState = "planned" | "sent" | "confirmed" | "unknown" | "failed";
export type DaemonStateName = "starting" | "running" | "draining" | "stopped";

export interface SlugRow {
  id: string;
  name: string;
  description: string;
  desired_state: DesiredState;
  active_revision_id: string | null;
  execution_epoch: number;
  created_at: number;
  updated_at: number;
}

export interface SlugRevisionRow {
  id: string;
  slug_id: string;
  revision: number;
  definition_json: string;
  definition_digest: string;
  created_at: number;
  created_by: string;
}

export interface SlugControlRequestRow {
  id: string;
  idempotency_key: string;
  slug_id: string;
  operation: string;
  request_digest: string;
  result_json: string;
  created_at: number;
}

export interface SlugRunRow {
  id: string;
  slug_id: string;
  revision_id: string | null;
  admission_key: string;
  state: RunState;
  scheduled_at: number;
  admitted_at: number;
  started_at: number | null;
  finished_at: number | null;
  outcome: string | null;
  execution_epoch: number;
  attempt_count: number;
  last_attempt_id: string | null;
  terminal_receipt_id: string | null;
  created_at: number;
}

export interface SlugAttemptRow {
  id: string;
  run_id: string;
  attempt_number: number;
  state: AttemptState;
  worker_id: string | null;
  lease_id: string | null;
  started_at: number | null;
  finished_at: number | null;
  exit_code: number | null;
  outcome: string | null;
  result_digest: string | null;
  created_at: number;
}

export interface LeaseRow {
  id: string;
  attempt_id: string;
  run_id: string;
  worker_id: string;
  generation: number;
  fencing_token_digest: string;
  heartbeat_at: number | null;
  expires_at: number;
  revoked_at: number | null;
  created_at: number;
}

export interface SlugEffectRow {
  id: string;
  run_id: string;
  attempt_id: string | null;
  effect_key: string;
  integration: string;
  operation: string;
  target: string;
  state: EffectState;
  request_digest: string;
  external_id: string | null;
  result_pointer: string | null;
  last_error_class: string | null;
  created_at: number;
  updated_at: number;
}

export interface ReceiptRow {
  id: string;
  run_id: string;
  attempt_id: string | null;
  lease_id: string | null;
  lease_generation: number;
  state: string;
  reason: string;
  durable_effect_pointer: string | null;
  evidence_pointer: string | null;
  result_digest: string;
  created_at: number;
}

export interface DaemonStateRow {
  id: string;
  daemon_id: string;
  state: DaemonStateName;
  leader_epoch: number;
  worker_capacity: number;
  heartbeat_at: number | null;
  drain_started_at: number | null;
  updated_at: number;
}

// ── Repository ───────────────────────────────────────────────────────────────

const slugColumns = "id, name, description, desired_state, active_revision_id, execution_epoch, created_at, updated_at";
const revisionColumns = "id, slug_id, revision, definition_json, definition_digest, created_at, created_by";
const controlColumns = "id, idempotency_key, slug_id, operation, request_digest, result_json, created_at";
const runColumns =
  "id, slug_id, revision_id, admission_key, state, scheduled_at, admitted_at, started_at, finished_at, outcome, execution_epoch, attempt_count, last_attempt_id, terminal_receipt_id, created_at";
const attemptColumns =
  "id, run_id, attempt_number, state, worker_id, lease_id, started_at, finished_at, exit_code, outcome, result_digest, created_at";
const leaseColumns =
  "id, attempt_id, run_id, worker_id, generation, fencing_token_digest, heartbeat_at, expires_at, revoked_at, created_at";
const effectColumns =
  "id, run_id, attempt_id, effect_key, integration, operation, target, state, request_digest, external_id, result_pointer, last_error_class, created_at, updated_at";
const receiptColumns =
  "id, run_id, attempt_id, lease_id, lease_generation, state, reason, durable_effect_pointer, evidence_pointer, result_digest, created_at";
const daemonColumns =
  "id, daemon_id, state, leader_epoch, worker_capacity, heartbeat_at, drain_started_at, updated_at";

export class SlugRepository {
  constructor(private readonly adapter: DbAdapter) {}

  // ── slugs ────────────────────────────────────────────────────────────────

  createSlug(input: {
    name: string;
    description?: string;
    desired_state?: DesiredState;
    execution_epoch?: number;
  }): SlugRow {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    this.adapter.run(
      `INSERT INTO slugs (id, name, description, desired_state, execution_epoch, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.name,
        input.description ?? "",
        input.desired_state ?? "stopped",
        input.execution_epoch ?? 0,
        now,
        now,
      ]
    );
    return this.getSlug(id)!;
  }

  getSlug(id: string): SlugRow | null {
    return this.adapter.get<SlugRow>(`SELECT ${slugColumns} FROM slugs WHERE id = ?`, [id]);
  }

  getSlugByName(name: string): SlugRow | null {
    return this.adapter.get<SlugRow>(`SELECT ${slugColumns} FROM slugs WHERE name = ?`, [name]);
  }

  listSlugs(limit = 1000, cursor?: string): SlugRow[] {
    if (cursor) {
      return this.adapter.all<SlugRow>(
        `SELECT ${slugColumns} FROM slugs WHERE name > ? ORDER BY name ASC LIMIT ?`,
        [cursor, limit]
      );
    }
    return this.adapter.all<SlugRow>(
      `SELECT ${slugColumns} FROM slugs ORDER BY name ASC LIMIT ?`,
      [limit]
    );
  }

  setDesiredState(id: string, state: DesiredState): void {
    this.adapter.run(
      "UPDATE slugs SET desired_state = ?, updated_at = unixepoch() WHERE id = ?",
      [state, id]
    );
  }

  setActiveRevision(id: string, revisionId: string): void {
    this.adapter.run(
      "UPDATE slugs SET active_revision_id = ?, updated_at = unixepoch() WHERE id = ?",
      [revisionId, id]
    );
  }

  bumpExecutionEpoch(id: string): void {
    this.adapter.run(
      "UPDATE slugs SET execution_epoch = execution_epoch + 1, updated_at = unixepoch() WHERE id = ?",
      [id]
    );
  }

  // ── slug_revisions ───────────────────────────────────────────────────────

  createRevision(input: {
    slugId: string;
    revision: number;
    definitionJson: string;
    definitionDigest: string;
    createdBy: string;
  }): SlugRevisionRow {
    const id = randomUUID();
    this.adapter.run(
      `INSERT INTO slug_revisions (id, slug_id, revision, definition_json, definition_digest, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.slugId, input.revision, input.definitionJson, input.definitionDigest, input.createdBy]
    );
    return this.adapter.get<SlugRevisionRow>(
      `SELECT ${revisionColumns} FROM slug_revisions WHERE id = ?`,
      [id]
    )!;
  }

  getRevision(slugId: string, revision: number): SlugRevisionRow | null {
    return this.adapter.get<SlugRevisionRow>(
      `SELECT ${revisionColumns} FROM slug_revisions WHERE slug_id = ? AND revision = ?`,
      [slugId, revision]
    );
  }

  getActiveRevision(slugId: string): SlugRevisionRow | null {
    return this.adapter.get<SlugRevisionRow>(
      `SELECT ${revisionColumns.split(", ").map((c) => `r.${c}`).join(", ")}
       FROM slug_revisions r
       JOIN slugs s ON s.active_revision_id = r.id
       WHERE s.id = ?`,
      [slugId]
    );
  }

  listRevisions(slugId: string): SlugRevisionRow[] {
    return this.adapter.all<SlugRevisionRow>(
      `SELECT ${revisionColumns} FROM slug_revisions WHERE slug_id = ? ORDER BY revision ASC`,
      [slugId]
    );
  }

  // ── slug_control_requests ────────────────────────────────────────────────

  recordControlRequest(input: {
    slugId: string;
    idempotencyKey: string;
    operation: string;
    requestDigest: string;
    resultJson?: string;
  }): { created: boolean; request: SlugControlRequestRow } {
    const id = randomUUID();
    const changed = this.adapter.run(
      `INSERT INTO slug_control_requests (id, idempotency_key, slug_id, operation, request_digest, result_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (slug_id, idempotency_key) DO NOTHING`,
      [id, input.idempotencyKey, input.slugId, input.operation, input.requestDigest, input.resultJson ?? ""]
    );
    const request = this.adapter.get<SlugControlRequestRow>(
      `SELECT ${controlColumns} FROM slug_control_requests WHERE slug_id = ? AND idempotency_key = ?`,
      [input.slugId, input.idempotencyKey]
    )!;
    return { created: request.id === id, request };
  }

  getControlRequest(slugId: string, idempotencyKey: string): SlugControlRequestRow | null {
    return this.adapter.get<SlugControlRequestRow>(
      `SELECT ${controlColumns} FROM slug_control_requests WHERE slug_id = ? AND idempotency_key = ?`,
      [slugId, idempotencyKey]
    );
  }

  // ── slug_runs ────────────────────────────────────────────────────────────

  createRun(input: {
    slugId: string;
    revisionId?: string | null;
    admissionKey: string;
    scheduledAt: number;
    executionEpoch: number;
  }): { created: boolean; run: SlugRunRow } {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    this.adapter.run(
      `INSERT INTO slug_runs (id, slug_id, revision_id, admission_key, state, scheduled_at, admitted_at, execution_epoch)
       VALUES (?, ?, ?, ?, 'admitted', ?, ?, ?)
       ON CONFLICT (admission_key) DO NOTHING`,
      [id, input.slugId, input.revisionId ?? null, input.admissionKey, input.scheduledAt, now, input.executionEpoch]
    );
    const run = this.adapter.get<SlugRunRow>(
      `SELECT ${runColumns} FROM slug_runs WHERE admission_key = ?`,
      [input.admissionKey]
    )!;
    return { created: run.id === id, run };
  }

  getRun(id: string): SlugRunRow | null {
    return this.adapter.get<SlugRunRow>(`SELECT ${runColumns} FROM slug_runs WHERE id = ?`, [id]);
  }

  getRunByAdmissionKey(admissionKey: string): SlugRunRow | null {
    return this.adapter.get<SlugRunRow>(
      `SELECT ${runColumns} FROM slug_runs WHERE admission_key = ?`,
      [admissionKey]
    );
  }

  listRuns(
    slugId: string,
    opts: { state?: RunState; limit?: number; cursor?: string } = {}
  ): SlugRunRow[] {
    const limit = opts.limit ?? 100;
    const clauses: string[] = ["slug_id = ?"];
    const params: unknown[] = [slugId];
    if (opts.state) {
      clauses.push("state = ?");
      params.push(opts.state);
    }
    if (opts.cursor) {
      clauses.push("created_at <= (SELECT created_at FROM slug_runs WHERE id = ?)");
      params.push(opts.cursor);
    }
    params.push(limit);
    return this.adapter.all<SlugRunRow>(
      `SELECT ${runColumns} FROM slug_runs WHERE ${clauses.join(" AND ")}
       ORDER BY scheduled_at DESC LIMIT ?`,
      params
    );
  }

  transitionRun(
    id: string,
    patch: {
      state?: RunState;
      outcome?: string | null;
      startedAt?: number | null;
      finishedAt?: number | null;
      attemptCount?: number;
      lastAttemptId?: string | null;
      terminalReceiptId?: string | null;
    }
  ): SlugRunRow | null {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.state !== undefined) {
      sets.push("state = ?");
      params.push(patch.state);
    }
    if (patch.outcome !== undefined) {
      sets.push("outcome = ?");
      params.push(patch.outcome);
    }
    if (patch.startedAt !== undefined) {
      sets.push("started_at = ?");
      params.push(patch.startedAt);
    }
    if (patch.finishedAt !== undefined) {
      sets.push("finished_at = ?");
      params.push(patch.finishedAt);
    }
    if (patch.attemptCount !== undefined) {
      sets.push("attempt_count = ?");
      params.push(patch.attemptCount);
    }
    if (patch.lastAttemptId !== undefined) {
      sets.push("last_attempt_id = ?");
      params.push(patch.lastAttemptId);
    }
    if (patch.terminalReceiptId !== undefined) {
      sets.push("terminal_receipt_id = ?");
      params.push(patch.terminalReceiptId);
    }
    if (sets.length === 0) return this.getRun(id);
    params.push(id);
    this.adapter.run(`UPDATE slug_runs SET ${sets.join(", ")} WHERE id = ?`, params);
    return this.getRun(id);
  }

  // ── slug_attempts ────────────────────────────────────────────────────────

  createAttempt(input: { runId: string; attemptNumber: number; workerId?: string | null }): SlugAttemptRow {
    const id = randomUUID();
    this.adapter.run(
      `INSERT INTO slug_attempts (id, run_id, attempt_number, state, worker_id)
       VALUES (?, ?, ?, 'leased', ?)`,
      [id, input.runId, input.attemptNumber, input.workerId ?? null]
    );
    return this.adapter.get<SlugAttemptRow>(`SELECT ${attemptColumns} FROM slug_attempts WHERE id = ?`, [id])!;
  }

  getAttempt(id: string): SlugAttemptRow | null {
    return this.adapter.get<SlugAttemptRow>(`SELECT ${attemptColumns} FROM slug_attempts WHERE id = ?`, [id]);
  }

  getAttemptsByRun(runId: string): SlugAttemptRow[] {
    return this.adapter.all<SlugAttemptRow>(
      `SELECT ${attemptColumns} FROM slug_attempts WHERE run_id = ? ORDER BY attempt_number ASC`,
      [runId]
    );
  }

  getLatestAttempt(runId: string): SlugAttemptRow | null {
    return this.adapter.get<SlugAttemptRow>(
      `SELECT ${attemptColumns} FROM slug_attempts WHERE run_id = ? ORDER BY attempt_number DESC LIMIT 1`,
      [runId]
    );
  }

  updateAttemptState(
    id: string,
    patch: {
      state?: AttemptState;
      workerId?: string | null;
      leaseId?: string | null;
      startedAt?: number | null;
      finishedAt?: number | null;
      exitCode?: number | null;
      outcome?: string | null;
      resultDigest?: string | null;
    }
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.state !== undefined) {
      sets.push("state = ?");
      params.push(patch.state);
    }
    if (patch.workerId !== undefined) {
      sets.push("worker_id = ?");
      params.push(patch.workerId);
    }
    if (patch.leaseId !== undefined) {
      sets.push("lease_id = ?");
      params.push(patch.leaseId);
    }
    if (patch.startedAt !== undefined) {
      sets.push("started_at = ?");
      params.push(patch.startedAt);
    }
    if (patch.finishedAt !== undefined) {
      sets.push("finished_at = ?");
      params.push(patch.finishedAt);
    }
    if (patch.exitCode !== undefined) {
      sets.push("exit_code = ?");
      params.push(patch.exitCode);
    }
    if (patch.outcome !== undefined) {
      sets.push("outcome = ?");
      params.push(patch.outcome);
    }
    if (patch.resultDigest !== undefined) {
      sets.push("result_digest = ?");
      params.push(patch.resultDigest);
    }
    if (sets.length === 0) return;
    params.push(id);
    this.adapter.run(`UPDATE slug_attempts SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  // ── leases ───────────────────────────────────────────────────────────────

  createLease(input: {
    attemptId: string;
    runId: string;
    workerId: string;
    generation: number;
    fencingTokenDigest: string;
    expiresAt: number;
  }): LeaseRow {
    const id = randomUUID();
    this.adapter.run(
      `INSERT INTO leases (id, attempt_id, run_id, worker_id, generation, fencing_token_digest, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.attemptId, input.runId, input.workerId, input.generation, input.fencingTokenDigest, input.expiresAt]
    );
    return this.adapter.get<LeaseRow>(`SELECT ${leaseColumns} FROM leases WHERE id = ?`, [id])!;
  }

  getActiveLease(runId: string): LeaseRow | null {
    return this.adapter.get<LeaseRow>(
      `SELECT ${leaseColumns} FROM leases WHERE run_id = ? AND revoked_at IS NULL
       ORDER BY generation DESC LIMIT 1`,
      [runId]
    );
  }

  getActiveLeaseByAttempt(attemptId: string): LeaseRow | null {
    return this.adapter.get<LeaseRow>(
      `SELECT ${leaseColumns} FROM leases WHERE attempt_id = ? AND revoked_at IS NULL
       ORDER BY generation DESC LIMIT 1`,
      [attemptId]
    );
  }

  revokeLease(id: string): void {
    this.adapter.run("UPDATE leases SET revoked_at = unixepoch() WHERE id = ?", [id]);
  }

  renewLease(id: string, expiresAt: number, heartbeatAt: number): void {
    this.adapter.run(
      "UPDATE leases SET expires_at = ?, heartbeat_at = ? WHERE id = ? AND revoked_at IS NULL",
      [expiresAt, heartbeatAt, id]
    );
  }

  // ── slug_effects ─────────────────────────────────────────────────────────

  createEffect(input: {
    runId: string;
    attemptId?: string | null;
    effectKey: string;
    integration: string;
    operation: string;
    target?: string;
    requestDigest?: string;
  }): { created: boolean; effect: SlugEffectRow } {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    this.adapter.run(
      `INSERT INTO slug_effects (id, run_id, attempt_id, effect_key, integration, operation, target, state, request_digest, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)
       ON CONFLICT (effect_key) DO NOTHING`,
      [
        id,
        input.runId,
        input.attemptId ?? null,
        input.effectKey,
        input.integration,
        input.operation,
        input.target ?? "",
        input.requestDigest ?? "",
        now,
        now,
      ]
    );
    const effect = this.adapter.get<SlugEffectRow>(
      `SELECT ${effectColumns} FROM slug_effects WHERE effect_key = ?`,
      [input.effectKey]
    )!;
    return { created: effect.id === id, effect };
  }

  getEffectByKey(effectKey: string): SlugEffectRow | null {
    return this.adapter.get<SlugEffectRow>(
      `SELECT ${effectColumns} FROM slug_effects WHERE effect_key = ?`,
      [effectKey]
    );
  }

  updateEffect(
    id: string,
    patch: {
      state?: EffectState;
      externalId?: string | null;
      resultPointer?: string | null;
      lastErrorClass?: string | null;
    }
  ): void {
    const sets: string[] = ["updated_at = unixepoch()"];
    const params: unknown[] = [];
    if (patch.state !== undefined) {
      sets.push("state = ?");
      params.push(patch.state);
    }
    if (patch.externalId !== undefined) {
      sets.push("external_id = ?");
      params.push(patch.externalId);
    }
    if (patch.resultPointer !== undefined) {
      sets.push("result_pointer = ?");
      params.push(patch.resultPointer);
    }
    if (patch.lastErrorClass !== undefined) {
      sets.push("last_error_class = ?");
      params.push(patch.lastErrorClass);
    }
    params.push(id);
    this.adapter.run(`UPDATE slug_effects SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  // ── receipts ─────────────────────────────────────────────────────────────

  createReceipt(input: {
    runId: string;
    attemptId?: string | null;
    leaseId?: string | null;
    leaseGeneration: number;
    reason?: string;
    durableEffectPointer?: string | null;
    evidencePointer?: string | null;
    resultDigest?: string;
  }): { created: boolean; receipt: ReceiptRow } {
    const id = randomUUID();
    this.adapter.run(
      `INSERT INTO receipts (id, run_id, attempt_id, lease_id, lease_generation, state, reason, durable_effect_pointer, evidence_pointer, result_digest)
       VALUES (?, ?, ?, ?, ?, 'terminal', ?, ?, ?, ?)
       ON CONFLICT (run_id) DO NOTHING`,
      [
        id,
        input.runId,
        input.attemptId ?? null,
        input.leaseId ?? null,
        input.leaseGeneration,
        input.reason ?? "",
        input.durableEffectPointer ?? null,
        input.evidencePointer ?? null,
        input.resultDigest ?? "",
      ]
    );
    const receipt = this.adapter.get<ReceiptRow>(
      `SELECT ${receiptColumns} FROM receipts WHERE run_id = ?`,
      [input.runId]
    )!;
    return { created: receipt.id === id, receipt };
  }

  getReceiptByRun(runId: string): ReceiptRow | null {
    return this.adapter.get<ReceiptRow>(
      `SELECT ${receiptColumns} FROM receipts WHERE run_id = ?`,
      [runId]
    );
  }

  // ── daemon_state ─────────────────────────────────────────────────────────

  upsertDaemonState(input: {
    daemonId: string;
    state: DaemonStateName;
    leaderEpoch?: number;
    workerCapacity?: number;
    heartbeatAt?: number | null;
    drainStartedAt?: number | null;
  }): DaemonStateRow {
    // One row per daemon: the row id is the daemon id, so a second upsert
    // for the same daemon updates the same row.
    const id = input.daemonId;
    const now = Math.floor(Date.now() / 1000);
    this.adapter.run(
      `INSERT INTO daemon_state (id, daemon_id, state, leader_epoch, worker_capacity, heartbeat_at, drain_started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         state = excluded.state,
         leader_epoch = excluded.leader_epoch,
         worker_capacity = excluded.worker_capacity,
         heartbeat_at = excluded.heartbeat_at,
         drain_started_at = excluded.drain_started_at,
         updated_at = excluded.updated_at`,
      [
        id,
        input.daemonId,
        input.state,
        input.leaderEpoch ?? 0,
        input.workerCapacity ?? 1,
        input.heartbeatAt ?? null,
        input.drainStartedAt ?? null,
        now,
      ]
    );
    // The upsert key is `id`; callers pass the daemon id when they want one
    // row per daemon. Select back by daemon_id (latest).
    return this.adapter.get<DaemonStateRow>(
      `SELECT ${daemonColumns} FROM daemon_state WHERE daemon_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [input.daemonId]
    )!;
  }

  getDaemonState(id: string): DaemonStateRow | null {
    return this.adapter.get<DaemonStateRow>(
      `SELECT ${daemonColumns} FROM daemon_state WHERE id = ?`,
      [id]
    );
  }
}
