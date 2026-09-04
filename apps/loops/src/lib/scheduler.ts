import type { ExecutorResult, Loop, LoopRun } from "../types.js";
import { LoopAdvancementConflictError, LoopArchivedError } from "./errors.js";
import {
  CIRCUIT_BREAKER_REASON_PREFIX,
  DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  MAX_RETRY_DELAY_MS,
  collectBreakerWindowRuns,
  consecutiveFailureCountFromRuns,
  loopAdvancementPatchMatchesCurrent,
  planLoopAdvancement,
  resolveBreakerThreshold,
  retryBackoffDelayMs,
  type CircuitBreakerThreshold,
} from "./advancement.js";
import { dueSlots } from "./recurrence.js";
import { classifyLoopExecutionResult } from "./loop-result.js";
import type { Store } from "./store.js";
import type { ExecuteOptions } from "./executor.js";
import { executeLoopTarget } from "./workflow-runner.js";

export {
  CIRCUIT_BREAKER_REASON_PREFIX,
  DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  MAX_RETRY_DELAY_MS,
  retryBackoffDelayMs,
} from "./advancement.js";

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
  /** randomness source for retry jitter; injectable for deterministic tests */
  random?: () => number;
  /** consecutive-final-failure count that trips the circuit breaker; number, per-loop resolver, or <= 0 to disable */
  circuitBreakerThreshold?: number | ((loop: Loop) => number | undefined);
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
  claimToken: string;
}

export interface ClaimDueRunsResult extends TickResult {
  claims: ClaimedLoopRun[];
}

/**
 * Scheduler concurrency lanes. Command-target loops are typically fast
 * (monitors, digests, syncs); agent/workflow-target loops are long-running
 * headless workers (minutes to over an hour). They draw from separate claim
 * budgets so a saturated agent lane cannot starve fast command loops (and vice
 * versa) — the single shared pool let long workers monopolize every slot.
 */
export type SchedulerLane = "command" | "agent";

/** The concurrency lane a loop's target belongs to. */
export function loopLane(loop: Loop): SchedulerLane {
  return loop.target.type === "command" ? "command" : "agent";
}

/** Remaining claim budget per lane for a single `claimDueRuns` pass. */
export type LaneLimits = Partial<Record<SchedulerLane, number>>;

export function manualRunScheduledFor(loop: Loop, now: Date = new Date()): string {
  if (loop.archivedAt) return now.toISOString();
  if (loop.status === "active" && loop.nextRunAt && new Date(loop.nextRunAt).getTime() <= now.getTime()) {
    return loop.retryScheduledFor ?? loop.nextRunAt;
  }
  return now.toISOString();
}

export function shouldAdvanceManualRun(loop: Loop, scheduledFor: string, now: Date = new Date()): boolean {
  if (loop.archivedAt) return false;
  if (loop.status !== "active") return false;
  if (!loop.nextRunAt || new Date(loop.nextRunAt).getTime() > now.getTime()) return false;
  return scheduledFor === (loop.retryScheduledFor ?? loop.nextRunAt);
}

export type ManualRunSource = "ad_hoc" | "due_slot" | "retry_slot";

export function manualRunSource(loop: Loop, scheduledFor: string, now: Date = new Date()): ManualRunSource {
  if (loop.archivedAt) return "ad_hoc";
  if (loop.status !== "active") return "ad_hoc";
  if (!loop.nextRunAt || new Date(loop.nextRunAt).getTime() > now.getTime()) return "ad_hoc";
  if (loop.retryScheduledFor && scheduledFor === loop.retryScheduledFor) return "retry_slot";
  return "due_slot";
}

/**
 * Inline (non-daemon) runners claim runs as `<surface>:<pid>`: `manual:<pid>`
 * (CLI run-now), `manual-tick:<pid>` (CLI tick), `sdk:<pid>` (LoopsClient
 * default), and caller-supplied SDK runner ids following the same convention.
 * The daemon claims as `${hostname}:${pid}:${leaseId}` (three segments) and
 * MCP run-now uses schedule mode, so neither ever matches. Centralized here so
 * the daemon's "spare runs owned by a live inline runner" check cannot drift
 * from the surfaces that share runLoopNow/executeClaimedRun semantics.
 */
