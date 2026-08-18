import { afterEach, describe, expect, it } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const monitorBin = join(import.meta.dir, "../../bins/monitor.ts");
const children: ChildProcess[] = [];
const tempDirs: string[] = [];

function startMarkedProcess(marker: string): ChildProcess {
  const child = spawn("bash", ["-c", `exec -a ${marker} sleep 60`], {
    stdio: "ignore",
  });
  children.push(child);
  if (!child.pid) throw new Error("test process did not expose a PID");
  return child;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("killed process did not exit")), 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function runMonitorKill(args: string[], input?: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [monitorBin, "kill", ...args], {
    cwd: join(import.meta.dir, "../.."),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
    input,
    timeout: 20_000,
  });
}

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.pid && isAlive(child.pid)) child.kill("SIGKILL");
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("monitor kill --name", () => {
  it("reports command-regex matches as JSON without killing during a dry run", () => {
    const marker = `monitor-kill-dry-${process.pid}-${Date.now()}`;
    const child = startMarkedProcess(marker);

    const result = runMonitorKill(["--name", marker, "--dry-run", "--json"]);

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      machine_id: string;
      pattern: string;
      signal: string;
      dry_run: boolean;
      matches: Array<{ pid: number; name: string; cmd: string }>;
    };
    expect(output).toMatchObject({
      machine_id: "local",
      pattern: marker,
      signal: "SIGTERM",
      dry_run: true,
    });
    expect(output.matches.some((match) => match.pid === child.pid && match.cmd.includes(marker))).toBe(true);
    expect(isAlive(child.pid!)).toBe(true);
  });

  it("requires confirmation before killing multiple matches", () => {
    const marker = `monitor-kill-confirm-${process.pid}-${Date.now()}`;
    const first = startMarkedProcess(marker);
    const second = startMarkedProcess(marker);

    const result = runMonitorKill(["--name", marker, "--json"], "no\n");

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      cancelled: boolean;
      actions: unknown[];
      matches: Array<{ pid: number }>;
    };
    expect(output.cancelled).toBe(true);
    expect(output.actions).toEqual([]);
    expect(output.matches.map((match) => match.pid)).toEqual(expect.arrayContaining([first.pid, second.pid]));
    expect(isAlive(first.pid!)).toBe(true);
    expect(isAlive(second.pid!)).toBe(true);
  });

  it("refuses oversized batches before sending any signals", () => {
    const marker = `monitor-kill-limit-${process.pid}-${Date.now()}`;
    const spawned = Array.from({ length: 6 }, () => startMarkedProcess(marker));

    const result = runMonitorKill(["--name", `^${marker}`, "--yes", "--json"]);

    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout) as {
      error: string;
      actions: unknown[];
      matches: Array<{ pid: number }>;
    };
    expect(output.error).toContain("no processes were killed");
    expect(output.actions).toEqual([]);
    expect(output.matches.map((match) => match.pid)).toEqual(
      expect.arrayContaining(spawned.map((child) => child.pid!))
    );
    for (const child of spawned) {
      expect(isAlive(child.pid!)).toBe(true);
    }
  });

  it("kills a single command-regex match", async () => {
    const marker = `monitor-kill-single-${process.pid}-${Date.now()}`;
    const child = startMarkedProcess(marker);

    const result = runMonitorKill(["--name", `^${marker}`, "--json"]);

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      actions: Array<{
        pid: number;
        action: string;
        name: string;
        reason: string;
        cmd: string;
      }>;
    };
    expect(output.actions).toContainEqual({
      pid: child.pid!,
      action: "killed",
      name: "sleep",
      reason: "sent SIGTERM",
      cmd: `${marker} 60`,
    });
    await waitForChildExit(child);
    expect(isAlive(child.pid!)).toBe(false);
  });

  it("kills matches collected through a non-default local machine ID", async () => {
    const marker = `monitor-kill-alias-${process.pid}-${Date.now()}`;
    const child = startMarkedProcess(marker);
    const configDir = mkdtempSync(join(tmpdir(), "monitor-kill-config-"));
    tempDirs.push(configDir);
    writeFileSync(join(configDir, "config.json"), JSON.stringify({
      machines: [{ id: "local-alias", label: "Local Alias", type: "local" }],
    }));

    const result = runMonitorKill(
      ["--name", `^${marker}`, "--machine", "local-alias", "--json"],
      undefined,
      { MONITOR_CONFIG_DIR: configDir }
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      machine_id: string;
      actions: Array<{ pid: number; action: string }>;
    };
    expect(output.machine_id).toBe("local-alias");
    expect(
      output.actions.some((action) => action.pid === child.pid && action.action === "killed")
    ).toBe(true);
    await waitForChildExit(child);
    expect(isAlive(child.pid!)).toBe(false);
  });

  it("never selects the CLI's own process when the machine is local via the DB store", () => {
    const marker = `monitor-kill-db-local-${process.pid}-${Date.now()}`;
    const child = startMarkedProcess(marker);
    const scratch = mkdtempSync(join(tmpdir(), "monitor-kill-db-local-"));
    tempDirs.push(scratch);
    const configDir = join(scratch, "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify({
      machines: [],
      dbPath: join(scratch, "monitor.db"),
    }));
    const env = { MONITOR_CONFIG_DIR: configDir };

    // Register a local-type machine through the DB store (the supported
    // `monitor add <name> --type local` path, which stores machines in the
    // database rather than the config file).
    const added = spawnSync(
      process.execPath,
      [monitorBin, "add", "db-local", "--type", "local"],
      {
        cwd: join(import.meta.dir, "../.."),
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1", ...env },
        timeout: 20_000,
      }
    );
    expect(added.status).toBe(0);
    expect(added.stdout).toContain("'db-local'");

    const result = runMonitorKill(
      ["--name", "monitor", "--machine", "db-local", "--dry-run", "--json"],
      undefined,
      env
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      machine_id: string;
      matches: Array<{ pid: number; name: string; cmd: string }>;
    };
    expect(output.machine_id).toBe("db-local");
    // Positive control: the local process table was actually read through the
    // DB-resolved machine.
    expect(
      output.matches.some((match) => match.pid === child.pid && match.cmd.includes(marker))
    ).toBe(true);
    // Self-protection: the running CLI process must never be selectable through
    // a DB-local machine (config-only classification would miss it and allow
    // `monitor kill` to terminate its own process).
    expect(output.matches.some((match) => match.pid === result.pid)).toBe(false);
  });

  it("reports an unknown machine as a JSON error", () => {
    const configDir = mkdtempSync(join(tmpdir(), "monitor-kill-config-"));
    tempDirs.push(configDir);
    writeFileSync(join(configDir, "config.json"), JSON.stringify({
      machines: [{ id: "local", label: "Local", type: "local" }],
    }));

    const result = runMonitorKill(
      ["--name", "worker", "--machine", "missing-machine", "--json"],
      undefined,
      { MONITOR_CONFIG_DIR: configDir }
    );

    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout) as { error: string };
    expect(output.error).toContain('Unknown machine or alias "missing-machine"');
  });

  it("rejects an invalid regular expression with JSON and a non-zero exit", () => {
    const result = runMonitorKill(["--name", "[", "--dry-run", "--json"]);

    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout) as { error: string };
    expect(output.error).toContain("Invalid name pattern");
  });
});

