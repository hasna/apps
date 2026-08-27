#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isHttpMode, isStdioMode, resolveHttpPort, startHttpServer, DEFAULT_HTTP_PORT } from "./http.js";
import { buildServer } from "./server.js";

export { buildServer, createMcpServer, VERSION } from "./server.js";
export { isHttpMode, resolveHttpPort, startHttpServer, DEFAULT_HTTP_PORT, HTTP_NAME } from "./http.js";
export {
  buildMcpTools,
  listTools,
  registerMcpTools,
  tools,
} from "./tools.js";
export type { McpsMcpToolDefinition } from "./tools.js";

export async function startMcpServer() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Decides the transport for a given argument vector. The contract (documented
 * in --help and matching every other @hasna/* MCP bin) is: stdio by default,
 * HTTP only when explicitly requested via --http or MCP_HTTP=1.
 */
export function resolveMcpTransport(
  args: string[] = process.argv.slice(2),
): "stdio" | "http" {
  if (isStdioMode(args)) return "stdio";
  return isHttpMode(args) ? "http" : "stdio";
}

export function isMcpEntry(argv1: string | undefined = process.argv[1]): boolean {
  return (
    argv1?.endsWith("/bin/mcp.js") === true ||
    argv1?.endsWith("/mcp/index.ts") === true ||
    argv1?.endsWith("/mcp/index.js") === true
  );
}

export async function main(args: string[] = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: mcps-mcp [options]

Meta-MCP registry server (stdio transport by default)

Options:
  --http         Start Streamable HTTP transport on 127.0.0.1 (or MCP_HTTP=1)
  --port <n>     HTTP port (default: ${DEFAULT_HTTP_PORT}, or MCP_HTTP_PORT env)
  -V, --version  output the version number
  -h, --help     display help for command`);
    return;
  }

  if (args.includes("--version") || args.includes("-V")) {
    const { VERSION } = await import("./server.js");
    console.log(VERSION);
    return;
  }

  if (resolveMcpTransport(args) === "http") {
    startHttpServer({ port: resolveHttpPort(args) });
    return;
  }

  await startMcpServer();
}

// Direct-run guard. `import.meta.main` is true only for the actual entry file —
// inside the CLI bundle (bin/index.js) this module is inlined and reports
// false, so importing it from `mcps mcp` never self-starts. The argv[1] suffix
// checks cover direct runs of the built and dev MCP entry files. Do NOT use an
// `import.meta.url` comparison here: it is true for every module inlined into
// a single-file bun bundle, which made the CLI 'mcp' subcommand spawn an
// unintended HTTP listener (O15-04315).
const isDirectRun =
  import.meta.main === true ||
  isMcpEntry();

if (isDirectRun) {
  main().catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
  });
}
