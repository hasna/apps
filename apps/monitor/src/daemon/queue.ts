/**
 * queue.ts — MON-V2-03.
 *
 * Durable admission and atomic claim for the monitor v2 daemon.
 *
 * Admission is idempotent: a stable admission key (slug, revision, cadence
 * occurrence, execution epoch) yields exactly one run — a duplicate admission
 * returns the existing run. Claims run inside a BEGIN IMMEDIATE transaction
 * and verify desired state, execution epoch, run state, absence of a current
 * lease, and the bounded attempt budget before creating the next attempt and
 * the next lease generation. Retry-wait and cancel-before-claim transitions
 * are also queue-owned and fence-guarded.
 */

import { randomUUID } from "node:crypto";
import type { DbAdapter } from "../db/adapter.js";
import { checkLeaseFence, fencingDigest, withImmediateTransaction } from "./lease-registry.js";
import { applyTerminalTransition } from "./receipts.js";

export type RunState =
  | "admitted"
  | "leased"
  | "running"
  | "retry_wait"
  | "reconciling"
  | "cancel_requested"
  | "terminal";

export interface RunRow {
  id: string;
  slug_id: string;
  revision_id: string;
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

export interface AttemptRow {
  id: string;
  run_id: string;
  attempt_number: number;
  state: string;
  worker_id: string | null;
  lease_id: string | null;
  started_at: number;
  finished_at: number | null;
  exit_code: number | null;
  outcome: string | null;
  result_digest: string | null;
  created_at: number;
}

// ── Admission ────────────────────────────────────────────────────────────────

export interface AdmitRunInput {
  slugId: string;
  revisionId: string;
  /** Stable key: slug + revision + cadence occurrence + execution epoch. */
  admissionKey: string;
  executionEpoch: number;
  scheduledAt: number;
  now: number;
}

export type AdmitResult = { runId: string; created: boolean; state: RunState };

/**
 * Idempotent admission. `INSERT ... ON CONFLICT(admission_key) DO NOTHING`
 * makes the insert atomic; a duplicate admission returns the existing run.
 */
export function admitRun(db: DbAdapter, input: AdmitRunInput): AdmitResult {
  const runId = randomUUID();
  db.run(
    `INSERT INTO slug_runs
       (id, slug_id, revision_id, admission_key, state, scheduled_at, admitted_at,
        execution_epoch, created_at)
     VALUES (?, ?, ?, ?, 'admitted', ?, ?, ?, ?)
     ON CONFLICT(admission_key) DO NOTHING`,
    [
      runId,
      input.slugId,
      input.revisionId,
      input.admissionKey,
      input.scheduledAt,
      input.now,
      input.executionEpoch,
      input.now,
    ],
  );
  const row = db.get<{ id: string; state: RunState }>(
    "SELECT id, state FROM slug_runs WHERE admission_key = ?",
    [input.admissionKey],
  );
  if (!row) {
    throw new Error(`admission did not produce a run row for key ${input.admissionKey}`);
  }
  return { runId: row.id, created: row.id === runId, state: row.state };
}

// ── Claim ────────────────────────────────────────────────────────────────────

export type ClaimCode =
  | "run_not_found"
  | "not_running"
  | "epoch_mismatch"
  | "already_claimed"
  | "no_capacity"
  | "cancel_requested"
  | "terminal"
  | "retry_exhausted";

export type ClaimResult =
  | {
      ok: true;
      runId: string;
      attemptId: string;
      attemptNumber: number;
      leaseId: string;
      generation: number;
      fencingToken: string;
    }
  | { ok: false; code: ClaimCode };

export interface ClaimRunInput {
  runId: string;
  slugId: string;
  workerId: string;
  /** Must equal the slug's current execution epoch. */
  executionEpoch: number;
  /** Bounded retries from the immutable slug revision. */
  maxAttempts: number;
  fencingToken: string;
  leaseTtlSeconds: number;
  capacityAvailable: boolean;
  now: number;
}

/**
 * Atomic claim. One BEGIN IMMEDIATE transaction verifies desired state,
 * execution epoch, run state, absence of a current lease, and the attempt
 * budget, then creates the next attempt and the next lease generation. The
 * caller holds the raw fencing token; only its digest is stored.
 */
export function claimRun(db: DbAdapter, input: ClaimRunInput): ClaimResult {
  if (!input.capacityAvailable) {
    return { ok: false, code: "no_capacity" };
  }
  return withImmediateTransaction(db, () => {
    const slug = db.get<{ desired_state: string; execution_epoch: number }>(
      "SELECT desired_state, execution_epoch FROM slugs WHERE id = ?",
      [input.slugId],
    );
    if (!slug || slug.desired_state !== "running") {
      return { ok: false, code: "not_running" } as const;
    }

    const run = db.get<{ state: RunState; execution_epoch: number }>(
      "SELECT state, execution_epoch FROM slug_runs WHERE id = ?",
      [input.runId],
    );
    if (!run) return { ok: false, code: "run_not_found" } as const;
    if (run.execution_epoch !== input.executionEpoch) {
      return { ok: false, code: "epoch_mismatch" } as const;
    }
    if (run.state === "terminal") return { ok: false, code: "terminal" } as const;
    if (run.state === "cancel_requested") {
      return { ok: false, code: "cancel_requested" } as const;
    }
    if (run.state !== "admitted" && run.state !== "retry_wait") {
      return { ok: false, code: "already_claimed" } as const;
    }

    // Absence of a current lease: no unrevoked, unexpired lease may exist.
    const active = db.get<{ id: string }>(
      "SELECT id FROM leases WHERE run_id = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1",
      [input.runId, input.now],
    );
    if (active) return { ok: false, code: "already_claimed" } as const;

    const maxAttempt = db.get<{ n: number }>(
      "SELECT COALESCE(MAX(attempt_number), 0) AS n FROM slug_attempts WHERE run_id = ?",
      [input.runId],
    );
    const attemptNumber = (maxAttempt?.n ?? 0) + 1;
    if (attemptNumber > input.maxAttempts) {
      return { ok: false, code: "retry_exhausted" } as const;
    }

    const maxGeneration = db.get<{ g: number }>(
      "SELECT COALESCE(MAX(generation), 0) AS g FROM leases WHERE run_id = ?",
      [input.runId],
    );
    const generation = (maxGeneration?.g ?? 0) + 1;
    const attemptId = randomUUID();
    const leaseId = randomUUID();

    db.run(
      `INSERT INTO slug_attempts
         (id, run_id, attempt_number, state, worker_id, lease_id, started_at, created_at)
       VALUES (?, ?, ?, 'leased', ?, ?, ?, ?)`,
      [attemptId, input.runId, attemptNumber, input.workerId, leaseId, input.now, input.now],
    );
    db.run(
      `INSERT INTO leases
         (id, attempt_id, run_id, worker_id, generation, fencing_token_digest,
          heartbeat_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        leaseId,
        attemptId,
        input.runId,
        input.workerId,
        generation,
        fencingDigest(input.fencingToken),
        input.now,
        input.now + input.leaseTtlSeconds,
        input.now,
      ],
    );
    db.run(
      `UPDATE slug_runs SET state = 'leased', started_at = COALESCE(started_at, ?),
         attempt_count = ?, last_attempt_id = ?
       WHERE id = ?`,
      [input.now, attemptNumber, attemptId, input.runId],
    );

    return {
      ok: true,
      runId: input.runId,
      attemptId,
      attemptNumber,
      leaseId,
      generation,
      fencingToken: input.fencingToken,
    } as const;
  });
}

// ── Retry-wait ────────────────────────────────────────────────────────────────

export interface RetryWaitInput {
  runId: string;
  attemptId: string;
  leaseId: string;
  generation: number;
  fencingToken: string;
  outcome: "failed" | "unknown";
  backoffSeconds: number;
  now: number;
}

export type RetryWaitResult =
  | { ok: true; scheduledAt: number }
  | { ok: false; code: "stale_fence"; reason: string };

/**
 * Moves a claimed run to retry_wait after a bounded failure, preserving the
 * run identity and provenance. Fence-guarded: a stale worker cannot reschedule
 * a run it no longer holds. Retry policy and the backoff series come from the
 * immutable slug revision (the caller supplies the selected backoff).
 */
export function transitionToRetryWait(db: DbAdapter, input: RetryWaitInput): RetryWaitResult {
  return withImmediateTransaction(db, () => {
    const fence = checkLeaseFence(db, {
      runId: input.runId,
      attemptId: input.attemptId,
      leaseId: input.leaseId,
      generation: input.generation,
      fencingToken: input.fencingToken,
      now: input.now,
    });
    if (!fence.ok) return { ok: false, code: "stale_fence", reason: fence.reason } as const;

    const run = db.get<{ state: RunState }>(
      "SELECT state FROM slug_runs WHERE id = ?",
      [input.runId],
    );
    if (!run || run.state === "terminal") {
      return { ok: false, code: "stale_fence", reason: "run_terminal" } as const;
    }

    const scheduledAt = input.now + input.backoffSeconds;
    // The worker surrenders its lease when it yields for a retry. The next
    // claim creates a new attempt with a new lease generation, and the old
    // worker can no longer write with its old lease.
    db.run("UPDATE leases SET revoked_at = ? WHERE id = ?", [input.now, input.leaseId]);
    db.run(
      `UPDATE slug_attempts SET state = ?, outcome = ?, finished_at = ?
       WHERE id = ?`,
      [input.outcome, input.outcome, input.now, input.attemptId],
    );
    db.run(
      "UPDATE slug_runs SET state = 'retry_wait', scheduled_at = ? WHERE id = ?",
      [scheduledAt, input.runId],
    );
    return { ok: true, scheduledAt } as const;
  });
}

// ── Cancel-before-claim ───────────────────────────────────────────────────────

export type CancelQueuedResult =
  | { ok: true; receiptId: string }
  | { ok: false; code: "not_queued" | "already_terminal" };

export interface CancelQueuedInput {
  runId: string;
  reason: string;
  now: number;
}

/**
 * System-side cancellation of queued (admitted or retry_wait) work — the
 * `stop --cancel` path. Queued entries become terminal `cancelled` and each
 * receives exactly one terminal receipt with reason `cancelled_before_claim`.
 * Active leases are not touched here (they are revoked by the caller through
 * the lease registry; a claimed run is not "queued").
 */
export function cancelQueuedRun(db: DbAdapter, input: CancelQueuedInput): CancelQueuedResult {
  return withImmediateTransaction(db, () => {
    const run = db.get<{ state: RunState; terminal_receipt_id: string | null }>(
      "SELECT state, terminal_receipt_id FROM slug_runs WHERE id = ?",
      [input.runId],
    );
    if (!run) return { ok: false, code: "not_queued" } as const;
    if (run.terminal_receipt_id !== null) {
      return { ok: false, code: "already_terminal" } as const;
    }
    if (run.state !== "admitted" && run.state !== "retry_wait") {
      return { ok: false, code: "not_queued" } as const;
    }
    const applied = applyTerminalTransition(db, {
      runId: input.runId,
      attemptId: null,
      leaseId: null,
      generation: 0,
      fencingToken: null,
      state: "cancelled_before_claim",
      // Queued entries become terminal `cancelled`; the receipt keeps the
      // precise `cancelled_before_claim` state (design §2 stop semantics).
      outcome: "cancelled",
      reason: input.reason,
      now: input.now,
    });
    if (!applied.ok) return { ok: false, code: "already_terminal" } as const;
    return { ok: true, receiptId: applied.receiptId } as const;
  });
}
