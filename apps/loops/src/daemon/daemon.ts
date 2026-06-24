import { openSync } from "node:fs";
import { hostname } from "node:os";
import { spawn } from "node:child_process";
import { genId } from "../lib/ids.js";
import { daemonLogPath, ensureDataDir, pidFilePath } from "../lib/paths.js";
import { advanceLoop, claimDueRuns, executeClaimedRun, type ClaimedLoopRun } from "../lib/scheduler.js";
import { executeLoopTarget } from "../lib/workflow-runner.js";
import { Store } from "../lib/store.js";
import { isDaemonRunning, removePid, writePid } from "./control.js";
import { realSleep, runLoop } from "./loop.js";
import type { ExecutorResult, Loop, LoopRun } from "../types.js";

export interface RunDaemonOptions {
  intervalMs?: number;
  leaseTtlMs?: number;
  concurrency?: number;
  store?: Store;
  pidPath?: string;
  execute?: (loop: Loop, run: LoopRun) => Promise<ExecutorResult>;
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  signal?: AbortSignal;
}

function intervalFromEnv(): number | undefined {
  const raw = process.env.LOOPS_DAEMON_INTERVAL_MS;
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function concurrencyFromEnv(): number | undefined {
  const raw = process.env.LOOPS_DAEMON_CONCURRENCY;
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
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
  const concurrency = Math.max(1, opts.concurrency ?? concurrencyFromEnv() ?? 4);
  const log = opts.log ?? ((message: string) => console.error(`[loops-daemon] ${message}`));

  const lease = store.acquireDaemonLease({
    id: leaseId,
    pid: process.pid,
    hostname: hostname(),
    ttlMs: leaseTtlMs,
  });
  if (!lease) throw new Error("another loops daemon holds the database lease");

  writePid(process.pid, pidPath);
  log(`started pid=${process.pid} interval=${intervalMs}ms lease=${leaseId}`);

  let stopFlag = false;
  let leaseLost = false;
  const runAbort = new AbortController();
  const activeRuns = new Map<string, Promise<void>>();
  const requestStop = (message?: string): void => {
    stopFlag = true;
    if (!runAbort.signal.aborted) runAbort.abort();
    if (message) log(message);
  };
  const ensureLease = (): void => {
    const current = store.heartbeatDaemonLease(leaseId, leaseTtlMs);
    if (!current || current.id !== leaseId) {
      leaseLost = true;
      requestStop("daemon lease lost");
      throw new Error("daemon lease lost");
    }
  };
  const onSignal = (): void => {
    requestStop("stop signal received");
  };
  if (opts.signal?.aborted) onSignal();
  opts.signal?.addEventListener("abort", onSignal, { once: true });
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const executeDaemonRun = async (claim: ClaimedLoopRun): Promise<void> => {
    const heartbeatMs = Math.max(25, Math.min(1_000, intervalMs, Math.floor(leaseTtlMs / 10)));
    const timer = setInterval(() => {
      try {
        ensureLease();
      } catch (err) {
        log(err instanceof Error ? err.message : String(err));
      }
    }, heartbeatMs);
    timer.unref();
    try {
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
          })),
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
    } finally {
      clearInterval(timer);
    }
  };

  const startClaim = (claim: ClaimedLoopRun): void => {
    const task = executeDaemonRun(claim)
      .catch((err) => log(`run ${claim.run.id} error: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => activeRuns.delete(claim.run.id));
    activeRuns.set(claim.run.id, task);
  };

  try {
    await runLoop({
      intervalMs,
      sleep: opts.sleep ?? realSleep,
      shouldStop: opts.shouldStop ?? (() => stopFlag),
      onTickError: (err) => log(`tick error: ${err instanceof Error ? err.message : String(err)}`),
      tickFn: async () => {
        ensureLease();
        const available = Math.max(0, concurrency - activeRuns.size);
        const result = claimDueRuns({
          store,
          runnerId,
          daemonLeaseId: leaseId,
          beforeRun: () => ensureLease(),
          maxClaims: available,
        });
        for (const claim of result.claims) startClaim(claim);
        const changed = result.claims.length + result.skipped.length + result.recovered.length + result.expired.length;
        if (changed > 0) {
          log(
            `tick claimed=${result.claims.length} active=${activeRuns.size} skipped=${result.skipped.length} recovered=${result.recovered.length} expired=${result.expired.length}`,
          );
        }
      },
    });
  } finally {
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
