/**
 * Env-var naming standard (2026-08-24): harness apps use the HASNA_<APP>_
 * prefix. The conversations identity contract — agent id, session id,
 * machine-identity opt-in — historically used CONVERSATIONS_* with no HASNA_
 * variant anywhere in the codebase. HASNA_CONVERSATIONS_* is now canonical;
 * the legacy names remain as a compatibility alias for one deprecation
 * window. Never a silent rename.
 *
 * Reads are lazy (function calls) so callers that set process.env at runtime
 * observe the values they set. Canonical wins when both are set; never set
 * both with different values.
 */
const alias = (canonical: string, legacy: string): string | undefined =>
  process.env[canonical] ?? process.env[legacy];

export const env = {
  agentId: (): string | undefined =>
    alias("HASNA_CONVERSATIONS_AGENT_ID", "CONVERSATIONS_AGENT_ID"),
  sessionId: (): string | undefined =>
    alias("HASNA_CONVERSATIONS_SESSION_ID", "CONVERSATIONS_SESSION_ID"),
  useMachineIdentity: (): string | undefined =>
    alias("HASNA_CONVERSATIONS_USE_MACHINE_IDENTITY", "CONVERSATIONS_USE_MACHINE_IDENTITY"),
} as const;
