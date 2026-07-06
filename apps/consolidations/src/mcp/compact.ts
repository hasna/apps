import { toStructuredError } from "../types/index.js";

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/** Wrap a successful result as a text tool result (JSON body for parity). */
export function toolText(value: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** Wrap an error as a structured {code,message,suggestion} tool result. */
export function toolError(error: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(toStructuredError(error)) }], isError: true };
}
