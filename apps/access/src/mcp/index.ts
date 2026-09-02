#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { APP_VERSION } from "../version.js";
import { AccessClient } from "../client/index.js";
import type { ClientEnv } from "../client/config.js";
import type { DomainExecutor } from "./tools/shared.js";
import { registerStandardTools } from "./tools/standard.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerIdentityTools } from "./tools/identities.js";
import { registerCredentialTools } from "./tools/credentials.js";
import { registerScopeTools } from "./tools/scopes.js";
import { registerElevationTools } from "./tools/elevations.js";
import { registerReviewTools } from "./tools/reviews.js";
import { registerRequestTools } from "./tools/requests.js";
import { registerRevocationTools } from "./tools/revocations.js";
import { registerTokenTools } from "./tools/tokens.js";
import { registerAuditTools } from "./tools/audit.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../services/authorization.js";
import { isHttpMode, isStdioMode, resolveHttpPort, startHttpServer } from "./http.js";

export { shouldRegisterTool, getProfile } from "./profile.js";
export { formatError } from "./compact.js";

/**
 * Build a fully-wired MCP server (all tools, subject to the profile filter),
 * bound to the CALLER's AuthorizationContext so every domain/storage tool
 * enforces that caller's scopes + entity/org authorization (§5.1a). The HTTP
 * transport builds one legacy server per authenticated request. This factory
 * never constructs a process-owner HTTPS client; HTTP auth migration is separate.
 */
export function buildServer(context: AuthorizationContext = SYSTEM_AUTHORIZATION_CONTEXT): McpServer {
  return createServer(context);
}

/** Only stdio's domain tools use the snapshotted, validated HTTPS authority. */
export function buildStdioServer(env: ClientEnv = process.env, fetcher: typeof fetch = fetch): McpServer {
  const client = new AccessClient(env, fetcher);
  return createServer(SYSTEM_AUTHORIZATION_CONTEXT, (operation, input) => client.runOperation(operation, input));
}

function createServer(context: AuthorizationContext, execute?: DomainExecutor): McpServer {
  const server = new McpServer({ name: "access", version: APP_VERSION });
  // Always-on: the four fleet-standard tools + the four storage tools.
  registerStandardTools(server);
  registerStorageTools(server, context);
  // Domain tools use HTTPS only for the explicit stdio executor. The eight
  // standard/storage tools above retain their legacy contracts and local graph.
  registerIdentityTools(server, context, execute);
  registerCredentialTools(server, context, execute);
  registerScopeTools(server, context, execute);
  registerElevationTools(server, context, execute);
  registerReviewTools(server, context, execute);
  registerRequestTools(server, context, execute);
  registerRevocationTools(server, context, execute);
  registerTokenTools(server, context, execute);
  registerAuditTools(server, context, execute);
  return server;
}

async function main(): Promise<void> {
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(APP_VERSION);
    return;
  }
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("access-mcp [--http [--port <n>]] [--stdio] [--version]");
    return;
  }
  if (isHttpMode() && !isStdioMode()) {
    await startHttpServer(resolveHttpPort());
    return;
  }
  const server = buildStdioServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
