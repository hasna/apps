#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../db/database.js";
import { OP_REGISTRY } from "../services/registry.js";
import { LOCAL_DEV_PRINCIPAL } from "../server/principal.js";
import type { ApiPrincipal } from "../server/auth.js";
import { APP_VERSION } from "../version.js";
import { registerDomainTools } from "./tools/domain.js";
import { registerStandardTools } from "./tools/standard.js";
import { registerStorageTools } from "./tools/storage.js";
import { isHttpMode, resolveHttpPort, startHttpServer } from "./http.js";

export type Profile = "minimal" | "standard" | "full";

// Tools always present regardless of profile (§5.5).
const ALWAYS_ON = new Set<string>([
  "register_agent",
  "heartbeat",
  "set_focus",
  "send_feedback",
  "holdings_storage_status",
  "holdings_storage_push",
  "holdings_storage_pull",
  "holdings_storage_sync",
]);

const PROFILE_TOOL_MAP: Record<Profile, Set<string>> = {
  minimal: new Set(OP_REGISTRY.filter((op) => op.profiles.includes("minimal")).map((op) => op.mcpTool)),
  standard: new Set(OP_REGISTRY.filter((op) => op.profiles.includes("standard")).map((op) => op.mcpTool)),
  full: new Set(OP_REGISTRY.filter((op) => op.profiles.includes("full")).map((op) => op.mcpTool)),
};

export function getProfile(): Profile {
  const env = (process.env["HASNA_HOLDINGS_PROFILE"] || process.env["HOLDINGS_PROFILE"])?.toLowerCase();
  if (env === "minimal" || env === "standard" || env === "full") return env;
  return "full";
}

export function shouldRegisterTool(toolName: string): boolean {
  if (ALWAYS_ON.has(toolName)) return true;
  return PROFILE_TOOL_MAP[getProfile()].has(toolName);
}

export interface BuildServerOptions {
  db?: Database;
  principal?: ApiPrincipal;
}

export function buildServer(options: BuildServerOptions = {}): McpServer {
  const db = options.db ?? openDatabase();
  const principal = options.principal ?? LOCAL_DEV_PRINCIPAL;
  const server = new McpServer({ name: "holdings", version: APP_VERSION });

  registerStandardTools(server);
  registerStorageTools(server, { db, principal });
  registerDomainTools(server, { db, principal, shouldRegister: shouldRegisterTool });

  return server;
}

async function main(): Promise<void> {
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(APP_VERSION);
    return;
  }
  if (isHttpMode()) {
    startHttpServer(resolveHttpPort());
    return;
  }
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error in holdings MCP server:", error);
    process.exit(1);
  });
}
