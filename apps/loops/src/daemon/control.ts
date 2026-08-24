import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { daemonLogPath, pidFilePath } from "../lib/paths.js";
import { procStatFields, processStartTimeMs, sameProcessStart, verifiedProcessStart } from "../lib/process-identity.js";
import type { Store } from "../lib/store.js";
import { Store as LiveStore } from "../lib/store.js";
import type { LoopRun } from "../types.js";
import { realSleep } from "./loop.js";

export { processStartTimeMs, sameProcessStart, verifiedProcessStart, START_TIME_TOLERANCE_MS } from "../lib/process-identity.js";

export interface PidFileRecord {
  pid: number;
  startedAt?: number;
}

export function readPidRecord(path: string = pidFilePath()): PidFileRecord | undefined {
  if (!existsSync(path)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { pid?: unknown; startedAt?: unknown };
      const pid = Number(parsed.pid);
      if (!Number.isInteger(pid) || pid <= 0) return undefined;
      const startedAt = Number(parsed.startedAt);
      return { pid, startedAt: Number.isFinite(startedAt) ? startedAt : undefined };
    } catch {
      return undefined;
    }
  }
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? { pid } : undefined;
}

export function readPid(path: string = pidFilePath()): number | undefined {
  return readPidRecord(path)?.pid;
}

export function writePid(pid: number = process.pid, path: string = pidFilePath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify({ pid, startedAt: processStartTimeMs(pid) }));
}

export function removePid(path: string = pidFilePath()): void {
  rmSync(path, { force: true });
}

export function isAlive(pid: number, startedAt?: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  return sameProcessStart(startedAt, processStartTimeMs(pid));
}

export interface DaemonProcessState {
  running: boolean;
  stale: boolean;
  pid?: number;
}

export function isDaemonRunning(path: string = pidFilePath()): DaemonProcessState {
  const record = readPidRecord(path);
  if (!record) return { running: false, stale: false };
  if (isAlive(record.pid, record.startedAt)) return { running: true, stale: false, pid: record.pid };
  return { running: false, stale: true, pid: record.pid };
}

export interface ReapableProcess {
  pid?: number;
  pgid?: number;
  processStartedAt?: string | number;
}

export function toReapableProcess(run: LoopRun): ReapableProcess {
  return { pid: run.pid, pgid: run.pgid, processStartedAt: run.processStartedAt };
}

function ownProcessGroupId(): number | undefined {
  if (process.platform === "linux") {
    // /proc/self/stat field 5 (pgrp) is index 2 after the comm field.
    const fields = procStatFields("/proc/self/stat");
    const pgrp = fields ? Number(fields[2]) : Number.NaN;
    if (Number.isInteger(pgrp) && pgrp > 0) return pgrp;
  }
  try {
    const run = spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" });
    const pgid = Number(run.stdout.trim());
    if (run.status === 0 && Number.isInteger(pgid) && pgid > 0) return pgid;
  } catch {
    /* ignore */
  }
  return undefined;
}

interface ReapTarget {
  id: number;
  group: boolean;
}

