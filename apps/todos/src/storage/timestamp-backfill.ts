/**
 * Backfill of terminal-status timestamps on the hosted Postgres store.
 *
 * Measured on the fleet 2026-08-17 (export of 63,603 rows): 1,569 completed
 * tasks carried a NULL `completed_at` and 123 failed tasks carried NULL
 * `started_at` AND NULL `completed_at`. Recency-based reads (todos recap,
 * standup — "what happened in the last N hours") filter on
 * `completed_at > since`, so those rows are not datable and silently drop out
 * of activity surfaces. The write paths are fixed to enforce the contract
 * going forward (see db/task-crud.updateTask, db/task-lifecycle.failTask and
 * the postgres adapter); this module repairs the rows that predate the fix.
 *
 * Derivation, in precedence order, per column:
 *
 *   completed_at <- latest audit_history entry with action 'complete' or
 *                   'fail' for the task (the immutable transition receipt);
 *                   else metadata._failure.failed_at for failed rows; else the
 *                   row's own updated_at (the last write to a terminal row is
 *                   the terminal transition itself).
 *   started_at   <- earliest audit_history entry with action 'start'; no
 *                   fallback — an undeterminable start stays NULL rather than
 *                   inventing one.
 *
 * Safety contract (mirrors the comment-redaction backfill):
 *   - dry-run by default; `--apply` requires an explicit confirmation token;
 *   - `--apply` requires an evidence path, written BEFORE any mutation, so the
 *     pre-change state is preserved and readable back;
 *   - only NULL columns are ever written (idempotent, compare-and-set guarded
 *     on the column still being NULL, so a concurrent writer is never
 *     overwritten);
 *   - bounded keyset batches, never an unbounded scan.
 */
import type { TodosPostgresQueryClient } from "./postgres-sync.js";

export const TIMESTAMP_BACKFILL_CONFIRMATION = "BACKFILL_TODOS_TERMINAL_TIMESTAMPS";

export interface TimestampBackfillOptions {
  /** Defaults to a non-mutating scan. */
  apply?: boolean;
  /** Required when `apply` is true to prevent an accidental production rewrite. */
  confirmation?: string;
  service?: string;
  tableName?: string;
  batchSize?: number;
  /** Required when `apply` is true: pre-state evidence is written here first. */
  evidencePath?: string;
}

export interface TimestampBackfillResult {
  dry_run: boolean;
  scanned: number;
  candidates: number;
  completed_at_backfilled: number;
  started_at_backfilled: number;
  batches: number;
  /** Raw candidates still present after this run (or found by a dry run). */
  remaining_candidates: number;
  evidence_path: string | null;
}

interface CandidateRow {
  object_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
  failed_at: string | null;
}

interface HistoryRow {
  task_id: string;
  action: string;
  new_value: string | null;
  created_at: string | null;
}

interface BackfillRow {
  object_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
  derived_started_at: string | null;
  derived_completed_at: string | null;
  started_source: "audit_history" | null;
  completed_source: "audit_history" | "failure_metadata" | "updated_at" | null;
}

