// Concurrency-safe run claiming for self-hosted Postgres runners.
//
// The correctness core of the multi-runner backend: many `loops-runner`
// processes poll the same Postgres database and must never both claim the same
// queued run. This uses `SELECT ... FOR UPDATE SKIP LOCKED` inside a
// transaction so that a row locked by one runner is invisible to the others'
// claim attempt (they skip it and grab the next one, or get nothing), which is
// the standard Postgres work-queue pattern and avoids the lost-update /
// double-dispatch race that a naive `SELECT` + `UPDATE` would hit.

import type { PoolQueryClient, TypedQueryClient } from "../../generated/storage-kit/query.js";

export interface ClaimedRunRow extends Record<string, unknown> {
  id: string;
  loop_id: string;
  loop_name: string;
  scheduled_for: string | Date;
  attempt: number;
  status: string;
  claimed_by: string | null;
  claim_token: string | null;
  lease_expires_at: string | Date | null;
}

export interface ClaimNextRunOptions {
  runnerId: string;
  leaseMs: number;
  claimToken: string;
  /** Statuses a run may be in to be claimable. Defaults to queued + lease-expired running. */
  now?: Date;
}

/**
 * Atomically claim the next claimable run for `runnerId`.
 *
 * A run is claimable when it is `queued`, or `running` with an expired lease
 * (crash recovery). Returns the claimed row, or `null` when nothing was
 * available. Two concurrent callers are guaranteed to receive distinct rows
 * (or one receives `null`) thanks to `FOR UPDATE SKIP LOCKED`.
 */
export async function claimNextRun(
  client: PoolQueryClient,
  options: ClaimNextRunOptions,
): Promise<ClaimedRunRow | null> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + options.leaseMs).toISOString();

  return client.transaction(async (tx: TypedQueryClient) => {
    const candidate = await tx.get<{ id: string }>(
      `SELECT id
         FROM loop_runs
        WHERE status = 'queued'
           OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1)
        ORDER BY scheduled_for ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
      [nowIso],
    );
    if (!candidate) return null;

    const updated = await tx.get<ClaimedRunRow>(
      `UPDATE loop_runs
          SET status = 'running',
              claimed_by = $2,
              claim_token = $3,
              lease_expires_at = $4,
              started_at = COALESCE(started_at, $1),
              attempt = CASE WHEN status = 'queued' THEN attempt ELSE attempt + 1 END,
              updated_at = $1
        WHERE id = $5
        RETURNING id, loop_id, loop_name, scheduled_for, attempt, status,
                  claimed_by, claim_token, lease_expires_at`,
      [nowIso, options.runnerId, options.claimToken, leaseExpiresAt, candidate.id],
    );
    return updated;
  });
}

/**
 * Heartbeat a claimed run's lease. Returns true when the lease was extended
 * (the caller still owns the run), false when ownership was lost (claim token
 * mismatch, run finalized, or lease already stolen).
 */
export async function heartbeatRunLease(
  client: PoolQueryClient,
  input: { runId: string; runnerId: string; claimToken: string; leaseMs: number; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
  const result = await client.query(
    `UPDATE loop_runs
        SET lease_expires_at = $1, updated_at = $2
      WHERE id = $3 AND status = 'running' AND claimed_by = $4 AND claim_token = $5`,
    [leaseExpiresAt, nowIso, input.runId, input.runnerId, input.claimToken],
  );
  return result.rowCount === 1;
}
