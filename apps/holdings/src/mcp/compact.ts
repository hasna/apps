import { z } from "zod";

// Token-aware output helpers for MCP tools.

export const DEFAULT_MCP_LIMIT = 25;
export const MAX_MCP_LIMIT = 100;

export const mcpListOptionsSchema = {
  limit: z.number().int().min(1).max(MAX_MCP_LIMIT).optional().describe(`Max records (default ${DEFAULT_MCP_LIMIT}, max ${MAX_MCP_LIMIT})`),
  cursor: z.number().int().min(0).optional().describe("Zero-based record offset for pagination"),
};

export function mcpText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function mcpError(envelope: { code: string; message: string; suggestion: string }) {
  return { content: [{ type: "text" as const, text: JSON.stringify(envelope, null, 2) }], isError: true };
}
