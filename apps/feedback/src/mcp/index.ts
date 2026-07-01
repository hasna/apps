#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFeedbackMcpServer } from "./server.js";

export { buildFeedbackMcpTools, registerFeedbackMcpTools } from "./tools.js";
export type { FeedbackMcpToolDefinition } from "./tools.js";
export { buildServer, createFeedbackMcpServer } from "./server.js";

export async function startMcpServer(): Promise<void> {
  const server = createFeedbackMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function printHelp(): void {
  console.log(`Usage: feedback-mcp [options]

Open Feedback MCP server over stdio.

Options:
  -h, --help  Display help`);
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  await startMcpServer();
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/mcp/index.ts") ||
  process.argv[1]?.endsWith("/mcp/index.js");

if (isDirectRun) {
  main().catch((error) => {
    console.error("MCP server error:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

