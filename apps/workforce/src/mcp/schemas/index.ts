import { z } from "zod";

// MCP write-safety: every mutating tool must require an explicit confirm:true and
// strip MCP-only control fields before the payload reaches a service. This makes
// accidental writes impossible from a read-oriented agent loop.

export const mcpWriteConfirmationSchema = {
  confirm: z.boolean().optional().describe("Must be true to perform this write."),
  confirmation_reason: z.string().optional().describe("Optional human-readable reason for the write."),
  idempotency_key: z.string().optional().describe("Optional idempotency key (not persisted in v0)."),
};

const MCP_ONLY_FIELDS = new Set(["confirm", "confirmation_reason", "idempotency_key"]);

export class McpWriteConfirmationRequiredError extends Error {
  static code = "MCP_CONFIRMATION_REQUIRED";
  static suggestion =
    "Repeat the MCP tool call with confirm: true after reviewing the write operation and target member/entity.";
  code = McpWriteConfirmationRequiredError.code;
  constructor(toolName: string) {
    super(`${toolName} requires confirm: true before it can write workforce data.`);
    this.name = "McpWriteConfirmationRequiredError";
  }
}

/** Enforce confirm:true and strip MCP-only fields, returning the service payload. */
export function stripMcpWriteConfirmation<T extends Record<string, unknown>>(input: T, toolName: string): Omit<T, "confirm" | "confirmation_reason" | "idempotency_key"> {
  if (input["confirm"] !== true) throw new McpWriteConfirmationRequiredError(toolName);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!MCP_ONLY_FIELDS.has(key)) out[key] = value;
  }
  return out as Omit<T, "confirm" | "confirmation_reason" | "idempotency_key">;
}
