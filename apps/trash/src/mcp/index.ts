#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTrashMcpServer } from "./server.js";
import { VERSION } from "../version.js";
const args = process.argv.slice(2);
if (args.includes("--version")) console.log(VERSION);
else if (args.includes("--help")) console.log("trash-mcp [--stdio]: hosted reversible deletion, metadata search and recovery over newline-delimited MCP. Credentials resolve through @hasna/contracts; no local metadata fallback.");
else if (args.some((arg) => arg !== "--stdio")) { console.error("Unsupported option. Use trash-mcp --stdio."); process.exitCode = 1; }
else {
  const server = createTrashMcpServer();
  await server.connect(new StdioServerTransport());
  const close = () => { void server.close(); };
  process.once("SIGTERM", close); process.once("SIGINT", close);
}