function toIso(value: string | null | undefined): string | null {
  if (!value || value === "null") return null;
  // Audit-history created_at may arrive as a full ISO string; normalize.
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Scan terminal rows missing timestamps and (with `apply` + confirmation)
 * fill them from the audit trail. Never writes a non-NULL column.
 */
export async function backfillMissingTimestamps(
  client: TodosPostgresQueryClient,
  options: TimestampBackfillOptions = {},
): Promise<TimestampBackfillResult> {
  const service = options.service ?? "todos";
  const tableName = options.tableName ?? "todos_sync_records";
  const batchSize = Math.min(Math.max(options.batchSize ?? 100, 1), 500);
  const apply = Boolean(options.apply);
  if (apply && options.confirmation !== TIMESTAMP_BACKFILL_CONFIRMATION) {
    throw new Error(
      `timestamp-backfill: --apply requires --confirm=${TIMESTAMP_BACKFILL_CONFIRMATION}`,
    );
  }
  if (apply && !options.evidencePath) {
    throw new Error(
      "timestamp-backfill: --apply requires --evidence-path so the pre-change state is preserved before mutation",
    );
  }

  let scanned = 0;
  let candidates = 0;
  let completedAtBackfilled = 0;
  let startedAtBackfilled = 0;
  let remainingAfterApply = 0;
  let batches = 0;
  let cursor: string | null = null;

  for (;;) {
    const pageResult = await client.query<CandidateRow>(
      // `= 'null'` arms cover the fleet's historical double-encoded payloads
      // ("completed_at": "null" as a JSON STRING), which `IS NULL` alone misses.
      `/* todos:timestamp-backfill-candidates */ SELECT object_id,
         payload->>'status' AS status,
         payload->>'started_at' AS started_at,
         payload->>'completed_at' AS completed_at,
         payload->>'updated_at' AS updated_at,
         payload->'metadata'->'_failure'->>'failed_at' AS failed_at
       FROM ${tableName}
       WHERE service = $1 AND object_type = 'tasks' AND deleted_at IS NULL
         AND ((payload->>'status' = 'completed'
             AND ((payload->>'completed_at') IS NULL OR (payload->>'completed_at') = 'null'))
           OR (payload->>'status' = 'failed'
             AND ((payload->>'started_at') IS NULL OR (payload->>'started_at') = 'null'
               OR (payload->>'completed_at') IS NULL OR (payload->>'completed_at') = 'null')))
         AND ($2::text IS NULL OR object_id > $2)
       ORDER BY object_id
       LIMIT $3`,
      [service, cursor, batchSize],
    );
    const page: CandidateRow[] = pageResult.rows;
    batches += 1;
    scanned += page.length;
    if (page.length === 0) break;

    // Normalize the double-encoded string "null" (a known fleet payload shape)
    // to a real null so every later intent check matches the SQL's fill arms.
    const batch: CandidateRow[] = page.map((row) => ({
      ...row,
      started_at: toIso(row.started_at),
      completed_at: toIso(row.completed_at),
      updated_at: toIso(row.updated_at),
      failed_at: toIso(row.failed_at),
    }));
    const taskIds = batch.map((row) => row.object_id);

    // One bounded history fetch per batch: the immutable transition receipts
    // that date the terminal transitions.
    const historyResult = await client.query<HistoryRow>(
      `/* todos:timestamp-backfill-history */ SELECT
         payload->>'task_id' AS task_id,
         payload->>'action' AS action,
         payload->>'new_value' AS new_value,
         payload->>'created_at' AS created_at
       FROM ${tableName}
       WHERE service = $1 AND object_type = 'audit_history' AND deleted_at IS NULL
         AND payload->>'action' IN ('start', 'complete', 'fail')
         AND payload->>'task_id' = ANY($2::text[])`,
      [service, taskIds],
    );
    const historyRows: HistoryRow[] = historyResult.rows;
    const byTask = new Map<string, HistoryRow[]>();
    for (const row of historyRows) {
      if (!row.task_id) continue;
      const list = byTask.get(row.task_id) ?? [];
      list.push(row);
      byTask.set(row.task_id, list);
    }

    for (const row of batch) {
      candidates += 1;
      const entries = (byTask.get(row.object_id) ?? []).sort((a, b) =>
        (a.created_at ?? "").localeCompare(b.created_at ?? ""),
      );

      // started_at: earliest 'start' receipt.
      let derivedStartedAt: string | null = null;
      let startedSource: BackfillRow["started_source"] = null;
      if (!row.started_at) {
        const start = entries.find((entry) => entry.action === "start");
        const candidate = toIso(start?.created_at);
        if (candidate) {
          derivedStartedAt = candidate;
          startedSource = "audit_history";
        }
      }

      // completed_at: latest 'complete'/'fail' receipt, then failure metadata,
      // then the row's own updated_at.
      let derivedCompletedAt: string | null = null;
      let completedSource: BackfillRow["completed_source"] = null;
      if (!row.completed_at) {
        const terminal = entries.filter(
          (entry) => entry.action === "complete" || entry.action === "fail",
        );
        if (terminal.length > 0) {
          const latest = terminal[terminal.length - 1]!;
          const candidate = toIso(latest.created_at);
          if (candidate) {
            derivedCompletedAt = candidate;
            completedSource = "audit_history";
          }
        }
        if (!derivedCompletedAt && row.failed_at && row.status === "failed") {
          const candidate = toIso(row.failed_at);
          if (candidate) {
            derivedCompletedAt = candidate;
            completedSource = "failure_metadata";
          }
        }
        if (!derivedCompletedAt) {
          const candidate = toIso(row.updated_at);
          if (candidate) {
            derivedCompletedAt = candidate;
            completedSource = "updated_at";
          }
        }
      }

      const evidenceRow: BackfillRow = {
        object_id: row.object_id,
        status: row.status,
        started_at: row.started_at,
        completed_at: row.completed_at,
        updated_at: row.updated_at,
        derived_started_at: derivedStartedAt,
        derived_completed_at: derivedCompletedAt,
        started_source: startedSource,
        completed_source: completedSource,
      };
      if (apply && options.evidencePath) {
        // Persist the pre-state of THIS row before its mutation lands, so a
        // crash mid-run can never leave mutations without their evidence.
        const { appendFileSync, mkdirSync } = await import("node:fs");
        const { dirname } = await import("node:path");
        mkdirSync(dirname(options.evidencePath), { recursive: true });
        appendFileSync(options.evidencePath, JSON.stringify(evidenceRow) + "\n");
      }

      let completedAtLanded = false;
      let startedAtLanded = false;
      if (apply) {
        const willFillStarted = row.started_at === null && derivedStartedAt !== null;
        const willFillCompleted = row.completed_at === null && derivedCompletedAt !== null;
        if (willFillStarted || willFillCompleted) {
          // Per-column CASE guard inside the SET: the WHERE clause matches the
          // row when EITHER column is fillable, so an unconditional SET on the
          // other column would overwrite a concurrent writer. Each column is
          // written only when it is still NULL in the row the statement sees.
          // RETURNING reports which column THIS statement actually wrote, so
          // the counts reflect what landed rather than what was intended.
          const result = await client.query<{
            object_id: string;
            completed_written: boolean;
            started_written: boolean;
          }>(
            `/* todos:timestamp-backfill-apply */ UPDATE ${tableName} SET
               payload = jsonb_set(
                 jsonb_set(
                   payload,
                   '{completed_at}',
                   CASE WHEN $3::text IS NOT NULL
                          AND ((payload->>'completed_at') IS NULL OR (payload->>'completed_at') = 'null')
                        THEN to_jsonb($3::text) ELSE payload->'completed_at' END,
                   true
                 ),
                 '{started_at}',
                 CASE WHEN $4::text IS NOT NULL
                        AND ((payload->>'started_at') IS NULL OR (payload->>'started_at') = 'null')
                      THEN to_jsonb($4::text) ELSE payload->'started_at' END,
                 true
               )
             WHERE service = $1 AND object_type = 'tasks' AND object_id = $2 AND deleted_at IS NULL
               AND (($3::text IS NOT NULL
                      AND ((payload->>'completed_at') IS NULL OR (payload->>'completed_at') = 'null'))
                 OR ($4::text IS NOT NULL
                      AND ((payload->>'started_at') IS NULL OR (payload->>'started_at') = 'null')))
             RETURNING object_id,
               ($3::text IS NOT NULL AND payload->>'completed_at' = $3::text) AS completed_written,
               ($4::text IS NOT NULL AND payload->>'started_at' = $4::text) AS started_written`,
            [service, row.object_id, derivedCompletedAt, derivedStartedAt],
          );
          if (result.rows.length > 0) {
            const landed = result.rows[0]!;
            completedAtLanded = willFillCompleted && landed.completed_written;
            startedAtLanded = willFillStarted && landed.started_written;
            if (completedAtLanded) completedAtBackfilled += 1;
            if (startedAtLanded) startedAtBackfilled += 1;
          }
        }
      }

      // Would this row still match the candidate scan on the next run?
      // completed rows remain candidates while completed_at is unfilled; failed
      // rows while EITHER column is unfilled.
      if (row.completed_at === null && !completedAtLanded) {
        remainingAfterApply += 1;
      } else if (row.status === "failed" && row.started_at === null && !startedAtLanded) {
        remainingAfterApply += 1;
      }
    }

    const last = batch[batch.length - 1]!;
    if (last.object_id === cursor) break; // no progress — safety
    cursor = last.object_id;

    if (page.length < batchSize) break;
  }

  return {
    dry_run: !apply,
    scanned,
    candidates,
    completed_at_backfilled: apply ? completedAtBackfilled : 0,
    started_at_backfilled: apply ? startedAtBackfilled : 0,
    batches,
    remaining_candidates: apply ? remainingAfterApply : candidates,
    evidence_path: options.evidencePath ?? null,
  };
}
