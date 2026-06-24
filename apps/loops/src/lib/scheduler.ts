import type { ExecutorResult, Loop, LoopRun } from "../types.js";
import { computeNextAfter, dueSlots } from "./schedule.js";
import type { Store } from "./store.js";
import { executeLoopTarget } from "./workflow-runner.js";

export interface SchedulerDeps {
  store: Store;
  runnerId: string;
  now?: () => Date;
  beforeRun?: (loop: Loop, scheduledFor: string) => void;
  beforeFinalize?: (loop: Loop, run: LoopRun) => void;
  daemonLeaseId?: string;
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

export interface ClaimedLoopRun {
  loop: Loop;
  run: LoopRun;
}

export interface ClaimDueRunsResult extends TickResult {
  claims: ClaimedLoopRun[];
}

export function manualRunScheduledFor(loop: Loop, now: Date = new Date()): string {
  if (loop.status === "active" && loop.nextRunAt && new Date(loop.nextRunAt).getTime() <= now.getTime()) {
    return loop.retryScheduledFor ?? loop.nextRunAt;
  }
  return now.toISOString();
}

export function shouldAdvanceManualRun(loop: Loop, scheduledFor: string, now: Date = new Date()): boolean {
  if (loop.status !== "active") return false;
  if (!loop.nextRunAt || new Date(loop.nextRunAt).getTime() > now.getTime()) return false;
  return scheduledFor === (loop.retryScheduledFor ?? loop.nextRunAt);
}

export type ManualRunSource = "ad_hoc" | "due_slot" | "retry_slot";

export function manualRunSource(loop: Loop, scheduledFor: string, now: Date = new Date()): ManualRunSource {
  if (loop.status !== "active") return "ad_hoc";
  if (!loop.nextRunAt || new Date(loop.nextRunAt).getTime() > now.getTime()) return "ad_hoc";
  if (loop.retryScheduledFor && scheduledFor === loop.retryScheduledFor) return "retry_slot";
  return "due_slot";
}

function nextAfterRetry(loop: Loop, now: Date): string {
  return new Date(now.getTime() + loop.retryDelayMs).toISOString();
}

function isDaemonLeaseLost(error: unknown): boolean {
  return error instanceof Error && error.message === "daemon lease lost";
}

export function advanceLoop(
  store: Store,
  loop: Loop,
  run: LoopRun,
  finishedAt: Date,
  succeeded: boolean,
  opts: { daemonLeaseId?: string } = {},
): void {
  if (run.status === "running") return;
  const current = store.getLoop(loop.id);
  if (!current || current.status !== "active") return;
  if (current.retryScheduledFor && current.retryScheduledFor !== run.scheduledFor) return;
  const shouldRetry = !succeeded && run.attempt < current.maxAttempts;
  if (shouldRetry) {
    store.updateLoop(current.id, {
      status: "active",
      nextRunAt: nextAfterRetry(current, finishedAt),
      retryScheduledFor: run.scheduledFor,
    }, { daemonLeaseId: opts.daemonLeaseId });
    return;
  }

  const deferredRetry = store.nextRetryableRun(current.id, current.maxAttempts, run.scheduledFor);
  if (deferredRetry) {
    store.updateLoop(current.id, {
      status: "active",
      nextRunAt: nextAfterRetry(current, finishedAt),
      retryScheduledFor: deferredRetry.scheduledFor,
    }, { daemonLeaseId: opts.daemonLeaseId });
    return;
  }

  const nextRunAt = computeNextAfter(current.schedule, new Date(run.scheduledFor), finishedAt);
  store.updateLoop(current.id, {
    status: nextRunAt ? "active" : "stopped",
    nextRunAt,
    retryScheduledFor: undefined,
  }, { daemonLeaseId: opts.daemonLeaseId });
}

export async function executeClaimedRun(deps: {
  store: Store;
  runnerId: string;
  loop: Loop;
  run: LoopRun;
  now?: () => Date;
  beforeFinalize?: (loop: Loop, run: LoopRun) => void;
  daemonLeaseId?: string;
  execute?: (loop: Loop, run: LoopRun) => Promise<ExecutorResult>;
  onError?: (loop: Loop, error: unknown) => void;
}): Promise<LoopRun> {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const heartbeatEveryMs = Math.max(10, Math.min(60_000, Math.floor(deps.loop.leaseMs / 3)));
  heartbeat = setInterval(() => {
    deps.store.heartbeatRunLease(deps.run.id, deps.runnerId, deps.loop.leaseMs, new Date(), {
      daemonLeaseId: deps.daemonLeaseId,
    });
  }, heartbeatEveryMs);
  heartbeat.unref();

  try {
    const result = await (deps.execute ?? ((loop, run) =>
      executeLoopTarget(deps.store, loop, run, {
        daemonLeaseId: deps.daemonLeaseId,
        onSpawn: (pid) => deps.store.markRunPid(run.id, pid, deps.runnerId, { daemonLeaseId: deps.daemonLeaseId }),
      })))(deps.loop, deps.run);
    deps.beforeFinalize?.(deps.loop, deps.run);
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
      daemonLeaseId: deps.daemonLeaseId,
      now: deps.now?.() ?? new Date(result.finishedAt),
    });
  } catch (err) {
    deps.onError?.(deps.loop, err);
    try {
      deps.beforeFinalize?.(deps.loop, deps.run);
    } catch {
      return deps.store.getRun(deps.run.id) ?? deps.run;
    }
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
      daemonLeaseId: deps.daemonLeaseId,
      now: deps.now?.() ?? finishedAt,
    });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