export const INLINE_RUNNER_ID_PATTERN = /^[^:\s]+:(\d+)$/;

/** Owner pid of an inline runner claim, or undefined for daemon/unknown claims. */
export function inlineRunnerOwnerPid(claimedBy: string | undefined): number | undefined {
  const match = claimedBy ? INLINE_RUNNER_ID_PATTERN.exec(claimedBy) : null;
  return match ? Number(match[1]) : undefined;
}

export type RunLoopNowMode = "inline" | "schedule";

export interface RunLoopNowDeps {
  store: Store;
  /** loop id or exact loop name */
  idOrName: string;
  runnerId: string;
  /**
   * "inline" claims and executes the run in this process (CLI/SDK semantics);
   * "schedule" only marks the loop due now for daemon pickup (MCP semantics).
   */
  mode?: RunLoopNowMode;
  now?: () => Date;
  execute?: (loop: Loop, run: LoopRun) => Promise<ExecutorResult>;
  /**
   * Run a bundled loop whose tree no longer matches its manifest.
   *
   * Only the MANUAL path carries this: `loops run-now --allow-dirty` is an
   * operator deliberately accepting an unreviewed tree for one run. The daemon
   * and the runner never set it, so scheduled execution always verifies.
   */
  allowDirtyBundle?: boolean;
}

export interface RunLoopNowScheduled {
  mode: "schedule";
  loop: Loop;
  scheduledFor: string;
}

export interface RunLoopNowExecuted {
  mode: "inline";
  loop: Loop;
  run: LoopRun;
  source: ManualRunSource;
  advancedLoop: boolean;
}

/**
 * An overlap:"skip" run-now that could not claim its slot because the
 * previous run is still executing. The run field carries the bookkeeping
 * "skipped" row recorded instead of an executed run; the CLI/SDK treat it
 * like any other skipped run (exit 0, status "skipped").
 */
export interface RunLoopNowSkipped {
  mode: "inline";
  loop: Loop;
  run: LoopRun;
  source: ManualRunSource;
  advancedLoop: boolean;
  /** Distinguishes a recorded skip from an executed inline run. */
  skipped: true;
}

export type RunLoopNowResult = RunLoopNowScheduled | RunLoopNowExecuted | RunLoopNowSkipped;

export async function runLoopNow(deps: RunLoopNowDeps & { mode: "schedule" }): Promise<RunLoopNowScheduled>;
export async function runLoopNow(
  deps: RunLoopNowDeps & { mode?: "inline" },
): Promise<RunLoopNowExecuted | RunLoopNowSkipped>;
/**
 * Single manual "run now" entry point shared by the CLI, SDK, and MCP server
 * so slot selection, the archived-loop guard, and advance semantics cannot
 * drift between surfaces.
 */
