import type { DispatchOptions, DispatchRecord, ScheduledDispatch } from "../types.js";
import type { Store } from "./store.js";
import { computeNextRun } from "./schedule.js";
import { nowIso } from "./ids.js";

export interface SchedulerDeps {
  store: Store;
  /** Performs an actual dispatch (usually DispatchClient.send). */
  dispatch: (options: DispatchOptions) => Promise<DispatchRecord>;
  /** Clock, injectable for tests. */
  now?: () => Date;
  /** Delay before retrying a failed one-shot schedule. Default 60s. */
  retryDelayMs?: number;
  /**
   * How long a failing one-shot schedule keeps retrying (measured from its fire
   * time) before it gives up and is marked `failed`, instead of retrying
   * forever against a permanently-dead target. Default 1 hour.
   */
  maxRetryWindowMs?: number;
  /** Optional sink for errors (a dispatch failing should not stop the tick). */
  onError?: (schedule: ScheduledDispatch, error: unknown) => void;
}

export interface TickResult {
  /** Terminal receipts: entries that reached a terminal success state this tick. */
  succeeded: ScheduledDispatch[];
  /** Terminal receipts: entries that recorded a failure this tick. */
  failed: ScheduledDispatch[];
}

/**
 * Fire every due schedule once: run its dispatch, then advance it — a one-shot
 * `at` becomes `succeeded` (terminal); a `cron` reschedules to its next run and
 * stays `admitted`. A failed one-shot is kept admitted and moved to a retry time so
 * it is not permanently consumed by a transient tmux/ssh failure and does not
 * spin in the current tick loop. All state is persisted, so the queue survives a
 * daemon restart.
 */
export async function tick(deps: SchedulerDeps): Promise<TickResult> {
  const now = deps.now ?? (() => new Date());
  const current = now();
  const retryDelayMs = deps.retryDelayMs ?? 60_000;
  const maxRetryWindowMs = deps.maxRetryWindowMs ?? 60 * 60_000;
  const due = deps.store.dueSchedules(current.getTime());
  const succeeded: ScheduledDispatch[] = [];
  const failed: ScheduledDispatch[] = [];

  for (const sched of due) {
    let lastAttemptId: string | undefined;
    let failedDispatch = false;
    let failureReason: string | undefined;
    try {
      const rec = await deps.dispatch(sched.options);
      lastAttemptId = rec?.id;
      if (rec?.status !== "succeeded") {
        failedDispatch = true;
        failureReason = rec?.detail ?? `dispatch ${rec?.id ?? "unknown"} ended with status ${rec?.status ?? "unknown"}`;
        deps.onError?.(sched, new Error(failureReason));
      }
    } catch (err) {
      failedDispatch = true;
      failureReason = err instanceof Error ? err.message : String(err);
      deps.onError?.(sched, err);
    }

    const firedAt = nowIso();
    const currentSched = deps.store.getSchedule(sched.id);
    if (!currentSched || currentSched.status !== "admitted") {
      // A user may pause/cancel/clear a schedule while its dispatch is in
      // flight. Do not resurrect it or abort the rest of the tick.
      continue;
    }
    if (failedDispatch) {
      // One-shots give up after the retry window so a permanently-dead target
      // does not cause infinite retries; crons always retry at their cadence.
      if (!sched.cron && !sched.intervalMs) {
        // Measure the retry window from the effective first-due time: the later
        // of the scheduled time and creation. A past `at` means "fire ASAP" and
        // must not be treated as decades of expired retries.
        const firstDue = Math.max(
          new Date(sched.at ?? sched.createdAt).getTime(),
          new Date(sched.createdAt).getTime(),
        );
        if (current.getTime() - firstDue >= maxRetryWindowMs) {
          const updated = deps.store.updateScheduleIfStatus(sched.id, "admitted", {
            status: "failed",
            lastAttemptId: lastAttemptId,
            lastAttemptAt: firedAt,
            lastFailureAt: firedAt,
            lastFailureReason: failureReason,
            failureCount: (currentSched.failureCount ?? sched.failureCount ?? 0) + 1,
          });
          if (updated) failed.push(updated);
          continue;
        }
      }
      const nextRun = sched.intervalMs
        ? computeNextRun({ intervalMs: sched.intervalMs }, now())
        : sched.cron
          ? computeNextRun({ cron: sched.cron }, now())
          : new Date(current.getTime() + retryDelayMs).toISOString();
      const updated = deps.store.updateScheduleIfStatus(sched.id, "admitted", {
        status: "admitted",
        nextRun,
        lastAttemptId: lastAttemptId,
        lastAttemptAt: firedAt,
        lastFailureAt: firedAt,
        lastFailureReason: failureReason,
        failureCount: (currentSched.failureCount ?? sched.failureCount ?? 0) + 1,
      });
      if (updated) failed.push(updated);
      continue;
    }

    if (sched.cron || sched.intervalMs) {
      // Reschedule recurring schedules after the dispatch attempt completes,
      // which avoids overlapping runs by default.
      const nextRun = sched.intervalMs
        ? computeNextRun({ intervalMs: sched.intervalMs }, now())
        : computeNextRun({ cron: sched.cron }, now());
      const updated = deps.store.updateScheduleIfStatus(sched.id, "admitted", {
        status: "admitted",
        nextRun,
        lastAttemptId: lastAttemptId,
        lastAttemptAt: firedAt,
        lastFailureAt: undefined,
        lastFailureReason: undefined,
      });
      if (updated) succeeded.push(updated);
    } else {
      const updated = deps.store.updateScheduleIfStatus(sched.id, "admitted", {
        status: "succeeded",
        lastAttemptId: lastAttemptId,
        lastAttemptAt: firedAt,
        lastFailureAt: undefined,
        lastFailureReason: undefined,
      });
      if (updated) succeeded.push(updated);
    }
  }

  return { succeeded, failed };
}
