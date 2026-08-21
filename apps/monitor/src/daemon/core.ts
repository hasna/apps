/**
 * Daemon core — durable admission, atomic claims, attempts, leases with
 * fencing tokens, and terminal receipts, per design.md sections 2/5/6.
 *
 * Every write from a worker is conditional on the lease fence: run id,
 * attempt id, lease id, generation, matching fencing-token digest, and an
 * unexpired, unrevoked lease. After expiry or replacement an old worker is
 * rejected with a typed `stale_fence` result and cannot overwrite state.
 *
 * All timestamps flow through the injected Clock so tests are deterministic.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { Clock } from "./clock.js";
import { validateSlugDefinition } from "./definition-schema.js";

// ── Row types ─────────────────────────────────────────────────────────────────

export interface SlugRow {
  id: string;
  name: string;
  description: string | null;
  desired_state: "stopped" | "running" | "draining";
  active_revision_id: string | null;
  execution_epoch: number;
  created_at: number;
  updated_at: number;
}

export interface RevisionRow {
  id: string;
  slug_id: string;
  revision: number;
  definition_json: string;
  definition_digest: string;
  created_at: number;
  created_by: string | null;
}

export interface RunRow {
  id: string;
  slug_id: string;
  revision_id: string;
  admission_key: string;
  state: string;
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

export interface ReceiptRow {
  id: string;
  run_id: string;
  attempt_id: string | null;
  lease_id: string | null;
  lease_generation: number | null;
  state: string;
  reason: string | null;
  durable_effect_pointer: string | null;
  evidence_pointer: string | null;
  result_digest: string | null;
  created_at: number;
}

export interface DaemonStateRow {
  id: string;
  daemon_id: string;
  state: string;
  leader_epoch: number;
  worker_capacity: number;
  heartbeat_at: number | null;
  drain_started_at: number | null;
  updated_at: number;
}

export interface RetryPolicy {
  maxRetries: number;
  retryDelayMs: number;
}

export type FenceError = "stale_fence" | "expired" | "unknown";

// ── Small helpers ─────────────────────────────────────────────────────────────

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newId(): string {
  return randomUUID();
}

// ── Slug registration (control-plane store surface) ───────────────────────────

export interface RegisteredSlug {
  slug: SlugRow;
  activeRevision: RevisionRow;
}

/**
 * Idempotent create-or-update of a slug definition (the daemon-side half of
 * `monitor slug define`). A changed definition creates a new immutable
 * revision and re-points the active revision; an unchanged definition is a
 * no-op.
 */
export function registerSlug(
  db: Database,
  clock: Clock,
  input: { name: string; definition: unknown; createdBy?: string }
): RegisteredSlug {
  // The daemon path validates every definition against the MON-V2-01
  // definition contract (CommandSpec argv commands; no shell strings, no
  // shell mode, no interpolation). An invalid definition is refused here so
  // it can never reach the executor or the store.
  const validated = validateSlugDefinition(input.definition);
  if (!validated.ok) {
    throw new Error(`registerSlug: invalid definition: ${validated.errors.join("; ")}`);
  }
  const now = clock.now();
  const definitionJson = JSON.stringify(input.definition);
  const digest = sha256Hex(definitionJson);

  const existing = getSlugByName(db, input.name);
  if (existing) {
    const active = existing.active_revision_id
      ? getRevision(db, existing.active_revision_id)
      : null;
    if (active && active.definition_digest === digest) {
      return { slug: existing, activeRevision: active };
    }
    const revision = createRevision(db, clock, existing.id, definitionJson, digest, now, input.createdBy);
    db.run("UPDATE slugs SET active_revision_id = ?, updated_at = ? WHERE id = ?", [
      revision.id,
      now,
      existing.id,
    ]);
    return { slug: getSlug(db, existing.id)!, activeRevision: revision };
  }

  const slugId = newId();
  db.run(
    "INSERT INTO slugs (id, name, description, desired_state, execution_epoch, created_at, updated_at) VALUES (?, ?, ?, 'stopped', 0, ?, ?)",
    // description is NOT NULL DEFAULT '' under migration 008.
    [slugId, input.name, "", now, now]
  );
  const revision = createRevision(db, clock, slugId, definitionJson, digest, now, input.createdBy);
  db.run("UPDATE slugs SET active_revision_id = ? WHERE id = ?", [revision.id, slugId]);
  return { slug: getSlug(db, slugId)!, activeRevision: revision };
}

