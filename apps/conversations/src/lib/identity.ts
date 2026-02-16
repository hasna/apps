/**
 * Resolve agent identity.
 * Priority: explicit flag → CONVERSATIONS_AGENT_ID env → "user" fallback
 */
export function resolveIdentity(explicit?: string): string {
  const explicitValue = explicit?.trim();
  if (explicitValue) return explicitValue;
  const envValue = process.env.CONVERSATIONS_AGENT_ID?.trim();
  if (envValue) return envValue;
  return "user";
}

/**
 * Require an explicit identity (for headless/MCP use).
 * Throws if no identity is set via flag or env.
 */
export function requireIdentity(explicit?: string): string {
  const explicitValue = explicit?.trim();
  if (explicitValue) return explicitValue;
  const envValue = process.env.CONVERSATIONS_AGENT_ID?.trim();
  if (envValue) return envValue;
  throw new Error(
    "Agent identity required. Set CONVERSATIONS_AGENT_ID env var or pass --from flag."
  );
}
