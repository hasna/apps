// Compact / token-aware output helpers shared by MCP tools.

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Wrap a JSON-serializable value as a standard MCP text result. */
export function jsonResult(value: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** Wrap a structured error envelope as an MCP error result. */
export function errorResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Truncate a long string for compact list rendering. */
export function truncate(value: string, max = 200): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
