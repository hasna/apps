import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb } from "../src/db.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import {
  getCommandMatrix,
  getFleetLoopPreflight,
  getFleetMachineHealth,
  getFleetRouting,
} from "../src/agent-abstractions.js";
import { validateMachinesConsumerEnvelope } from "../src/consumer-schema.js";
import { discoverMachineTopology } from "../src/topology.js";
import type { CompatibilityCommandRunner } from "../src/compatibility.js";

const ENV_KEYS = [
  "HASNA_MACHINES_DB_PATH",
  "HASNA_MACHINES_MANIFEST_PATH",
  "HASNA_MACHINES_MACHINE_ID",
  "HASNA_MACHINES_REACHABLE_HOSTS",
] as const;

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

function setupFleet(): string {
  const dir = mkdtempSync(join(tmpdir(), "machines-agent-abstractions-"));
  process.env.HASNA_MACHINES_DB_PATH = join(dir, "machines.db");
  process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
  process.env.HASNA_MACHINES_MACHINE_ID = "control";
  process.env.HASNA_MACHINES_REACHABLE_HOSTS = "operator@worker";
  manifestInit();
  manifestAdd({
    id: "control",
    friendlyName: "Control Node",
    platform: "linux",
    workspacePath: "/home/hasna/Workspace",
    updatedAt: "2026-06-26T10:00:00.000Z",
  });
  manifestAdd({
    id: "worker",
    friendlyName: "Worker Node",
    platform: "linux",
    workspacePath: "/srv/workspace",
    sshAddress: "operator@worker",
    updatedAt: "2026-06-26T09:00:00.000Z",
  });
  return dir;
}

const missingBunRunner: CompatibilityCommandRunner = (machineId, command) => {
  const commandName = command.match(/cmd='([^']+)'/)?.[1] ?? "";
  if (commandName === "bun" && machineId === "worker") {
    return { machineId, source: "ssh", stdout: "path=\n", stderr: "", exitCode: 0 };
  }
  return {
    machineId,
    source: machineId === "control" ? "local" : "ssh",
    stdout: `path=/usr/bin/${commandName}\nversion=${commandName} 1.2.3\n`,
    stderr: "",
    exitCode: 0,
  };
};

describe("agent abstraction APIs", () => {
  test("returns compact health, routing, command matrix, and loop preflight envelopes", () => {
    const dir = setupFleet();
    try {
      const now = new Date("2026-06-26T12:00:00.000Z");
      const topology = discoverMachineTopology({ includeTailscale: false, limit: null, now });
      const machineIds = ["control", "worker", "missing"];

      const health = getFleetMachineHealth({
        topology,
        machineIds,
        now,
        checkCompatibility: true,
        commands: [{ command: "bun", required: true }],
        compatibilityRunner: missingBunRunner,
      });
      expect(health.kind).toBe("machine_health");
      expect(health.pagination).toMatchObject({ total: 3, count: 3, hasMore: false });
      expect(health.machines.map((machine) => machine.machine_id)).toEqual(machineIds);
      expect(health.machines.find((machine) => machine.machine_id === "worker")?.issues).toContain("command:bun:path:fail");
      expect(health.machines.find((machine) => machine.machine_id === "missing")).toMatchObject({
        status: "blocked",
        checks: { manifest: "fail", route: "fail", heartbeat: "fail" },
      });
      expect(validateMachinesConsumerEnvelope("machine_health", health)).toMatchObject({ ok: true, errors: [] });

      const routing = getFleetRouting({ topology, machineIds: ["worker"], now });
      expect(routing.kind).toBe("routing");
      expect(routing.routes[0]).toMatchObject({
        machine_id: "worker",
        ok: true,
        route: "ssh",
        target: "[redacted]",
        command_target: "[redacted]",
      });
      expect(validateMachinesConsumerEnvelope("routing", routing)).toMatchObject({ ok: true, errors: [] });

      const privateRouting = getFleetRouting({ topology, machineIds: ["worker"], now, privateMetadata: true });
      expect(privateRouting.routes[0]?.target).toBe("operator@worker");

      const matrix = getCommandMatrix({ topology, machineIds, command: "echo loop", now });
      expect(matrix.kind).toBe("command_matrix");
      expect(matrix.mode).toBe("plan");
      expect(matrix.commands.find((row) => row.machine_id === "worker")).toMatchObject({
        can_run: true,
        command: {
          command_ref: {
            provided: true,
            preview: "[redacted]",
            redacted: true,
          },
          mcp: {
            tool: "machines_ssh_resolve",
            args: { remote_command: "<loop-command>", private_metadata: false },
          },
          private_shell_command: "[redacted]",
        },
      });
      expect(JSON.stringify(matrix)).not.toContain("echo loop");
      expect(validateMachinesConsumerEnvelope("command_matrix", matrix)).toMatchObject({ ok: true, errors: [] });

      const privateMatrix = getCommandMatrix({ topology, machineIds: ["worker"], command: "echo loop", now, privateMetadata: true });
      expect(privateMatrix.commands[0]?.command).toMatchObject({
        command_ref: { preview: "echo loop", redacted: false },
        mcp: { args: { remote_command: "echo loop", private_metadata: false } },
      });
      expect(privateMatrix.commands[0]?.command.cli).toContain("--private-metadata");

      const preflight = getFleetLoopPreflight({ topology, machineIds, command: "echo loop", now });
      expect(preflight.kind).toBe("loop_preflight");
      expect(preflight.mode).toBe("plan");
      expect(preflight.selection_mode).toBe("explicit");
      expect(preflight.ok).toBe(false);
      expect(preflight.summary).toMatchObject({ any_ready: true, all_ready: false });
      expect(preflight.machines.find((machine) => machine.machine_id === "missing")?.next_steps).toContain("inspect_route:missing");
      expect(validateMachinesConsumerEnvelope("loop_preflight", preflight)).toMatchObject({ ok: true, errors: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("discovered fleet pagination is applied once", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-agent-pagination-"));
    try {
      process.env.HASNA_MACHINES_DB_PATH = join(dir, "machines.db");
      process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
      process.env.HASNA_MACHINES_MACHINE_ID = "demo-node-00";
      manifestInit();
      for (let index = 0; index < 12; index += 1) {
        manifestAdd({
          id: `demo-node-${String(index).padStart(2, "0")}`,
          platform: "linux",
          workspacePath: `/workspace/${index}`,
          updatedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        });
      }

      const first = getFleetMachineHealth({ includeTailscale: false });
      expect(first.pagination).toMatchObject({
        limit: 10,
        offset: 0,
        total: 12,
        count: 10,
        hasMore: true,
        nextOffset: 10,
      });
      expect(first.summary.total).toBe(10);
      expect(first.machines[0]?.machine_id).toBe("demo-node-11");

      const second = getFleetMachineHealth({ includeTailscale: false, offset: 10 });
      expect(second.pagination).toMatchObject({
        limit: 10,
        offset: 10,
        total: 12,
        count: 2,
        hasMore: false,
      });
      expect(second.machines.map((machine) => machine.machine_id)).toEqual(["demo-node-01", "demo-node-00"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
