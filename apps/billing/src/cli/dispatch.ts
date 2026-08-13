import { getOp } from "../services/registry.js";
import { runOp, type ServiceContext } from "../services/context.js";
import { errorEnvelope, ValidationError } from "../types/index.js";

export interface CliResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; suggestion: string };
}

/**
 * The CLI surface's normalized dispatch. Shared by the commander actions and
 * the interface-parity harness so the CLI drives the SAME service ops through
 * the SAME runOp choke point as MCP and /v1 (BUILD-SPEC §7).
 */
export async function cliInvoke(opName: string, rawInput: unknown, ctx: ServiceContext): Promise<CliResult> {
  const op = getOp(opName);
  if (!op) {
    return { ok: false, error: errorEnvelope(new ValidationError(`Unknown operation: ${opName}`)) };
  }
  try {
    const data = await runOp(op, ctx, rawInput ?? {});
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: errorEnvelope(error) };
  }
}

export function parseInputJson(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError("--input must be valid JSON.");
  }
}
