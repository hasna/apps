#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { APP_VERSION } from "../version.js";
import { localOwnerPrincipal, type ApiPrincipal } from "../server/auth.js";
import type { Profile } from "../services/registry.js";
import { registerStandardTools } from "./tools/standard.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerDomainTools } from "./tools/domain.js";
import { isHttpMode, resolveHttpPort, startHttpServer } from "./http.js";

export function getProfile(): Profile {
  const env = process.env["FLEET_PROFILE"]?.toLowerCase();
  if (env === "minimal" || env === "standard" || env === "full") return env;
  return "full";
}

/**
 * Build the fleet MCP server for a given caller principal. HTTP transport binds a
 * per-request principal from the bearer token (§5.1a); stdio (local) uses the
 * local owner principal. The four standard tools + four storage tools are always
 * registered; domain tools are filtered by the active profile.
 */
export function buildServer(principal: ApiPrincipal = localOwnerPrincipal(), profile: Profile = getProfile()): McpServer {
  const server = new McpServer({ name: "fleet", version: APP_VERSION });
  registerStandardTools(server, principal);
  registerStorageTools(server, principal);
  registerDomainTools(server, principal, profile);
  return server;
}

function hasFlag(...flags: string[]): boolean {
  return flags.some((f) => process.argv.includes(f));
}

function printHelp(): void {
  console.log(`Usage: fleet-mcp [options]

Start the @hasna/fleet MCP server (read-only AgentOps control tower).

Options:
  --stdio          Use stdio transport (default)
  --http           Use Streamable HTTP transport (bearer auth required, §5.1a)
  --port <port>    HTTP port (default 8889; implies --http)
  -V, --version    output the version number
  -h, --help       display help for command

Environment:
  MCP_HTTP=1                  Use Streamable HTTP transport
  MCP_HTTP_PORT=<port>        HTTP port
  FLEET_PROFILE=<profile>     Tool profile: minimal | standard | full
  HASNA_FLEET_MCP_AUTH=off    Disable /mcp auth (loopback + local mode ONLY)`);
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
  if (isHttpMode()) {
    // Honor an explicit bind host (e.g. docker sets 0.0.0.0 so the published port
    // is reachable). A non-loopback bind forces auth on (mcpAuthRequired, §5.1a).
    const hostname = (process.env["HASNA_FLEET_MCP_BIND_HOST"] || process.env["FLEET_MCP_BIND_HOST"])?.trim();
    await startHttpServer(resolveHttpPort(), hostname ? { hostname } : undefined);
    return;
  }
  // stdio fallback (single-user, local)
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error in fleet MCP server:", err);
    process.exit(1);
  });
}
