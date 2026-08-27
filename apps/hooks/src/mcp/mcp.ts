#!/usr/bin/env bun
/**
 * hooks-mcp — the standalone MCP server bin (four-surface release gate:
 * CLI, MCP bin, -serve, ./sdk).
 *
 * Answers --version/--help BEFORE any bind or store open (the
 * binds-before-help class, todos row dc92977d; release-review P1), then
 * starts the MCP server with the same transport options as `hooks mcp`:
 * default shared Streamable HTTP, --stdio for one-process-per-agent, --sse
 * for the legacy SSE transport.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve package.json from both source (src/mcp/) and built (bin/) locations
const pkgPath = existsSync(join(__dirname, "..", "package.json"))
  ? join(__dirname, "..", "package.json")
  : join(__dirname, "..", "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(pkg.version);
  process.exit(0);
}

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: hooks-mcp [options]

Standalone MCP server for @hasna/hooks v${pkg.version}.

Options:
  --stdio      Use stdio transport (one process per agent)
  --sse        Use legacy SSE transport (port 39427)
  --http       Use Streamable HTTP transport (explicit; also the default)
  -p, --port <port>  Port for HTTP/SSE transport (8847 HTTP / 39427 SSE)
  --version    Print version
  -h, --help   Show this help
`);
  process.exit(0);
}

async function main(): Promise<void> {
  if (args.includes("--stdio")) {
    const { startStdioServer } = await import("./server.js");
    await startStdioServer();
  } else if (args.includes("--sse")) {
    const { startSSEServer } = await import("./server.js");
    const portIdx = args.indexOf("-p") >= 0 ? args.indexOf("-p") + 1 : args.indexOf("--port") >= 0 ? args.indexOf("--port") + 1 : -1;
    const port = portIdx >= 0 && portIdx < args.length ? Number(args[portIdx]) : 39427;
    await startSSEServer({ port });
  } else {
    const { createHooksServer } = await import("./server.js");
    const { resolveMcpHttpPort, startMcpHttpServer } = await import("./http.js");
    startMcpHttpServer({
      name: "hooks",
      port: resolveMcpHttpPort(args),
      buildServer: createHooksServer,
    });
  }
}

main().catch((err) => {
  process.stderr.write(`[hooks-mcp] Failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