async function runSlot(deps: SchedulerDeps, loop: Loop, scheduledFor: string): Promise<LoopRun | undefined> {
  const now = deps.now?.() ?? new Date();
  deps.beforeRun?.(loop, scheduledFor);
  if (loop.overlap === "skip" && deps.store.hasRunningRun(loop.id)) {
    let skipped: LoopRun;
    try {
      skipped = deps.store.createSkippedRun(loop, scheduledFor, "previous run still active", {
        daemonLeaseId: deps.daemonLeaseId,
      });
    } catch (error) {
      if (deps.daemonLeaseId && isDaemonLeaseLost(error)) return undefined;
      throw error;
    }
    advanceLoop(deps.store, loop, skipped, now, true, { daemonLeaseId: deps.daemonLeaseId });
    deps.onRun?.(skipped);
    return skipped;
  }

  let claim: ReturnType<Store["claimRun"]>;
  try {
    claim = deps.store.claimRun(loop, scheduledFor, deps.runnerId, now, { daemonLeaseId: deps.daemonLeaseId });
  } catch (error) {
    if (deps.daemonLeaseId && isDaemonLeaseLost(error)) return undefined;
    throw error;
  }
  if (!claim) return undefined;
  deps.beforeRun?.(claim.loop, claim.run.scheduledFor);
  deps.onRun?.(claim.run);

  const finalRun = await executeClaimedRun({
    store: deps.store,
    runnerId: deps.runnerId,
    loop: claim.loop,
    run: claim.run,
    now: deps.now,
    execute: deps.execute,
    beforeFinalize: deps.beforeFinalize,
    daemonLeaseId: deps.daemonLeaseId,
    onError: deps.onError,
  });
  advanceLoop(
    deps.store,
    claim.loop,
    finalRun,
    new Date(finalRun.finishedAt ?? new Date()),
    finalRun.status === "succeeded",
    { daemonLeaseId: deps.daemonLeaseId },
  );
  deps.onRun?.(finalRun);
  return finalRun;
}

function claimSlot(deps: SchedulerDeps, loop: Loop, scheduledFor: string): ClaimedLoopRun | LoopRun | undefined {
  const now = deps.now?.() ?? new Date();
  deps.beforeRun?.(loop, scheduledFor);
  if (loop.overlap === "skip" && deps.store.hasRunningRun(loop.id)) {
    if (deps.store.hasRunningRunForSlot(loop.id, scheduledFor)) return undefined;
    let skipped: LoopRun;
    try {
      skipped = deps.store.createSkippedRun(loop, scheduledFor, "previous run still active", {
        daemonLeaseId: deps.daemonLeaseId,
      });
    } catch (error) {
      if (deps.daemonLeaseId && isDaemonLeaseLost(error)) return undefined;
      throw error;
    }
    advanceLoop(deps.store, loop, skipped, now, true, { daemonLeaseId: deps.daemonLeaseId });
    deps.onRun?.(skipped);
    return skipped;
  }

  let claim: ReturnType<Store["claimRun"]>;
  try {
    claim = deps.store.claimRun(loop, scheduledFor, deps.runnerId, now, { daemonLeaseId: deps.daemonLeaseId });
  } catch (error) {
    if (deps.daemonLeaseId && isDaemonLeaseLost(error)) return undefined;
    throw error;
  }
  if (!claim) return undefined;
  deps.beforeRun?.(claim.loop, claim.run.scheduledFor);
  deps.onRun?.(claim.run);
  return claim;
}

