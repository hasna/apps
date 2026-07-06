import { copyFileSync, existsSync, openSync, renameSync, rmSync, statSync, truncateSync } from "node:fs";
import { hostname } from "node:os";
import { spawn } from "node:child_process";
import { genId } from "../lib/ids.js";
import { daemonLogPath, ensureDataDir, pidFilePath } from "../lib/paths.js";
import { advanceLoop, claimDueRuns, executeClaimedRun, inlineRunnerOwnerPid, loopLane, type ClaimedLoopRun, type SchedulerLane } from "../lib/scheduler.js";
import { RESTART_INTERRUPTED_RUN_PREFIX } from "../lib/health.js";
import { executeLoopTarget } from "../lib/workflow-runner.js";
import { Store } from "../lib/store.js";
import {
  isAlive,
  isDaemonRunning,
  processStartTimeMs,
  reapProcessGroups,
  removePid,
  START_TIME_TOLERANCE_MS,
  toReapableProcess,
  writePid,
} from "./control.js";
import { realSleep, runLoop } from "./loop.js";
import type { ExecutorResult, Loop, LoopRun } from "../types.js";

export interface RunDaemonOptions {
  intervalMs?: number;
  leaseTtlMs?: number;
  /** Legacy single-pool knob; back-compat alias for the agent/workflow lane budget. */
  concurrency?: number;
  /** Claim budget for command-target loops (fast loops). Default 4. */
  commandConcurrency?: number;
  /** Claim budget for agent/workflow-target loops (long workers). Default 8; `concurrency`/LOOPS_DAEMON_CONCURRENCY still set it. */
  agentConcurrency?: number;
  store?: Store;
  pidPath?: string;
  execute?: (loop: Loop, run: LoopRun) => Promise<ExecutorResult>;
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  signal?: AbortSignal;
  reapGraceMs?: number;
}

