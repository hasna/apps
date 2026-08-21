/**
 * Scheduler — event-driven admission of due cadence occurrences.
 *
 * The scheduler is the primary admission path; the reconciler's safety sweep
 * is recovery only and never a substitute for it. Admission keys are stable
 * across slug, revision, execution epoch, and scheduled time, so repeated
 * ticks are idempotent.
 */

import type { Database } from "bun:sqlite";
import type { Clock } from "./clock.js";
import {
  admitRun,
  getActiveRevision,
  insertTerminalSkipped,
  type RunRow,
  type SlugRow,
} from "./core.js";
import { nextDueAt, parseCadence } from "./cadence.js";

export interface AdmitOutcome {
  slugId: string;
  runId: string | null;
  dueMs: number;
  skipped: boolean;
  reason: "admitted" | "already_admitted" | "skipped_overlap" | "not_running" | "invalid_cadence";
}

export interface SchedulerStatus {
  checkedSlugs: number;
  admitted: AdmitOutcome[];
}

export interface AdmitOptions {
  /**
   * In-memory cadence base per slug, seeded when the slug entered the
   * running epoch. Used only until the first run exists (persisted runs
   * then drive the base). Kept in the daemon, not in the DB, because the
   * execution epoch boundary is not otherwise recorded.
   */
  cadenceBases?: ReadonlyMap<string, number>;
  /**
   * When true, a due occurrence is resolved to `skipped_overlap` while a
   * previous run of the same slug is still active. Execution states
   * (RUNNING/STOPPING) skip; queueing states (PAUSED) admit and queue.
   */
  skipOverlap?: boolean;
}

export class Scheduler {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock
  ) {}

  /**
   * Admit every occurrence that is due at or before `nowMs` for every slug
   * whose desired state is running.
   */
  admitDue(nowMs: number, opts: AdmitOptions = {}): SchedulerStatus {
    const slugs = this.db
      .query<SlugRow, [string]>("SELECT * FROM slugs WHERE desired_state = 'running'")
      .all("running");
    const admitted: AdmitOutcome[] = [];

    for (const slug of slugs) {
      admitted.push(...this.admitForSlug(slug, nowMs, opts));
    }

    return { checkedSlugs: slugs.length, admitted };
  }

  private admitForSlug(slug: SlugRow, nowMs: number, opts: AdmitOptions): AdmitOutcome[] {
    const revision = getActiveRevision(this.db, slug);
    if (!revision) {
      return [{ slugId: slug.id, runId: null, dueMs: nowMs, skipped: false, reason: "invalid_cadence" }];
    }
    let definition: { cadence?: unknown };
    try {
      definition = JSON.parse(revision.definition_json) as { cadence?: unknown };
    } catch {
      return [{ slugId: slug.id, runId: null, dueMs: nowMs, skipped: false, reason: "invalid_cadence" }];
    }
    const cadence = parseCadence(definition.cadence);
    if (!cadence) {
      return [{ slugId: slug.id, runId: null, dueMs: nowMs, skipped: false, reason: "invalid_cadence" }];
    }

    const outcomes: AdmitOutcome[] = [];
    let lastScheduled = this.lastScheduledAt(slug.id);
    const base = lastScheduled ?? opts.cadenceBases?.get(slug.id) ?? nowMs;

    for (let guard = 0; guard < 100; guard++) {
      const due = nextDueAt(cadence, lastScheduled ?? base, nowMs);
      if (due > nowMs) break;

      const overlapping = opts.skipOverlap !== false && this.hasActiveRun(slug.id);
      if (overlapping) {
        const skipped = insertTerminalSkipped(this.db, this.clock, {
          slug,
          revision,
          scheduledAt: due,
          epoch: slug.execution_epoch,
        });
        outcomes.push({
          slugId: slug.id,
          runId: skipped?.id ?? null,
          dueMs: due,
          skipped: true,
          reason: "skipped_overlap",
        });
        lastScheduled = due;
        continue;
      }

      const result = admitRun(this.db, this.clock, {
        slug,
        revision,
        scheduledAt: due,
        epoch: slug.execution_epoch,
        source: cadence.type === "interval" ? "interval" : "cron",
      });
      outcomes.push({
        slugId: slug.id,
        runId: result.ok ? result.run.id : (result.run?.id ?? null),
        dueMs: due,
        skipped: false,
        reason: result.ok ? "admitted" : result.reason === "already_admitted" ? "already_admitted" : "not_running",
      });
      lastScheduled = due;
    }

    return outcomes;
  }

  /** The most recent scheduled occurrence for a slug (drives the cadence base). */
  private lastScheduledAt(slugId: string): number | null {
    const row = this.db
      .query<{ n: number | null }, [string]>(
        "SELECT MAX(scheduled_at) AS n FROM slug_runs WHERE slug_id = ?"
      )
      .get(slugId);
    return row?.n ?? null;
  }

  /** A previous occurrence is "active" only while it is executing (leased,
   *  running, or reconciling) — queued (admitted/retry_wait) occurrences do
   *  not overlap and must not suppress admission. */
  private hasActiveRun(slugId: string): boolean {
    const row = this.db
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) AS n FROM slug_runs WHERE slug_id = ? AND state IN ('leased','running','reconciling')"
      )
      .get(slugId)!;
    return row.n > 0;
  }
}

export type { Cadence } from "./cadence.js";
export type { RunRow };