export async function runLoopNow(deps: RunLoopNowDeps): Promise<RunLoopNowResult> {
  const { store, runnerId } = deps;
  const loop = store.requireLoop(deps.idOrName);
  if (loop.archivedAt) throw new LoopArchivedError(loop.name || deps.idOrName);
  const now = deps.now?.() ?? new Date();
  if (deps.mode === "schedule") {
    const scheduledFor = now.toISOString();
    const updated = store.updateLoop(loop.id, { status: "active", nextRunAt: scheduledFor });
    return { mode: "schedule", loop: updated, scheduledFor };
  }
  let scheduledFor = manualRunScheduledFor(loop, now);
  let source = manualRunSource(loop, scheduledFor, now);
  let shouldAdvance = shouldAdvanceManualRun(loop, scheduledFor, now);
  let claim = store.claimRun(loop, scheduledFor, runnerId, now);
  if (!claim && shouldAdvance) {
    // The due slot already holds a terminal run (e.g. an earlier manual run):
    // fall back to an ad hoc slot instead of failing or re-advancing the loop.
    const existing = store.getRunBySlot(loop.id, scheduledFor);
    if (existing && existing.status !== "running") {
      scheduledFor = now.toISOString();
      source = "ad_hoc";
      shouldAdvance = false;
      claim = store.claimRun(loop, scheduledFor, runnerId, now);
    }
  }
  if (!claim) {
    // Graceful overlap-skip: with overlap:"skip", a still-executing previous
    // run makes claimRun return undefined (either its live lease blocks the
    // requested slot, or the running row itself occupies it). Mirror the
    // daemon tick's skip semantics (createSkippedRun + advanceLoop) instead
    // of failing the manual run, so `run-now` exits 0 with the skip recorded.
    // When the running row occupies the requested slot, the skip cannot be
    // recorded there (one run per slot), so it lands on an ad hoc slot.
    // Genuine claim collisions on non-skip loops still throw below.
    if (loop.overlap === "skip" && store.hasRunningRun(loop.id)) {
      const skipSlot = store.hasRunningRunForSlot(loop.id, scheduledFor) ? now.toISOString() : scheduledFor;
      const skipped = store.createSkippedRun(loop, skipSlot, "previous run still active");
      advanceLoop(store, loop, skipped, new Date(skipped.updatedAt), true);
      return {
        mode: "inline",
        loop,
        run: skipped,
        source: skipSlot === scheduledFor ? source : "ad_hoc",
        advancedLoop: true,
        skipped: true,
      };
    }
    throw new Error(`could not claim manual run for ${deps.idOrName}`);
  }
  const run = await executeClaimedRun({
    store,
    runnerId,
    claimToken: claim.claimToken,
    loop: claim.loop,
    run: claim.run,
    now: deps.now,
    execute: deps.execute,
    executeOptions: deps.allowDirtyBundle ? { allowDirtyBundle: true } : undefined,
  });
  if (shouldAdvance) {
    advanceLoop(store, claim.loop, run, new Date(run.updatedAt), run.status === "succeeded");
  }
  return { mode: "inline", loop: claim.loop, run, source, advancedLoop: shouldAdvance };
}

export const MAX_SKIPS_PER_LOOP_PER_TICK = 10;

function isDaemonLeaseLost(error: unknown): boolean {
  return error instanceof Error && error.message === "daemon lease lost";
}

export interface AdvanceLoopOptions {
  daemonLeaseId?: string;
  random?: () => number;
  circuitBreakerThreshold?: CircuitBreakerThreshold;
  onRun?: (run: LoopRun) => void;
}

/**
 * Count consecutive final failures (failed/timed_out/abandoned) in recent run
 * history. Skipped bookkeeping runs and in-flight runs are neutral; a success
 * resets the streak. Failed runs with attempts remaining (attempt <
 * maxAttempts) are pending retries by the scheduler's own semantics, so they
 * are neutral too — only exhausted slots count as final failures. A previous
 * circuit-breaker marker acts as a watermark (compared via scheduledFor, which
 * shares the scheduler clock with run slots, unlike the marker's wall-clock
 * createdAt): only failures after it count, so a manual resume requires a
 * fresh streak before the breaker can trip again.
 */
export function consecutiveFailureCount(store: Store, loopId: string, maxAttempts = 1, scanLimit = 50): number {
  return consecutiveFailureCountFromRuns(
    collectBreakerWindowRuns((opts) => store.listRuns({ loopId, ...opts }), scanLimit),
    maxAttempts,
  );
}

function applyCircuitBreakerPlan(
  store: Store,
  loop: Loop,
  plan: Extract<ReturnType<typeof planLoopAdvancement>, { kind: "circuit_breaker" }>,
  opts: AdvanceLoopOptions,
): boolean {
  const transition = store.tripCircuitBreakerIfCurrent(
    loop.id,
    loop,
    plan.patch,
    { scheduledFor: plan.markerScheduledFor, reason: plan.reason },
    { daemonLeaseId: opts.daemonLeaseId },
  );
  if (transition) opts.onRun?.(transition.marker);
  return transition !== undefined;
}

function applyExpiryPlan(
  store: Store,
  loop: Loop,
  plan: Extract<ReturnType<typeof planLoopAdvancement>, { kind: "expires_after_runs" }>,
  opts: AdvanceLoopOptions,
): boolean {
  const transition = store.expireLoopIfCurrent(
    loop.id,
    loop,
    plan.patch,
    { scheduledFor: plan.markerScheduledFor, reason: plan.reason },
    { daemonLeaseId: opts.daemonLeaseId },
  );
  if (transition) opts.onRun?.(transition.marker);
  return transition !== undefined;
}