function createRevision(
  db: Database,
  clock: Clock,
  slugId: string,
  definitionJson: string,
  digest: string,
  now: number,
  createdBy?: string
): RevisionRow {
  const row = db
    .query<{ n: number }, [string]>("SELECT COALESCE(MAX(revision), 0) + 1 AS n FROM slug_revisions WHERE slug_id = ?")
    .get(slugId)!;
  const revision = newId();
  db.run(
    "INSERT INTO slug_revisions (id, slug_id, revision, definition_json, definition_digest, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    // created_by is NOT NULL DEFAULT '' under migration 008.
    [revision, slugId, row.n, definitionJson, digest, now, createdBy ?? ""]
  );
  return getRevision(db, revision)!;
}

// ── Slug state ────────────────────────────────────────────────────────────────

export function getSlug(db: Database, slugId: string): SlugRow | null {
  return db.query<SlugRow, [string]>("SELECT * FROM slugs WHERE id = ?").get(slugId) ?? null;
}

export function getSlugByName(db: Database, name: string): SlugRow | null {
  return db.query<SlugRow, [string]>("SELECT * FROM slugs WHERE name = ?").get(name) ?? null;
}

export function getRevision(db: Database, revisionId: string): RevisionRow | null {
  return db.query<RevisionRow, [string]>("SELECT * FROM slug_revisions WHERE id = ?").get(revisionId) ?? null;
}

export function getActiveRevision(db: Database, slug: SlugRow): RevisionRow | null {
  if (!slug.active_revision_id) return null;
  return getRevision(db, slug.active_revision_id);
}

/**
 * Change the slug's desired control state. The execution epoch increments
 * only on the stopped -> running transition (new execution epoch).
 */
export function setSlugDesiredState(
  db: Database,
  clock: Clock,
  slugId: string,
  state: SlugRow["desired_state"]
): SlugRow {
  const now = clock.now();
  const slug = getSlug(db, slugId);
  if (!slug) throw new Error(`setSlugDesiredState: unknown slug ${slugId}`);
  const epochDelta = slug.desired_state === "stopped" && state === "running" ? 1 : 0;
  db.run(
    "UPDATE slugs SET desired_state = ?, execution_epoch = execution_epoch + ?, updated_at = ? WHERE id = ?",
    [state, epochDelta, now, slugId]
  );
  return getSlug(db, slugId)!;
}

/**
 * Retry policy from the immutable revision a run was admitted against,
 * read from the MON-V2-01 `execution` shape (maxAttempts, retryBackoffSeconds).
 * maxAttempts 1 (the schema default) means no retries; each further attempt
 * adds one retry after a failure.
 */
export function getRetryPolicy(db: Database, run: RunRow): RetryPolicy {
  const revision = getRevision(db, run.revision_id);
  let execution: { maxAttempts?: number; retryBackoffSeconds?: number[] } = {};
  if (revision) {
    try {
      const def = JSON.parse(revision.definition_json) as {
        execution?: { maxAttempts?: number; retryBackoffSeconds?: number[] };
      };
      execution = def.execution ?? {};
    } catch {
      execution = {};
    }
  }
  const maxAttempts =
    typeof execution.maxAttempts === "number" ? Math.max(1, Math.floor(execution.maxAttempts)) : 1;
  const backoff =
    Array.isArray(execution.retryBackoffSeconds) && execution.retryBackoffSeconds.length > 0
      ? Math.max(0, execution.retryBackoffSeconds[0] ?? 0)
      : 0;
  return {
    maxRetries: maxAttempts - 1,
    retryDelayMs: backoff * 1000,
  };
}

// ── Admission ─────────────────────────────────────────────────────────────────

export type AdmitSource = "interval" | "cron" | "immediate";

export type AdmitResult =
  | { ok: true; run: RunRow }
  | { ok: false; reason: "already_admitted" | "not_running"; run?: RunRow };

/**
 * Idempotent admission of a cadence occurrence. The admission key is stable
 * across slug id, revision id, execution epoch, and scheduled time, so
 * repeated admissions return the existing run.
 */
