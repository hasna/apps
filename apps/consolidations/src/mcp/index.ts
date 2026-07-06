#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { APP_VERSION } from "../version.js";
import { SYSTEM_PRINCIPAL } from "../services/execute.js";
import type { ApiPrincipal } from "../server/auth.js";
import { registerStandardTools } from "./tools/standard.js";
import { registerDomainTools, type Profile } from "./tools/domain.js";

export function getProfile(): Profile {
  const env = process.env["CONSOLIDATIONS_PROFILE"]?.toLowerCase();
  if (env === "minimal" || env === "standard" || env === "full") return env;
  return "full";
}

export interface BuildServerOptions {
  /** Authenticated caller principal (HTTP). Defaults to SYSTEM for local stdio. */
  principal?: ApiPrincipal;
  profile?: Profile;
}

/** Build an MCP server with all tools registered for the caller + profile. */
export function buildServer(options: BuildServerOptions = {}): McpServer {
  const server = new McpServer({ name: "consolidations", version: APP_VERSION });
  const principal = options.principal ?? SYSTEM_PRINCIPAL;
  const profile = options.profile ?? getProfile();
  registerStandardTools(server);
  registerDomainTools(server, { principal, profile });
  return server;
}

function hasFlag(...names: string[]): boolean {
  return process.argv.some((arg) => names.includes(arg));
}

function printHelp(): void {
  console.log(`Usage: consolidations-mcp [options]

Start the @hasna/consolidations MCP server.

Options:
  --stdio          Use stdio transport (default)
  --http           Use Streamable HTTP transport (shared, bearer-auth)
  --port <port>    Use Streamable HTTP on the given port (implies --http)
  -V, --version    output the version number
  -h, --help       display help for command

Environment:
  MCP_STDIO=1                 Force stdio transport
  MCP_HTTP=1                  Use Streamable HTTP transport
  MCP_HTTP_PORT=<port>        HTTP port when using HTTP transport
  CONSOLIDATIONS_PROFILE=...  Tool profile (minimal|standard|full)`);
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

if (import.meta.main) {
  main().catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
}
