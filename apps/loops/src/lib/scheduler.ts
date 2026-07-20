import type { ExecutorResult, Loop, LoopRun } from "../types.js";
import { LoopArchivedError } from "./errors.js";
import { classifyRunFailure } from "./health.js";
import { computeNextAfter, dueSlots } from "./recurrence.js";
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

export type RunLoopNowResult = RunLoopNowScheduled | RunLoopNowExecuted;

export async function runLoopNow(deps: RunLoopNowDeps & { mode: "schedule" }): Promise<RunLoopNowScheduled>;
export async function runLoopNow(deps: RunLoopNowDeps & { mode?: "inline" }): Promise<RunLoopNowExecuted>;
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
  if (!claim) throw new Error(`could not claim manual run for ${deps.idOrName}`);
  const run = await executeClaimedRun({
    store,
    runnerId,
    loop: claim.loop,
    run: claim.run,
    now: deps.now,
    execute: deps.execute,
  });
  if (shouldAdvance) {
    advanceLoop(store, claim.loop, run, new Date(run.finishedAt ?? new Date()), run.status === "succeeded");
  }
  return { mode: "inline", loop: claim.loop, run, source, advancedLoop: shouldAdvance };
}

export const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 5;
export const CIRCUIT_BREAKER_REASON_PREFIX = "circuit breaker open";
export const MAX_SKIPS_PER_LOOP_PER_TICK = 10;
const THROTTLED_RETRY_MULTIPLIER = 4;
const MAX_RETRY_EXPONENT = 20;

/**
 * Exponential retry backoff with jitter:
 * delay = retryDelayMs * 2^(attempt-1) * (0.5 + random), capped at 6h.
 * Failures classified as provider-gated back off 4x harder, since hammering
 * a throttled, misconfigured, or unavailable provider only makes things worse.
 */
export function retryBackoffDelayMs(loop: Loop, run: LoopRun, random: () => number = Math.random): number {
  const attempt = Math.max(1, run.attempt);
  const failure = classifyRunFailure(run);
  const throttled =
    failure?.classification === "rate_limit" ||
    failure?.classification === "auth" ||
    failure?.classification === "provider_capacity" ||
    failure?.classification === "provider_unavailable";
  const growth = 2 ** Math.min(attempt - 1, MAX_RETRY_EXPONENT);
  const base = loop.retryDelayMs * growth * (throttled ? THROTTLED_RETRY_MULTIPLIER : 1);
  const jitter = 0.5 + random();
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(base * jitter));
}

function nextAfterRetry(loop: Loop, run: LoopRun, now: Date, random?: () => number): string {
  return new Date(now.getTime() + retryBackoffDelayMs(loop, run, random)).toISOString();
}

function isDaemonLeaseLost(error: unknown): boolean {
  return error instanceof Error && error.message === "daemon lease lost";
}

export interface AdvanceLoopOptions {
  daemonLeaseId?: string;
  random?: () => number;
  circuitBreakerThreshold?: number | ((loop: Loop) => number | undefined);
  onRun?: (run: LoopRun) => void;
}

function resolveBreakerThreshold(loop: Loop, override?: number | ((loop: Loop) => number | undefined)): number {
  // The Loop schema (owned by lib-core) has no breaker column yet; honor a
  // structural circuitBreakerThreshold override so a future schema addition
  // works here without scheduler changes.
  const perLoop = (loop as { circuitBreakerThreshold?: unknown }).circuitBreakerThreshold;
  if (typeof perLoop === "number" && Number.isFinite(perLoop)) return Math.floor(perLoop);
  const resolved = typeof override === "function" ? override(loop) : override;
  if (typeof resolved === "number" && Number.isFinite(resolved)) return Math.floor(resolved);
  return DEFAULT_CIRCUIT_BREAKER_THRESHOLD;
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
  const runs = store.listRuns({ loopId, limit: scanLimit });
  let watermark: number | undefined;
  for (const run of runs) {
    if (run.status !== "skipped" || !run.error?.startsWith(CIRCUIT_BREAKER_REASON_PREFIX)) continue;
    const at = new Date(run.scheduledFor).getTime();
    if (watermark === undefined || at > watermark) watermark = at;
  }
  let count = 0;
  for (const run of runs) {
    if (run.status === "running" || run.status === "skipped") continue;
    if (watermark !== undefined && new Date(run.scheduledFor).getTime() <= watermark) continue;
    if (run.status === "succeeded") break;
    if (run.attempt < maxAttempts) continue;
    count += 1;
  }
  return count;
}

