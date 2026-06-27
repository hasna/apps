import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { daemonLogPath, pidFilePath } from "../lib/paths.js";
import type { Store } from "../lib/store.js";
import { Store as LiveStore } from "../lib/store.js";
import { realSleep } from "./loop.js";

export function readPid(path: string = pidFilePath()): number | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

export function writePid(pid: number = process.pid, path: string = pidFilePath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, String(pid));
}

export function removePid(path: string = pidFilePath()): void {
  rmSync(path, { force: true });
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface DaemonProcessState {
  running: boolean;
  stale: boolean;
  pid?: number;
}

export function isDaemonRunning(path: string = pidFilePath()): DaemonProcessState {
  const pid = readPid(path);
  if (!pid) return { running: false, stale: false };
  if (isAlive(pid)) return { running: true, stale: false, pid };
  return { running: false, stale: true, pid };
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
      running: store.countRuns("running"),
      failed: store.countRuns("failed"),
      succeeded: store.countRuns("succeeded"),
      abandoned: store.countRuns("abandoned"),
    },
    logPath: daemonLogPath(),
  };
}

export async function stopDaemon(
  opts: { path?: string; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ wasRunning: boolean; stopped: boolean; forced: boolean; pid?: number }> {
  const path = opts.path ?? pidFilePath();
  const state = isDaemonRunning(path);
  if (state.stale) {
    removePid(path);
    return { wasRunning: false, stopped: false, forced: false, pid: state.pid };
  }
  if (!state.running || !state.pid) return { wasRunning: false, stopped: false, forced: false };
  const store = new LiveStore();
  try {
    const lease = store.getDaemonLease();
    if (!lease || lease.pid !== state.pid || new Date(lease.expiresAt).getTime() <= Date.now()) {
      removePid(path);
      return { wasRunning: false, stopped: false, forced: false, pid: state.pid };
    }
  } finally {
    store.close();
  }
  const sleep = opts.sleep ?? realSleep;
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    removePid(path);
    return { wasRunning: true, stopped: true, forced: false, pid: state.pid };
  }
  const steps = Math.max(1, Math.ceil((opts.timeoutMs ?? 6_000) / 100));
  for (let i = 0; i < steps; i++) {
    await sleep(100);
    if (!isAlive(state.pid)) {
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
  return { wasRunning: true, stopped: !isAlive(state.pid), forced: true, pid: state.pid };
}