export function admitRun(
  db: Database,
  clock: Clock,
  input: { slug: SlugRow; revision: RevisionRow; scheduledAt: number; epoch: number; source: AdmitSource }
): AdmitResult {
  const now = clock.now();
  if (input.slug.desired_state !== "running") {
    return { ok: false, reason: "not_running" };
  }
  const admissionKey = sha256Hex(
    `${input.source}:${input.slug.id}:${input.revision.id}:${input.epoch}:${input.scheduledAt}`
  );
  const runId = newId();
  const info = db
    .query<{ changes: number }, [string, string, string, string, number, number, number, number]>(
      "INSERT OR IGNORE INTO slug_runs (id, slug_id, revision_id, admission_key, state, scheduled_at, admitted_at, execution_epoch, attempt_count, created_at) VALUES (?, ?, ?, ?, 'admitted', ?, ?, ?, 0, ?)"
    )
    .run(runId, input.slug.id, input.revision.id, admissionKey, input.scheduledAt, now, input.epoch, now);
  if (Number(info.changes) === 0) {
    const existing = db
      .query<RunRow, [string]>("SELECT * FROM slug_runs WHERE admission_key = ?")
      .get(admissionKey);
    return { ok: false, reason: "already_admitted", run: existing ?? undefined };
  }
  return { ok: true, run: getRun(db, runId)! };
}

/**
 * Admit a due occurrence and immediately mark it terminal `skipped_overlap`
 * when the previous occurrence is still active. The occurrence slot is
 * consumed (so the cadence does not drift) and the skip is observable with
 * its own receipt.
 */
export function insertTerminalSkipped(
  db: Database,
  clock: Clock,
  input: { slug: SlugRow; revision: RevisionRow; scheduledAt: number; epoch: number }
): RunRow | null {
  const result = admitRun(db, clock, {
    slug: input.slug,
    revision: input.revision,
    scheduledAt: input.scheduledAt,
    epoch: input.epoch,
    source: "interval",
  });
  if (!result.ok) return result.run ?? null;
  const now = clock.now();
  db.run("UPDATE slug_runs SET state = 'terminal', finished_at = ?, outcome = 'skipped_overlap' WHERE id = ?", [
    now,
    result.run.id,
  ]);
  const run = getRun(db, result.run.id)!;
  const receipt = insertReceipt(db, clock, {
    run,
    attempt: null,
    lease: null,
    state: "skipped_overlap",
    reason: "skipped_overlap",
    resultDigest: null,
  });
  db.run("UPDATE slug_runs SET terminal_receipt_id = ? WHERE id = ?", [receipt.id, run.id]);
  return run;
}

// ── Atomic claim with lease fencing ───────────────────────────────────────────

export interface ClaimInput {
  workerId: string;
  leaseTtlMs: number;
  capacity: number;
  now: number;
}

export interface Claim {
  run: RunRow;
  attempt: AttemptRow;
  lease: LeaseRow;
  token: string;
}

/**
 * Atomically claim the next due run for a worker. Verifies the slug's
 * desired state, the run's execution epoch against the slug's, and the
 * absence of a live lease; creates the next attempt and a lease with
 * generation max(previous)+1 and a fresh fencing token (only its digest is
 * stored). Returns null when capacity is exhausted or no claimable work
 * exists.
 */