const killFixture = join(import.meta.dir, "kill-fixture.preload.ts");

function runMonitorKillPreload(args: string[], preload: string = killFixture) {
  return spawnSync(process.execPath, ["--preload", preload, monitorBin, "kill", ...args], {
    cwd: join(import.meta.dir, "../.."),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 20_000,
  });
}

describe("monitor kill batch operations", () => {
  it("reports one dry-run JSON result per unique PID", () => {
    const child = runMonitorKill(["--pids", "1234,5678,1234", "--dry-run", "--json"]);

    expect(child.status).toBe(0);
    expect(child.stderr).toBe("");
    expect(JSON.parse(child.stdout)).toEqual([
      {
        pid: 1234,
        name: "pid:1234",
        action: "skipped",
        reason: "dry-run: would send SIGTERM on local",
      },
      {
        pid: 5678,
        name: "pid:5678",
        action: "skipped",
        reason: "dry-run: would send SIGTERM on local",
      },
    ]);
  });

  it("accepts the ps filter vocabulary and returns per-PID JSON", () => {
    const child = runMonitorKillPreload(["--filter", "zombies", "--dry-run", "--json"]);

    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual([
      {
        pid: 1234,
        name: "pid:1234",
        action: "skipped",
        reason: "dry-run: would send SIGTERM on local",
      },
    ]);
  });

  it("rejects conflicting batch selectors", () => {
    const child = runMonitorKill(["1234", "--pids", "5678,9012", "--dry-run", "--json"]);

    expect(child.status).toBe(1);
    const output = JSON.parse(child.stdout) as { error: string };
    expect(output.error).toContain("Specify exactly one of");
  });

  it("rejects all-process filter kills", () => {
    const child = runMonitorKill(["--filter", "all", "--dry-run", "--json"]);

    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    expect(child.stderr).toContain("kill filter must be 'zombies', 'orphans', or 'high_mem'");
  });

  it("rejects malformed PID lists", () => {
    const child = runMonitorKill(["--pids", "1234,not-a-pid", "--dry-run", "--json"]);

    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    expect(child.stderr).toContain("PIDs must be a comma-separated list of integers");
  });

  it("requires confirmation before batch-killing multiple PIDs", () => {
    const marker = `monitor-kill-batch-confirm-${process.pid}-${Date.now()}`;
    const first = startMarkedProcess(marker);
    const second = startMarkedProcess(marker);

    const result = runMonitorKill(["--pids", `${first.pid},${second.pid}`, "--json"], "no\n");

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      cancelled: boolean;
      actions: unknown[];
    };
    expect(output.cancelled).toBe(true);
    expect(output.actions).toEqual([]);
    expect(isAlive(first.pid!)).toBe(true);
    expect(isAlive(second.pid!)).toBe(true);
  });

  it("refuses oversized batch PID lists before sending any signals", () => {
    const marker = `monitor-kill-batch-limit-${process.pid}-${Date.now()}`;
    const spawned = Array.from({ length: 6 }, () => startMarkedProcess(marker));

    const result = runMonitorKill(
      ["--pids", spawned.map((c) => c.pid).join(","), "--yes", "--json"]
    );

    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout) as {
      error: string;
      actions: unknown[];
    };
    expect(output.error).toContain("no processes were killed");
    expect(output.actions).toEqual([]);
    for (const child of spawned) {
      expect(isAlive(child.pid!)).toBe(true);
    }
  });

  it("batch-kills multiple PIDs with --yes", async () => {
    const marker = `monitor-kill-batch-kill-${process.pid}-${Date.now()}`;
    const first = startMarkedProcess(marker);
    const second = startMarkedProcess(marker);

    const result = runMonitorKill(["--pids", `${first.pid},${second.pid}`, "--yes", "--json"]);

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as Array<{ pid: number; action: string }>;
    expect(output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pid: first.pid, action: "killed" }),
        expect.objectContaining({ pid: second.pid, action: "killed" }),
      ])
    );
    await waitForChildExit(first);
    await waitForChildExit(second);
    expect(isAlive(first.pid!)).toBe(false);
    expect(isAlive(second.pid!)).toBe(false);
  });
});
