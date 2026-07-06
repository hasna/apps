import { z } from "zod";

/**
 * MCP write-safety schema. Every mutating tool spreads mcpWriteConfirmationSchema
 * and calls stripMcpWriteConfirmation() at runtime, so a write cannot happen
 * without an explicit confirm: true. MCP-only fields are stripped before the
 * value reaches the service layer.
 */

export const mcpWriteConfirmationSchema = {
  confirm: z.boolean().optional().describe("Must be true to perform the write."),
  confirmation_reason: z.string().optional().describe("Optional human reason for the write (audited)."),
  idempotency_key: z.string().optional().describe("Optional idempotency key for the write."),
};

const MCP_ONLY_FIELDS = new Set(["confirm", "confirmation_reason", "idempotency_key"]);

export class McpWriteConfirmationRequiredError extends Error {
  readonly code = "MCP_CONFIRMATION_REQUIRED";
  readonly toolName: string;
  constructor(toolName: string) {
    super(`${toolName} requires confirm: true before it can write access data.`);
    this.name = "McpWriteConfirmationRequiredError";
    this.toolName = toolName;
  }
  get suggestion(): string {
    return "Repeat the MCP tool call with confirm: true after reviewing the write operation and target identity/entity.";
  }
}

export function stripMcpWriteConfirmation(input: Record<string, unknown>, toolName: string): Record<string, unknown> {
  if (input.confirm !== true) throw new McpWriteConfirmationRequiredError(toolName);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!MCP_ONLY_FIELDS.has(key)) out[key] = value;
  }
  return out;
}
