#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { register as registerSessions } from "./sessions.js";
import { register as registerActions } from "./actions.js";
import { register as registerCapture } from "./capture.js";
import { register as registerNetwork } from "./network.js";
import { register as registerData } from "./data.js";
import { register as registerTui } from "./tui.js";
import { register as registerExtension } from "./extension.js";
import { register as registerKernel } from "./kernel.js";
import { registerStorageTools } from "./storage.js";
import { isStdioMode, resolveMcpHttpPort, startMcpHttpServer } from "./http.js";

const _pkg = JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8")) as { version: string };

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "@hasna/browser",
    version: _pkg.version,
  });

  registerSessions(server);
  registerActions(server);
  registerCapture(server);
  registerNetwork(server);
  registerData(server);
  registerTui(server);
  registerExtension(server);
  registerKernel(server);
  registerStorageTools(server);

  return server;
}

function hasFlag(...flags: string[]): boolean {
  return process.argv.some((arg) => flags.includes(arg));
}

function printHelp(): void {
  process.stdout.write(
    `Usage: browser-mcp [options]

Browser MCP server (stdio transport by default)

Options:
  --http           Serve MCP over Streamable HTTP (127.0.0.1)
  --port <number>  HTTP port (default: 8851, env: MCP_HTTP_PORT)
  -h, --help       Show help
  -V, --version    Show version
`,
  );
}

async function logStartup(server: McpServer): Promise<void> {
  const startupToolCount = Object.keys((server as any)._registeredTools ?? {}).length;
  const { getDataDir } = await import("../db/schema.js");
  console.error(
    `@hasna/browser v${_pkg.version} — ${startupToolCount} tools | data: ${getDataDir()}`,
  );
}

async function main(): Promise<void> {
  if (hasFlag("--help", "-h")) {
    printHelp();
    return;
  }

  if (hasFlag("--version", "-V")) {
    process.stdout.write(`${_pkg.version}\n`);
    return;
  }

  if (isStdioMode()) {
    const server = buildServer();
    await logStartup(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  const handle = await startMcpHttpServer(buildServer, {
    port: resolveMcpHttpPort(),
  });
  await logStartup(buildServer());
  process.on("SIGINT", () => {
    void handle.close().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void handle.close().finally(() => process.exit(0));
  });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
  });
}
