import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { DEFAULT_MCP_HTTP_PORT, isHttpMode, resolveHttpPort, startHttpServer } from "./http.js";
import { PACKAGE_VERSION } from "../version.js";

export { buildServer, MCP_NAME } from "./server.js";
export { DEFAULT_MCP_HTTP_PORT, isHttpMode, resolveHttpPort, startHttpServer } from "./http.js";

function printHelp(): void {
  console.log(`Usage: styles-mcp [options]

MCP server for @hasna/styles

Options:
  -V, --version  output the version number
  -h, --help     display help for command
  --http         explicitly select Streamable HTTP transport
  --stdio        run the MCP server over stdio
  --port <n>     HTTP port (default: ${DEFAULT_MCP_HTTP_PORT})

Set MCP_STDIO=1 or pass --stdio for stdio clients. MCP_HTTP=1 explicitly
selects HTTP; MCP_HTTP_PORT sets its port.`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(PACKAGE_VERSION);
  process.exit(0);
}

export async function startStdioServer(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** @deprecated use startStdioServer */
export const startMcpServer = startStdioServer;

async function main(): Promise<void> {
  if (isHttpMode()) {
    await startHttpServer({ port: resolveHttpPort() });
    return;
  }

  await startStdioServer();
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write("MCP server error: " + String(err) + "\n");
    process.exit(1);
  });
}
