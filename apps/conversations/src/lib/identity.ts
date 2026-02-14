/**
 * Resolve agent identity.
 * Priority: explicit flag → CONVERSATIONS_AGENT_ID env → "user" fallback
 */
export function resolveIdentity(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.CONVERSATIONS_AGENT_ID) return process.env.CONVERSATIONS_AGENT_ID;
  return "user";
}

/**
 * Require an explicit identity (for headless/MCP use).
 * Throws if no identity is set via flag or env.
 */
export function requireIdentity(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.CONVERSATIONS_AGENT_ID) return process.env.CONVERSATIONS_AGENT_ID;
  throw new Error(
    "Agent identity required. Set CONVERSATIONS_AGENT_ID env var or pass --from flag."
  );
}
