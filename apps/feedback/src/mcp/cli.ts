#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFeedbackMcpServer } from "./server.js";
import { VERSION } from "../version.js";

export async function startMcpServer(): Promise<void> {
  const server = createFeedbackMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function printHelp(): void {
  console.log(`Usage: feedback-mcp [options]

Open Feedback MCP server over stdio.

Options:
  -V, --version   Display version
  -h, --help      Display help`);
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args.includes("--version") || args.includes("-V")) {
    console.log(VERSION);
    return;
  }
  await startMcpServer();
}

main().catch((error) => {
  console.error("MCP server error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