export function claimNext(db: Database, clock: Clock, input: ClaimInput): Claim | null {
  const now = input.now;
  return db.transaction((): Claim | null => {
    const active = db
      .query<{ n: number }, [number]>(
        "SELECT COUNT(*) AS n FROM leases WHERE revoked_at IS NULL AND expires_at > ?"
      )
      .get(now)!;
    if (active.n >= input.capacity) return null;

    const candidate = db
      .query<RunRow, [number, number]>(
        `SELECT r.* FROM slug_runs r
         JOIN slugs s ON s.id = r.slug_id
         WHERE r.state IN ('admitted','retry_wait')
           AND r.scheduled_at <= ?
           AND s.desired_state = 'running'
           AND r.execution_epoch = s.execution_epoch
           AND NOT EXISTS (
             SELECT 1 FROM leases l
             WHERE l.run_id = r.id AND l.revoked_at IS NULL AND l.expires_at > ?
           )
         ORDER BY r.scheduled_at ASC, r.created_at ASC
         LIMIT 1`
      )
      .get(now, now);

    if (!candidate) return null;

    const slug = getSlug(db, candidate.slug_id)!;
    const gen = db
      .query<{ n: number }, [string]>("SELECT COALESCE(MAX(generation), 0) + 1 AS n FROM leases WHERE run_id = ?")
      .get(candidate.id)!.n;
    const attemptId = newId();
    const leaseId = newId();
    const token = randomUUID();
    const attemptNumber = candidate.attempt_count + 1;

    db.run(
      "INSERT INTO slug_attempts (id, run_id, attempt_number, state, worker_id, lease_id, started_at, created_at) VALUES (?, ?, ?, 'leased', ?, ?, ?, ?)",
      [attemptId, candidate.id, attemptNumber, input.workerId, leaseId, now, now]
    );
    db.run(
      "INSERT INTO leases (id, attempt_id, run_id, worker_id, generation, fencing_token_digest, heartbeat_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [leaseId, attemptId, candidate.id, input.workerId, gen, sha256Hex(token), now, now + input.leaseTtlMs, now]
    );
    db.run(
      "UPDATE slug_runs SET state = 'leased', started_at = COALESCE(started_at, ?), attempt_count = ?, last_attempt_id = ? WHERE id = ?",
      [now, attemptNumber, attemptId, candidate.id]
    );

    return {
      run: getRun(db, candidate.id)!,
      attempt: getAttempt(db, attemptId)!,
      lease: getLease(db, leaseId)!,
      token,
    };
  })();
}

// ── Lease lifecycle ───────────────────────────────────────────────────────────

export function getLease(db: Database, leaseId: string): LeaseRow | null {
  return db.query<LeaseRow, [string]>("SELECT * FROM leases WHERE id = ?").get(leaseId) ?? null;
}

export function getAttempt(db: Database, attemptId: string): AttemptRow | null {
  return db.query<AttemptRow, [string]>("SELECT * FROM slug_attempts WHERE id = ?").get(attemptId) ?? null;
}

export function getRun(db: Database, runId: string): RunRow | null {
  return db.query<RunRow, [string]>("SELECT * FROM slug_runs WHERE id = ?").get(runId) ?? null;
}

/** Verify the fence on a write: live lease, matching worker and token. */
function checkFence(
  db: Database,
  clock: Clock,
  input: { leaseId: string; workerId: string; token: string }
): { ok: true; lease: LeaseRow } | { ok: false; error: FenceError } {
  const lease = getLease(db, input.leaseId);
  if (!lease) return { ok: false, error: "unknown" };
  if (lease.revoked_at !== null) return { ok: false, error: "stale_fence" };
  if (lease.expires_at <= clock.now()) return { ok: false, error: "expired" };
  if (lease.worker_id !== input.workerId || lease.fencing_token_digest !== sha256Hex(input.token)) {
    return { ok: false, error: "stale_fence" };
  }
  return { ok: true, lease };
}

export type RenewResult = { ok: true; lease: LeaseRow } | { ok: false; error: FenceError };

/** Renew an active lease under the same generation. Never erases history. */
export function renewLease(
  db: Database,
  clock: Clock,
  input: { leaseId: string; workerId: string; token: string; ttlMs: number }
): RenewResult {
  const fence = checkFence(db, clock, input);
  if (!fence.ok) return { ok: false, error: fence.error };
  const now = clock.now();
  db.run("UPDATE leases SET heartbeat_at = ?, expires_at = ? WHERE id = ?", [
    now,
    now + input.ttlMs,
    input.leaseId,
  ]);
  return { ok: true, lease: getLease(db, input.leaseId)! };
}

/** Revoke a lease (cancel, replacement, or expiry). */
export function revokeLease(db: Database, clock: Clock, leaseId: string): void {
  db.run("UPDATE leases SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [
    clock.now(),
    leaseId,
  ]);
}

// ── Completion and terminal receipts ─────────────────────────────────────────

export interface CompleteInput {
  runId: string;
  attemptId: string;
  leaseId: string;
  generation: number;
  workerId: string;
  token: string;
  outcome: "succeeded" | "failed" | "cancelled";
  exitCode: number | null;
  resultDigest: string | null;
}

export type CompleteResult =
  | { ok: true; run: RunRow; attempt: AttemptRow; receipt: ReceiptRow | null }
  | { ok: false; error: FenceError | "unknown_run" };

/**
 * Fenced attempt completion. A stale worker (wrong generation/token,
 * expired or revoked lease) is rejected and changes nothing.
 */
