import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  renderAgentReplaySimulationMarkdown,
  simulateAgentReplay,
  simulateAgentReplayFile,
} from "./agent-replay-simulator.js";

function fixture() {
  return {
    schema_version: 1,
    agent_id: "codex",
    task: {
      id: "task-1",
      title: "Replay offline",
      status: "pending",
    },
    plan: {
      id: "plan-1",
      name: "Replay plan",
      status: "active",
      tasks: [{ id: "task-1", title: "Replay offline", status: "pending" }],
    },
    traceability: {
      verifications: [
        { command: "bun test", status: "passed", output_summary: "ok" },
      ],
    },
    runs: {
      items: [
        {
          id: "run-1",
          status: "failed",
          events: [
            { event_type: "started", message: "claimed" },
            { event_type: "progress", message: "approval gate approved: release" },
            { event_type: "failed", message: "tests failed" },
          ],
          commands: [
            { command: "bun test src/lib/agent-replay-simulator.test.ts", status: "failed", output_summary: "1 fail" },
          ],
          files: [
            { path: "src/lib/agent-replay-simulator.ts", status: "modified" },
          ],
          artifacts: [
            { path: "logs/replay.txt", artifact_type: "log", description: "failure log" },
          ],
        },
      ],
    },
    approvals: [
      { gate: "release", status: "approved", note: "reviewed" },
    ],
  };
}

describe("local agent replay simulator", () => {
  test("builds deterministic dry-run snapshots without database access", () => {
    const first = simulateAgentReplay(fixture(), { scenario: "offline-debug" });
    const second = simulateAgentReplay(fixture(), { scenario: "offline-debug" });

    expect(first).toMatchObject({
      schema_version: 1,
      mode: "dry-run",
      mutates_database: false,
      scenario: "offline-debug",
      task: {
        id: "task-1",
        title: "Replay offline",
        initial_status: "pending",
        final_status: "failed",
      },
      plan: {
        id: "plan-1",
        task_count: 1,
      },
      commands: {
        total: 2,
        passed: 1,
        failed: 1,
      },
      approvals: {
        approved: 2,
      },
    });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.snapshot.files).toEqual(["src/lib/agent-replay-simulator.ts"]);
    expect(first.snapshot.artifacts).toEqual(["logs/replay.txt"]);
    expect(first.failures.map((failure) => failure.message)).toEqual(expect.arrayContaining(["tests failed", "1 fail"]));
    expect(first.steps.map((step) => step.type)).toEqual(expect.arrayContaining(["context", "plan", "transition", "command", "file", "artifact", "approval"]));
  });

  test("loads fixture files and renders markdown summaries", () => {
    const dir = mkdtempSync(join(tmpdir(), "todos-replay-"));
    try {
      const path = join(dir, "fixture.json");
      writeFileSync(path, JSON.stringify({ context_pack: fixture() }, null, 2));
      const simulation = simulateAgentReplayFile(path, { agent_id: "takumi" });
      const markdown = renderAgentReplaySimulationMarkdown(simulation);

      expect(simulation.agent_id).toBe("takumi");
      expect(markdown).toContain("# Agent Replay Simulation: Replay offline");
      expect(markdown).toContain("Mutates database: no");
      expect(markdown).toContain("command [failed]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