function intervalFromEnv(): number | undefined {
  const raw = process.env.LOOPS_DAEMON_INTERVAL_MS;
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function concurrencyFromEnv(): number | undefined {
  return positiveIntEnv("LOOPS_DAEMON_CONCURRENCY");
}

export const DEFAULT_COMMAND_CONCURRENCY = 4;
export const DEFAULT_AGENT_CONCURRENCY = 8;

/**
 * Resolve the two separated concurrency lanes. Command loops (fast) and
 * agent/workflow loops (long workers) get independent budgets so a saturated
 * agent lane cannot starve command loops. Precedence per lane is explicit opt >
 * lane env > legacy knob > default. The legacy `concurrency` opt and
 * `LOOPS_DAEMON_CONCURRENCY` env stay wired to the agent lane (the dominant
 * consumer / historical "total" knob), so existing deployments keep their
 * heavy-lane capacity and simply gain a reserved command lane on top.
 */
export function resolveLaneConcurrency(opts: Pick<RunDaemonOptions, "concurrency" | "commandConcurrency" | "agentConcurrency"> = {}): Record<SchedulerLane, number> {
  const command = Math.max(
    1,
    opts.commandConcurrency ?? positiveIntEnv("LOOPS_DAEMON_COMMAND_CONCURRENCY") ?? DEFAULT_COMMAND_CONCURRENCY,
  );
  const agent = Math.max(
    1,
    opts.agentConcurrency ?? opts.concurrency ?? positiveIntEnv("LOOPS_DAEMON_AGENT_CONCURRENCY") ?? concurrencyFromEnv() ?? DEFAULT_AGENT_CONCURRENCY,
  );
  return { command, agent };
}

export const DAEMON_LOG_MAX_BYTES = 50 * 1024 * 1024;
export const DAEMON_LOG_KEEP = 2;

export function daemonLogLine(message: string): string {
  return `[${new Date().toISOString()}] [loops-daemon] ${message}`;
}

export function rotateDaemonLog(
  path: string = daemonLogPath(),
  maxBytes: number = DAEMON_LOG_MAX_BYTES,
  keep: number = DAEMON_LOG_KEEP,
): boolean {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return false;
  }
  if (size < maxBytes) return false;
  try {
    rmSync(`${path}.${keep}`, { force: true });
    for (let i = keep - 1; i >= 1; i--) {
      if (existsSync(`${path}.${i}`)) renameSync(`${path}.${i}`, `${path}.${i + 1}`);
    }
    // Copy + truncate so inherited stdio descriptors keep appending to the live file.
    copyFileSync(path, `${path}.1`);
    truncateSync(path, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultDaemonLog(message: string): void {
  rotateDaemonLog();
  console.error(daemonLogLine(message));
}

export async function runDaemon(opts: RunDaemonOptions = {}): Promise<void> {
  ensureDataDir();
  const pidPath = opts.pidPath ?? pidFilePath();
  const state = isDaemonRunning(pidPath);
  if (state.running) throw new Error(`daemon already running (pid ${state.pid})`);
  if (state.stale) removePid(pidPath);

  const ownStore = !opts.store;
  const store = opts.store ?? new Store();
  const leaseId = genId();
  const runnerId = `${hostname()}:${process.pid}:${leaseId}`;
  const intervalMs = opts.intervalMs ?? intervalFromEnv() ?? 1_000;
  const leaseTtlMs = opts.leaseTtlMs ?? Math.max(60_000, intervalMs * 10);
  const laneConcurrency = resolveLaneConcurrency(opts);
  const log = opts.log ?? defaultDaemonLog;
  const sleep = opts.sleep ?? realSleep;

  const lease = store.acquireDaemonLease({
    id: leaseId,
    pid: process.pid,
    hostname: hostname(),
    ttlMs: leaseTtlMs,
  });
  if (!lease) throw new Error("another loops daemon holds the database lease");

  writePid(process.pid, pidPath);
  log(
    `started pid=${process.pid} interval=${intervalMs}ms lease=${leaseId} ` +
      `command_concurrency=${laneConcurrency.command} agent_concurrency=${laneConcurrency.agent}`,
  );

  let stopFlag = false;
  let leaseLost = false;
  let leaseEpoch = 0;
  let runAbort = new AbortController();
  const activeRuns = new Map<string, Promise<void>>();
  const activeByLane: Record<SchedulerLane, number> = { command: 0, agent: 0 };
  const isControlledStopInterruption = (result: ExecutorResult): boolean =>
    stopFlag && !leaseLost && result.status === "failed" && result.error?.includes("terminated by SIGTERM") === true;
  const requestStop = (message?: string): void => {
    stopFlag = true;
    if (!runAbort.signal.aborted) runAbort.abort();
    if (message) log(message);
  };
  const abortInFlightRuns = (): void => {
    if (!runAbort.signal.aborted) runAbort.abort();
    runAbort = new AbortController();
  };
  const ensureLease = (): void => {
    const current = store.heartbeatDaemonLease(leaseId, leaseTtlMs);
    if (current && current.id === leaseId) return;
    // Heartbeat failed: attempt lease re-acquisition before giving up. The store
    // permits re-acquiring our own id or replacing an expired lease.
    let reacquired: ReturnType<Store["acquireDaemonLease"]>;
    try {
      reacquired = store.acquireDaemonLease({
        id: leaseId,
        pid: process.pid,
        hostname: hostname(),
        ttlMs: leaseTtlMs,
      });
    } catch {
      reacquired = undefined;
    }
    if (!reacquired || reacquired.id !== leaseId) {
      leaseLost = true;
      requestStop("daemon lease lost");
      throw new Error("daemon lease lost");
    }
    // Takeover succeeded, but abort in-flight fenced work regardless: another
    // daemon may have acted while our lease was lapsed. Fencing stays authoritative.
    leaseEpoch += 1;
    abortInFlightRuns();
    log(`daemon lease re-acquired after transient loss (epoch=${leaseEpoch}); aborted in-flight runs`);
  };
  const onSignal = (): void => {
    requestStop("stop signal received");
  };
  if (opts.signal?.aborted) onSignal();
  opts.signal?.addEventListener("abort", onSignal, { once: true });
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const reapAbandoned = async (recovered: LoopRun[]): Promise<void> => {
    const entries = recovered.map(toReapableProcess).filter((entry) => entry.pid !== undefined || entry.pgid !== undefined);
    if (entries.length === 0) return;
    const killed = await reapProcessGroups(entries, { sleep, graceMs: opts.reapGraceMs, log });
    if (killed.length > 0) log(`reaped orphan process groups: ${killed.join(", ")}`);
  };

  // One shared daemon-lease heartbeat instead of per-run timers.
  const heartbeatMs = Math.max(25, Math.min(1_000, intervalMs, Math.floor(leaseTtlMs / 10)));
  const leaseHeartbeat = setInterval(() => {
    if (stopFlag) return;
    try {
      ensureLease();
    } catch (err) {
      log(err instanceof Error ? err.message : String(err));
    }
  }, heartbeatMs);
  leaseHeartbeat.unref();

  const executeDaemonRun = async (claim: ClaimedLoopRun): Promise<void> => {
    const finalRun = await executeClaimedRun({
      store,
      runnerId,
      loop: claim.loop,
      run: claim.run,
      daemonLeaseId: leaseId,
      beforeFinalize: () => ensureLease(),
      execute: opts.execute ?? ((loop, run) =>
        executeLoopTarget(store, loop, run, {
          signal: runAbort.signal,
          beforePersist: () => ensureLease(),
          daemonLeaseId: leaseId,
          onSpawn: (pid) => {
            ensureLease();
            store.markRunPid(run.id, pid, runnerId, { daemonLeaseId: leaseId });
          },
          onSpawnProcess: (info) => {
            store.recordRunProcess(run.id, info, { daemonLeaseId: leaseId });
          },
        })),
      finalizeResult: (result) => {
        if (!isControlledStopInterruption(result)) return result;
        return {
          ...result,
          status: "skipped",
          exitCode: undefined,
          error: `${RESTART_INTERRUPTED_RUN_PREFIX}: child process terminated by SIGTERM during daemon stop/restart`,
        };
      },
      onError: (loop, err) => log(`loop ${loop.id} failed: ${err instanceof Error ? err.message : String(err)}`),
    });
    ensureLease();
    if (leaseLost) throw new Error("daemon lease lost during run");
    advanceLoop(
      store,
      claim.loop,
      finalRun,
      new Date(finalRun.finishedAt ?? new Date()),
      finalRun.status === "succeeded",
      { daemonLeaseId: leaseId },
    );
    log(`run ${finalRun.id} ${finalRun.status} loop=${claim.loop.id}`);
  };

  const startClaim = (claim: ClaimedLoopRun): void => {
    const lane = loopLane(claim.loop);
    activeByLane[lane] += 1;
    const task = executeDaemonRun(claim)
      .catch((err) => log(`run ${claim.run.id} error: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        activeRuns.delete(claim.run.id);
        activeByLane[lane] -= 1;
      });
    activeRuns.set(claim.run.id, task);
  };

  try {
    // Startup recovery pass: recover expired run leases and reap orphaned
    // process groups left behind by a previous daemon before ticking. At
    // startup any running run with an expired lease belongs to a dead owner,
    // so runs deferred by recovery (process still alive) are reaped too —
    // unless the recorded inline `<surface>:<pid>` owner (manual/manual-tick/
    // sdk run-now or tick) is still alive: its lease may have merely lapsed
    // across a suspend/resume window and it will finalize the run itself.
    if (!stopFlag) {
      try {
        const liveInlineOwner = (run: LoopRun): boolean => {
          const ownerPid = inlineRunnerOwnerPid(run.claimedBy);
          if (ownerPid === undefined || !isAlive(ownerPid)) return false;
          // Guard against pid recycling: a bare isAlive() would treat a reused
          // pid (now an unrelated process) as the still-live inline owner and
          // wrongly suppress reaping of a genuinely orphaned run. The inline
          // owner must have existed when it claimed the run, so a pid whose
          // kernel start time is after the run started is a recycled impostor —
          // treat it as dead so the orphan gets reaped. Unresolvable start
          // times stay lenient (possibly-live owner is the safe answer).
          const ownerStartMs = processStartTimeMs(ownerPid);
          const runStartMs = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
          if (ownerStartMs !== undefined && Number.isFinite(runStartMs) && ownerStartMs > runStartMs + START_TIME_TOLERANCE_MS) {
            return false;
          }
          return true;
        };
        const staleCandidates = store
          .listRuns({ status: "running", limit: 1_000 })
          .filter((run) => run.leaseExpiresAt !== undefined && new Date(run.leaseExpiresAt).getTime() <= Date.now());
        const startup = claimDueRuns({ store, runnerId, daemonLeaseId: leaseId, maxClaims: 0 });
        const recoveredIds = new Set(startup.recovered.map((run) => run.id));
        const deferred = staleCandidates.filter((run) => !recoveredIds.has(run.id) && !liveInlineOwner(run));
        if (startup.recovered.length + startup.expired.length + deferred.length > 0) {
          log(
            `startup recovery recovered=${startup.recovered.length} deferred=${deferred.length} expired=${startup.expired.length}`,
          );
        }
        await reapAbandoned([...startup.recovered, ...deferred]);
      } catch (err) {
        log(`startup recovery error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await runLoop({
      intervalMs,
      sleep,
      shouldStop: opts.shouldStop ?? (() => stopFlag),
      onTickError: (err) => log(`tick error: ${err instanceof Error ? err.message : String(err)}`),
      tickFn: async () => {
        ensureLease();
        const laneLimits: Record<SchedulerLane, number> = {
          command: Math.max(0, laneConcurrency.command - activeByLane.command),
          agent: Math.max(0, laneConcurrency.agent - activeByLane.agent),
        };
        const result = claimDueRuns({
          store,
          runnerId,
          daemonLeaseId: leaseId,
          beforeRun: () => ensureLease(),
          // Sum caps total claims this tick and short-circuits recovery-only
          // ticks (both lanes full => 0); laneLimits gates each lane.
          maxClaims: laneLimits.command + laneLimits.agent,
          laneLimits,
        });
        for (const claim of result.claims) startClaim(claim);
        const changed = result.claims.length + result.skipped.length + result.recovered.length + result.expired.length;
        if (changed > 0) {
          log(
            `tick claimed=${result.claims.length} active=${activeRuns.size} (command=${activeByLane.command} agent=${activeByLane.agent}) skipped=${result.skipped.length} recovered=${result.recovered.length} expired=${result.expired.length}`,
          );
        }
        await reapAbandoned(result.recovered);
      },
    });
  } finally {
    clearInterval(leaseHeartbeat);
    if (activeRuns.size > 0 && !runAbort.signal.aborted) runAbort.abort();
    await Promise.allSettled([...activeRuns.values()]);
    opts.signal?.removeEventListener("abort", onSignal);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    store.releaseDaemonLease(leaseId);
    removePid(pidPath);
    if (ownStore) store.close();
    log("stopped");
  }
}

export interface StartDaemonResult {
  started: boolean;
  alreadyRunning: boolean;
  pid?: number;
}

export async function startDaemon(opts: {
  cliEntry: string;
  execPath?: string;
  args?: string[];
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<StartDaemonResult> {
  ensureDataDir();
  const state = isDaemonRunning();
  if (state.running) return { started: false, alreadyRunning: true, pid: state.pid };
  if (state.stale) removePid();
  const out = openSync(daemonLogPath(), "a");
  const child = spawn(opts.execPath ?? process.execPath, [opts.cliEntry, ...(opts.args ?? ["daemon", "run"])], {
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  const sleep = opts.sleep ?? realSleep;
  const deadline = Math.max(1, Math.ceil((opts.waitMs ?? 4_000) / 100));
  for (let i = 0; i < deadline; i++) {
    await sleep(100);
    const current = isDaemonRunning();
    if (current.running) return { started: true, alreadyRunning: false, pid: current.pid };
  }
  return { started: false, alreadyRunning: false };
}