export function completeAttempt(db: Database, clock: Clock, input: CompleteInput): CompleteResult {
  const now = clock.now();
  return db.transaction((): CompleteResult => {
    const fence = checkFence(db, clock, input);
    if (!fence.ok) return { ok: false, error: fence.error };
    if (fence.lease.generation !== input.generation) return { ok: false, error: "stale_fence" };
    const attempt = getAttempt(db, input.attemptId);
    const run = getRun(db, input.runId);
    if (!attempt || !run || attempt.run_id !== input.runId || attempt.lease_id !== input.leaseId) {
      return { ok: false, error: "unknown_run" };
    }

    db.run(
      "UPDATE slug_attempts SET state = ?, finished_at = ?, exit_code = ?, outcome = ?, result_digest = ? WHERE id = ?",
      [input.outcome, now, input.exitCode, input.outcome, input.resultDigest, input.attemptId]
    );

    let nextRunState: string | null = null;
    let terminalOutcome: string | null = null;
    let receipt: ReceiptRow | null = null;

    if (input.outcome === "succeeded") {
      nextRunState = "terminal";
      terminalOutcome = "succeeded";
    } else if (input.outcome === "cancelled") {
      nextRunState = "terminal";
      terminalOutcome = "cancelled";
    } else {
      const retry = getRetryPolicy(db, run);
      // Budget: maxRetries + 1 total attempts. A further attempt is allowed
      // while attempt_count <= maxRetries.
      if (run.attempt_count <= retry.maxRetries) {
        db.run("UPDATE slug_runs SET state = 'retry_wait', scheduled_at = ? WHERE id = ?", [
          now + retry.retryDelayMs,
          run.id,
        ]);
        // The failed attempt's lease is done; free the capacity slot.
        revokeLease(db, clock, input.leaseId);
        return { ok: true, run: getRun(db, run.id)!, attempt: getAttempt(db, input.attemptId)!, receipt: null };
      }
      nextRunState = "terminal";
      terminalOutcome = retry.maxRetries === 0 ? "failed" : "retry_exhausted";
    }

    db.run("UPDATE slug_runs SET state = ?, finished_at = ?, outcome = ? WHERE id = ?", [
      nextRunState,
      now,
      terminalOutcome,
      run.id,
    ]);
    const updatedRun = getRun(db, run.id)!;
    receipt = insertReceipt(db, clock, {
      run: updatedRun,
      attempt: getAttempt(db, input.attemptId)!,
      lease: fence.lease,
      state: terminalOutcome,
      reason: terminalOutcome,
      resultDigest: input.resultDigest,
    });
    db.run("UPDATE slug_runs SET terminal_receipt_id = ? WHERE id = ?", [receipt.id, run.id]);
    // The lease's job is done in every completion path: revoke it so the
    // capacity count is accurate and no later renewal can extend it.
    revokeLease(db, clock, input.leaseId);
    return { ok: true, run: getRun(db, run.id)!, attempt: getAttempt(db, input.attemptId)!, receipt };
  })();
}

function insertReceipt(
  db: Database,
  clock: Clock,
  input: {
    run: RunRow;
    attempt: AttemptRow | null;
    lease: LeaseRow | null;
    state: string;
    reason: string | null;
    resultDigest: string | null;
  }
): ReceiptRow {
  const receiptId = newId();
  const info = db
    .query<{ changes: number }, [string, string, string | null, string | null, number, string, string, string, number]>(
      "INSERT OR IGNORE INTO receipts (id, run_id, attempt_id, lease_id, lease_generation, state, reason, result_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      receiptId,
      input.run.id,
      input.attempt?.id ?? null,
      input.lease?.id ?? null,
      // lease_generation is NOT NULL under migration 008; the skipped and
      // cancelled-before-claim paths have no lease, so a neutral 0 is stored.
      input.lease?.generation ?? 0,
      input.state,
      // reason and result_digest are NOT NULL DEFAULT '' under migration 008.
      input.reason ?? "",
      input.resultDigest ?? "",
      clock.now()
    );
  if (Number(info.changes) === 0) {
    return db.query<ReceiptRow, [string]>("SELECT * FROM receipts WHERE run_id = ?").get(input.run.id)!;
  }
  return getReceipt(db, receiptId)!;
}

