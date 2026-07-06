#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { APP_VERSION } from "../version.js";
import { getOp } from "../services/registry.js";
import type { ToolProfile } from "../services/context.js";
import type { ApiPrincipal } from "../server/auth.js";
import { registerStandardTools } from "./tools/standard.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerDomainTools } from "./tools/domain.js";

export interface BuildServerOptions {
  principal?: ApiPrincipal;
}

export function getProfile(): ToolProfile {
  const env = (process.env["BILLING_PROFILE"] || process.env["HASNA_BILLING_PROFILE"])?.toLowerCase();
  if (env === "minimal" || env === "standard" || env === "full") return env;
  return "full";
}

/** Whether a domain op is enabled under a profile. */
export function domainToolEnabled(opName: string, profile: ToolProfile = getProfile()): boolean {
  const op = getOp(opName);
  return op ? op.profiles.includes(profile) : false;
}

/** Build a fully-wired MCP server. `principal` binds the caller's scopes (HTTP). */
export function buildServer(opts?: BuildServerOptions): McpServer {
  const server = new McpServer({ name: "billing", version: APP_VERSION });
  const profile = getProfile();
  // The 4 standard tools + 4 storage tools are always registered (§5.5).
  registerStandardTools(server);
  registerStorageTools(server, opts?.principal);
  registerDomainTools(server, opts?.principal, (name) => domainToolEnabled(name, profile));
  return server;
}

function hasFlag(...flags: string[]): boolean {
  return flags.some((f) => process.argv.includes(f));
}

function printHelp(): void {
  console.log(`Usage: billing-mcp [options]

Start the @hasna/billing MCP server.

Options:
  --stdio          Use stdio transport (fallback for ad-hoc local clients)
  --http           Use Streamable HTTP transport (shared, per-caller bearer auth)
  --port <port>    HTTP port (implies --http; default 8891)
  -V, --version    output the version number
  -h, --help       display help for command

Environment:
  MCP_STDIO=1                Force stdio transport
  MCP_HTTP=1                 Use Streamable HTTP transport
  MCP_HTTP_PORT=<port>       HTTP port
  BILLING_PROFILE=<profile>  Tool profile filter: minimal|standard|full
  HASNA_BILLING_MCP_AUTH=off Disable MCP bearer auth (loopback + local mode only)`);
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

  const { isHttpMode, isStdioMode, resolveHttpPort, resolveBindHost, startHttpServer } = await import("./http.js");
  if (isHttpMode() && !isStdioMode()) {
    await startHttpServer(resolveHttpPort(), { host: resolveBindHost() });
    return;
  }
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error in billing MCP server:", err);
    process.exit(1);
  });
}
