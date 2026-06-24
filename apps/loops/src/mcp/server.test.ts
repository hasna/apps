import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOpenLoopsMcpServer } from "./server.js";
import { Store } from "../lib/store.js";

async function mcpClient(store: Store) {
  const server = createOpenLoopsMcpServer({ store, runnerId: "mcp-test" });
  const client = new Client({ name: "openloops-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function structured<T>(value: unknown): T {
  const result = value as { structuredContent?: unknown };
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as T;
}

describe("OpenLoops MCP server", () => {
  test("advertises explicit practical tools", async () => {
    const store = new Store(":memory:");
    const { client, server } = await mcpClient(store);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([
        "openloops_archive_workflow",
        "openloops_cancel_workflow_run",
        "openloops_create_loop",
        "openloops_create_workflow",
        "openloops_daemon_status",
        "openloops_delete_loop",
        "openloops_doctor",
        "openloops_get_goal",
        "openloops_get_goal_status",
        "openloops_get_loop",
        "openloops_get_workflow",
        "openloops_inspect_workflow_run",
        "openloops_list_loops",
        "openloops_list_machines",
        "openloops_list_runs",
        "openloops_list_workflow_events",
        "openloops_list_workflow_runs",
        "openloops_list_workflows",
        "openloops_pause_loop",
        "openloops_recover_workflow_run",
        "openloops_resolve_machine",
        "openloops_resume_loop",
        "openloops_run_now",
        "openloops_run_workflow",
        "openloops_stop_loop",
        "openloops_tick",
        "openloops_update_labels",
        "openloops_validate_workflow",
      ]);
      const create = tools.tools.find((tool) => tool.name === "openloops_create_loop");
      expect(create?.inputSchema.type).toBe("object");
      expect(create?.inputSchema.properties).toHaveProperty("schedule");
      expect(create?.inputSchema.properties).toHaveProperty("target");
      expect(create?.inputSchema.properties).toHaveProperty("labels");
    } finally {
      await client.close();
      await server.close();
      store.close();
    }
  });

  test("creates, filters, runs, inspects, labels, pauses, resumes, and deletes loops", async () => {
    const store = new Store(":memory:");
    const { client, server } = await mcpClient(store);
    try {
      const created = structured<{ loop: { name: string; labels: string[] } }>(
        await client.callTool({
          name: "openloops_create_loop",
          arguments: {
            name: "mcp-loop",
            labels: ["BrowserPlan"],
            schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
            target: { type: "command", command: "printf SECRET_OUTPUT", shell: true },
          },
        }),
      );
      expect(created.loop.name).toBe("mcp-loop");
      expect(created.loop.labels).toEqual(["browserplan"]);

      const listed = structured<{ loops: { name: string }[] }>(
        await client.callTool({ name: "openloops_list_loops", arguments: { labels: ["browserplan"] } }),
      );
      expect(listed.loops.map((loop) => loop.name)).toEqual(["mcp-loop"]);
      expect(typeof (listed.loops[0] as { target?: unknown }).target).toBe("string");
      const verboseListed = structured<{ loops: { target: { type: string } }[] }>(
        await client.callTool({ name: "openloops_list_loops", arguments: { labels: ["browserplan"], verbose: true } }),
      );
      expect(verboseListed.loops[0]?.target.type).toBe("command");
      for (const name of ["mcp-loop-b", "mcp-loop-c"]) {
        await client.callTool({
          name: "openloops_create_loop",
          arguments: {
            name,
            labels: ["BrowserPlan"],
            schedule: { type: "once", at: "2026-01-02T00:00:00Z" },
            target: { type: "command", command: "true" },
          },
        });
      }
      const firstPage = structured<{ loops: { id: string }[]; nextCursor?: number; hasMore: boolean }>(
        await client.callTool({ name: "openloops_list_loops", arguments: { labels: ["browserplan"], limit: 1 } }),
      );
      expect(firstPage.loops).toHaveLength(1);
      expect(firstPage.nextCursor).toBe(1);
      expect(firstPage.hasMore).toBe(true);
      const secondPage = structured<{ loops: { id: string }[]; nextCursor?: number; hasMore: boolean }>(
        await client.callTool({ name: "openloops_list_loops", arguments: { labels: ["browserplan"], limit: 1, cursor: firstPage.nextCursor } }),
      );
      expect(secondPage.loops).toHaveLength(1);
      expect(secondPage.loops[0]?.id).not.toBe(firstPage.loops[0]?.id);
      expect(secondPage.hasMore).toBe(true);

      const redactedRun = structured<{ run: { status: string; stdout?: string } }>(
        await client.callTool({ name: "openloops_run_now", arguments: { idOrName: "mcp-loop" } }),
      );
      expect(redactedRun.run.status).toBe("succeeded");
      expect(redactedRun.run.stdout).toContain("[redacted");
      expect(JSON.stringify(redactedRun)).not.toContain("SECRET_OUTPUT");
      const redactedCall = await client.callTool({ name: "openloops_get_loop", arguments: { idOrName: "mcp-loop" } });
      expect(JSON.stringify(redactedCall.content)).not.toContain("SECRET_OUTPUT");

      const runs = structured<{ runs: { loopName: string; stdout?: string }[] }>(
        await client.callTool({
          name: "openloops_list_runs",
          arguments: { labels: ["browserplan"], showOutput: true, maxOutputChars: 6 },
        }),
      );
      expect(runs.runs[0]?.loopName).toBe("mcp-loop");
      expect(runs.runs[0]?.stdout).toContain("[truncated");

      const relabeled = structured<{ loop: { labels: string[] } }>(
        await client.callTool({ name: "openloops_update_labels", arguments: { idOrName: "mcp-loop", mode: "add", labels: ["urgent"] } }),
      );
      expect(relabeled.loop.labels).toEqual(["browserplan", "urgent"]);

      const paused = structured<{ loop: { status: string } }>(
        await client.callTool({ name: "openloops_pause_loop", arguments: { idOrName: "mcp-loop" } }),
      );
      expect(paused.loop.status).toBe("paused");
      const resumed = structured<{ loop: { status: string } }>(
        await client.callTool({ name: "openloops_resume_loop", arguments: { idOrName: "mcp-loop" } }),
      );
      expect(resumed.loop.status).toBe("active");

      const read = structured<{ loop: { name: string }; recentRuns: unknown[] }>(
        await client.callTool({ name: "openloops_get_loop", arguments: { idOrName: "mcp-loop", includeRecentRuns: true } }),
      );
      expect(read.loop.name).toBe("mcp-loop");
      expect(read.recentRuns.length).toBe(1);
      const compactRead = structured<{ loop: { name: string }; recentRuns?: unknown[] }>(
        await client.callTool({ name: "openloops_get_loop", arguments: { idOrName: "mcp-loop" } }),
      );
      expect(compactRead.loop.name).toBe("mcp-loop");
      expect(compactRead.recentRuns).toBeUndefined();

      const deleted = structured<{ removed: boolean }>(
        await client.callTool({ name: "openloops_delete_loop", arguments: { idOrName: "mcp-loop" } }),
      );
      expect(deleted.removed).toBe(true);

      const badAuthProfile = await client.callTool({
        name: "openloops_create_loop",
        arguments: {
          name: "bad-auth-profile",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "agent", provider: "claude", prompt: "test", authProfile: "account001" },
        },
      });
      expect(badAuthProfile.isError).toBe(true);
      expect(JSON.stringify(badAuthProfile.content)).toContain("authProfile");
    } finally {
      await client.close();
      await server.close();
      store.close();
    }
  });

  test("validates workflows and reports daemon status", async () => {
    const store = new Store(":memory:");
    const { client, server } = await mcpClient(store);
    try {
      const validation = structured<{ valid: boolean; workflow: { name: string } }>(
        await client.callTool({
          name: "openloops_validate_workflow",
          arguments: {
            workflow: {
              name: "mcp-workflow",
              steps: [{ id: "status", target: { type: "command", command: "true" } }],
            },
          },
        }),
      );
      expect(validation.valid).toBe(true);
      expect(validation.workflow.name).toBe("mcp-workflow");

      const createdWorkflow = structured<{ workflow: { id: string; name: string } }>(
        await client.callTool({
          name: "openloops_create_workflow",
          arguments: {
            workflow: {
              name: "mcp-workflow",
              steps: [{ id: "status", target: { type: "command", command: "printf WFSECRET", shell: true } }],
            },
          },
        }),
      );
      expect(createdWorkflow.workflow.name).toBe("mcp-workflow");

      const workflowLoop = structured<{ loop: { target: { type: string; workflowId: string } } }>(
        await client.callTool({
          name: "openloops_create_loop",
          arguments: {
            name: "workflow-loop",
            schedule: { type: "once", at: "2999-01-01T00:00:00Z" },
            target: { type: "workflow", workflowId: "mcp-workflow" },
          },
        }),
      );
      expect(workflowLoop.loop.target.workflowId).toBe(createdWorkflow.workflow.id);
      const missingWorkflow = await client.callTool({
        name: "openloops_create_loop",
        arguments: {
          name: "missing-workflow-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "workflow", workflowId: "missing-workflow" },
        },
      });
      expect(missingWorkflow.isError).toBe(true);
      expect(JSON.stringify(missingWorkflow.content)).toContain("workflow not found");

      const workflows = structured<{ workflows: { name: string }[] }>(
        await client.callTool({ name: "openloops_list_workflows", arguments: {} }),
      );
      expect(workflows.workflows.map((workflow) => workflow.name)).toContain("mcp-workflow");
      const workflow = structured<{ workflow: { id: string } }>(
        await client.callTool({ name: "openloops_get_workflow", arguments: { idOrName: "mcp-workflow" } }),
      );
      expect(workflow.workflow.id).toBe(createdWorkflow.workflow.id);

      const workflowRun = structured<{ workflowRun: { id: string; status: string }; steps: { stdout?: string }[] }>(
        await client.callTool({ name: "openloops_run_workflow", arguments: { idOrName: "mcp-workflow" } }),
      );
      expect(workflowRun.workflowRun.status).toBe("succeeded");
      expect(JSON.stringify(workflowRun)).not.toContain("WFSECRET");
      const workflowRuns = structured<{ workflowRuns: { id: string }[] }>(
        await client.callTool({ name: "openloops_list_workflow_runs", arguments: { idOrName: "mcp-workflow" } }),
      );
      expect(workflowRuns.workflowRuns[0]?.id).toBe(workflowRun.workflowRun.id);

      const statusWorkflow = store.createWorkflow({
        name: "status-filter-workflow",
        steps: [{ id: "status", target: { type: "command", command: "true" } }],
      });
      const failedRun = store.createWorkflowRun({ workflow: statusWorkflow });
      store.finalizeWorkflowRun(failedRun.id, "failed", { error: "expected failure" });
      store.createWorkflowRun({ workflow: statusWorkflow });
      const failedRuns = structured<{ workflowRuns: { id: string; status: string }[] }>(
        await client.callTool({
          name: "openloops_list_workflow_runs",
          arguments: { idOrName: "status-filter-workflow", status: "failed", limit: 1 },
        }),
      );
      expect(failedRuns.workflowRuns).toHaveLength(1);
      expect(failedRuns.workflowRuns[0]?.id).toBe(failedRun.id);
      expect(failedRuns.workflowRuns[0]?.status).toBe("failed");

      const inspected = structured<{ workflowRun: { id: string }; steps: unknown[]; events: unknown[] }>(
        await client.callTool({ name: "openloops_inspect_workflow_run", arguments: { runId: workflowRun.workflowRun.id } }),
      );
      expect(inspected.workflowRun.id).toBe(workflowRun.workflowRun.id);
      expect(inspected.steps.length).toBe(1);
      const largeWorkflow = store.createWorkflow({
        name: "large-inspect-workflow",
        steps: Array.from({ length: 60 }, (_, index) => ({
          id: `step-${index}`,
          target: { type: "command" as const, command: "true" },
        })),
      });
      const largeRun = store.createWorkflowRun({ workflow: largeWorkflow });
      const cappedInspect = structured<{ steps: unknown[]; stepsTotal: number; stepsTruncated: boolean }>(
        await client.callTool({ name: "openloops_inspect_workflow_run", arguments: { runId: largeRun.id } }),
      );
      expect(cappedInspect.steps).toHaveLength(50);
      expect(cappedInspect.stepsTotal).toBe(60);
      expect(cappedInspect.stepsTruncated).toBe(true);
      const expandedInspect = structured<{ steps: unknown[]; stepsTruncated: boolean }>(
        await client.callTool({ name: "openloops_inspect_workflow_run", arguments: { runId: largeRun.id, stepsLimit: 60 } }),
      );
      expect(expandedInspect.steps).toHaveLength(60);
      expect(expandedInspect.stepsTruncated).toBe(false);
      const events = structured<{ events: unknown[] }>(
        await client.callTool({ name: "openloops_list_workflow_events", arguments: { runId: workflowRun.workflowRun.id } }),
      );
      expect(events.events.length).toBeGreaterThan(0);
      const eventPage = structured<{ events: unknown[]; nextCursor?: number; hasMore: boolean }>(
        await client.callTool({ name: "openloops_list_workflow_events", arguments: { runId: workflowRun.workflowRun.id, limit: 1 } }),
      );
      expect(eventPage.events).toHaveLength(1);
      expect(eventPage.nextCursor).toBe(1);
      expect(eventPage.hasMore).toBe(true);
      const nextEventPage = structured<{ events: unknown[]; hasMore: boolean }>(
        await client.callTool({
          name: "openloops_list_workflow_events",
          arguments: { runId: workflowRun.workflowRun.id, limit: 1, cursor: eventPage.nextCursor },
        }),
      );
      expect(nextEventPage.events).toHaveLength(1);

      const pendingRun = store.createWorkflowRun({ workflow: store.requireWorkflow("mcp-workflow") });
      const cancelled = structured<{ workflowRun: { status: string } }>(
        await client.callTool({ name: "openloops_cancel_workflow_run", arguments: { runId: pendingRun.id, reason: "test cancel" } }),
      );
      expect(cancelled.workflowRun.status).toBe("cancelled");
      const recoverRun = store.createWorkflowRun({ workflow: store.requireWorkflow("mcp-workflow") });
      store.startWorkflowStepRun(recoverRun.id, "status");
      const recovered = structured<{ recoveredSteps: unknown[] }>(
        await client.callTool({ name: "openloops_recover_workflow_run", arguments: { runId: recoverRun.id, reason: "test recover" } }),
      );
      expect(recovered.recoveredSteps.length).toBe(1);

      const archived = structured<{ workflow: { status: string } }>(
        await client.callTool({ name: "openloops_archive_workflow", arguments: { idOrName: "mcp-workflow" } }),
      );
      expect(archived.workflow.status).toBe("archived");

      const goalLoop = structured<{ loop: { goal: { objective: string } } }>(
        await client.callTool({
          name: "openloops_create_loop",
          arguments: {
            name: "goal-loop",
            schedule: { type: "once", at: "2999-01-01T00:00:00Z" },
            target: { type: "command", command: "true" },
            goal: { objective: "verify from MCP" },
          },
        }),
      );
      expect(goalLoop.loop.goal.objective).toBe("verify from MCP");
      const goal = structured<{ config: { objective: string } }>(
        await client.callTool({ name: "openloops_get_goal", arguments: { idOrName: "goal-loop" } }),
      );
      expect(goal.config.objective).toBe("verify from MCP");

      const runtimeGoal = store.createGoal({ objective: "runtime goal" });
      store.createGoalPlanNodes(
        runtimeGoal.goalId,
        Array.from({ length: 60 }, (_, index) => ({
          key: `node-${index}`,
          objective: index === 0 ? `${"Review compact MCP output. ".repeat(20)}TAIL_MARKER_SHOULD_REQUIRE_VERBOSE` : `node ${index}`,
        })),
      );
      const goalStatus = structured<{ goal: { goalId: string }; nodes: unknown[]; nodesTotal: number; nodesTruncated: boolean }>(
        await client.callTool({ name: "openloops_get_goal_status", arguments: { runId: runtimeGoal.goalId } }),
      );
      expect(goalStatus.goal.goalId).toBe(runtimeGoal.goalId);
      expect(goalStatus.nodes).toHaveLength(50);
      expect(goalStatus.nodesTotal).toBe(60);
      expect(goalStatus.nodesTruncated).toBe(true);
      expect(JSON.stringify(goalStatus)).not.toContain("TAIL_MARKER_SHOULD_REQUIRE_VERBOSE");
      const verboseGoalStatus = structured<{ nodes: { objective: string }[] }>(
        await client.callTool({ name: "openloops_get_goal_status", arguments: { runId: runtimeGoal.goalId, verbose: true, nodesLimit: 60 } }),
      );
      expect(verboseGoalStatus.nodes).toHaveLength(60);
      expect(JSON.stringify(verboseGoalStatus)).toContain("TAIL_MARKER_SHOULD_REQUIRE_VERBOSE");

      await client.callTool({
        name: "openloops_create_loop",
        arguments: {
          name: "tick-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
      });
      const due = structured<{ completed: { loopName: string }[] }>(
        await client.callTool({ name: "openloops_tick", arguments: {} }),
      );
      expect(due.completed.map((run) => run.loopName)).toContain("tick-loop");

      const daemon = structured<{ status: { loops: { total: number }; runs: { total: number } } }>(
        await client.callTool({ name: "openloops_daemon_status", arguments: {} }),
      );
      expect(daemon.status.loops.total).toBeGreaterThan(0);
      expect(daemon.status.runs.total).toBeGreaterThan(0);
    } finally {
      await client.close();
      await server.close();
      store.close();
    }
  });
});
