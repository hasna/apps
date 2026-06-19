import type { ExecutorResult, Loop, LoopRun } from "../types.js";
import { computeNextAfter, dueSlots } from "./schedule.js";
import type { Store } from "./store.js";
import { executeLoopTarget } from "./workflow-runner.js";

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

export function manualRunScheduledFor(loop: Loop, now: Date = new Date()): string {
  if (loop.nextRunAt && new Date(loop.nextRunAt).getTime() <= now.getTime()) {
    return loop.retryScheduledFor ?? loop.nextRunAt;
  }
  return now.toISOString();
}

export function shouldAdvanceManualRun(loop: Loop, scheduledFor: string, now: Date = new Date()): boolean {
  if (!loop.nextRunAt || new Date(loop.nextRunAt).getTime() > now.getTime()) return false;
  return scheduledFor === (loop.retryScheduledFor ?? loop.nextRunAt);
}

function nextAfterRetry(loop: Loop, now: Date): string {
  return new Date(now.getTime() + loop.retryDelayMs).toISOString();
}

export function advanceLoop(store: Store, loop: Loop, run: LoopRun, finishedAt: Date, succeeded: boolean): void {
  if (run.status === "running") return;
  const current = store.getLoop(loop.id);
  if (!current || current.status !== "active") return;
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

export async function executeClaimedRun(deps: {
  store: Store;
  runnerId: string;
  loop: Loop;
  run: LoopRun;
  now?: () => Date;
  execute?: (loop: Loop, run: LoopRun) => Promise<ExecutorResult>;
  onError?: (loop: Loop, error: unknown) => void;
}): Promise<LoopRun> {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const heartbeatEveryMs = Math.max(10, Math.min(60_000, Math.floor(deps.loop.leaseMs / 3)));
  heartbeat = setInterval(() => {
    deps.store.heartbeatRunLease(deps.run.id, deps.runnerId, deps.loop.leaseMs);
  }, heartbeatEveryMs);
  heartbeat.unref();

  try {
    const result = await (deps.execute ?? ((loop, run) =>
      executeLoopTarget(deps.store, loop, run, {
        onSpawn: (pid) => deps.store.markRunPid(run.id, pid, deps.runnerId),
      })))(deps.loop, deps.run);
    return deps.store.finalizeRun(deps.run.id, {
      status: result.status,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error: result.error,
      pid: result.pid,
    }, {
      claimedBy: deps.runnerId,
      now: deps.now?.() ?? new Date(result.finishedAt),
    });
  } catch (err) {
    deps.onError?.(deps.loop, err);
    const finishedAt = new Date();
    return deps.store.finalizeRun(deps.run.id, {
      status: "failed",
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - new Date(deps.run.startedAt ?? deps.run.createdAt).getTime(),
      stdout: "",
      stderr: "",
      error: err instanceof Error ? err.message : String(err),
    }, {
      claimedBy: deps.runnerId,
      now: deps.now?.() ?? finishedAt,
    });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
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

  const finalRun = await executeClaimedRun({
    store: deps.store,
    runnerId: deps.runnerId,
    loop: claim.loop,
    run: claim.run,
    now: deps.now,
    execute: deps.execute,
    onError: deps.onError,
  });
  advanceLoop(deps.store, claim.loop, finalRun, new Date(finalRun.finishedAt ?? new Date()), finalRun.status === "succeeded");
  deps.onRun?.(finalRun);
  return finalRun;
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
      if (["failed", "timed_out", "abandoned"].includes(run.status) && run.attempt < loop.maxAttempts) break;
    }
  }

  return { claimed, completed, skipped, recovered, expired };
}