export function getReceipt(db: Database, receiptId: string): ReceiptRow | null {
  return db.query<ReceiptRow, [string]>("SELECT * FROM receipts WHERE id = ?").get(receiptId) ?? null;
}

// ── Cancellation ──────────────────────────────────────────────────────────────

export interface CancelResult {
  cancelledQueued: number;
  revokedLeases: number;
}

/**
 * Explicit cancellation (stop --cancel semantics): queued admitted and
 * retry_wait entries become terminal cancelled with a
 * `cancelled_before_claim` receipt, and every active lease is revoked so
 * stale workers are fenced.
 */
export function cancelSlugRuns(db: Database, clock: Clock, slugId: string): CancelResult {
  const now = clock.now();
  return db.transaction((): CancelResult => {
    const queued = db
      .query<RunRow, [string]>("SELECT * FROM slug_runs WHERE slug_id = ? AND state IN ('admitted','retry_wait')")
      .all(slugId);
    for (const run of queued) {
      db.run("UPDATE slug_runs SET state = 'terminal', finished_at = ?, outcome = 'cancelled' WHERE id = ?", [
        now,
        run.id,
      ]);
      const updated = getRun(db, run.id)!;
      const receipt = insertReceipt(db, clock, {
        run: updated,
        attempt: null,
        lease: null,
        state: "cancelled",
        reason: "cancelled_before_claim",
        resultDigest: null,
      });
      db.run("UPDATE slug_runs SET terminal_receipt_id = ? WHERE id = ?", [receipt.id, run.id]);
    }

    const leases = db
      .query<LeaseRow, [string]>("SELECT * FROM leases WHERE run_id IN (SELECT id FROM slug_runs WHERE slug_id = ?) AND revoked_at IS NULL")
      .all(slugId);
    for (const lease of leases) {
      revokeLease(db, clock, lease.id);
    }

    return { cancelledQueued: queued.length, revokedLeases: leases.length };
  })();
}

/**
 * Cancel runs admitted under a superseded execution epoch for a running
 * slug. They can never be claimed (the claim verifies the epoch), so they
 * are resolved to terminal `cancelled` with a `cancelled_before_claim`
 * receipt instead of lingering forever.
 */
export function cancelStaleEpochRuns(db: Database, clock: Clock, slugId: string): number {
  const slug = getSlug(db, slugId);
  if (!slug) return 0;
  const now = clock.now();
  return db.transaction((): number => {
    const runs = db
      .query<RunRow, [string, number]>(
        "SELECT * FROM slug_runs WHERE slug_id = ? AND state IN ('admitted','retry_wait') AND execution_epoch < ?"
      )
      .all(slugId, slug.execution_epoch);
    for (const run of runs) {
      db.run("UPDATE slug_runs SET state = 'terminal', finished_at = ?, outcome = 'cancelled' WHERE id = ?", [
        now,
        run.id,
      ]);
      const updated = getRun(db, run.id)!;
      const receipt = insertReceipt(db, clock, {
        run: updated,
        attempt: null,
        lease: null,
        state: "cancelled",
        reason: "cancelled_before_claim",
        resultDigest: null,
      });
      db.run("UPDATE slug_runs SET terminal_receipt_id = ? WHERE id = ?", [receipt.id, run.id]);
    }
    return runs.length;
  })();
}

/** Revoke every active lease (used by replacement and start-from-stopped). */
export function revokeAllActiveLeases(db: Database, clock: Clock): number {
  const now = clock.now();
  const info = db
    .query<{ changes: number }, [number]>(
      "UPDATE leases SET revoked_at = ? WHERE revoked_at IS NULL"
    )
    .run(now);
  return Number(info.changes);
}

// ── Recovery helpers ──────────────────────────────────────────────────────────

export interface ExpiredLeaseResult {
  run: RunRow;
  attempt: AttemptRow;
  receipt: ReceiptRow | null;
}

/**
 * Resolve an expired or revoked lease: the attempt becomes `expired`; the
 * run requeues into retry_wait while bounded retries remain, otherwise it
 * terminates with `retry_exhausted` and exactly one receipt.
 */
