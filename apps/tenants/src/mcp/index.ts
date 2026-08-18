#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTenantsMcpServer } from "./server.js";

export { registerTenantsMcpTools } from "./tools.js";
export type { TenantsMcpToolOptions } from "./tools.js";
export { createTenantsMcpServer } from "./server.js";
export type { CreateTenantsMcpServerOptions } from "./server.js";

export async function startMcpServer(): Promise<void> {
  const server = createTenantsMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function printHelp(): void {
  console.log(`Usage: tenants-mcp [options]

Hasna Tenants MCP server over stdio. Talks to tenants-serve through the
TenantsClient SDK (HASNA_TENANTS_API_URL, HASNA_TENANTS_API_KEY).

Tools:
  tenants_signup
  tenants_login
  tenants_verify_otp
  tenants_issue_token
  tenants_whoami
  tenants_introspect
  tenants_jwks

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