function awaitStrictlyNewerRunTimestamp(store: Store, loopId: string): void {
  // createSkippedRun stamps createdAt from the wall clock and listRuns orders
  // by created_at only, so nudge past the newest run's millisecond to make the
  // breaker marker sort strictly newest (bounded spin, at most ~1ms of clock).
  const latest = store.listRuns({ loopId, limit: 1 })[0];
  if (!latest) return;
  const latestMs = new Date(latest.createdAt).getTime();
  for (let spin = 0; spin < 1_000_000 && Date.now() <= latestMs; spin += 1) {
    /* wait for the clock to advance */
  }
}

function tripCircuitBreaker(
  store: Store,
  loop: Loop,
  run: LoopRun,
  finishedAt: Date,
  failures: number,
  opts: AdvanceLoopOptions,
): void {
  awaitStrictlyNewerRunTimestamp(store, loop.id);
  const reason = `${CIRCUIT_BREAKER_REASON_PREFIX}: ${failures} consecutive failed runs; loop auto-paused (resume with 'loops resume ${loop.name}')`;
  // The marker is a skipped bookkeeping run: it records the pause reason in
  // run history (health-visible) without any schema change.
  let markerAtMs = finishedAt.getTime();
  for (let probe = 0; probe < 1_000 && store.getRunBySlot(loop.id, new Date(markerAtMs).toISOString()); probe += 1) {
    markerAtMs += 1;
  }
  const marker = store.createSkippedRun(loop, new Date(markerAtMs).toISOString(), reason, {
    daemonLeaseId: opts.daemonLeaseId,
  });
  const nextRunAt = computeNextAfter(loop.schedule, new Date(run.scheduledFor), finishedAt);
  store.updateLoop(loop.id, {
    status: "paused",
    nextRunAt,
    retryScheduledFor: undefined,
  }, { daemonLeaseId: opts.daemonLeaseId });
  opts.onRun?.(marker);
}

export function advanceLoop(
  store: Store,
  loop: Loop,
  run: LoopRun,
  finishedAt: Date,
  succeeded: boolean,
  opts: AdvanceLoopOptions = {},
): void {
  if (run.status === "running") return;
  const current = store.getLoop(loop.id);
  if (!current || current.status !== "active" || current.archivedAt) return;
  if (current.retryScheduledFor && current.retryScheduledFor !== run.scheduledFor) return;
  const shouldRetry = !succeeded && run.attempt < current.maxAttempts;
  if (shouldRetry) {
    store.updateLoop(current.id, {
      status: "active",
      nextRunAt: nextAfterRetry(current, run, finishedAt, opts.random),
      retryScheduledFor: run.scheduledFor,
    }, { daemonLeaseId: opts.daemonLeaseId });
    return;
  }

  // Restore deferred retries before the breaker evaluates: slots that still
  // have attempts remaining are owed their retries, and the breaker only
  // reasons about final failures (tripping here would silently drop them).
  const deferredRetry = store.nextRetryableRun(current.id, current.maxAttempts, run.scheduledFor);
  if (deferredRetry) {
    store.updateLoop(current.id, {
      status: "active",
      nextRunAt: nextAfterRetry(current, deferredRetry, finishedAt, opts.random),
      retryScheduledFor: deferredRetry.scheduledFor,
    }, { daemonLeaseId: opts.daemonLeaseId });
    return;
  }

  if (!succeeded) {
    const threshold = resolveBreakerThreshold(current, opts.circuitBreakerThreshold);
    if (threshold > 0) {
      const failures = consecutiveFailureCount(store, current.id, current.maxAttempts, Math.max(threshold * 4, 50));
      if (failures >= threshold) {
        tripCircuitBreaker(store, current, run, finishedAt, failures, opts);
        return;
      }
    }
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
  finalizeResult?: (result: ExecutorResult, loop: Loop, run: LoopRun) => Omit<ExecutorResult, "status"> & { status: LoopRun["status"] };
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
    const finalResult = deps.finalizeResult?.(result, deps.loop, deps.run) ?? result;
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
      daemonLeaseId: deps.daemonLeaseId,
      now: deps.now?.() ?? new Date(finalResult.finishedAt),
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
      new Date(existing.finishedAt ?? now),
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
    advanceLoop(deps.store, loop, skipped, now, true, advanceOptions(deps));
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
    advanceLoop(deps.store, loop, skipped, now, true, advanceOptions(deps));
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
      advanceLoop(deps.store, loop, retryable, new Date(retryable.finishedAt ?? now), false, advanceOptions(deps));
      continue;
    }
    for (const run of runs) {
      const current = deps.store.getLoop(run.loopId);
      if (current) {
        advanceLoop(deps.store, current, run, new Date(run.finishedAt ?? now), false, advanceOptions(deps));
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
      if (["failed", "timed_out", "abandoned"].includes(run.status) && run.attempt < loop.maxAttempts) break;
    }
  }

  return { claimed, completed, skipped, recovered, expired };
}