export function requeueExpiredLease(
  db: Database,
  clock: Clock,
  leaseId: string
): ExpiredLeaseResult | null {
  const now = clock.now();
  return db.transaction((): ExpiredLeaseResult | null => {
    const lease = getLease(db, leaseId);
    if (!lease) return null;
    const attempt = getAttempt(db, lease.attempt_id);
    const run = attempt ? getRun(db, attempt.run_id) : null;
    if (!attempt || !run || run.state === "terminal") return null;

    db.run("UPDATE leases SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", [now, leaseId]);
    db.run("UPDATE slug_attempts SET state = 'expired', finished_at = ? WHERE id = ?", [now, attempt.id]);

    const retry = getRetryPolicy(db, run);
    if (run.attempt_count <= retry.maxRetries) {
      db.run("UPDATE slug_runs SET state = 'retry_wait', scheduled_at = ? WHERE id = ?", [
        now + retry.retryDelayMs,
        run.id,
      ]);
      return { run: getRun(db, run.id)!, attempt: getAttempt(db, attempt.id)!, receipt: null };
    }

    const outcome = retry.maxRetries === 0 ? "failed" : "retry_exhausted";
    db.run("UPDATE slug_runs SET state = 'terminal', finished_at = ?, outcome = ? WHERE id = ?", [
      now,
      outcome,
      run.id,
    ]);
    const updatedRun = getRun(db, run.id)!;
    const receipt = insertReceipt(db, clock, {
      run: updatedRun,
      attempt: getAttempt(db, attempt.id)!,
      lease: getLease(db, leaseId)!,
      state: outcome,
      reason: "lease_expired",
      resultDigest: null,
    });
    db.run("UPDATE slug_runs SET terminal_receipt_id = ? WHERE id = ?", [receipt.id, run.id]);
    return { run: updatedRun, attempt: getAttempt(db, attempt.id)!, receipt };
  })();
}

export interface ReconcileResult {
  run: RunRow;
  attempt: AttemptRow | null;
  receipt: ReceiptRow | null;
}

/**
 * Resolve a run stuck in `reconciling` with no live lease: the attempt is
 * marked `expired`, then the run requeues while bounded retries remain or
 * terminates with `unknown_reconciled` and a receipt.
 */
export function resolveReconcilingRun(db: Database, clock: Clock, runId: string): ReconcileResult | null {
  const now = clock.now();
  return db.transaction((): ReconcileResult | null => {
    const run = getRun(db, runId);
    if (!run || run.state !== "reconciling") return null;
    const live = db
      .query<{ n: number }, [string, number]>(
        "SELECT COUNT(*) AS n FROM leases WHERE run_id = ? AND revoked_at IS NULL AND expires_at > ?"
      )
      .get(runId, now)!.n;
    if (live > 0) return null;

    const attempt = run.last_attempt_id ? getAttempt(db, run.last_attempt_id) : null;
    if (attempt && !attempt.finished_at) {
      db.run("UPDATE slug_attempts SET state = 'expired', finished_at = ? WHERE id = ?", [now, attempt.id]);
    }

    const retry = getRetryPolicy(db, run);
    if (run.attempt_count <= retry.maxRetries) {
      db.run("UPDATE slug_runs SET state = 'retry_wait', scheduled_at = ? WHERE id = ?", [
        now + retry.retryDelayMs,
        run.id,
      ]);
      return { run: getRun(db, run.id)!, attempt, receipt: null };
    }

    db.run("UPDATE slug_runs SET state = 'terminal', finished_at = ?, outcome = 'unknown_reconciled' WHERE id = ?", [
      now,
      runId,
    ]);
    const updatedRun = getRun(db, runId)!;
    const receipt = insertReceipt(db, clock, {
      run: updatedRun,
      attempt,
      lease: null,
      state: "unknown_reconciled",
      reason: "unknown_reconciled",
      resultDigest: attempt?.result_digest ?? null,
    });
    db.run("UPDATE slug_runs SET terminal_receipt_id = ? WHERE id = ?", [receipt.id, runId]);
    return { run: updatedRun, attempt, receipt };
  })();
}

/**
 * Create the missing terminal receipt for a terminal run (crash between the
 * outcome write and the receipt write). Returns the receipt, or null when
 * the run is not terminal or already has one.
 */
