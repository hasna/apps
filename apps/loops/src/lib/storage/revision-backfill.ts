/**
 * The Postgres driver for `loops-serve backfill-revisions` (hasna/apps#1724 P3).
 *
 * Pure shell around the contract-level backfill in `../bundle/backfill.ts`:
 * enumerate tenants, then per tenant run the candidate list through
 * `collectRevisionBackfillCandidates` (which pages `listLoops` — RLS-scoped, so
 * it must run inside the tenant context) and attempt each loop in P3 cohort
 * order, one batch per tenant-scoped transaction.
 *
 * Every per-tenant transaction is an `executor.withRequestContext(...)` — the
 * same `SET LOCAL ROLE open_loops_runtime` + `open_loops.tenant_id` binding the
 * API uses — so the job writes exactly as the push route does and RLS applies
 * exactly as it does in serve. The transaction is also the batch boundary:
 * anything a batch attempted either all commits or all rolls back, and an
 * unexpected error (a row archived mid-run, a concurrent push that won the
 * version race, an object store that already holds the key) rolls back the
 * batch, is recorded as a `batchError`, and the run moves PAST it — never
 * retrying the same failing batch in a loop. Rerunning the job retries it, and
 * everything that already committed is skipped by the `alreadyBackfilled`
 * guard.
 *
 * `--limit` budgets real backfill units (`created` + `wouldCreate`): skips are
 * free because they are stable across reruns, so a limited run stops exactly
 * where a resumption should continue. `--dry-run` performs zero writes of any
 * kind — no ledger rows, no objects.
 */
import type { BundleArtifactStorage } from "../bundle/artifact-storage.js";
import {
  collectRevisionBackfillCandidates,
  runRevisionBackfill,
  type RevisionBackfillAttempt,
} from "../bundle/backfill.js";
import type { PgPoolExecutor } from "./pg-executor.js";
import { createPostgresLoopStorage } from "./postgres-loop-storage.js";

export const REVISION_BACKFILL_DEFAULT_AUTHOR = "backfill-revisions";
export const REVISION_BACKFILL_DEFAULT_BATCH_SIZE = 100;
export const REVISION_BACKFILL_DEFAULT_REASON =
  "backfill-revisions: revision 1 for legacy bundled loops (hasna/apps#1724 P3)";

const MAX_SAMPLES_PER_TENANT = 5;

export interface RevisionBackfillCommandOptions {
  /** Classify, name and digest, but write nothing anywhere. */
  dryRun?: boolean;
  /**
   * Cap on real backfill units this run performs (`created`, or `wouldCreate`
   * under --dry-run). Skips do not consume budget. Default: no cap.
   */
  limit?: number;
  /** Loops per tenant-scoped transaction. Default 100. */
  batchSize?: number;
  /** Restrict the run to one tenant. Default: every tenant in `tenants`. */
  tenantId?: string;
  /** Ledger author for every revision (and the request-context principal id). */
  author?: string;
  /** Manifest source.reason recorded on every revision. */
  reason?: string;
  sourceStation?: string;
  sourceAgent?: string;
}

export interface RevisionBackfillTenantReport {
  tenantId: string;
  /** Loops the run looked at in this tenant (skips included). */
  attempted: number;
  created: number;
  wouldCreate: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  /** First few skip attempts with their detail, so an operator can see who was left out and why. */
  samples: RevisionBackfillAttempt[];
  /** The most recent batch that rolled back, if any. The run moved past it; rerun to retry it. */
  batchError?: string;
}

export interface RevisionBackfillCommandResult {
  dryRun: boolean;
  tenants: RevisionBackfillTenantReport[];
  created: number;
  wouldCreate: number;
  skipped: number;
  /** Tenant-scoped batches attempted (committed, or would-committed under --dry-run). */
  batches: number;
  batchErrors: string[];
  /** True when --limit ran out of budget before every candidate was attempted. */
  stopped: boolean;
  complete: boolean;
}

async function listTenantIds(executor: PgPoolExecutor, tenantId?: string): Promise<string[]> {
  if (tenantId && tenantId.trim() !== "") return [tenantId.trim()];
  // The migrator session inherits open_loops_owner, whose auth_definer lookup
  // policy grants it the tenant catalog; no tenant GUC is set here and none
  // should be — this is the control-plane view, not a tenant view.
  const rows = await executor.query<{ id: string }>("SELECT id FROM tenants ORDER BY id");
  return rows.map((row) => row.id);
}

