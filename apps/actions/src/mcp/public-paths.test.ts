import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ActionsClient } from "../index.js";
import { JsonActionsStore } from "../storage.js";
import type { ActionManifest, ActionRun } from "../types.js";
import { createServer } from "./index.js";
import { TOOLS, type ToolDeps, type ToolDef } from "./tools.js";

function manifest(id: string, bindingKind: "local-shell" | "typescript"): ActionManifest {
  return {
    id,
    name: `Manifest ${id}`,
    version: "1.0.0",
    description: "MCP public-path fixture.",
    inputSchema: { type: "object", required: ["name"] },
    outputSchema: { type: "object", required: ["message"] },
    actor: { types: ["human", "agent"], required: true },
    resource: { type: "local-process", identifiers: ["name"] },
    scope: { level: "local", permissions: ["shell:execute"] },
    riskLevel: "low",
    requiredApprovals: [],
    idempotency: { supported: true, required: false },
    dryRun: { supported: true, default: false },
    confirmation: { title: "Echo input", summaryTemplate: "Echo {{name}}" },
    audit: { eventTypes: ["action.planned", "action.previewed", "action.executed"] },
    evidence: { required: false },
    rollback: { strategy: "none" },
    executorBindings: bindingKind === "local-shell"
      ? [{ kind: "local-shell", command: process.execPath, args: ["-e", "console.log(JSON.stringify({ message: 'shell-ok' }))"], outputMode: "json" }]
      : [{ kind: "typescript", ref: "mcp#none" }],
  };
}

function tool(name: string): ToolDef {
  const found = TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing tool ${name}`);
  return found;
}

async function withDeps<T>(fn: (deps: ToolDeps, dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "actions-mcp-pub-"));
  try {
    const client = new ActionsClient({ store: new JsonActionsStore(dir) });
    return await fn({ client }, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("MCP public paths", () => {
  test("registers a local-shell manifest and runs it with dryRun and approve=true through the tool handlers", async () => {
    await withDeps(async (deps) => {
      const manifestFixture = manifest("mcp.local.echo", "local-shell");
      const registered = await tool("actions_register_manifest").handler(deps, { manifest: manifestFixture });
      expect(registered).toMatchObject({ id: "mcp.local.echo" });

      const dryRun = await tool("actions_run").handler(deps, { actionId: "mcp.local.echo", input: { name: "x" }, dryRun: true, detail: "full" });
      expect((dryRun as ActionRun).status).toBe("previewed");
      expect((dryRun as ActionRun).output).toBeUndefined();

      const executed = await tool("actions_run").handler(deps, {
        actionId: "mcp.local.echo",
        input: { name: "x" },
        approve: true,
        detail: "full",
      });
      expect((executed as ActionRun).status).toBe("succeeded");
      expect((executed as ActionRun).output).toEqual({ message: "shell-ok" });
    });
  });

  test("approve, deny, and execute operate on a planned run through the real tool handlers", async () => {
    await withDeps(async (deps) => {
      const manifestFixture = manifest("mcp.local.approvals", "local-shell");
      await tool("actions_register_manifest").handler(deps, {
        manifest: { ...manifestFixture, requiredApprovals: [{ kind: "manual", count: 1 }] },
      });

      const planned = await tool("actions_run").handler(deps, { actionId: "mcp.local.approvals", input: { name: "x" }, detail: "full" });
      expect((planned as ActionRun).status).toBe("awaiting_approval");

      const approved = await tool("actions_approve").handler(deps, { runId: (planned as ActionRun).id, reason: "reviewed", detail: "full" });
      expect((approved as ActionRun).status).toBe("approved");

      const executed = await tool("actions_execute").handler(deps, { runId: (planned as ActionRun).id, detail: "full" });
      expect((executed as ActionRun).status).toBe("succeeded");

      const deniedCandidate = await tool("actions_run").handler(deps, { actionId: "mcp.local.approvals", input: { name: "y" }, detail: "full" });
      const denied = await tool("actions_deny").handler(deps, { runId: (deniedCandidate as ActionRun).id, reason: "not now", detail: "full" });
      expect((denied as ActionRun).status).toBe("denied");
      expect((denied as ActionRun).error).toBe("not now");
    });
  });

  test("a non-shell manifest yields the exact no-in-process-binding error on the run", async () => {
    await withDeps(async (deps) => {
      await tool("actions_register_manifest").handler(deps, { manifest: manifest("mcp.non.shell", "typescript") });
      const run = await tool("actions_run").handler(deps, { actionId: "mcp.non.shell", input: { name: "x" }, approve: true, detail: "full" });
      // The executor throws inside the client, which records the failure on the run
      // instead of rejecting; the exact error text must survive on run.error.
      expect((run as ActionRun).status).toBe("failed");
      expect((run as ActionRun).error).toBe("Action mcp.non.shell has no executable in-process binding");
    });
  });

  test("the no-actor default is id 'mcp' and type 'agent', overridden by explicit actor args", async () => {
    await withDeps(async (deps) => {
      const manifestFixture = manifest("mcp.actor.default", "local-shell");
      await tool("actions_register_manifest").handler(deps, { manifest: manifestFixture });

      const defaultActor = await tool("actions_run").handler(deps, { actionId: "mcp.actor.default", input: { name: "x" }, dryRun: true, detail: "full" });
      expect((defaultActor as ActionRun).actor).toEqual({ id: "mcp", type: "agent" });

      const explicitActor = await tool("actions_run").handler(deps, {
        actionId: "mcp.actor.default",
        input: { name: "x" },
        dryRun: true,
        actorId: "worker-9",
        actorType: "agent",
        detail: "full",
      });
      expect((explicitActor as ActionRun).actor).toEqual({ id: "worker-9", type: "agent" });
    });
  });

  test("show_manifest and show_run return {error:'not found'} for missing ids", async () => {
    await withDeps(async (deps) => {
      expect(await tool("actions_show_manifest").handler(deps, { actionId: "mcp.missing.manifest" }))
        .toEqual({ error: "not found", id: "mcp.missing.manifest" });
      expect(await tool("actions_show_run").handler(deps, { runId: "missing-run-id" }))
        .toEqual({ error: "not found", id: "missing-run-id" });
    });
  });

  test("a throwing handler is reported as isError with the error text over a live transport", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-mcp-err-"));
    try {
      const server = createServer({ deps: { client: new ActionsClient({ store: new JsonActionsStore(dir) }) } });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test", version: "0.0.0" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      try {
        const called = await client.callTool({
          name: "actions_run",
          arguments: { actionId: "mcp.not.registered", input: {} },
        });
        expect(called.isError).toBe(true);
        const content = called.content as Array<{ type: string; text: string }>;
        expect(content[0]?.text).toContain("Action is not registered in this process: mcp.not.registered");
      } finally {
        await client.close();
        await server.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
