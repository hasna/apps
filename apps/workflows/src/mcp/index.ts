#!/usr/bin/env bun
/**
 * workflows-mcp — the MCP server surface of @hasna/workflows.
 *
 * Answers --version/--help before starting, then serves a minimal stdio
 * JSON-RPC 2.0 MCP server backed by WorkflowsService. Later slices extend
 * the tool registry with the graph language, store, and daemon tools.
 */
import { createInterface } from "node:readline";
import { callWorkflowTool, workflowsTools } from "../agent-tools.js";
import { createWorkflowsService, packageVersion } from "../service.js";

const HELP_TEXT = `workflows-mcp — MCP server for @hasna/workflows

Usage:
  workflows-mcp [--version] [--help]

Speaks the MCP protocol over stdio. Tools:
  workflows_version  report the installed version
  workflows_health   report service health
  workflows_ready    report service readiness`;

const argv = process.argv.slice(2);
if (argv.includes("--version") || argv.includes("-v")) {
  console.log(packageVersion());
  process.exit(0);
}
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP_TEXT);
  process.exit(0);
}

interface RpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function respond(id: number | string | null, result: unknown): void {
  if (id === null || id === undefined) return; // notifications carry no id
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function respondError(id: number | string | null, code: number, message: string): void {
  if (id === null || id === undefined) return;
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

const service = createWorkflowsService();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line: string) => {
  const trimmed = line.trim();
  if (trimmed === "") return;
  let msg: RpcRequest;
  try {
    msg = JSON.parse(trimmed) as RpcRequest;
  } catch {
    return; // malformed frames are ignored; never echo back content
  }
  const method = msg.method ?? "";
  if (method === "initialize") {
    respond(msg.id ?? null, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "workflows-mcp", version: packageVersion() },
    });
    return;
  }
  if (method.startsWith("notifications/")) return; // no response to notifications
  if (method === "ping") {
    respond(msg.id ?? null, {});
    return;
  }
  if (method === "tools/list") {
    respond(msg.id ?? null, { tools: workflowsTools(service) });
    return;
  }
  if (method === "tools/call") {
    const params = msg.params ?? {};
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments as Record<string, unknown> | undefined) ?? {};
    try {
      respond(msg.id ?? null, callWorkflowTool(service, name, args));
    } catch (err) {
      respond(msg.id ?? null, {
        content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }],
        isError: true,
      });
    }
    return;
  }
  respondError(msg.id ?? null, -32601, `Method not found: ${method}`);
});