export async function runRevisionBackfillCommand(
  executor: PgPoolExecutor,
  artifacts: BundleArtifactStorage,
  opts: RevisionBackfillCommandOptions = {},
): Promise<RevisionBackfillCommandResult> {
  const dryRun = Boolean(opts.dryRun);
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? REVISION_BACKFILL_DEFAULT_BATCH_SIZE));
  const limit = opts.limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(opts.limit));
  const author = opts.author?.trim() || REVISION_BACKFILL_DEFAULT_AUTHOR;
  const reason = (opts.reason ?? REVISION_BACKFILL_DEFAULT_REASON).slice(0, 512);
  const sourceStation = opts.sourceStation?.trim() || undefined;
  const sourceAgent = opts.sourceAgent?.trim() || undefined;
  const baseContext = {
    artifacts,
    tenantId: "",
    dryRun,
    author,
    reason,
    ...(sourceStation === undefined ? {} : { sourceStation }),
    ...(sourceAgent === undefined ? {} : { sourceAgent }),
  };

  const tenantIds = await listTenantIds(executor, opts.tenantId);
  const tenants: RevisionBackfillTenantReport[] = [];
  const batchErrors: string[] = [];
  let batchCounter = 0;
  let createdTotal = 0;
  let wouldCreateTotal = 0;
  let skippedTotal = 0;
  let budgetUsed = (): number => createdTotal + wouldCreateTotal;
  let stopped = false;

  for (const tenantId of tenantIds) {
    if (budgetUsed() >= limit) {
      stopped = true;
      break;
    }
    const report: RevisionBackfillTenantReport = {
      tenantId,
      attempted: 0,
      created: 0,
      wouldCreate: 0,
      skipped: 0,
      skippedByReason: {},
      samples: [],
    };

    const principal = { tenantId, principalId: author, requestId: `${author}-${tenantId}-${batchCounter}` };

    // Candidate collection is a read-only tenant-scoped pass: listLoops pages
    // through RLS, so it needs the tenant context even though it writes nothing.
    const candidates = await executor.withRequestContext(principal, (client) =>
      collectRevisionBackfillCandidates(createPostgresLoopStorage(client, principal, { contextAlreadyBound: true })),
    );
    if (candidates.length === 0) {
      tenants.push(report);
      continue;
    }

    let index = 0;
    while (index < candidates.length && budgetUsed() < limit) {
      const slice = candidates.slice(index, index + Math.min(batchSize, limit - budgetUsed()));
      if (slice.length === 0) break;
      batchCounter += 1;
      const requestId = `${author}-${tenantId}-${batchCounter}`;
      try {
        const result = await executor.withRequestContext(
          { tenantId, principalId: author, requestId },
          (client) =>
            runRevisionBackfill(
              { ...baseContext, tenantId, storage: createPostgresLoopStorage(client, { tenantId, principalId: author, requestId }, { contextAlreadyBound: true }) },
              slice,
            ),
        );
        report.created += result.created;
        report.wouldCreate += result.wouldCreate;
        const batchSkipped = result.attempts.length - result.created - result.wouldCreate;
        report.skipped += batchSkipped;
        for (const [reasonName, count] of Object.entries(result.skipped)) {
          report.skippedByReason[reasonName] = (report.skippedByReason[reasonName] ?? 0) + count;
        }
        for (const attempt of result.attempts) {
          if (attempt.outcome !== "skipped") continue;
          if (report.samples.length < MAX_SAMPLES_PER_TENANT) report.samples.push(attempt);
        }
        report.attempted += result.attempts.length;
      } catch (error) {
        // The batch rolled back as a unit. Record it and move PAST it: the
        // next batch starts after this slice, so a persistently failing loop
        // cannot wedge the run. A rerun retries exactly this slice.
        const message = error instanceof Error ? error.message : String(error);
        report.batchError = message;
        batchErrors.push(`tenant ${tenantId} batch ${batchCounter}: ${message}`);
        break;
      }
      index += slice.length;
    }
    createdTotal += report.created;
    wouldCreateTotal += report.wouldCreate;
    skippedTotal += report.skipped;
    if (index < candidates.length) stopped = true;
    tenants.push(report);
  }

  return {
    dryRun,
    tenants,
    created: createdTotal,
    wouldCreate: wouldCreateTotal,
    skipped: skippedTotal,
    batches: batchCounter,
    batchErrors,
    stopped,
    complete: !stopped,
  };
}
