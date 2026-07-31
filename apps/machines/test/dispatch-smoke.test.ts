import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { closeDb } from "../src/db.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { getDispatchFleetSmoke, type DispatchFleetSmokeRunner } from "../src/dispatch-smoke.js";
import { discoverMachineTopology } from "../src/topology.js";

const ENV_KEYS = [
  "HASNA_MACHINES_DB_PATH",
  "HASNA_MACHINES_MANIFEST_PATH",
  "HASNA_MACHINES_MACHINE_ID",
  "HASNA_MACHINES_REACHABLE_HOSTS",
] as const;

const repoRoot = resolve(import.meta.dir, "..");
const cliPath = join(repoRoot, "src", "cli", "index.ts");

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

function setupDispatchFleet(): string {
  const dir = mkdtempSync(join(tmpdir(), "machines-dispatch-smoke-"));
  process.env.HASNA_MACHINES_DB_PATH = join(dir, "machines.db");
  process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
  process.env.HASNA_MACHINES_MACHINE_ID = "spark02";
  process.env.HASNA_MACHINES_REACHABLE_HOSTS = "operator@spark01,hasna@apple03";
  manifestInit();
  manifestAdd({
    id: "spark02",
    friendlyName: "Spark 02",
    platform: "linux",
    workspacePath: "/home/hasna/Workspace",
    updatedAt: "2026-07-01T10:00:00.000Z",
  });
  manifestAdd({
    id: "spark01",
    friendlyName: "Spark 01",
    platform: "linux",
    workspacePath: "/home/hasna/Workspace",
    sshAddress: "operator@spark01",
    updatedAt: "2026-07-01T09:00:00.000Z",
  });
  manifestAdd({
    id: "apple03",
    friendlyName: "Apple 03",
    platform: "macos",
    workspacePath: "/Users/hasna/Workspace",
    sshAddress: "hasna@apple03",
    updatedAt: "2026-07-01T08:00:00.000Z",
  });
  return dir;
}

function dispatchRunner(commands: string[] = []): DispatchFleetSmokeRunner {
  return (target, command) => {
    commands.push(`${target.target_id}:${command}`);
    if (command.includes("daemon restart")) {
      throw new Error("mutating restart command must not execute");
    }
    if (command.includes("command -v")) {
      return {
        machineId: target.machine_id,
        source: target.route_mode === "ssh" ? "ssh" : "local",
        stdout: "path=/home/hasna/.bun/bin/dispatch\nversion=@hasna/dispatch 0.0.22\n",
        stderr: "",
        exitCode: 0,
      };
    }
    if (command.includes("daemon status")) {
      return {
        machineId: target.machine_id,
        source: target.route_mode === "ssh" ? "ssh" : "local",
        stdout: JSON.stringify({ running: true, health: "alive", pid: 1234, log: "/home/hasna/.dispatch/daemon.log" }),
        stderr: "",
        exitCode: 0,
      };
    }
    return {
      machineId: target.machine_id,
      source: "local",
      stdout: "",
      stderr: `unexpected command ${command}`,
      exitCode: 1,
    };
  };
}

