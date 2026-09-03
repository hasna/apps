import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../lib/store.js";
import { listToolsForCli, LOOPS_MCP_TOOLS } from "./index.js";

function cleanEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    HASNA_LOOPS_API_URL: "",
    HASNA_LOOPS_API_KEY: "",
    ...overrides,
  };
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
    // MCP_STDIO=1: the server now defaults to shared Streamable HTTP, so these
    // stdio integration tests must explicitly opt into the stdio transport.
    args: ["run", "src/mcp/index.ts", "--stdio"],
    cwd: process.cwd(),
    env: cleanEnv({ LOOPS_DATA_DIR: dataDir, MCP_STDIO: "1", ...env }),
    stderr: "pipe",
  });
  const client = new Client({ name: "open-loops-mcp-test", version: "0.0.0" });
  await client.connect(transport);
  return { client, transport };
}

describe("Loops MCP server", () => {
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
          labels: ["BrowserPlan", "nightly"],
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        });
        const workflow = store.createWorkflow({
          name: "mcp-inspect-workflow",
          steps: [{ id: "check", target: { type: "command", command: "true" } }],
        });
        const workflowRun = store.createWorkflowRun({ workflow });
        const receipt = store.writeRunReceipt({
          loop_id: loop.id,
          run_id: "mcp-run-receipt",
          machine: "spark01",
          repo: "/workspace/open-loops",
          task_ids: ["task-mcp"],
          status: "succeeded",
          summary: "mcp receipt",
          evidence_paths: ["/tmp/mcp-receipt.json"],
        });
        return { loopId: loop.id, workflowRunId: workflowRun.id, receiptRunId: receipt.run_id };
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

      const list = textPayload(
        await client.callTool({ name: "loops_list", arguments: { limit: 10, labels: ["browserplan", "nightly"] } }),
      ) as {
        loops: Array<{ id: string; name: string; labels: string[] }>;
      };
      expect(list.loops.map((loop) => loop.name)).toContain("mcp-smoke");
      expect(list.loops[0]?.labels).toEqual(["browserplan", "nightly"]);

      const show = textPayload(await client.callTool({ name: "loops_show", arguments: { idOrName: seeded.loopId } })) as {
        loop: { id: string; name: string };
      };
      expect(show.loop).toMatchObject({ id: seeded.loopId, name: "mcp-smoke" });

      const receiptRead = textPayload(
        await client.callTool({ name: "loops_receipt_read", arguments: { run_id: seeded.receiptRunId } }),
      ) as { receipt: { run_id: string; result_ref: string; summary: { stdout_bytes: number; stderr_bytes: number } } };
      expect(receiptRead.receipt).toMatchObject({
        run_id: "mcp-run-receipt",
        result_ref: expect.stringMatching(/^sha256:/),
        summary: { stdout_bytes: 0, stderr_bytes: 0 },
      });
      expect(receiptRead.receipt).not.toHaveProperty("machine");
      expect(receiptRead.receipt.summary).not.toHaveProperty("text");
      expect(receiptRead.receipt).not.toHaveProperty("evidence_paths");

      const receiptList = textPayload(
        await client.callTool({ name: "loops_receipts_list", arguments: { task_id: "task-mcp" } }),
      ) as { receipts: Array<{ run_id: string }> };
      expect(receiptList.receipts.map((receipt) => receipt.run_id)).toEqual(["mcp-run-receipt"]);

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

  test("caps each exposed run output and the aggregate loops_runs MCP response", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-output-cap-"));
    roots.push(root);
    withLoopDataDir(root, () => {
      const store = new Store();
      try {
        const loop = store.createLoop(
          {
            name: "large-output-loop",
            labels: ["large-output"],
            schedule: { type: "interval", everyMs: 60_000 },
            target: { type: "command", command: "true" },
          },
          new Date("2026-07-20T00:00:00.000Z"),
        );
        for (let index = 0; index < 30; index += 1) {
          const scheduledFor = new Date(Date.parse("2026-07-20T00:00:00.000Z") + index * 60_000).toISOString();
          const claim = store.claimRun(loop, scheduledFor, "seed");
          if (!claim) throw new Error(`failed to seed run ${index}`);
          store.finalizeRun(claim.run.id, {
            status: "succeeded",
            finishedAt: new Date(Date.parse(scheduledFor) + 1_000).toISOString(),
            durationMs: 1_000,
            stdout: `stdout-${index}-` + "x".repeat(100_000),
            stderr: `stderr-${index}-` + "y".repeat(100_000),
          });
        }
      } finally {
        store.close();
      }
    });

    const { client, transport } = await connectMcp(root);
    try {
      const result = await client.callTool({
        name: "loops_runs",
        arguments: {
          labels: ["large-output"],
          limit: 500,
          showOutput: true,
          maxOutputChars: 32_000,
        },
      });
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.text ?? "";
      expect(text.length).toBeLessThanOrEqual(128_000);
      expect(text).toContain('"truncated"');
      expect(text).not.toContain("x".repeat(32_001));
      expect(text).not.toContain("y".repeat(32_001));
    } finally {
      await client.close();
      await transport.close();
    }
  });

  test("scrubs legacy stored credentials from MCP run output on canonical and alias tools", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-output-scrub-"));
    roots.push(root);
    const canary = `${String.fromCharCode(115, 107, 45, 97, 110, 116, 45)}AbCdEf1234567890`;
    const seeded = withLoopDataDir(root, () => {
      const store = new Store();
      try {
        const loop = store.createLoop(
          {
            name: "secret-output-loop",
            schedule: { type: "interval", everyMs: 60_000 },
            target: { type: "command", command: "true" },
          },
          new Date("2026-07-20T00:00:00.000Z"),
        );
        const claim = store.claimRun(loop, "2026-07-20T00:00:00.000Z", "seed");
        if (!claim) throw new Error("failed to seed secret output run");
        store.finalizeRun(claim.run.id, {
          status: "succeeded",
          finishedAt: "2026-07-20T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "safe stdout",
          stderr: "safe stderr",
        });
        return { loopId: loop.id, runId: claim.run.id };
      } finally {
        store.close();
      }
    });
    const raw = new Database(join(root, "loops.db"));
    try {
      raw.query("UPDATE loop_runs SET stdout = ?, stderr = ? WHERE id = ?").run(
        `stdout ${canary}`,
        `stderr ${canary}`,
        seeded.runId,
      );
    } finally {
      raw.close();
    }

    const { client, transport } = await connectMcp(root);
    try {
      for (const name of ["loops_runs", "loop_runs"]) {
        const result = textPayload(
          await client.callTool({
            name,
            arguments: { idOrName: seeded.loopId, showOutput: true, maxOutputChars: 32_000 },
          }),
        ) as { runs: Array<{ stdout?: string; stderr?: string }> };
        expect(result.runs[0]?.stdout).toContain("[SCRUBBED]");
        expect(result.runs[0]?.stderr).toContain("[SCRUBBED]");
        expect(JSON.stringify(result)).not.toContain(canary);
      }

      const shown = textPayload(
        await client.callTool({
          name: "loops_show",
          arguments: {
            idOrName: seeded.loopId,
            includeLatestRun: true,
            showOutput: true,
            maxOutputChars: 32_000,
          },
        }),
      ) as { latestRun?: { stdout?: string; stderr?: string } };
      expect(shown.latestRun?.stdout).toContain("[SCRUBBED]");
      expect(shown.latestRun?.stderr).toContain("[SCRUBBED]");
      expect(JSON.stringify(shown)).not.toContain(canary);
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

      const receiptWrite = await client.callTool({
        name: "loops_receipt_write",
        arguments: { loop_id: loopId, run_id: "mcp-denied-receipt", status: "succeeded" },
      });
      expect(receiptWrite.isError).toBe(true);
      expect(JSON.stringify(receiptWrite.content)).toContain("LOOPS_MCP_ALLOW_MUTATIONS=true");

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

  test("archive and unarchive fail closed on ambiguous names while ids stay exact", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-archive-ambiguity-"));
    roots.push(root);
    const seeded = withLoopDataDir(root, () => {
      const store = new Store();
      try {
        const input = {
          name: "mcp-archive-dupe",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" } as const,
          target: { type: "command", command: "true" } as const,
        };
        const first = store.createLoop(input, new Date("2025-12-31T00:00:00Z"));
        const second = store.createLoop(input, new Date("2025-12-31T00:00:01Z"));
        return { firstId: first.id, secondId: second.id, name: input.name };
      } finally {
        store.close();
      }
    });

    const { client, transport } = await connectMcp(root, { LOOPS_MCP_ALLOW_MUTATIONS: "true" });
    try {
      const ambiguousArchive = await client.callTool({
        name: "loops_archive",
        arguments: { idOrName: seeded.name },
      });
      expect(ambiguousArchive.isError).toBe(true);
      expect(textPayload(ambiguousArchive)).toMatchObject({ error: { code: "AMBIGUOUS_NAME" } });
      withLoopDataDir(root, () => {
        const store = new Store();
        try {
          expect(store.getLoop(seeded.firstId)?.archivedAt).toBeUndefined();
          expect(store.getLoop(seeded.secondId)?.archivedAt).toBeUndefined();
        } finally {
          store.close();
        }
      });

      expect(
        (textPayload(await client.callTool({
          name: "loops_archive",
          arguments: { idOrName: seeded.firstId },
        })) as { loop: { id: string } }).loop.id,
      ).toBe(seeded.firstId);
      expect(
        (textPayload(await client.callTool({
          name: "loops_archive",
          arguments: { idOrName: seeded.name },
        })) as { loop: { id: string } }).loop.id,
      ).toBe(seeded.secondId);

      const ambiguousUnarchive = await client.callTool({
        name: "loops_unarchive",
        arguments: { idOrName: seeded.name },
      });
      expect(ambiguousUnarchive.isError).toBe(true);
      expect(textPayload(ambiguousUnarchive)).toMatchObject({ error: { code: "AMBIGUOUS_NAME" } });
      withLoopDataDir(root, () => {
        const store = new Store();
        try {
          expect(store.getLoop(seeded.firstId)?.archivedAt).toBeString();
          expect(store.getLoop(seeded.secondId)?.archivedAt).toBeString();
        } finally {
          store.close();
        }
      });

      expect(
        (textPayload(await client.callTool({
          name: "loops_unarchive",
          arguments: { idOrName: seeded.firstId },
        })) as { loop: { id: string } }).loop.id,
      ).toBe(seeded.firstId);
      expect(
        (textPayload(await client.callTool({
          name: "loops_unarchive",
          arguments: { idOrName: seeded.name },
        })) as { loop: { id: string } }).loop.id,
      ).toBe(seeded.secondId);
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

      const receiptWrite = textPayload(
        await client.callTool({
          name: "loops_receipt_write",
          arguments: {
            loop_id: seeded.loopId,
            run_id: "mcp-written-receipt",
            machine: "spark01",
            repo: "/workspace/open-loops",
            task_ids: ["task-written"],
            status: "succeeded",
            summary: "written over MCP",
            evidence_paths: ["/tmp/mcp-written.json"],
          },
        }),
      ) as { receipt: { run_id: string; result_ref: string; summary: { stdout_bytes: number; stderr_bytes: number } } };
      expect(receiptWrite.receipt).toMatchObject({
        run_id: "mcp-written-receipt",
        result_ref: expect.stringMatching(/^sha256:/),
        summary: { stdout_bytes: 0, stderr_bytes: 0 },
      });
      expect(receiptWrite.receipt).not.toHaveProperty("machine");
      expect(receiptWrite.receipt.summary).not.toHaveProperty("text");
      expect(receiptWrite.receipt).not.toHaveProperty("evidence_paths");

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
            labels: ["BrowserPlan", "nightly"],
          },
        }),
      ) as { loop: { name: string; description: string; labels: string[]; target: { type: string; shell?: boolean } } };
      expect(commandLoop.loop.name).toBe("created-command");
      expect(commandLoop.loop.labels).toEqual(["browserplan", "nightly"]);
      expect(commandLoop.loop.description).toContain("Why: keep created-command running");
      expect(commandLoop.loop.description).toContain("runs command true");
      expect(commandLoop.loop.target.shell).toBe(false);

      const relabeled = textPayload(
        await client.callTool({
          name: "loops_labels_update",
          arguments: { idOrName: "created-command", mode: "add", labels: ["urgent"] },
        }),
      ) as { loop: { labels: string[] } };
      expect(relabeled.loop.labels).toEqual(["browserplan", "nightly", "urgent"]);

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

  test("loops_create_command with a machine pin fails loudly and stores nothing (machines deleted)", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-machine-"));
    roots.push(root);
    const { client, transport } = await connectMcp(root, { LOOPS_MCP_ALLOW_MUTATIONS: "true" });
    try {
      // @hasna/machines was deleted (owner directive, 2026-09-03); the routing
      // consumer is no longer installable, so every machine pin fails loudly
      // rather than persist a NULL pin that leaves the loop claimable by any
      // fleet runner.
      const created = await client.callTool({
        name: "loops_create_command",
        arguments: {
          name: "mcp-pinned",
          command: "true",
          schedule: { type: "once", at: "2026-01-02T00:00:00Z" },
          machine: "mcp-pin-test-machine",
        },
      });
      expect(created.isError).toBe(true);
      expect(JSON.stringify(created.content)).toContain("@hasna/machines has been deleted");
      expect(withLoopDataDir(root, () => new Store().findLoopByName("mcp-pinned"))).toBeUndefined();
    } finally {
      await client.close();
      await transport.close();
    }
  });

  test("loops_create_workflow with a machine pin fails loudly and stores nothing (machines deleted)", async () => {
    // Twin of the loops_create_command machine-pin regression: the workflow
    // create shares commonCreateInput (and therefore resolveLoopMachine), so
    // the same fail-closed contract must hold — with @hasna/machines deleted
    // (owner directive, 2026-09-03) every pin fails the create loudly and
    // stores nothing.
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-workflow-machine-"));
    // Seed the workflow the create resolves, in the same store the MCP process
    // opens (requireWorkflow runs before the machine resolution, so an absent
    // workflow would error as WORKFLOW_NOT_FOUND and never reach the pin path).
    const workflowId = withLoopDataDir(root, () => {
      const store = new Store();
      try {
        return store.createWorkflow({
          name: "mcp-pin-workflow",
          steps: [{ id: "check", target: { type: "command", command: "true" } }],
        }).id;
      } finally {
        store.close();
      }
    });
    const { client, transport } = await connectMcp(root, { LOOPS_MCP_ALLOW_MUTATIONS: "true" });
    try {
      // @hasna/machines was deleted (owner directive, 2026-09-03); the
      // routing consumer is no longer installable, so every machine pin
      // fails loudly rather than persist a NULL pin that leaves the loop
      // claimable by any fleet runner.
      const created = await client.callTool({
          name: "loops_create_workflow",
          arguments: {
            name: "mcp-pinned-workflow-loop",
            workflow: workflowId,
            schedule: { type: "once", at: "2026-01-02T00:00:00Z" },
            machine: "mcp-pin-workflow-machine",
          },
        });
        expect(created.isError).toBe(true);
        expect(JSON.stringify(created.content)).toContain("@hasna/machines has been deleted");
        expect(withLoopDataDir(root, () => new Store().findLoopByName("mcp-pinned-workflow-loop"))).toBeUndefined();
    } finally {
      await client.close();
      await transport.close();
    }
  });

  // Regression: on a cloud-flipped MCP server (HASNA_LOOPS_API_URL/API_KEY set),
  // EVERY store-backed tool must route to the hosted /v1 API — never silently to
  // the on-box sqlite island — and the local-runtime tools (diagnose/health) must
  // fail loudly rather than read the wrong store. These lock the split-brain bug.
  test("cloud-flipped MCP routes receipts to the hosted API and never the local island", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-cloud-receipt-"));
    roots.push(root);
    const requests: Array<{ method: string; path: string }> = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        requests.push({ method: req.method, path: url.pathname });
        if (url.pathname === "/v1/receipts" && req.method === "POST") {
          const now = new Date().toISOString();
          return Response.json(
            {
              receipt: {
                run_id: "cloud-receipt",
                loop_id: "cloud-loop",
                repo: "",
                task_ids: [],
                knowledge_ids: [],
                digest_id: `sha256:${"a".repeat(64)}`,
                started_at: null,
                finished_at: null,
                status: "succeeded",
                exit_code: null,
                summary: { stdout_bytes: 0, stderr_bytes: 0 },
                created_at: now,
                updated_at: now,
              },
            },
            { status: 201 },
          );
        }
        if (url.pathname === "/v1/receipts" && req.method === "GET") {
          const now = new Date().toISOString();
          return Response.json({
            receipts: [{
              run_id: "cloud-receipt",
              loop_id: "cloud-loop",
              repo: "",
              task_ids: [],
              knowledge_ids: [],
              digest_id: `sha256:${"a".repeat(64)}`,
              started_at: null,
              finished_at: null,
              status: "succeeded",
              exit_code: null,
              summary: { stdout_bytes: 0, stderr_bytes: 0 },
              created_at: now,
              updated_at: now,
            }],
          });
        }
        return Response.json({ error: { code: "not_found", message: url.pathname } }, { status: 404 });
      },
    });
    const cloudEnv = {
      HASNA_LOOPS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_LOOPS_API_KEY: "test-bearer-key",
      LOOPS_MCP_ALLOW_MUTATIONS: "true",
    };
    const { client, transport } = await connectMcp(root, cloudEnv);
    try {
      const written = textPayload(
        await client.callTool({
          name: "loops_receipt_write",
          arguments: { loop_id: "cloud-loop", run_id: "cloud-receipt", status: "succeeded" },
        }),
      ) as { receipt: { run_id: string } };
      // The write reached the hosted API (proves ApiStore routing, not local sqlite).
      expect(written.receipt.run_id).toBe("cloud-receipt");
      expect(requests).toContainEqual({ method: "POST", path: "/v1/receipts" });

      const listed = textPayload(
        await client.callTool({ name: "loops_receipts_list", arguments: {} }),
      ) as { receipts: Array<{ run_id: string }> };
      expect(listed.receipts.map((r) => r.run_id)).toEqual(["cloud-receipt"]);
      expect(requests).toContainEqual({ method: "GET", path: "/v1/receipts" });

      // The local on-box island was never touched by the cloud-flipped write.
      const localReceipts = withLoopDataDir(root, () => {
        const store = new Store();
        try {
          return store.listRunReceipts({});
        } finally {
          store.close();
        }
      });
      expect(localReceipts).toEqual([]);
    } finally {
      await client.close();
      await transport.close();
      server.stop(true);
    }
  });

  test("cloud-flipped MCP fails diagnose/health loudly instead of reading the local island", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-mcp-cloud-guard-"));
    roots.push(root);
    // Seed a LOCAL loop so a silent local read would (wrongly) succeed. The guard
    // must fire before any local access, so this loop must never surface.
    withLoopDataDir(root, () => {
      const store = new Store();
      try {
        store.createLoop({
          name: "local-only-loop",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        });
      } finally {
        store.close();
      }
    });
    const cloudEnv = {
      HASNA_LOOPS_API_URL: "http://127.0.0.1:1",
      HASNA_LOOPS_API_KEY: "test-bearer-key",
    };
    const { client, transport } = await connectMcp(root, cloudEnv);
    try {
      for (const name of ["loops_diagnose", "loops_health", "loops_health_scan"] as const) {
        const args = name === "loops_diagnose" ? { idOrName: "local-only-loop" } : {};
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
        const text = JSON.stringify(result.content);
        expect(text).toContain("not available while flipped");
        // It must NOT have silently returned the seeded local loop.
        expect(text).not.toContain("local-only-loop");
      }
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
