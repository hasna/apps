import { normalizeError } from "../core/errors.js";

export interface ToolResult {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

/** Wrap a JSON-serializable value as an MCP text result. */
export function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** Wrap an error as the canonical `{ code, message, suggestion }` envelope. */
export function fail(error: unknown): ToolResult {
  const envelope = normalizeError(error);
  return { content: [{ type: "text", text: JSON.stringify(envelope) }] };
}
