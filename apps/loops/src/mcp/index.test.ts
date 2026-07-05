import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../lib/store.js";
import { listToolsForCli, LOOPS_MCP_TOOLS } from "./index.js";

function cleanEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}

function textPayload(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  const entry = content[0];
  if (!entry || entry.type !== "text") throw new Error("expected text MCP content");
  return JSON.parse(entry.text ?? "");
}

function withLoopDataDir<T>(dataDir: string, fn: () => T): T {
  const previous = process.env.LOOPS_DATA_DIR;
  process.env.LOOPS_DATA_DIR = dataDir;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.LOOPS_DATA_DIR;
    else process.env.LOOPS_DATA_DIR = previous;
  }
}

async function connectMcp(
  dataDir: string,
  env: Record<string, string> = {},
): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/mcp/index.ts"],
    cwd: process.cwd(),
    env: cleanEnv({ LOOPS_DATA_DIR: dataDir, ...env }),
    stderr: "pipe",
  });
  const client = new Client({ name: "open-loops-mcp-test", version: "0.0.0" });
  await client.connect(transport);
  return { client, transport };
}

describe("open-loops MCP server", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("lists canonical loops_* tools with aliases through the CLI smoke helper", () => {
    const names = listToolsForCli().map((tool) => tool.name);
    expect(names).toContain("loops_list");
    expect(names).toContain("loops_workflow_validate");
    expect(names).toContain("loops_health");
    expect(names).toContain("loops_health_scan");
    expect(names).toContain("loops_diagnose");
    expect(names).toContain("loops_daemon_status");
    expect(names).toContain("loops_workflow_run_inspect");
    // every advertised name uses the loops_ prefix; legacy names live in aliases
    expect(names.every((name) => name.startsWith("loops_"))).toBe(true);
    const byName = new Map(listToolsForCli().map((tool) => [tool.name, tool]));
    expect(byName.get("loops_runs")?.aliases).toEqual(["loop_runs"]);
    expect(byName.get("loops_pause")?.aliases).toEqual(["loop_pause"]);
    expect(byName.get("loops_daemon_status")?.aliases).toEqual(["daemon_status"]);
    expect(listToolsForCli().filter((tool) => tool.guarded)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "loops_pause", requiresEnv: "LOOPS_MCP_ALLOW_MUTATIONS=true" }),
        expect.objectContaining({ name: "loops_create_command" }),
        expect.objectContaining({ name: "loops_archive" }),
        expect.objectContaining({ name: "loops_unarchive" }),
        expect.objectContaining({ name: "loops_stop" }),
      ]),
    );
    // read tools are never guarded
    for (const tool of LOOPS_MCP_TOOLS) {
      if (tool.readOnly) expect(tool.guarded).toBeUndefined();
    }
  });

  test("serves list/show/doctor/health/diagnose/daemon-status and workflow tools over stdio", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-"));
    roots.push(root);
    const seeded = withLoopDataDir(root, () => {
      const store = new Store();
      try {
        const loop = store.createLoop({
          name: "mcp-smoke",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        });
        const workflow = store.createWorkflow({
          name: "mcp-inspect-workflow",
          steps: [{ id: "check", target: { type: "command", command: "true" } }],
        });
        const workflowRun = store.createWorkflowRun({ workflow });
        return { loopId: loop.id, workflowRunId: workflowRun.id };
      } finally {
        store.close();
      }
    });

    const { client, transport } = await connectMcp(root);
    try {
      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);
      expect(toolNames).toContain("loops_list");
      expect(toolNames).toContain("loops_create_command");
      // legacy names remain registered as deprecated aliases
      expect(toolNames).toContain("loop_runs");
      expect(toolNames).toContain("workflow_validate");

      const list = textPayload(await client.callTool({ name: "loops_list", arguments: { limit: 10 } })) as {
        loops: Array<{ id: string; name: string }>;
      };
      expect(list.loops.map((loop) => loop.name)).toContain("mcp-smoke");

      const show = textPayload(await client.callTool({ name: "loops_show", arguments: { idOrName: seeded.loopId } })) as {
        loop: { id: string; name: string };
      };
      expect(show.loop).toMatchObject({ id: seeded.loopId, name: "mcp-smoke" });

      const doctor = textPayload(await client.callTool({ name: "loops_doctor", arguments: {} })) as {
        checks: Array<{ id: string }>;
      };
      expect(doctor.checks.map((check) => check.id)).toContain("data-dir");

      const health = textPayload(await client.callTool({ name: "loops_health", arguments: {} })) as {
        summary: { loops: number };
        expectations: Array<{ loop: { id: string } }>;
      };
      expect(health.summary.loops).toBe(1);
      expect(health.expectations[0]?.loop.id).toBe(seeded.loopId);

      const scan = textPayload(
        await client.callTool({ name: "loops_health_scan", arguments: { daemon: true, includeStatuses: ["active"] } }),
      ) as { counts: { loops: number; daemonFindings: number }; daemon: { running: boolean } };
      expect(scan.counts.loops).toBe(1);
      expect(scan.daemon.running).toBe(false);
      expect(scan.counts.daemonFindings).toBe(1);

      const diagnose = textPayload(
        await client.callTool({ name: "loops_diagnose", arguments: { idOrName: "mcp-smoke" } }),
      ) as { loop: { id: string }; expectation: { check: { status: string } }; recentRuns: unknown[] };
      expect(diagnose.loop.id).toBe(seeded.loopId);
      expect(diagnose.expectation.check.status).toBe("warn");
      expect(diagnose.recentRuns).toEqual([]);

      const daemon = textPayload(await client.callTool({ name: "loops_daemon_status", arguments: {} })) as {
        running: boolean;
        loops: { total: number };
      };
      expect(daemon.running).toBe(false);
      expect(daemon.loops.total).toBe(1);

      const inspect = textPayload(
        await client.callTool({ name: "loops_workflow_run_inspect", arguments: { runId: seeded.workflowRunId } }),
      ) as { run: { id: string; workflowName: string }; steps: unknown[]; events: unknown[] };
      expect(inspect.run).toMatchObject({ id: seeded.workflowRunId, workflowName: "mcp-inspect-workflow" });
      expect(Array.isArray(inspect.steps)).toBe(true);
      expect(Array.isArray(inspect.events)).toBe(true);

      const missingRun = await client.callTool({ name: "loops_workflow_run_inspect", arguments: { runId: "nope" } });
      expect(missingRun.isError).toBe(true);

      const validation = textPayload(
        await client.callTool({
          name: "loops_workflow_validate",
          arguments: {
            workflow: {
              name: "mcp-workflow",
              steps: [{ id: "check", target: { type: "command", command: "true" } }],
            },
          },
        }),
      ) as { valid: boolean; workflow: { name: string; steps: Array<{ id: string }> } };
      expect(validation.valid).toBe(true);
      expect(validation.workflow.name).toBe("mcp-workflow");
      expect(validation.workflow.steps.map((step) => step.id)).toEqual(["check"]);

      // the deprecated alias resolves to the same handler
      const aliasValidation = textPayload(
        await client.callTool({
          name: "workflow_validate",
          arguments: {
            workflow: {
              name: "mcp-workflow-alias",
              steps: [{ id: "check", target: { type: "command", command: "true" } }],
            },
          },
        }),
      ) as { valid: boolean };
      expect(aliasValidation.valid).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  });

  test("rejects invalid tool input through MCP schema validation", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-schema-"));
    roots.push(root);
    const { client, transport } = await connectMcp(root);
    try {
      const result = await client.callTool({ name: "loops_show", arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("idOrName");
    } finally {
      await client.close();
      await transport.close();
    }
  });

  test("keeps mutation tools disabled unless the server process opts in", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-mutations-disabled-"));
    roots.push(root);
    const loopId = withLoopDataDir(root, () => {
      const store = new Store();
      try {
        return store.createLoop({
          name: "disabled-mutation",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        }).id;
      } finally {
        store.close();
      }
    });

    const { client, transport } = await connectMcp(root);
    try {
      const result = await client.callTool({ name: "loops_pause", arguments: { idOrName: loopId } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("LOOPS_MCP_ALLOW_MUTATIONS=true");

      // workflow_validate preflight spawns credential-resolution subprocesses
      // from model-controlled input, so it shares the mutation gate.
      const preflight = await client.callTool({
        name: "loops_workflow_validate",
        arguments: {
          preflight: true,
          workflow: {
            name: "preflight-gated",
            steps: [{ id: "check", target: { type: "command", command: "true" } }],
          },
        },
      });
      expect(preflight.isError).toBe(true);
      expect(JSON.stringify(preflight.content)).toContain("LOOPS_MCP_ALLOW_MUTATIONS=true");

      // plain validation (no preflight) stays available without the opt-in
      const validation = textPayload(
        await client.callTool({
          name: "loops_workflow_validate",
          arguments: {
            workflow: {
              name: "still-valid",
              steps: [{ id: "check", target: { type: "command", command: "true" } }],
            },
          },
        }),
      ) as { valid: boolean };
      expect(validation.valid).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  });

  test("executes guarded mutation tools when explicitly enabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-mutations-"));
    roots.push(root);
    const seeded = withLoopDataDir(root, () => {
      const store = new Store();
      try {
        const loop = store.createLoop({
          name: "mutable-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        });
        const workflow = store.createWorkflow({
          name: "mcp-workflow-target",
          steps: [{ id: "check", target: { type: "command", command: "true" } }],
        });
        return { loopId: loop.id, workflowId: workflow.id };
      } finally {
        store.close();
      }
    });

    const { client, transport } = await connectMcp(root, { LOOPS_MCP_ALLOW_MUTATIONS: "true" });
    try {
      const paused = textPayload(
        await client.callTool({ name: "loops_pause", arguments: { idOrName: seeded.loopId } }),
      ) as { loop: { status: string } };
      expect(paused.loop.status).toBe("paused");

      // the deprecated alias shares the guarded handler
      const aliasResumed = textPayload(
        await client.callTool({ name: "loop_resume", arguments: { idOrName: seeded.loopId } }),
      ) as { loop: { status: string } };
      expect(aliasResumed.loop.status).toBe("active");

      const scheduled = textPayload(
        await client.callTool({ name: "loops_run_now", arguments: { idOrName: seeded.loopId } }),
      ) as {
        scheduledFor: string;
        loop: { nextRunAt: string; status: string };
        daemon: { running: boolean };
        warning?: string;
      };
      expect(scheduled.loop.status).toBe("active");
      expect(scheduled.loop.nextRunAt).toBe(scheduled.scheduledFor);
      // no daemon runs in this data dir: run-now is schedule-only and must say so
      expect(scheduled.daemon.running).toBe(false);
      expect(scheduled.warning).toContain("daemon is not running");

      const stopped = textPayload(
        await client.callTool({ name: "loops_stop", arguments: { idOrName: seeded.loopId } }),
      ) as { loop: { status: string; nextRunAt?: string } };
      expect(stopped.loop.status).toBe("stopped");
      expect(stopped.loop.nextRunAt).toBeUndefined();

      const archived = textPayload(
        await client.callTool({ name: "loops_archive", arguments: { idOrName: seeded.loopId } }),
      ) as { loop: { archivedAt?: string } };
      expect(archived.loop.archivedAt).toBeDefined();

      // archived loops are frozen by the store guard and surface the coded error
      const pauseArchived = await client.callTool({ name: "loops_pause", arguments: { idOrName: seeded.loopId } });
      expect(pauseArchived.isError).toBe(true);
      expect(textPayload(pauseArchived)).toMatchObject({ error: { code: "LOOP_ARCHIVED" } });

      const runArchived = await client.callTool({ name: "loops_run_now", arguments: { idOrName: seeded.loopId } });
      expect(runArchived.isError).toBe(true);
      expect(textPayload(runArchived)).toMatchObject({ error: { code: "LOOP_ARCHIVED" } });

      const unarchived = textPayload(
        await client.callTool({ name: "loops_unarchive", arguments: { idOrName: seeded.loopId } }),
      ) as { loop: { archivedAt?: string; status: string } };
      expect(unarchived.loop.archivedAt).toBeUndefined();

      const missing = await client.callTool({ name: "loops_pause", arguments: { idOrName: "no-such-loop" } });
      expect(missing.isError).toBe(true);
      expect(textPayload(missing)).toMatchObject({ error: { code: "LOOP_NOT_FOUND" } });

      const commandLoop = textPayload(
        await client.callTool({
          name: "loops_create_command",
          arguments: {
            name: "created-command",
            command: "true",
            schedule: { type: "interval", everyMs: 60_000 },
          },
        }),
      ) as { loop: { name: string; description: string; target: { type: string; shell?: boolean } } };
      expect(commandLoop.loop.name).toBe("created-command");
      expect(commandLoop.loop.description).toContain("Why: keep created-command running");
      expect(commandLoop.loop.description).toContain("runs command true");
      expect(commandLoop.loop.target.shell).toBe(false);

      // shell targets are forbidden over MCP: schema-level rejection
      const shellRejected = await client.callTool({
        name: "loops_create_command",
        arguments: {
          name: "created-shell",
          command: "echo hi | cat",
          shell: true,
          schedule: { type: "interval", everyMs: 60_000 },
        },
      });
      expect(shellRejected.isError).toBe(true);
      expect(JSON.stringify(shellRejected.content)).toContain("shell");

      const workflowLoop = textPayload(
        await client.callTool({
          name: "loops_create_workflow",
          arguments: {
            name: "created-workflow",
            workflow: seeded.workflowId,
            schedule: { type: "once", at: "2026-01-02T00:00:00Z" },
          },
        }),
      ) as { loop: { name: string; description: string; target: { type: string; workflowId: string } } };
      expect(workflowLoop.loop.name).toBe("created-workflow");
      expect(workflowLoop.loop.description).toContain("runs workflow");
      expect(workflowLoop.loop.target).toMatchObject({ type: "workflow", workflowId: seeded.workflowId });
    } finally {
      await client.close();
      await transport.close();
    }
  });

  test("resume recomputes nextRunAt for a stopped loop so it can become due again", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-resume-stopped-"));
    roots.push(root);
    const loopId = withLoopDataDir(root, () => {
      const store = new Store();
      try {
        const loop = store.createLoop({
          name: "mcp-resume-stopped",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        });
        // Stop it: next_run_at is cleared, mirroring the reported bug's setup.
        store.updateLoop(loop.id, { status: "stopped", nextRunAt: undefined });
        return loop.id;
      } finally {
        store.close();
      }
    });

    const { client, transport } = await connectMcp(root, { LOOPS_MCP_ALLOW_MUTATIONS: "true" });
    try {
      const resumed = textPayload(
        await client.callTool({ name: "loops_resume", arguments: { idOrName: loopId } }),
      ) as { loop: { status: string; nextRunAt?: string } };
      expect(resumed.loop.status).toBe("active");
      // Regression: resume left nextRunAt null, so dueLoops never picked it up.
      expect(resumed.loop.nextRunAt).toBeString();
    } finally {
      await client.close();
      await transport.close();
    }
  });
});