export function claimDueRuns(deps: SchedulerDeps & { maxClaims?: number }): ClaimDueRunsResult {
  const now = deps.now?.() ?? new Date();
  const recovered = deps.store.recoverExpiredRunLeases(now, { daemonLeaseId: deps.daemonLeaseId });
  const recoveredByLoop = new Map<string, LoopRun[]>();
  for (const run of recovered) {
    recoveredByLoop.set(run.loopId, [...(recoveredByLoop.get(run.loopId) ?? []), run]);
  }
  for (const runs of recoveredByLoop.values()) {
    const loop = deps.store.getLoop(runs[0]!.loopId);
    if (!loop) continue;
    const retryable = runs
      .filter((run) => run.attempt < loop.maxAttempts)
      .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())[0];
    if (retryable) {
      advanceLoop(deps.store, loop, retryable, new Date(retryable.finishedAt ?? now), false, {
        daemonLeaseId: deps.daemonLeaseId,
      });
      continue;
    }
    for (const run of runs) {
      const current = deps.store.getLoop(run.loopId);
      if (current) {
        advanceLoop(deps.store, current, run, new Date(run.finishedAt ?? now), false, {
          daemonLeaseId: deps.daemonLeaseId,
        });
      }
    }
  }
  const expired = deps.store.expireLoops(now, { daemonLeaseId: deps.daemonLeaseId });
  const claims: ClaimedLoopRun[] = [];
  const claimed: LoopRun[] = [];
  const skipped: LoopRun[] = [];
  const maxClaims = Math.max(0, deps.maxClaims ?? Number.POSITIVE_INFINITY);

  for (const loop of deps.store.dueLoops(now)) {
    if (claims.length >= maxClaims) break;
    const plan = dueSlots(loop, now);
    for (const slot of plan.slots) {
      if (claims.length >= maxClaims) break;
      const run = claimSlot(deps, loop, slot);
      if (!run) continue;
      if ("loop" in run) {
        claims.push(run);
        claimed.push(run.run);
      } else if (run.status === "skipped") {
        skipped.push(run);
      }
    }
  }

  return { claims, claimed, completed: [], skipped, recovered, expired };
}

export async function tick(deps: SchedulerDeps): Promise<TickResult> {
  const now = deps.now?.() ?? new Date();
  const recovered = deps.store.recoverExpiredRunLeases(now, { daemonLeaseId: deps.daemonLeaseId });
  const recoveredByLoop = new Map<string, LoopRun[]>();
  for (const run of recovered) {
    recoveredByLoop.set(run.loopId, [...(recoveredByLoop.get(run.loopId) ?? []), run]);
  }
  for (const runs of recoveredByLoop.values()) {
    const loop = deps.store.getLoop(runs[0]!.loopId);
    if (!loop) continue;
    const retryable = runs
      .filter((run) => run.attempt < loop.maxAttempts)
      .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())[0];
    if (retryable) {
      advanceLoop(deps.store, loop, retryable, new Date(retryable.finishedAt ?? now), false, {
        daemonLeaseId: deps.daemonLeaseId,
      });
      continue;
    }
    for (const run of runs) {
      const current = deps.store.getLoop(run.loopId);
      if (current) {
        advanceLoop(deps.store, current, run, new Date(run.finishedAt ?? now), false, {
          daemonLeaseId: deps.daemonLeaseId,
        });
      }
    }
  }
  const expired = deps.store.expireLoops(now, { daemonLeaseId: deps.daemonLeaseId });
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
