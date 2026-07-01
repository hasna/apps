import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../lib/store.js";
import { listToolsForCli } from "./index.js";

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

  test("lists tools through the CLI smoke helper", () => {
    expect(listToolsForCli().map((tool) => tool.name)).toContain("loops_list");
    expect(listToolsForCli().map((tool) => tool.name)).toContain("workflow_validate");
    expect(listToolsForCli().filter((tool) => tool.guarded)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "loop_pause" }),
        expect.objectContaining({ name: "loop_create_command" }),
      ]),
    );
  });

  test("serves list/show/doctor and workflow validation over stdio", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-"));
    roots.push(root);
    const loopId = withLoopDataDir(root, () => {
      const store = new Store();
      try {
        return store.createLoop({
          name: "mcp-smoke",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        }).id;
      } finally {
        store.close();
      }
    });

    const { client, transport } = await connectMcp(root);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("loops_list");
      expect(tools.tools.map((tool) => tool.name)).toContain("loop_create_command");

      const list = textPayload(await client.callTool({ name: "loops_list", arguments: { limit: 10 } })) as {
        loops: Array<{ id: string; name: string }>;
      };
      expect(list.loops.map((loop) => loop.name)).toContain("mcp-smoke");

      const show = textPayload(await client.callTool({ name: "loops_show", arguments: { idOrName: loopId } })) as {
        loop: { id: string; name: string };
      };
      expect(show.loop).toMatchObject({ id: loopId, name: "mcp-smoke" });

      const doctor = textPayload(await client.callTool({ name: "loops_doctor", arguments: {} })) as {
        checks: Array<{ id: string }>;
      };
      expect(doctor.checks.map((check) => check.id)).toContain("data-dir");

      const validation = textPayload(
        await client.callTool({
          name: "workflow_validate",
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
      const result = await client.callTool({ name: "loop_pause", arguments: { idOrName: loopId, confirm: "pause-loop" } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("LOOPS_MCP_ALLOW_MUTATIONS=true");
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
      const badConfirm = await client.callTool({
        name: "loop_pause",
        arguments: { idOrName: seeded.loopId, confirm: "wrong-confirmation" },
      });
      expect(badConfirm.isError).toBe(true);
      expect(JSON.stringify(badConfirm.content)).toContain("pause-loop");

      const paused = textPayload(
        await client.callTool({ name: "loop_pause", arguments: { idOrName: seeded.loopId, confirm: "pause-loop" } }),
      ) as { loop: { status: string } };
      expect(paused.loop.status).toBe("paused");

      const resumed = textPayload(
        await client.callTool({ name: "loop_resume", arguments: { idOrName: seeded.loopId, confirm: "resume-loop" } }),
      ) as { loop: { status: string } };
      expect(resumed.loop.status).toBe("active");

      const scheduled = textPayload(
        await client.callTool({ name: "loop_run_now", arguments: { idOrName: seeded.loopId, confirm: "run-now" } }),
      ) as { scheduledFor: string; loop: { nextRunAt: string; status: string } };
      expect(scheduled.loop.status).toBe("active");
      expect(scheduled.loop.nextRunAt).toBe(scheduled.scheduledFor);

      const commandLoop = textPayload(
        await client.callTool({
          name: "loop_create_command",
          arguments: {
            name: "created-command",
            command: "true",
            schedule: { type: "interval", everyMs: 60_000 },
            confirm: "create-command-loop",
          },
        }),
      ) as { loop: { name: string; description: string; target: { type: string } } };
      expect(commandLoop.loop.name).toBe("created-command");
      expect(commandLoop.loop.description).toContain("Why: keep created-command running");
      expect(commandLoop.loop.description).toContain("runs command true");

      const workflowLoop = textPayload(
        await client.callTool({
          name: "loop_create_workflow",
          arguments: {
            name: "created-workflow",
            workflow: seeded.workflowId,
            schedule: { type: "once", at: "2026-01-02T00:00:00Z" },
            confirm: "create-workflow-loop",
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
});
