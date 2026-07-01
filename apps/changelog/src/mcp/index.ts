#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createChangelogMcpServer } from "./server.js";

export { buildChangelogMcpTools, registerChangelogMcpTools } from "./tools.js";
export type { ChangelogMcpToolDefinition } from "./tools.js";
export { buildServer, createChangelogMcpServer } from "./server.js";

export async function startMcpServer(): Promise<void> {
  const server = createChangelogMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function printHelp(): void {
  console.log(`Usage: changelog-mcp [options]

Open Changelog MCP server over stdio.

Tools:
  add_changelog_entry
  list_changelog_entries
  get_changelog_entry
  update_changelog_entry
  generate_changelog
  publish_changelog
  changelog_stats
  export_changelog_jsonl

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
