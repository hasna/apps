#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isStdioMode, resolveHttpPort } from "./options.js";

function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  console.log(`Usage: clip-mcp [options]

Runs the @hasna/clip MCP server (stdio by default).

Options:
      --http         Serve MCP over Streamable HTTP on 127.0.0.1
  -p, --port <port>  HTTP port (default: MCP_HTTP_PORT or 8874)
  -V, --version      output the version number
  -h, --help         display help for command`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(getPackageVersion());
  process.exit(0);
}

async function main(): Promise<void> {
  if (isStdioMode(args)) {
    const { buildServer } = await import("./server.js");
    const server = buildServer();
    await server.connect(new StdioServerTransport());
    return;
  }
  const { startHttpServer } = await import("./http.js");
  startHttpServer({ port: resolveHttpPort(args), log: (message) => console.error(message) });
  await new Promise<never>(() => {});
}

main().catch((error) => {
  console.error("clip-mcp error:", error);
  process.exit(1);
});