describe("dispatch fleet smoke API", () => {
  test("reports default dispatch fleet package, route, and daemon readiness without mutation", () => {
    const dir = setupDispatchFleet();
    const commands: string[] = [];
    try {
      const topology = discoverMachineTopology({ includeTailscale: false, limit: null, now: new Date("2026-07-01T12:00:00.000Z") });
      const report = getDispatchFleetSmoke({
        topology,
        now: new Date("2026-07-01T12:00:00.000Z"),
        expectedVersion: "0.0.22",
        runner: dispatchRunner(commands),
      });

      expect(report).toMatchObject({
        kind: "dispatch_fleet_smoke",
        dryRun: true,
        dry_run: true,
        mutates: false,
        redaction: { enabled: true, marker: "[redacted]", private_metadata: false },
        selection: {
          default_fleet: true,
          package_name: "@hasna/dispatch",
          command: "dispatch",
          expected_version: "0.0.22",
          ignored: [{ machine_id: "apple01" }],
        },
        summary: { total: 4, fail: 0, package_ok: 4, daemon_restart_ready: 4 },
      });
      expect(report.machines.map((machine) => machine.target.target_id)).toEqual(["local", "spark01", "spark02:ssh", "apple03"]);
      expect(report.machines.find((machine) => machine.target.target_id === "spark02:ssh")?.route_health).toMatchObject({
        route: "ssh",
        forced_ssh: true,
        target: "[redacted]",
      });
      expect(report.machines.every((machine) => machine.daemon.restart_readiness.executed === false)).toBe(true);
      expect(report.machines.every((machine) => machine.daemon.restart_readiness.planned_mutates === true)).toBe(true);
      expect(commands.some((command) => command.includes("daemon restart"))).toBe(false);
      expect(commands.filter((command) => command.includes("daemon status")).length).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("redacts bounded command output and still avoids restart execution", () => {
    const dir = setupDispatchFleet();
    const leaked = [
      `sk-${"proj"}-abcdefghijklmnopqrstuvwxyz`,
      `npm${"_"}abcdefghijklmnopqrstuvwxyz`,
      `xai${"-"}abcdefghijklmnopqrstuvwxyz`,
      `${"secret"}-token:abcdef`,
      `gh${"p"}_abcdefghijklmnopqrstuvwxyz123456`,
      "Bearer abcdefghijklmnopqrstuvwxyz",
    ].join(" ");
    const commands: string[] = [];
    const runner: DispatchFleetSmokeRunner = (target, command) => {
      commands.push(command);
      if (command.includes("daemon restart")) throw new Error("restart must not execute");
      if (command.includes("command -v")) {
        return {
          machineId: target.machine_id,
          source: "local",
          stdout: `path=/Users/alice/.bun/bin/dispatch\nversion=@hasna/dispatch 0.0.22 ${leaked}\n`,
          stderr: `stderr ${leaked}`,
          exitCode: 0,
        };
      }
      return {
        machineId: target.machine_id,
        source: "local",
        stdout: JSON.stringify({ running: true, health: "alive", detail: `/home/alice/log ${leaked}` }),
        stderr: leaked,
        exitCode: 0,
      };
    };

    try {
      const report = getDispatchFleetSmoke({
        topology: discoverMachineTopology({ includeTailscale: false, limit: null }),
        machineIds: ["local"],
        maxOutputChars: 120,
        runner,
      });
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain(`sk-${"proj"}-abcdefghijklmnopqrstuvwxyz`);
      expect(serialized).not.toContain(`npm${"_"}abcdefghijklmnopqrstuvwxyz`);
      expect(serialized).not.toContain(`xai${"-"}abcdefghijklmnopqrstuvwxyz`);
      expect(serialized).not.toContain(`${"secret"}-token:abcdef`);
      expect(serialized).not.toContain(`gh${"p"}_abcdefghijklmnopqrstuvwxyz123456`);
      expect(serialized).not.toContain("Bearer abcdefghijklmnopqrstuvwxyz");
      expect(serialized).not.toContain("/Users/alice");
      expect(serialized).not.toContain("/home/alice");
      expect(serialized).toContain("[redacted]");
      expect(serialized).toContain("/Users/<user>");
      expect(commands.some((command) => command.includes("daemon restart"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dispatch-smoke CLI emits JSON and does not call daemon restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-dispatch-smoke-cli-"));
    const binDir = join(dir, "bin");
    const marker = join(dir, "restart-called");
    try {
      const dispatch = join(binDir, "dispatch");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(dispatch, `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "--version" ]; then
  echo "@hasna/dispatch 0.0.22"
  exit 0
fi
if [ "$1" = "daemon" ] && [ "$2" = "status" ] && [ "$3" = "--json" ]; then
  echo '{"running":true,"health":"alive"}'
  exit 0
fi
if [ "$1" = "daemon" ] && [ "$2" = "restart" ]; then
  touch ${JSON.stringify(marker)}
  exit 99
fi
exit 2
`);
      chmodSync(dispatch, 0o755);
      const env = {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        // dispatch-smoke builds its own PATH as
        //   PATH="$HOME/.bun/bin:$HOME/.local/bin:...:$PATH"
        // so $HOME/.bun/bin is searched BEFORE the binDir prepended above. On
        // any machine with a real @hasna/dispatch installed there, that binary
        // wins and reports its own version instead of the 0.0.22 stub —
        // measured on station01 against @hasna/dispatch 0.0.25, where this
        // test failed with version_ok:false while CI (no dispatch installed)
        // passed. Point HOME at the sandbox so the product's own PATH prefix
        // resolves inside it and the stub is the only dispatch reachable.
        HOME: dir,
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_MACHINE_ID: "spark02",
      };
      const result = spawnSync(process.execPath, [
        cliPath,
        "dispatch-smoke",
        "--machine",
        "local",
        "--no-tailscale",
        "--expected-version",
        "0.0.22",
        "--json",
      ], {
        cwd: repoRoot,
        env,
        encoding: "utf8",
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload).toMatchObject({
        kind: "dispatch_fleet_smoke",
        dryRun: true,
        mutates: false,
        summary: { total: 1, fail: 0, package_ok: 1, daemon_restart_ready: 1 },
      });
      expect(payload.machines[0].daemon.restart_readiness).toMatchObject({
        planned_command_ref: "PATH=\"$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH\"; export PATH; 'dispatch' daemon restart --json",
        planned_mutates: true,
        executed: false,
      });
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
