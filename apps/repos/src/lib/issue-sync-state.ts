/**
 * Issue detection watermark accessors.
 *
 * `issue_sync_state` is LOCAL-ONLY by design, exactly like `pr_monitor_state`:
 * the watermark is a per-machine traversal position (the sync is owned by one
 * station), so the table is deliberately absent from the auto-index
 * SYNC_TABLES list and never propagates to shared Postgres. Rows are bounded —
 * one per remote ever synced.
 *
 * The watermark is a GitHub `updated_at` timestamp, never a local clock
 * reading (issue detection brief section 3.1.1 rule W1), and it stores the
 * value the NEXT run passes to `filterBy.since`: `max(updatedAt) − overlap`.
 * It only ever moves forward (rule W7) and only after a traversal complete by
 * exhaustion (rule W2).
 */
import { getDb } from "../db/database.js";

/** One row of `issue_sync_state`, exactly as stored. */
export interface IssueSyncStateRow {
  remote_url: string;
  gh_owner: string;
  gh_repo: string;
  /** The `since` boundary for the next run (`max(updatedAt) − overlap`). */
  watermark_updated_at: string | null;
  first_complete_at: string | null;
  last_complete_at: string | null;
  last_run_at: string;
  /** complete | incomplete | truncated */
  last_outcome: string;
  last_incomplete_reason: string | null;
}

export function getIssueSyncState(remoteUrl: string): IssueSyncStateRow | null {
  const db = getDb();
  return (db
    .query("SELECT * FROM issue_sync_state WHERE remote_url = ?")
    .get(remoteUrl) as IssueSyncStateRow | null) ?? null;
}

export interface IssueSyncRunRecord {
  remoteUrl: string;
  ghOwner: string;
  ghRepo: string;
  /**
   * The new watermark, or null to leave the stored one unchanged. A run that
   * is not complete-by-exhaustion MUST pass null: the watermark never moves on
   * a failed or truncated traversal.
   */
  watermarkUpdatedAt: string | null;
  outcome: "complete" | "incomplete" | "truncated";
  incompleteReason: string | null;
}

/**
 * Record one run's outcome.
 *
 * `first_complete_at`/`last_complete_at` only advance on a complete outcome,
 * which is what makes the first successful traversal the baseline run (W6).
 * The watermark is COALESCEd so an incomplete run's null cannot erase a
 * previous boundary, and `first_complete_at` is COALESCEd so it records the
 * first complete traversal, not the most recent one.
 */
export function recordIssueSyncRun(record: IssueSyncRunRecord): void {
  const db = getDb();
  db.query(
    `INSERT INTO issue_sync_state
       (remote_url, gh_owner, gh_repo, watermark_updated_at, first_complete_at,
        last_complete_at, last_run_at, last_outcome, last_incomplete_reason)
     VALUES (?, ?, ?, ?,
             CASE WHEN ? = 'complete' THEN datetime('now') END,
             CASE WHEN ? = 'complete' THEN datetime('now') END,
             datetime('now'), ?, ?)
     ON CONFLICT(remote_url) DO UPDATE SET
       gh_owner = excluded.gh_owner,
       gh_repo = excluded.gh_repo,
       watermark_updated_at = COALESCE(excluded.watermark_updated_at, issue_sync_state.watermark_updated_at),
       first_complete_at = COALESCE(issue_sync_state.first_complete_at, excluded.first_complete_at),
       last_complete_at = COALESCE(excluded.last_complete_at, issue_sync_state.last_complete_at),
       last_run_at = excluded.last_run_at,
       last_outcome = excluded.last_outcome,
       last_incomplete_reason = excluded.last_incomplete_reason`,
  ).run(
    record.remoteUrl,
    record.ghOwner,
    record.ghRepo,
    record.watermarkUpdatedAt,
    record.outcome,
    record.outcome,
    record.outcome,
    record.incompleteReason,
  );
}
