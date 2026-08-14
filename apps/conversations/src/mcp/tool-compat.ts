import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

type ToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
};

type ToolHandler = (args: Record<string, any>, extra: unknown) => unknown | Promise<unknown>;

/**
 * The MCP SDK accepts v3/v4-compatible Zod schemas at runtime, but its generic
 * registerTool overload can become prohibitively expensive across this large
 * tool set. Keep that compatibility cast in one place and let individual tools
 * continue to declare ordinary Zod raw shapes.
 */
export function registerMcpTool(
  server: McpServer,
  name: string,
  config: ToolConfig,
  handler: ToolHandler,
) {
  const register = server.registerTool.bind(server) as unknown as (
    toolName: string,
    toolConfig: ToolConfig,
    toolHandler: ToolHandler,
  ) => unknown;
  return register(name, config, handler);
}
