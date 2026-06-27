import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { closeDb } from "../src/db.js";
import {
  getFleetOpsCheck,
  parseFleetOpsTmuxExpectation,
  type FleetOpsTmuxPane,
} from "../src/ops-check.js";
import { discoverMachineTopology } from "../src/topology.js";

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
  const dir = mkdtempSync(join(tmpdir(), "machines-ops-check-"));
  process.env.HASNA_MACHINES_DB_PATH = join(dir, "machines.db");
  process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
  process.env.HASNA_MACHINES_MACHINE_ID = "control";
  process.env.HASNA_MACHINES_REACHABLE_HOSTS = "operator@worker";
  manifestInit();
  manifestAdd({
    id: "control",
    friendlyName: "Control",
    platform: "linux",
    workspacePath: "/home/hasna/workspace",
    updatedAt: "2026-06-27T10:00:00.000Z",
  });
  manifestAdd({
    id: "worker",
    friendlyName: "Worker",
    platform: "linux",
    workspacePath: "/srv/workspace",
    sshAddress: "operator@worker",
    updatedAt: "2026-06-27T09:00:00.000Z",
  });
  return dir;
}

describe("fleet ops check", () => {
  test("composes fleet readiness with task suggestions and read-only tmux diagnostics", () => {
    const dir = setupFleet();
    const deadPane: FleetOpsTmuxPane = {
      ref: "ops:1.0",
      session: "ops",
      window: "1",
      pane: "0",
      pane_dead: true,
      current_command: "bash",
      dead_status: 1,
      start_command: "bun run worker",
    };
    try {
      const now = new Date("2026-06-27T12:00:00.000Z");
      const topology = discoverMachineTopology({ includeTailscale: false, limit: null, now });
      const result = getFleetOpsCheck({
        topology,
        machineIds: ["control", "worker"],
        expectedMachines: ["control", "apple03"],
        expectedTmux: [{ target: "%99", label: "ops-pane" }],
        tmuxProbe: (target) => ({
          target,
          exists: false,
          checkedAt: now.toISOString(),
          exitCode: 1,
          stderr: "can't find pane",
        }),
        tmuxList: () => ({ panes: [deadPane], error: null }),
        now,
        maxEvidenceItems: 1,
        maxTaskSuggestions: 2,
      });

      expect(result.kind).toBe("fleet_ops_check");
      expect(result.composed).toMatchObject({
        machine_health: "machine_health",
        routing: "routing",
        loop_preflight: "loop_preflight",
        tmux_diagnostics: "read_only",
        todo_dependency: "none",
      });
      expect(result.issues.map((issue) => issue.classification)).toContain("expected-machine-missing");
      expect(result.issues.map((issue) => issue.classification)).toContain("tmux-dead-pane-detected");
      expect(result.issues.map((issue) => issue.classification)).toContain("tmux-expected-pane-missing");
      expect(result.task_suggestions).toHaveLength(2);
      expect(result.bounds.truncated_task_suggestions).toBeGreaterThan(0);
      expect(result.issues.every((issue) => issue.evidence.length <= 1)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("send-keys");
      expect(JSON.stringify(result)).not.toContain("respawn");
      expect(JSON.stringify(result)).not.toContain("resurrect");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("parses configurable tmux expectations", () => {
    expect(parseFleetOpsTmuxExpectation("control=%1")).toEqual({ machineId: "control", target: "%1" });
    expect(parseFleetOpsTmuxExpectation("%2")).toEqual({ target: "%2" });
  });
});
