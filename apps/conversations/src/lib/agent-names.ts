import type { AgentConflictError, RegisterAgentResult } from "../types.js";

/** Canonical agent-name comparison form (trimmed, lower-cased). Pure. */
export function normalizeAgentName(name: string): string {
  return name.trim().toLowerCase();
}

/** Discriminates the register-agent conflict envelope. Pure. */
export function isAgentConflict(result: RegisterAgentResult | AgentConflictError): result is AgentConflictError {
  return (result as AgentConflictError).conflict === true;
}
