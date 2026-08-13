import { SYSTEM_AUTHORIZATION_CONTEXT } from "../services/authorization.js";
import { runOperation, type OperationInput } from "../services/registry.js";
import { errorStatus, toErrorEnvelope } from "../types/index.js";

/**
 * Builds the CLI run context. The local CLI operates against the authoritative
 * local SQLite store as a system principal (the store IS the trust boundary in
 * local mode); network surfaces (serve/MCP) apply the bearer/scope stack.
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

/** Run a registry op with the local system context and emit its result (or fail). */
export function runAndEmit(op: string, input: OperationInput): void {
  try {
    const result = runOperation(op, input, SYSTEM_AUTHORIZATION_CONTEXT);
    emit(result);
  } catch (error) {
    void errorStatus(error);
    fail(error);
  }
}