export function advanceLoop(
  store: Store,
  loop: Loop,
  run: LoopRun,
  finishedAt: Date,
  succeeded: boolean,
  opts: AdvanceLoopOptions = {},
): void {
  const retryRandom = (opts.random ?? Math.random)();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = store.getLoop(loop.id);
    const threshold = current ? resolveBreakerThreshold(current, opts.circuitBreakerThreshold) : 0;
    const plan = planLoopAdvancement({
      current,
      run,
      finishedAt,
      succeeded,
      deferredRetry: current ? store.nextRetryableRun(current.id, current.maxAttempts) : undefined,
      retryIntentRun: current?.retryScheduledFor
        ? store.getRunBySlot(current.id, current.retryScheduledFor)
        : undefined,
      recentRuns: current
        ? collectBreakerWindowRuns(
          (opts) => store.listRuns({ loopId: current.id, ...opts }),
          Math.max(threshold * 4, 50),
        )
        : [],
      retryRandom,
      circuitBreakerThreshold: threshold,
    });
    if (plan.kind === "none") return;
    if (loopAdvancementPatchMatchesCurrent(current!, plan.patch)) return;
    const applied = plan.kind === "circuit_breaker"
      ? applyCircuitBreakerPlan(store, current!, plan, opts)
      : plan.kind === "expires_after_runs"
        ? applyExpiryPlan(store, current!, plan, opts)
        : store.advanceLoopIfCurrent(current!.id, current!, plan.patch, {
          daemonLeaseId: opts.daemonLeaseId,
        }) !== undefined;
    if (applied) return;
    if (attempt === 1) throw new LoopAdvancementConflictError(loop.id, run.id);
  }
}

