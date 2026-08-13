import { toErrorEnvelope } from "../types/index.js";

/** Token-aware output helpers for MCP tool results. */

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
}

export function toToolResult(value: unknown): McpToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text", text }], structuredContent: value };
}

/** Serialize any error to the canonical { code, message, suggestion } envelope. */
export function formatError(error: unknown): string {
  return JSON.stringify(toErrorEnvelope(error));
}

export function errorResult(error: unknown): McpToolResult {
  return { content: [{ type: "text", text: formatError(error) }] };
}
