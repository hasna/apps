#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getPackageVersion } from "../lib/package-version.js";
import { resolveConfigStore } from "../data/config-store.js";
import { buildServer } from "./server.js";
import { isStdioMode, resolveHttpPort, startMcpHttpServer } from "./http.js";

async function main() {
  const argv = process.argv.slice(2);

  // Binds-before-version class (todos row 7e5f8f3d): --version/--help must
  // answer BEFORE any transport resolution or bind. They previously fell
  // through and started the shared HTTP server (:8853) with no output.
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(getPackageVersion());
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Usage: configs-mcp [options]

MCP server for @hasna/instructions (Streamable HTTP by default; --stdio to select stdio).

Options:
  -V, --version  output the version number
  -h, --help     display help for command
  --claude       register with Claude Code (stdio, user scope)
  --http         explicitly select Streamable HTTP transport
  --stdio        explicitly select stdio transport
  --port <n>     HTTP port (default: 8853)`);
    return;
  }

  if (argv.includes("--claude")) {
    const proc = Bun.spawn(
      ["claude", "mcp", "add", "--transport", "stdio", "--scope", "user", "configs", "--", "configs-mcp"],
      { stdout: "inherit", stderr: "inherit" }
    );
    await proc.exited;
    process.exit(0);
  }

  // Fail closed before serving (owner directive 2026-09-04): every tool routes
  // through the Store, so with no hosted credential and no explicit local
  // opt-in this server must refuse to start with a non-zero exit — never
  // silently serve the on-box SQLite store. Resolving here also constructs
  // nothing (LocalConfigStore opens its database lazily), so no local file is
  // created on the failure path.
  try {
    resolveConfigStore();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (isStdioMode(argv)) {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  const port = resolveHttpPort(argv);
  const { port: boundPort } = await startMcpHttpServer(port);
  console.error(`configs-mcp HTTP listening on http://127.0.0.1:${boundPort}/mcp`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
}

export { buildServer } from "./server.js";
