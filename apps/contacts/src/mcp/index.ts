#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerContactsDiscoveryTools, registerContactsTools } from "./register-tools.js";
import { registerContactsStorageTools } from "./storage-tools.js";
import { resolveMcpStartupGate } from "./startup-gate.js";
import { isHttpMode, resolveMcpHttpPort, startMcpHttpServer } from "./http.js";
import { resolveContactsMcpProfile, type ContactsMcpProfile } from "./profile.js";

function getServerVersion(): string {
  try {
    const packageJsonPath = join(import.meta.dir, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function buildServer(profile: ContactsMcpProfile = "full"): McpServer {
  const server = new McpServer({ name: "contacts", version: getServerVersion() }, {
    instructions: `Active MCP profile: ${profile}. The default core profile keeps tool-list schemas bounded; set HASNA_CONTACTS_MCP_PROFILE=full only when the complete inventory is required.`,
  });
  registerContactsTools(server, profile);
  registerContactsStorageTools(server, profile);
  if (profile === "core") registerContactsDiscoveryTools(server);
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
       contacts-mcp --mcp-profile <name>  core (default) or full
       contacts-mcp --version             Print the version

options:
  --help, -h          show this help and exit
  --mcp-profile <p>   advertise core (default) or full tool inventory
  --version, -V       print the package version and exit
`;
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

  const profile = resolveContactsMcpProfile(args);

  // FAIL-CLOSED at startup (hasna/apps#1720 validation, round 2): with no
  // credential resolvable through the @hasna/contracts chain there is nothing
  // this hosted-only server could serve, so exit non-zero BEFORE the stdio
  // transport is connected or the HTTP port is bound — an `initialize` request
  // is never answered by an unauthenticated server. A deliberate tier that
  // cannot be honoured (a vault pointer, a profile, an unsafe file) is refused
  // here too, on one line, never as a stack trace. --help/--version stay ahead
  // of the gate; every tool still re-resolves the credential per call.
  const gate = await resolveMcpStartupGate();
  if (!gate.ok) {
    console.error(gate.message);
    process.exit(1);
  }

  if (isHttpMode(args)) {
    startMcpHttpServer({
      name: "contacts",
      port: resolveMcpHttpPort(args),
      buildServer: () => buildServer(profile),
    });
    return;
  }

  const transport = new StdioServerTransport();
  await buildServer(profile).connect(transport);
  console.error("Contacts MCP server running on stdio");
}

export function isDirectMcpEntry(entry = process.argv[1]): boolean {
  if (!entry) return false;
  const normalized = entry.replaceAll("\\", "/");
  return normalized.endsWith("/mcp/index.ts") || normalized.endsWith("/mcp/index.js");
}

if (isDirectMcpEntry()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
