#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShape } from "zod";
import { ActionsClient } from "../index.js";
import { ACTIONS_VERSION } from "../version.js";
import { TOOLS, type ToolDeps } from "./tools.js";

export interface CreateServerOptions {
  deps?: ToolDeps;
}

interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * The SDK's `registerTool` infers its callback argument from the literal shape of
 * `inputSchema`. Our tools carry an opaque `ZodRawShape`, which makes that inference
 * recurse until tsc reports TS2589, so we register through this terminating signature.
 */
type RegisterTool = (
  name: string,
  config: { title: string; description: string; inputSchema: ZodRawShape },
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>,
) => void;

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer({ name: "actions", version: ACTIONS_VERSION });
  const deps = options.deps ?? { client: new ActionsClient() };
  const registerTool = server.registerTool.bind(server) as unknown as RegisterTool;

  for (const tool of TOOLS) {
    registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>): Promise<McpToolResult> => {
        try {
          const result = await tool.handler(deps, args ?? {});
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (error) {
          return {
            content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { TOOLS } from "./tools.js";
