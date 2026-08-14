#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../services/authorization.js";
import { isMcpToolInProfile, type Profile } from "../services/registry.js";
import { toErrorEnvelope } from "../types/index.js";
import { APP_VERSION } from "../version.js";
import type { McpToolResult } from "./compact.js";
import { registerStandardTools } from "./tools/standard.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerMemberTools } from "./tools/members.js";
import { registerCapabilityTools } from "./tools/capabilities.js";
import { registerLifecycleTools } from "./tools/lifecycle.js";
import { registerAssignmentTools } from "./tools/assignments.js";
import { registerExportTools } from "./tools/exports.js";

export type ToolHandler = (args: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult;

export interface ToolRegistrar {
  tool(name: string, description: string, schema: Record<string, unknown>, handler: ToolHandler): unknown;
}

export interface ToolContext {
  authCtx: AuthorizationContext;
  shouldRegisterTool: (name: string) => boolean;
  formatError: (error: unknown) => string;
}

// ---- profile filtering ----

export function getProfile(): Profile {
  const env = process.env["WORKFORCE_PROFILE"]?.toLowerCase();
  if (env === "minimal" || env === "standard" || env === "full") return env;
  return "full";
}

export function shouldRegisterTool(toolName: string): boolean {
  return isMcpToolInProfile(toolName, getProfile());
}

// ---- error formatting (canonical {code, message, suggestion}) ----

export function formatError(error: unknown): string {
  return JSON.stringify(toErrorEnvelope(error));
}

// ---- focus (per-agent default entity) ----

const focusMap = new Map<string, { entity_id: string }>();

export function setFocus(agent: string, entityId: string): void {
  focusMap.set(agent, { entity_id: entityId });
}

export function getFocusEntity(agent?: string): string | undefined {
  return agent ? focusMap.get(agent)?.entity_id : undefined;
}

// ---- server ----

export function buildServer(authCtx: AuthorizationContext = SYSTEM_AUTHORIZATION_CONTEXT): McpServer {
  const server = new McpServer({ name: "workforce", version: APP_VERSION });
  const registered = new Set<string>();
  const registerOnce = (name: string): boolean => {
    if (registered.has(name)) return false;
    registered.add(name);
    return true;
  };
  const ctx: ToolContext = {
    authCtx,
    shouldRegisterTool: (name: string) => registerOnce(name) && shouldRegisterTool(name),
    formatError,
  };
  const registrar = server as unknown as ToolRegistrar;

  // The four fleet-standard tools + four storage tools are always registered.
  registerStandardTools(registrar, ctx, { setFocus, getFocusEntity });
  registerStorageTools(registrar, ctx);

  registerMemberTools(registrar, ctx);
  registerCapabilityTools(registrar, ctx);
  registerLifecycleTools(registrar, ctx);
  registerAssignmentTools(registrar, ctx);
  registerExportTools(registrar, ctx);

  return server;
}

// ---- CLI dispatch ----

function hasFlag(...flags: string[]): boolean {
  return flags.some((f) => process.argv.includes(f));
}

function printHelp(): void {
  console.log(`Usage: workforce-mcp [options]

Start the @hasna/workforce MCP server.

Options:
  --stdio          Use stdio transport (default)
  --http           Use Streamable HTTP transport (bearer auth required)
  --port <port>    Use Streamable HTTP on the given port (implies --http)
  -V, --version    Output the version number
  -h, --help       Display help

Environment:
  MCP_STDIO=1                 Force stdio transport
  MCP_HTTP=1                  Use Streamable HTTP transport
  MCP_HTTP_PORT=<port>        HTTP port
  WORKFORCE_PROFILE=<profile> Tool profile filter (minimal|standard|full)
  HASNA_WORKFORCE_MCP_AUTH=off  Disable MCP auth (loopback + local only)`);
}

async function main(): Promise<void> {
  if (hasFlag("--version", "-V")) {
    console.log(APP_VERSION);
    return;
  }
  if (hasFlag("--help", "-h")) {
    printHelp();
    return;
  }

  const { isHttpMode, resolveHttpPort, startHttpServer } = await import("./http.js");
  const portRequested = process.argv.some((arg) => arg === "--port" || arg.startsWith("--port="));
  if (isHttpMode() || portRequested) {
    await startHttpServer(resolveHttpPort());
    return;
  }
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectRun = import.meta.main || process.argv[1]?.endsWith("/mcp/index.ts") || process.argv[1]?.endsWith("/mcp/index.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
}