function signalReapTarget(target: ReapTarget, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(target.group ? -target.id : target.id, signal);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function reapProcessGroups(
  entries: ReapableProcess[],
  opts: { graceMs?: number; sleep?: (ms: number) => Promise<void>; log?: (message: string) => void } = {},
): Promise<number[]> {
  const sleep = opts.sleep ?? realSleep;
  const graceMs = Math.max(100, opts.graceMs ?? 2_000);
  const ownPgid = ownProcessGroupId();
  const targets = new Map<string, ReapTarget>();
  for (const entry of entries) {
    // Pid identity must be verified before signalling: pids are recycled, so
    // an unverifiable identity fails closed (skip) rather than killing an
    // unrelated process. When the recorded leader pid is already dead the
    // fingerprint cannot be read, but signalling stays safe: a bare-pid kill
    // is a no-op (ESRCH) and a pgid cannot be recycled while any group member
    // is still alive, so the group kill only sweeps genuine survivors.
    const leaderPid = entry.pid ?? entry.pgid;
    if (leaderPid !== undefined && processExists(leaderPid)) {
      if (entry.processStartedAt === undefined) {
        opts.log?.(`skipping reap of pid ${leaderPid}: no recorded start-time fingerprint to verify identity`);
        continue;
      }
      if (!verifiedProcessStart(entry.processStartedAt, processStartTimeMs(leaderPid))) {
        opts.log?.(`skipping reap of pid ${leaderPid}: start-time fingerprint mismatch or unverifiable (pid recycled)`);
        continue;
      }
    }
    const usableGroup =
      entry.pgid !== undefined && Number.isInteger(entry.pgid) && entry.pgid > 1 && entry.pgid !== process.pid && entry.pgid !== ownPgid;
    const usablePid =
      entry.pid !== undefined && Number.isInteger(entry.pid) && entry.pid > 1 && entry.pid !== process.pid;
    const target: ReapTarget | undefined = usableGroup
      ? { id: entry.pgid!, group: true }
      : usablePid
        ? { id: entry.pid!, group: false }
        : undefined;
    if (!target) continue;
    targets.set(`${target.group ? "g" : "p"}:${target.id}`, target);
  }
  const live = [...targets.values()].filter((target) => signalReapTarget(target, "SIGTERM"));
  if (live.length === 0) return [];
  const steps = Math.max(1, Math.ceil(graceMs / 100));
  let remaining = live;
  for (let i = 0; i < steps && remaining.length > 0; i++) {
    await sleep(100);
    remaining = remaining.filter((target) => signalReapTarget(target, 0));
  }
  for (const target of remaining) {
    signalReapTarget(target, "SIGKILL");
    opts.log?.(`escalated to SIGKILL for ${target.group ? "pgid" : "pid"} ${target.id}`);
  }
  return live.map((target) => target.id);
}

export interface DaemonStatus extends DaemonProcessState {
  lease?: ReturnType<Store["getDaemonLease"]>;
  host: string;
  loops: {
    total: number;
    active: number;
    paused: number;
    stopped: number;
    expired: number;
    archived: number;
  };
  runs: {
    total: number;
    running: number;
    failed: number;
    succeeded: number;
    abandoned: number;
  };
  logPath: string;
}

export function daemonStatus(store: Store, path: string = pidFilePath()): DaemonStatus {
  return {
    ...isDaemonRunning(path),
    lease: store.getDaemonLease(),
    host: hostname(),
    loops: {
      total: store.countLoops(),
      active: store.countLoops("active"),
      paused: store.countLoops("paused"),
      stopped: store.countLoops("stopped"),
      expired: store.countLoops("expired"),
      archived: store.countLoops(undefined, { archived: true }),
    },
    runs: {
      total: store.countRuns(),
      running: store.countRuns({ status: "running" }),
      failed: store.countRuns({ status: "failed" }),
      succeeded: store.countRuns({ status: "succeeded" }),
      abandoned: store.countRuns({ status: "abandoned" }),
    },
    logPath: daemonLogPath(),
  };
}

export async function stopDaemon(
  opts: { path?: string; timeoutMs?: number; reapGraceMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ wasRunning: boolean; stopped: boolean; forced: boolean; pid?: number; reapedPgids?: number[] }> {
  const path = opts.path ?? pidFilePath();
  const record = readPidRecord(path);
  const state = isDaemonRunning(path);
  if (state.stale) {
    removePid(path);
    return { wasRunning: false, stopped: false, forced: false, pid: state.pid };
  }
  if (!state.running || !state.pid) return { wasRunning: false, stopped: false, forced: false };
  const sleep = opts.sleep ?? realSleep;
  // Honor the data dir the pidfile lives in rather than the process-global default.
  const store = new LiveStore(join(dirname(path), "loops.db"));
  try {
    const lease = store.getDaemonLease();
    // The pidfile process is verified alive above (state.running). Terminate it
    // regardless of lease state: a suspend/resume (or clock jump) can lapse or
    // mismatch the lease while the daemon is still live, and bailing out here
    // would leave an untracked live daemon that a later `daemon start` races.
    // Run reaping still requires a verified lease — without it we cannot tell
    // which running runs this daemon owned, so we terminate only the daemon.
    const leaseVerified = Boolean(lease && lease.pid === state.pid && new Date(lease.expiresAt).getTime() > Date.now());
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      removePid(path);
      return { wasRunning: true, stopped: true, forced: false, pid: state.pid };
    }
    const steps = Math.max(1, Math.ceil((opts.timeoutMs ?? 6_000) / 100));
    for (let i = 0; i < steps; i++) {
      await sleep(100);
      if (!isAlive(state.pid, record?.startedAt)) {
        removePid(path);
        return { wasRunning: true, stopped: true, forced: false, pid: state.pid };
      }
    }
    try {
      process.kill(state.pid, "SIGKILL");
    } catch {
      /* ignore */
    }
    await sleep(150);
    removePid(path);
    // Only reap runs the dead daemon actually owned. The daemon claims runs
    // with runnerId `${hostname}:${pid}:${leaseId}`, so ownership is keyed on
    // the lease id. Running runs claimed by other owners (e.g. an inline
    // `manual:<pid>` run-now in another terminal) have live processes that must
    // not be killed by a daemon stop. When the lease is unverified we cannot
    // attribute runs safely, so we skip reaping entirely. The explicit limit
    // matches the daemon's startup recovery pass: listRuns defaults to 100 rows,
    // which would silently skip owned runs when more than 100 are concurrently
    // running (high LOOPS_DAEMON_CONCURRENCY, inline runs mixed into the
    // newest-first window).
    let reapedPgids: number[] = [];
    if (leaseVerified && lease) {
      const ownedRuns = store
        .listRuns({ status: "running", limit: 1_000 })
        .filter((run) => run.claimedBy !== undefined && run.claimedBy.endsWith(`:${lease.id}`));
      reapedPgids = await reapProcessGroups(ownedRuns.map(toReapableProcess), {
        sleep,
        graceMs: opts.reapGraceMs,
      });
    }
    return { wasRunning: true, stopped: !isAlive(state.pid, record?.startedAt), forced: true, pid: state.pid, reapedPgids };
  } finally {
    store.close();
  }
}
