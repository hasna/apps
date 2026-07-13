#!/usr/bin/env bun
/**
 * sandboxes MCP server (bin: sandboxes-mcp). Like the CLI and SDK, it is a pure
 * /v1 API client — every tool call proxies to https://<host>/v1 with the
 * configured API key. No local DB, no provider SDK on this surface.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { SandboxesClient, SandboxesApiError } from "./sdk.js";

const VERSION = "1.0.0-rc.1";

const TOOLS: Tool[] = [
  { name: "sandboxes_health", description: "Public service health.", inputSchema: { type: "object", properties: {} } },
  { name: "sandboxes_whoami", description: "Resolved tenant/user/scopes for the configured key.", inputSchema: { type: "object", properties: {} } },
  {
    name: "sandboxes_validate",
    description: "Validate a sandboxes document (sandbox-spec, create-sandbox, fence, etc.).",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string" }, document: { type: "object" } },
      required: ["kind", "document"],
    },
  },
  { name: "sandboxes_adapters", description: "List provider adapters and which have live credentials.", inputSchema: { type: "object", properties: {} } },
  {
    name: "sandboxes_allocate",
    description: "Allocate a sandbox for the caller's tenant (fake adapter activates; real adapters gated for R2).",
    inputSchema: {
      type: "object",
      properties: { adapter: { type: "string", enum: ["fake", "e2b", "daytona_cloud"] }, spec: { type: "object" } },
      required: ["adapter", "spec"],
    },
  },
  {
    name: "sandboxes_list",
    description: "List the caller tenant's sandbox allocations.",
    inputSchema: { type: "object", properties: { state: { type: "string" }, limit: { type: "number" } } },
  },
  {
    name: "sandboxes_get",
    description: "Get one allocation by id (404 if it belongs to another tenant).",
    inputSchema: { type: "object", properties: { allocation_id: { type: "string" } }, required: ["allocation_id"] },
  },
  {
    name: "sandboxes_destroy",
    description: "Mark an allocation destroyed.",
    inputSchema: { type: "object", properties: { allocation_id: { type: "string" } }, required: ["allocation_id"] },
  },
  {
    name: "sandboxes_checkpoint_create",
    description: "Create a checkpoint (optional base64 payload stored under the tenant's S3 prefix).",
    inputSchema: {
      type: "object",
      properties: { allocation_id: { type: "string" }, label: { type: "string" }, payload_base64: { type: "string" } },
      required: ["allocation_id"],
    },
  },
  {
    name: "sandboxes_checkpoint_list",
    description: "List checkpoints for an allocation.",
    inputSchema: { type: "object", properties: { allocation_id: { type: "string" } }, required: ["allocation_id"] },
  },
];

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const body =
    error instanceof SandboxesApiError
      ? { code: error.code, message: error.message, status: error.status, details: error.details }
      : { code: "internal_failure", message: error instanceof Error ? error.message : "failed" };
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError: true };
}

async function dispatch(client: SandboxesClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "sandboxes_health":
      return client.health();
    case "sandboxes_whoami":
      return client.whoami();
    case "sandboxes_validate":
      return client.validate(String(args["kind"]), args["document"]);
    case "sandboxes_adapters":
      return client.listAdapters();
    case "sandboxes_allocate":
      return client.allocate({ adapter: args["adapter"] as never, spec: args["spec"] as never });
    case "sandboxes_list":
      return client.listSandboxes({
        ...(args["state"] ? { state: args["state"] as never } : {}),
        ...(args["limit"] !== undefined ? { limit: Number(args["limit"]) } : {}),
      });
    case "sandboxes_get":
      return client.getSandbox(String(args["allocation_id"]));
    case "sandboxes_destroy":
      return client.destroySandbox(String(args["allocation_id"]));
    case "sandboxes_checkpoint_create":
      return client.createCheckpoint(String(args["allocation_id"]), {
        ...(typeof args["label"] === "string" ? { label: args["label"] } : {}),
        ...(typeof args["payload_base64"] === "string" ? { payload_base64: args["payload_base64"] } : {}),
      });
    case "sandboxes_checkpoint_list":
      return client.listCheckpoints(String(args["allocation_id"]));
    default:
      throw new SandboxesApiError(404, "not_found", `Unknown tool ${name}`);
  }
}

export function createMcpServer(client: SandboxesClient = new SandboxesClient()): Server {
  const server = new Server({ name: "sandboxes", version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      return textResult(await dispatch(client, request.params.name, args));
    } catch (error) {
      return errorResult(error);
    }
  });
  return server;
}

async function main(): Promise<void> {
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  void main();
}
