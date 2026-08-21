/**
 * Reconciler — the bounded safety sweep.
 *
 * The sweep is recovery only: it reconciles expired or revoked leases,
 * attempts stuck in `reconciling`, terminal runs missing their receipt, and
 * stale admissions from superseded epochs. It is never the primary scheduler
 * and never a backfill mechanism.
 */

import type { Database } from "bun:sqlite";
import type { Clock } from "./clock.js";
import {
  cancelStaleEpochRuns,
  ensureTerminalReceipt,
  requeueExpiredLease,
  resolveReconcilingRun,
  type RunRow,
} from "./core.js";

export interface SweepResult {
  expiredLeases: number;
  requeuedRuns: number;
  terminatedRuns: number;
  createdReceipts: number;
  cancelledStaleAdmissions: number;
}

export interface ReconcilerOptions {
  /** Unused placeholder for per-slug defaults; retry policy is read from each run's revision. */
  retryDefaults?: { maxRetries?: number; retryDelayMs?: number };
}

export class Reconciler {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock
  ) {}

  /**
   * One bounded sweep pass. Idempotent per item: every resolved lease or
   * run is moved to a terminal or requeued state that later passes no-op.
   */
  safetySweep(nowMs: number): SweepResult {
    const result: SweepResult = {
      expiredLeases: 0,
      requeuedRuns: 0,
      terminatedRuns: 0,
      createdReceipts: 0,
      cancelledStaleAdmissions: 0,
    };

    // 1. Attempts still leased/running whose lease is expired or revoked.
    const stale = this.db
      .query<{ lease_id: string }, [number]>(
        `SELECT l.id AS lease_id
         FROM leases l
         JOIN slug_attempts a ON a.id = l.attempt_id
         WHERE a.state IN ('leased','running')
           AND (l.revoked_at IS NOT NULL OR l.expires_at <= ?)`
      )
      .all(nowMs);
    for (const row of stale) {
      const outcome = requeueExpiredLease(this.db, this.clock, row.lease_id);
      if (!outcome) continue;
      result.expiredLeases += 1;
      if (outcome.receipt) result.terminatedRuns += 1;
      else result.requeuedRuns += 1;
    }

    // 2. Runs stuck in `reconciling` with no live lease.
    const reconciling = this.db
      .query<RunRow, [string]>("SELECT * FROM slug_runs WHERE state = 'reconciling'")
      .all("reconciling");
    for (const run of reconciling) {
      const outcome = resolveReconcilingRun(this.db, this.clock, run.id);
      if (!outcome) continue;
      if (outcome.receipt) result.terminatedRuns += 1;
      else result.requeuedRuns += 1;
    }

    // 3. Terminal runs whose receipt write never landed (crash window).
    //    A dangling terminal_receipt_id pointing at a deleted row counts as
    //    missing too, so the check is by existence, not by pointer.
    const missing = this.db
      .query<RunRow, []>(
        `SELECT r.* FROM slug_runs r
         WHERE r.state = 'terminal'
           AND NOT EXISTS (SELECT 1 FROM receipts x WHERE x.run_id = r.id)`
      )
      .all();
    for (const run of missing) {
      const receipt = ensureTerminalReceipt(this.db, this.clock, run.id);
      if (receipt) result.createdReceipts += 1;
    }

    // 4. Admitted runs superseded by a newer execution epoch.
    const runningSlugs = this.db
      .query<{ id: string }, [string]>("SELECT id FROM slugs WHERE desired_state = 'running'")
      .all("running");
    for (const slug of runningSlugs) {
      result.cancelledStaleAdmissions += cancelStaleEpochRuns(this.db, this.clock, slug.id);
    }

    return result;
  }
}
