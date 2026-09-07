#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerContactsTools } from "./register-tools.js";
import { registerContactsStorageTools } from "./storage-tools.js";
import { isHttpMode, resolveMcpHttpPort, startMcpHttpServer } from "./http.js";
import { ContactsClientConfigurationError, resolveContactsClientTransport, type Env } from "../cloud/http-storage.js";

function getServerVersion(): string {
  try {
    const packageJsonPath = join(import.meta.dir, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "contacts", version: getServerVersion() });
  registerContactsTools(server);
  registerContactsStorageTools(server);
  return server;
}

/**
 * Classify early-exit arguments before any http-mode parse, server build, or
 * stdio bind. `--help` / `--version` answer with rc=0 and the MCP server never
 * starts: previously `contacts-mcp --version` fell through to the stdio
 * JSON-RPC loop and printed "running on stdio" instead of the version
 * (hasna/apps#1720 validation, the binds-before-version class).
 */
export function handleEarlyArgs(argv: string[]): "help" | "version" | "start" {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  if (argv.includes("--version") || argv.includes("-V")) return "version";
  return "start";
}

export function mcpUsage(): string {
  return `usage: contacts-mcp                       MCP server over stdio (default)
       contacts-mcp --http [--port <n>]   Streamable-HTTP dev server (loopback)
       contacts-mcp --version             Print the version

options:
  --help, -h          show this help and exit
  --version, -V       print the package version and exit
`;
}

/**
 * The fail-closed startup gate (hasna/apps#1720): the contacts MCP server
 * refuses to RUN unauthenticated, so it resolves its API key and authority
 * through the one @hasna/contracts client chain BEFORE the stdio transport is
 * connected or the HTTP port is bound. Returns `null` when the server may
 * start (a credential resolved for the authority), otherwise a value-free
 * first-line diagnosis naming where the credential should live — the Keychain
 * item, the credentials-file path, then `HASNA_CONTACTS_API_KEY` — never a
 * value. `--help` / `--version` answer ahead of this gate, and once the
 * server is up every tool still re-resolves the credential per request.
 */
export function mcpStartupDiagnosis(env: Env = process.env): string | null {
  try {
    const resolution = resolveContactsClientTransport("contacts", env);
    if (resolution.configured) return null;
    return (
      `CONTACTS_API_NOT_CONFIGURED: ${resolution.issue ?? "No contacts credential resolved."} ` +
      "The contacts MCP server fails closed and never runs unauthenticated; no SQLite or local store is ever opened."
    );
  } catch (error) {
    // Hard refusals — a retired client selector, conflicting or blank aliases,
    // an unsafe credentials file — are themselves the diagnosis.
    if (error instanceof ContactsClientConfigurationError) return error.message;
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const early = handleEarlyArgs(args);
  if (early === "help") {
    console.log(mcpUsage());
    return;
  }
  if (early === "version") {
    console.log(getServerVersion());
    return;
  }

  const diagnosis = mcpStartupDiagnosis();
  if (diagnosis) {
    console.error(diagnosis);
    process.exit(1);
  }

  if (isHttpMode(args)) {
    startMcpHttpServer({
      name: "contacts",
      port: resolveMcpHttpPort(args),
      buildServer,
    });
    return;
  }

  const transport = new StdioServerTransport();
  await buildServer().connect(transport);
  console.error("Contacts MCP server running on stdio");
}

export function isDirectMcpEntry(entry = process.argv[1]): boolean {
  if (!entry) return false;
  const normalized = entry.replaceAll("\\", "/");
  return normalized.endsWith("/mcp/index.ts") || normalized.endsWith("/mcp/index.js");
}

if (isDirectMcpEntry()) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
