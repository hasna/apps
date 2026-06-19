import type { ExecutorResult, Loop, LoopRun } from "../types.js";
import { executeLoop } from "./executor.js";
import { computeNextAfter, dueSlots } from "./schedule.js";
import type { Store } from "./store.js";

export interface SchedulerDeps {
  store: Store;
  runnerId: string;
  now?: () => Date;
  execute?: (loop: Loop, run: LoopRun) => Promise<ExecutorResult>;
  onError?: (loop: Loop, error: unknown) => void;
  onRun?: (run: LoopRun) => void;
}

export interface TickResult {
  claimed: LoopRun[];
  completed: LoopRun[];
  skipped: LoopRun[];
  recovered: LoopRun[];
  expired: Loop[];
}

function nextAfterRetry(loop: Loop, now: Date): string {
  return new Date(now.getTime() + loop.retryDelayMs).toISOString();
}

function advanceLoop(store: Store, loop: Loop, run: LoopRun, finishedAt: Date, succeeded: boolean): void {
  const shouldRetry = !succeeded && run.attempt < loop.maxAttempts;
  if (shouldRetry) {
    store.updateLoop(loop.id, {
      status: "active",
      nextRunAt: nextAfterRetry(loop, finishedAt),
      retryScheduledFor: run.scheduledFor,
    });
    return;
  }

  const nextRunAt = computeNextAfter(loop.schedule, new Date(run.scheduledFor), finishedAt);
  store.updateLoop(loop.id, {
    status: nextRunAt ? "active" : "stopped",
    nextRunAt,
    retryScheduledFor: undefined,
  });
}

async function runSlot(deps: SchedulerDeps, loop: Loop, scheduledFor: string): Promise<LoopRun | undefined> {
  const now = deps.now?.() ?? new Date();
  if (loop.overlap === "skip" && deps.store.hasRunningRun(loop.id)) {
    const skipped = deps.store.createSkippedRun(loop, scheduledFor, "previous run still active");
    advanceLoop(deps.store, loop, skipped, now, true);
    deps.onRun?.(skipped);
    return skipped;
  }

  const claim = deps.store.claimRun(loop, scheduledFor, deps.runnerId, now);
  if (!claim) return undefined;
  deps.onRun?.(claim.run);

  try {
    const result = await (deps.execute ?? executeLoop)(claim.loop, claim.run);
    const finalRun = deps.store.finalizeRun(claim.run.id, {
      status: result.status,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error: result.error,
      pid: result.pid,
    });
    advanceLoop(deps.store, claim.loop, finalRun, new Date(result.finishedAt), result.status === "succeeded");
    deps.onRun?.(finalRun);
    return finalRun;
  } catch (err) {
    deps.onError?.(claim.loop, err);
    const finishedAt = new Date();
    const finalRun = deps.store.finalizeRun(claim.run.id, {
      status: "failed",
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - new Date(claim.run.startedAt ?? claim.run.createdAt).getTime(),
      stdout: "",
      stderr: "",
      error: err instanceof Error ? err.message : String(err),
    });
    advanceLoop(deps.store, claim.loop, finalRun, finishedAt, false);
    deps.onRun?.(finalRun);
    return finalRun;
  }
}

export async function tick(deps: SchedulerDeps): Promise<TickResult> {
  const now = deps.now?.() ?? new Date();
  const recovered = deps.store.recoverExpiredRunLeases(now);
  for (const run of recovered) {
    const loop = deps.store.getLoop(run.loopId);
    if (loop) advanceLoop(deps.store, loop, run, new Date(run.finishedAt ?? now), false);
  }
  const expired = deps.store.expireLoops(now);
  const claimed: LoopRun[] = [];
  const completed: LoopRun[] = [];
  const skipped: LoopRun[] = [];

  for (const loop of deps.store.dueLoops(now)) {
    const plan = dueSlots(loop, now);
    for (const slot of plan.slots) {
      const run = await runSlot(deps, loop, slot);
      if (!run) continue;
      if (run.status === "running") claimed.push(run);
      else if (run.status === "skipped") skipped.push(run);
      else completed.push(run);
    }
  }

  return { claimed, completed, skipped, recovered, expired };
}