export function ensureTerminalReceipt(
  db: Database,
  clock: Clock,
  runId: string
): ReceiptRow | null {
  const run = getRun(db, runId);
  if (!run || run.state !== "terminal") return null;
  const existing = db
    .query<ReceiptRow, [string]>("SELECT * FROM receipts WHERE run_id = ?")
    .get(runId);
  if (existing) return existing;

  const attempt = run.last_attempt_id ? getAttempt(db, run.last_attempt_id) : null;
  const lease = attempt?.lease_id ? getLease(db, attempt.lease_id) : null;
  const receipt = insertReceipt(db, clock, {
    run,
    attempt,
    lease,
    state: run.outcome ?? "unknown_reconciled",
    reason: run.outcome ?? "unknown_reconciled",
    resultDigest: attempt?.result_digest ?? null,
  });
  db.run("UPDATE slug_runs SET terminal_receipt_id = ? WHERE id = ?", [receipt.id, runId]);
  return receipt;
}

// ── Observation reads ─────────────────────────────────────────────────────────

export function getRunsForSlug(db: Database, slugName: string, limit = 100): RunRow[] {
  return db
    .query<RunRow, [string, number]>(
      `SELECT r.* FROM slug_runs r JOIN slugs s ON s.id = r.slug_id
       WHERE s.name = ? ORDER BY r.scheduled_at ASC LIMIT ?`
    )
    .all(slugName, limit);
}

export function countRunsForSlug(db: Database, slugName: string): number {
  return db
    .query<{ n: number }, [string]>(
      "SELECT COUNT(*) AS n FROM slug_runs r JOIN slugs s ON s.id = r.slug_id WHERE s.name = ?"
    )
    .get(slugName)!.n;
}

export function countNonTerminalRuns(db: Database, slugName: string): number {
  return db
    .query<{ n: number }, [string]>(
      `SELECT COUNT(*) AS n FROM slug_runs r JOIN slugs s ON s.id = r.slug_id
       WHERE s.name = ? AND r.state <> 'terminal'`
    )
    .get(slugName)!.n;
}

export function countTerminalRuns(db: Database, slugName: string): number {
  return db
    .query<{ n: number }, [string]>(
      `SELECT COUNT(*) AS n FROM slug_runs r JOIN slugs s ON s.id = r.slug_id
       WHERE s.name = ? AND r.state = 'terminal'`
    )
    .get(slugName)!.n;
}

export function getAttemptsForRun(db: Database, runId: string): AttemptRow[] {
  return db
    .query<AttemptRow, [string]>(
      "SELECT * FROM slug_attempts WHERE run_id = ? ORDER BY attempt_number ASC"
    )
    .all(runId);
}

export function getActiveLeases(db: Database): LeaseRow[] {
  return db
    .query<LeaseRow, []>("SELECT * FROM leases WHERE revoked_at IS NULL ORDER BY created_at ASC")
    .all();
}

export function countReceiptsForRun(db: Database, runId: string): number {
  return db
    .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM receipts WHERE run_id = ?")
    .get(runId)!.n;
}

export function getDaemonState(db: Database, daemonId: string): DaemonStateRow | null {
  return db
    .query<DaemonStateRow, [string]>("SELECT * FROM daemon_state WHERE daemon_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(daemonId) ?? null;
}

export function upsertDaemonState(
  db: Database,
  clock: Clock,
  input: {
    daemonId: string;
    state: string;
    leaderEpoch: number;
    workerCapacity: number;
    heartbeatAt?: number | null;
    drainStartedAt?: number | null;
  }
): DaemonStateRow {
  const now = clock.now();
  const existing = getDaemonState(db, input.daemonId);
  if (existing) {
    db.run(
      "UPDATE daemon_state SET state = ?, leader_epoch = ?, worker_capacity = ?, heartbeat_at = COALESCE(?, heartbeat_at), drain_started_at = COALESCE(?, drain_started_at), updated_at = ? WHERE id = ?",
      [
        input.state,
        input.leaderEpoch,
        input.workerCapacity,
        input.heartbeatAt ?? null,
        input.drainStartedAt ?? null,
        now,
        existing.id,
      ]
    );
    return getDaemonState(db, input.daemonId)!;
  }
  const id = newId();
  db.run(
    "INSERT INTO daemon_state (id, daemon_id, state, leader_epoch, worker_capacity, heartbeat_at, drain_started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      input.daemonId,
      input.state,
      input.leaderEpoch,
      input.workerCapacity,
      input.heartbeatAt ?? null,
      input.drainStartedAt ?? null,
      now,
    ]
  );
  return getDaemonState(db, input.daemonId)!;
}
