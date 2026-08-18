// MCP server assembly for @hasna/tenants. The tools are thin wrappers over
// the shipped TenantsClient SDK; nothing here reimplements IdP logic.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPackageVersion } from "../version.js";
import { registerTenantsMcpTools, type TenantsMcpToolOptions } from "./tools.js";

export interface CreateTenantsMcpServerOptions extends TenantsMcpToolOptions {
  name?: string;
  version?: string;
}

export function createTenantsMcpServer(options: CreateTenantsMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.name ?? "tenants",
    version: options.version ?? getPackageVersion(),
  });
  registerTenantsMcpTools(server, { client: options.client });
  return server;
}