export async function executeClaimedRun(deps: {
  store: Store;
  runnerId: string;
  claimToken: string;
  loop: Loop;
  run: LoopRun;
  now?: () => Date;
  beforeFinalize?: (loop: Loop, run: LoopRun) => void;
  daemonLeaseId?: string;
  execute?: (loop: Loop, run: LoopRun) => Promise<ExecutorResult>;
  /** Extra executor options for the default execute path (the manual --allow-dirty bypass). */
  executeOptions?: ExecuteOptions;
  finalizeResult?: (result: ExecutorResult, loop: Loop, run: LoopRun) => Omit<ExecutorResult, "status"> & { status: LoopRun["status"] };
  onError?: (loop: Loop, error: unknown) => void;
}): Promise<LoopRun> {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const heartbeatEveryMs = Math.max(10, Math.min(60_000, Math.floor(deps.loop.leaseMs / 3)));
  heartbeat = setInterval(() => {
    deps.store.heartbeatRunLease(deps.run.id, deps.runnerId, deps.loop.leaseMs, new Date(), {
      daemonLeaseId: deps.daemonLeaseId,
      claimToken: deps.claimToken,
    });
  }, heartbeatEveryMs);
  heartbeat.unref();

  try {
    const result = await (deps.execute ?? ((loop, run) =>
      executeLoopTarget(deps.store, loop, run, {
        ...deps.executeOptions,
        daemonLeaseId: deps.daemonLeaseId,
        onSpawn: (pid) => deps.store.markRunPid(run.id, pid, deps.runnerId, {
          daemonLeaseId: deps.daemonLeaseId,
          claimToken: deps.claimToken,
        }),
      })))(deps.loop, deps.run);
    const transformedResult = deps.finalizeResult?.(result, deps.loop, deps.run) ?? result;
    const finalResult = classifyLoopExecutionResult(deps.loop, transformedResult);
    deps.beforeFinalize?.(deps.loop, deps.run);
    return deps.store.finalizeRun(deps.run.id, {
      status: finalResult.status,
      finishedAt: finalResult.finishedAt,
      durationMs: finalResult.durationMs,
      stdout: finalResult.stdout,
      stderr: finalResult.stderr,
      exitCode: finalResult.exitCode,
      error: finalResult.error,
      pid: finalResult.pid,
    }, {
      claimedBy: deps.runnerId,
      claimToken: deps.claimToken,
      daemonLeaseId: deps.daemonLeaseId,
      now: deps.now?.() ?? new Date(),
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
      claimToken: deps.claimToken,
      daemonLeaseId: deps.daemonLeaseId,
      now: deps.now?.() ?? finishedAt,
    });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

function advanceOptions(deps: SchedulerDeps): AdvanceLoopOptions {
  return {
    daemonLeaseId: deps.daemonLeaseId,
    random: deps.random,
    circuitBreakerThreshold: deps.circuitBreakerThreshold,
    onRun: deps.onRun,
  };
}

const TERMINAL_RUN_STATUSES: ReadonlySet<LoopRun["status"]> = new Set([
  "succeeded",
  "failed",
  "timed_out",
  "abandoned",
  "skipped",
]);

/**
 * Wedge repair: if a due slot already holds a *terminal* run but claimRun
 * returned nothing, the loop never advanced past it (e.g. the daemon died /
 * lost its lease / was SIGKILLed between finalizeRun and advanceLoop). Left
 * alone, every future tick re-computes the same due slot, claims nothing, and
 * nextRunAt never moves — the loop is wedged forever. This hits once/dynamic
 * schedules and catchUp:"none" interval/cron loops, whose due slot IS
 * nextRunAt. advanceLoop is idempotent (it recomputes nextRunAt from the run's
 * scheduledFor and no-ops when the loop already moved on), so this is safe to
 * call on the terminal run to unstick the loop. A *running* run is never
 * terminal, so a live in-flight run is left untouched.
 */
function repairWedgedTerminalSlot(deps: SchedulerDeps, loop: Loop, scheduledFor: string, now: Date): void {
  const existing = deps.store.getRunBySlot(loop.id, scheduledFor);
  if (!existing || !TERMINAL_RUN_STATUSES.has(existing.status)) return;
  try {
    advanceLoop(
      deps.store,
      loop,
      existing,
      new Date(existing.updatedAt),
      existing.status === "succeeded",
      advanceOptions(deps),
    );
  } catch (error) {
    // A lost daemon lease during repair is not fatal to the rest of the tick;
    // skip like the claim paths do and let the lease heartbeat stop the daemon.
    if (deps.daemonLeaseId && isDaemonLeaseLost(error)) return;
    throw error;
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
    advanceLoop(deps.store, loop, skipped, new Date(skipped.updatedAt), true, advanceOptions(deps));
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
  if (!claim) {
    repairWedgedTerminalSlot(deps, loop, scheduledFor, now);
    return undefined;
  }
  deps.beforeRun?.(claim.loop, claim.run.scheduledFor);
  deps.onRun?.(claim.run);

  const finalRun = await executeClaimedRun({
    store: deps.store,
    runnerId: deps.runnerId,
    claimToken: claim.claimToken,
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
    new Date(finalRun.updatedAt),
    finalRun.status === "succeeded",
    advanceOptions(deps),
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
    advanceLoop(deps.store, loop, skipped, new Date(skipped.updatedAt), true, advanceOptions(deps));
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
  if (!claim) {
    repairWedgedTerminalSlot(deps, loop, scheduledFor, now);
    return undefined;
  }
  deps.beforeRun?.(claim.loop, claim.run.scheduledFor);
  deps.onRun?.(claim.run);
  return claim;
}

/**
 * Shared tick/claim preamble: recover expired run leases, restore retry intent
 * for the earliest retryable recovered slot per loop (advancing past exhausted
 * ones otherwise), then expire loops whose expiresAt has passed.
 *
 * tick() and claimDueRuns() intentionally diverge after this preamble:
 * tick() executes slots inline, so it can gate later catch-up slots on the
 * outcome of earlier ones (a failed-but-retryable slot stops further slot
 * processing for that loop). claimDueRuns() only claims runs for asynchronous
 * execution, so outcomes are unknown while claiming and that retry gate cannot
 * apply to it.
 */
function recoverAndExpire(deps: SchedulerDeps, now: Date): { recovered: LoopRun[]; expired: Loop[] } {
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
      advanceLoop(deps.store, loop, retryable, new Date(retryable.updatedAt), false, advanceOptions(deps));
      continue;
    }
    for (const run of runs) {
      const current = deps.store.getLoop(run.loopId);
      if (current) {
        advanceLoop(deps.store, current, run, new Date(run.updatedAt), false, advanceOptions(deps));
      }
    }
  }
  const expired = deps.store.expireLoops(now, { daemonLeaseId: deps.daemonLeaseId });
  return { recovered, expired };
}

export function claimDueRuns(deps: SchedulerDeps & { maxClaims?: number; laneLimits?: LaneLimits }): ClaimDueRunsResult {
  const now = deps.now?.() ?? new Date();
  const { recovered, expired } = recoverAndExpire(deps, now);
  const claims: ClaimedLoopRun[] = [];
  const claimed: LoopRun[] = [];
  const skipped: LoopRun[] = [];
  const maxClaims = Math.max(0, deps.maxClaims ?? Number.POSITIVE_INFINITY);
  if (maxClaims === 0) return { claims, claimed, completed: [], skipped, recovered, expired };

  // Per-lane claim budgets: fast command loops and long agent/workflow loops
  // draw from separate pools this pass. Absent laneLimits every lane is
  // unbounded and only the global maxClaims caps (legacy single-pool behavior).
  const laneLimits = deps.laneLimits;
  const laneClaims: Record<SchedulerLane, number> = { command: 0, agent: 0 };
  const laneCap = (lane: SchedulerLane): number =>
    laneLimits === undefined ? Number.POSITIVE_INFINITY : Math.max(0, laneLimits[lane] ?? Number.POSITIVE_INFINITY);
  const laneFull = (lane: SchedulerLane): boolean => laneClaims[lane] >= laneCap(lane);

  for (const loop of deps.store.dueLoops(now)) {
    if (claims.length >= maxClaims) break;
    const lane = loopLane(loop);
    // A saturated lane skips its loops without consuming another lane's budget,
    // so due loops in the other lane are still reached in the same pass.
    if (laneFull(lane)) continue;
    const plan = dueSlots(loop, now);
    let loopSkips = 0;
    for (const slot of plan.slots) {
      if (claims.length >= maxClaims) break;
      if (laneFull(lane)) break;
      // Fairness: overlap-skip bookkeeping never consumes the claim budget
      // (only executed runs do) and is capped per loop per tick, so one
      // skipping loop cannot starve other due loops of claims.
      if (loopSkips >= MAX_SKIPS_PER_LOOP_PER_TICK) break;
      const run = claimSlot(deps, loop, slot);
      if (!run) continue;
      if ("loop" in run) {
        claims.push(run);
        claimed.push(run.run);
        laneClaims[lane] += 1;
      } else if (run.status === "skipped") {
        skipped.push(run);
        loopSkips += 1;
      }
    }
  }

  return { claims, claimed, completed: [], skipped, recovered, expired };
}

export async function tick(deps: SchedulerDeps): Promise<TickResult> {
  const now = deps.now?.() ?? new Date();
  const { recovered, expired } = recoverAndExpire(deps, now);
  const claimed: LoopRun[] = [];
  const completed: LoopRun[] = [];
  const skipped: LoopRun[] = [];

  for (const loop of deps.store.dueLoops(now)) {
    const plan = dueSlots(loop, now);
    let loopSkips = 0;
    for (const slot of plan.slots) {
      // Fairness: bound overlap-skip bookkeeping per loop per tick.
      if (loopSkips >= MAX_SKIPS_PER_LOOP_PER_TICK) break;
      const run = await runSlot(deps, loop, slot);
      if (!run) continue;
      if (run.status === "running") claimed.push(run);
      else if (run.status === "skipped") {
        skipped.push(run);
        loopSkips += 1;
      } else completed.push(run);
      // tick-only retry gate: see recoverAndExpire() doc comment.
      // The retry budget can change while a run is executing, so decide from
      // the persisted loop instead of the pre-run snapshot used by dueSlots().
      if (["failed", "timed_out", "abandoned"].includes(run.status)) {
        const current = deps.store.getLoop(loop.id);
        if (current && run.attempt < current.maxAttempts) break;
      }
    }
  }

  return { claimed, completed, skipped, recovered, expired };
}
