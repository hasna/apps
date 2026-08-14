import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Store } from "../lib/store.js";
import {
  daemonStatus,
  isAlive,
  isDaemonRunning,
  processStartTimeMs,
  readPid,
  readPidRecord,
  reapProcessGroups,
  sameProcessStart,
  stopDaemon,
  writePid,
} from "./control.js";
import { startDaemon } from "./daemon.js";

interface Victim {
  pid: number;
  kill: () => void;
}

async function spawnVictim(command: string[] = ["sleep", "30"]): Promise<Victim> {
  const child = spawn(command[0]!, command.slice(1), { detached: true, stdio: "ignore" });
  child.unref();
  await once(child, "spawn");
  const pid = child.pid!;
  return {
    pid,
    kill: () => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already dead */
        }
      }
    },
  };
}

async function waitForDeath(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await Bun.sleep(50);
  }
  return !isAlive(pid);
}

async function deadPid(): Promise<number> {
  const child = spawn("sh", ["-c", "exit 0"], { stdio: "ignore" });
  const pid = child.pid!;
  await once(child, "exit");
  return pid;
}

describe("daemon control", () => {
  test("writePid records a start-time fingerprint that readPidRecord round-trips", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-pid-"));
    const path = join(root, "daemon.pid");
    try {
      writePid(process.pid, path);
      const record = readPidRecord(path);
      expect(record?.pid).toBe(process.pid);
      expect(record?.startedAt).toBeDefined();
      expect(sameProcessStart(record?.startedAt, processStartTimeMs(process.pid))).toBe(true);
      expect(readPid(path)).toBe(process.pid);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("readPidRecord accepts legacy plain-number pidfiles", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-legacy-"));
    const path = join(root, "daemon.pid");
    try {
      writeFileSync(path, `${process.pid}\n`);
      expect(readPidRecord(path)).toEqual({ pid: process.pid });
      expect(isDaemonRunning(path)).toEqual({ running: true, stale: false, pid: process.pid });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("isDaemonRunning reports a missing pidfile as not running and not stale", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-missing-"));
    try {
      expect(isDaemonRunning(join(root, "daemon.pid"))).toEqual({ running: false, stale: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("isDaemonRunning flags a dead pid as stale", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-stale-"));
    const path = join(root, "daemon.pid");
    try {
      const pid = await deadPid();
      writeFileSync(path, JSON.stringify({ pid }));
      expect(isDaemonRunning(path)).toEqual({ running: false, stale: true, pid });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("isDaemonRunning treats a recycled pid (fingerprint mismatch) as stale", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-recycled-"));
    const path = join(root, "daemon.pid");
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: 123 }));
      expect(isDaemonRunning(path)).toEqual({ running: false, stale: true, pid: process.pid });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("isAlive honors the start-time fingerprint", () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(process.pid, processStartTimeMs(process.pid))).toBe(true);
    expect(isAlive(process.pid, 123)).toBe(false);
  });

  test("daemonStatus reflects pidfile and store state", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-status-"));
    const store = new Store(":memory:");
    try {
      const status = daemonStatus(store, join(root, "daemon.pid"));
      expect(status.running).toBe(false);
      expect(status.stale).toBe(false);
      expect(status.loops.total).toBe(0);
      expect(status.runs.total).toBe(0);
      expect(status.lease).toBeUndefined();
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("startDaemon reports an already running daemon from the pidfile", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-start-"));
    const oldDataDir = process.env.LOOPS_DATA_DIR;
    process.env.LOOPS_DATA_DIR = root;
    try {
      writePid(process.pid);
      const result = await startDaemon({ cliEntry: "unused", sleep: async () => undefined });
      expect(result).toEqual({ started: false, alreadyRunning: true, pid: process.pid });
    } finally {
      if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
      else process.env.LOOPS_DATA_DIR = oldDataDir;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("startDaemon clears a stale pidfile and reports failure when the child never comes up", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-start-fail-"));
    const oldDataDir = process.env.LOOPS_DATA_DIR;
    process.env.LOOPS_DATA_DIR = root;
    try {
      const stalePid = await deadPid();
      writeFileSync(join(root, "daemon.pid"), JSON.stringify({ pid: stalePid }));
      const result = await startDaemon({
        cliEntry: "-c",
        execPath: "/bin/sh",
        args: ["exit 0"],
        waitMs: 300,
        sleep: async (ms) => Bun.sleep(Math.min(ms, 10)),
      });
      expect(result).toEqual({ started: false, alreadyRunning: false });
      expect(existsSync(join(root, "daemon.pid"))).toBe(false);
    } finally {
      if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
      else process.env.LOOPS_DATA_DIR = oldDataDir;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("stopDaemon uses the store that lives beside the pidfile, not the process default", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-stop-"));
    const decoy = mkdtempSync(join(tmpdir(), "loops-control-stop-decoy-"));
    const oldDataDir = process.env.LOOPS_DATA_DIR;
    process.env.LOOPS_DATA_DIR = decoy;
    const victim = await spawnVictim();
    try {
      const path = join(root, "daemon.pid");
      writePid(victim.pid, path);
      const store = new Store(join(root, "loops.db"));
      store.acquireDaemonLease({ id: "test-lease", pid: victim.pid, hostname: "test", ttlMs: 60_000 });
      store.close();

      const result = await stopDaemon({ path, timeoutMs: 2_000 });
      expect(result.wasRunning).toBe(true);
      expect(result.stopped).toBe(true);
      expect(result.forced).toBe(false);
      expect(result.pid).toBe(victim.pid);
      expect(existsSync(path)).toBe(false);
      expect(await waitForDeath(victim.pid)).toBe(true);
    } finally {
      victim.kill();
      if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
      else process.env.LOOPS_DATA_DIR = oldDataDir;
      rmSync(root, { recursive: true, force: true });
      rmSync(decoy, { recursive: true, force: true });
    }
  });

  test("stopDaemon removes a stale pidfile without signaling anything", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-stop-stale-"));
    const path = join(root, "daemon.pid");
    try {
      const pid = await deadPid();
      writeFileSync(path, JSON.stringify({ pid }));
      const result = await stopDaemon({ path });
      expect(result).toEqual({ wasRunning: false, stopped: false, forced: false, pid });
      expect(existsSync(path)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("stopDaemon terminates a live pidfile daemon even when its lease is expired/mismatched", async () => {
    // Regression: a suspend/resume can lapse or mismatch the lease while the
    // daemon process is still alive. stopDaemon must terminate the live process
    // rather than remove the pidfile and report "not running", which would leave
    // an untracked live daemon that a later `daemon start` races. Run reaping is
    // still skipped without a verified lease, so only the daemon is killed.
    const root = mkdtempSync(join(tmpdir(), "loops-control-stop-nolease-"));
    const victim = await spawnVictim();
    try {
      const path = join(root, "daemon.pid");
      writePid(victim.pid, path);
      const store = new Store(join(root, "loops.db"));
      store.close();
      const result = await stopDaemon({ path, timeoutMs: 2_000 });
      expect(result.wasRunning).toBe(true);
      expect(result.stopped).toBe(true);
      expect(result.reapedPgids ?? []).toEqual([]);
      expect(existsSync(path)).toBe(false);
      expect(await waitForDeath(victim.pid)).toBe(true);
    } finally {
      victim.kill();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("stopDaemon escalates to SIGKILL and reaps child process groups from the store", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-stop-force-"));
    const stubborn = await spawnVictim(["sh", "-c", "trap '' TERM; sleep 5"]);
    const orphan = await spawnVictim();
    try {
      const path = join(root, "daemon.pid");
      writePid(stubborn.pid, path);
      const store = new Store(join(root, "loops.db"));
      store.acquireDaemonLease({ id: "test-lease", pid: stubborn.pid, hostname: "test", ttlMs: 60_000 });
      const daemonRunner = `test:${stubborn.pid}:test-lease`;
      const loop = store.createLoop({
        name: "force-stop-loop",
        schedule: { type: "once", at: "2099-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), daemonRunner);
      expect(claim).toBeDefined();
      store.markRunPid(claim!.run.id, orphan.pid, daemonRunner, { claimToken: claim!.claimToken });
      store.close();

      const result = await stopDaemon({ path, timeoutMs: 300, reapGraceMs: 200 });
      expect(result.wasRunning).toBe(true);
      expect(result.forced).toBe(true);
      expect(result.stopped).toBe(true);
      expect(result.reapedPgids ?? []).toContain(orphan.pid);
      expect(await waitForDeath(stubborn.pid)).toBe(true);
      expect(await waitForDeath(orphan.pid)).toBe(true);
    } finally {
      stubborn.kill();
      orphan.kill();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("stopDaemon reaps owned runs beyond the default 100-row listRuns window", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-stop-many-"));
    const stubborn = await spawnVictim(["sh", "-c", "trap '' TERM; sleep 5"]);
    const orphan = await spawnVictim();
    try {
      const path = join(root, "daemon.pid");
      writePid(stubborn.pid, path);
      const store = new Store(join(root, "loops.db"));
      store.acquireDaemonLease({ id: "test-lease", pid: stubborn.pid, hostname: "test", ttlMs: 60_000 });
      const daemonRunner = `test:${stubborn.pid}:test-lease`;
      // The orphaned run is the OLDEST running row; 110 newer running rows push
      // it out of listRuns' default newest-first 100-row window.
      const orphanLoop = store.createLoop({
        name: "orphan-loop",
        schedule: { type: "once", at: "2099-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      const orphanClaim = store.claimRun(orphanLoop, new Date().toISOString(), daemonRunner);
      expect(orphanClaim).toBeDefined();
      store.markRunPid(orphanClaim!.run.id, orphan.pid, daemonRunner, { claimToken: orphanClaim!.claimToken });
      await Bun.sleep(10);
      for (let i = 0; i < 110; i++) {
        const filler = store.createLoop({
          name: `filler-loop-${i}`,
          schedule: { type: "once", at: "2099-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        });
        expect(store.claimRun(filler, new Date().toISOString(), daemonRunner)).toBeDefined();
      }
      store.close();

      const result = await stopDaemon({ path, timeoutMs: 300, reapGraceMs: 200 });
      expect(result.forced).toBe(true);
      expect(result.reapedPgids ?? []).toContain(orphan.pid);
      expect(await waitForDeath(orphan.pid)).toBe(true);
    } finally {
      stubborn.kill();
      orphan.kill();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("stopDaemon forced path leaves running runs owned by live non-daemon owners alone", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-control-stop-owned-"));
    const stubborn = await spawnVictim(["sh", "-c", "trap '' TERM; sleep 5"]);
    const daemonChild = await spawnVictim();
    const manualChild = await spawnVictim();
    try {
      const path = join(root, "daemon.pid");
      writePid(stubborn.pid, path);
      const store = new Store(join(root, "loops.db"));
      store.acquireDaemonLease({ id: "test-lease", pid: stubborn.pid, hostname: "test", ttlMs: 60_000 });
      const daemonRunner = `test:${stubborn.pid}:test-lease`;
      const daemonLoop = store.createLoop({
        name: "daemon-owned-loop",
        schedule: { type: "once", at: "2099-01-01T00:00:00Z" },
        target: { type: "command", command: "true" },
      });
      const daemonClaim = store.claimRun(daemonLoop, new Date().toISOString(), daemonRunner);
      expect(daemonClaim).toBeDefined();
      store.markRunPid(daemonClaim!.run.id, daemonChild.pid, daemonRunner, { claimToken: daemonClaim!.claimToken });
      // Inline `loops run-now` in another terminal: healthy child, live owner, valid lease.
      const manualRunner = `manual:${process.pid}`;
      const manualLoop = store.createLoop({
        name: "manual-owned-loop",
        schedule: { type: "once", at: "2099-01-01T00:01:00Z" },
        target: { type: "command", command: "true" },
      });
      const manualClaim = store.claimRun(manualLoop, new Date().toISOString(), manualRunner);
      expect(manualClaim).toBeDefined();
      store.markRunPid(manualClaim!.run.id, manualChild.pid, manualRunner, { claimToken: manualClaim!.claimToken });
      store.heartbeatRunLease(manualClaim!.run.id, manualRunner, 60_000, new Date(), { claimToken: manualClaim!.claimToken });
      store.close();

      const result = await stopDaemon({ path, timeoutMs: 300, reapGraceMs: 200 });
      expect(result.forced).toBe(true);
      expect(result.reapedPgids ?? []).toContain(daemonChild.pid);
      expect(result.reapedPgids ?? []).not.toContain(manualChild.pid);
      expect(await waitForDeath(daemonChild.pid)).toBe(true);
      expect(isAlive(manualChild.pid)).toBe(true);
    } finally {
      stubborn.kill();
      daemonChild.kill();
      manualChild.kill();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reapProcessGroups terminates a detached process group", async () => {
    const victim = await spawnVictim();
    try {
      const killed = await reapProcessGroups(
        [{ pid: victim.pid, pgid: victim.pid, processStartedAt: processStartTimeMs(victim.pid) }],
        { graceMs: 200 },
      );
      expect(killed).toContain(victim.pid);
      expect(await waitForDeath(victim.pid)).toBe(true);
    } finally {
      victim.kill();
    }
  });

  test("reapProcessGroups skips pids whose start-time fingerprint does not match", async () => {
    const victim = await spawnVictim();
    try {
      const killed = await reapProcessGroups([{ pid: victim.pid, pgid: victim.pid, processStartedAt: 123 }], {
        graceMs: 100,
      });
      expect(killed).toHaveLength(0);
      expect(isAlive(victim.pid)).toBe(true);
    } finally {
      victim.kill();
    }
  });

  test("reapProcessGroups fails closed on live pids without a recorded fingerprint", async () => {
    // Pre-0.4.0 rows carry a pid but no process_started_at: the pid may have
    // been recycled by an unrelated process, so it must never be signalled.
    const victim = await spawnVictim();
    const logs: string[] = [];
    try {
      const killed = await reapProcessGroups([{ pid: victim.pid, pgid: victim.pid }], {
        graceMs: 100,
        log: (message) => logs.push(message),
      });
      expect(killed).toHaveLength(0);
      expect(isAlive(victim.pid)).toBe(true);
      expect(logs.some((line) => line.includes("no recorded start-time fingerprint"))).toBe(true);
    } finally {
      victim.kill();
    }
  });
});
