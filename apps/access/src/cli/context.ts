import { runOperation, type CoreOperation } from "../client/index.js";
import type { OperationInput } from "../services/registry.js";
import { errorStatus, toErrorEnvelope } from "../types/index.js";

/**
 * CLI output helpers. Core operations use the HTTPS credential's server-side
 * scope and tenant boundary; there is no local system-principal fallback.
 */

export function jsonMode(): boolean {
  return process.argv.includes("--json");
}

export function emit(value: unknown): void {
  if (jsonMode()) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  } else {
    process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
  }
}

export function fail(error: unknown): never {
  const envelope = toErrorEnvelope(error);
  // Include `error` alias so CLI error output carries the message field too.
  process.stdout.write(`${JSON.stringify({ ...envelope, error: envelope.message })}\n`);
  process.exit(1);
}

/** Run an authenticated HTTPS operation and emit its result (or fail). */
export async function runAndEmit(op: string, input: OperationInput): Promise<void> {
  try {
    const result = await runOperation(op as CoreOperation, input);
    emit(result);
  } catch (error) {
    void errorStatus(error);
    fail(error);
  }
}
