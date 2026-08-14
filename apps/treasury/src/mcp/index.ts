#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { APP_VERSION } from "../version.js";
import { isApiAuthConfigured, type ApiPrincipal } from "../server/auth.js";
import { resolveStorageMode } from "../config.js";
import { OPS, type Profile } from "../services/registry.js";
import { registerStandardTools } from "./tools/standard.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerDomainTools } from "./tools/domain.js";
import { isHttpMode, resolveHttpPort, startHttpServer } from "./http.js";

const ALWAYS_ON = new Set([
  "register_agent",
  "heartbeat",
  "set_focus",
  "send_feedback",
  "treasury_storage_status",
  "treasury_storage_push",
  "treasury_storage_pull",
  "treasury_storage_sync",
]);

export function getProfile(): Profile {
  const env = process.env["TREASURY_PROFILE"]?.toLowerCase();
  if (env === "minimal" || env === "standard" || env === "full") return env;
  return "full";
}

/** Whether a tool is registered under the active profile (standard/storage always on). */
export function shouldRegisterTool(toolName: string, profile: Profile = getProfile()): boolean {
  if (ALWAYS_ON.has(toolName)) return true;
  const op = OPS.find((o) => o.name === toolName);
  return op ? op.profiles.includes(profile) : false;
}

/**
 * Full-scope local owner principal (stdio fallback + auth-off loopback dev only).
 * It carries `bypass: true` so it has the SAME authority as the CLI's
 * localOwnerContext (SYSTEM bypass): without it, entity-scoped ops would fail
 * deny-by-default (no entity_ids) and the local-owner surface could not read or
 * write any entity-anchored data. Scoped bearer credentials never get bypass.
 */
export function localOwnerPrincipal(): ApiPrincipal {
  return {
    credential_id: "local-owner",
    credential_type: "api_key",
    actor_id: "local-owner",
    roles: ["owner"],
    scopes: ["treasury:read", "treasury:write", "treasury:recommend", "treasury:export", "treasury:admin", "storage:admin"],
    bypass: true,
  };
}

/**
 * Build a fully-wired MCP server bound to a specific authenticated caller
 * principal. Domain tools authorize against THIS principal's scopes + entity
 * set — never a SYSTEM bypass on the transport (§5.1a).
 */
export function buildServer(principal: ApiPrincipal, profile: Profile = getProfile()): McpServer {
  const server = new McpServer({ name: "treasury", version: APP_VERSION });
  registerStandardTools(server, principal);
  registerStorageTools(server, principal);
  registerDomainTools(server, principal, profile);
  return server;
}

/**
 * Fail-closed guard for the stdio transport (BUILD-SPEC §5.1a). Unlike the HTTP
 * transport, stdio has no bearer channel: it always runs as the SYSTEM-bypass
 * localOwnerPrincipal(). That is only acceptable in local mode with auth off —
 * the SAME condition mcpAuthDisabled() enforces for the HTTP loopback dev path.
 * In cloud mode (or when API credentials are configured) stdio would hand a
 * caller full unauthenticated bypass access to production Postgres, so we refuse
 * to start instead of silently granting it.
 */
export function assertStdioSafety(): void {
  if (resolveStorageMode() === "cloud") {
    throw new Error(
      "Refusing to start treasury-mcp stdio transport in cloud mode: stdio grants an " +
        "unauthenticated SYSTEM-bypass local-owner principal with full access to the cloud " +
        "Postgres. Use --http with HASNA_TREASURY_API_CREDENTIALS, or run stdio only in local mode.",
    );
  }
  if (isApiAuthConfigured()) {
    throw new Error(
      "Refusing to start treasury-mcp stdio transport while API credentials are configured: " +
        "stdio cannot authenticate a bearer and would bypass them. Use --http instead.",
    );
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(APP_VERSION);
    return;
  }
  if (isHttpMode()) {
    await startHttpServer(resolveHttpPort());
    return;
  }
  // stdio fallback for ad-hoc external clients — local mode, auth off only.
  assertStdioSafety();
  const server = buildServer(localOwnerPrincipal());
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error in treasury MCP server:", err);
    process.exit(1);
  });
}
