/**
 * Agent identity resolution for the messages CLI.
 *
 * The acting identity used to be a mandatory `--agent` on every verb, which
 * makes the CLI unusable from a script on a station that already knows who it
 * is (hasna/apps#1602: "identity flags default from the station wrapper env
 * rather than being mandatory"). Resolution is: explicit flag → environment →
 * fail closed. It lives in its own module so it is unit-testable; importing
 * the CLI entrypoint would execute it.
 */

/**
 * Env keys that carry the calling agent's identity, canonical first.
 * `CONVERSATIONS_AGENT_ID` is accepted because the conversations MCP/CLI pair
 * already established it as the per-session agent identity on a station, and a
 * session that has one is the same actor here.
 */
export const MESSAGES_AGENT_ID_ENV_KEYS = [
  "HASNA_MESSAGES_AGENT_ID",
  "MESSAGES_AGENT_ID",
  "CONVERSATIONS_AGENT_ID",
] as const;

/** The identity configured in the environment, or undefined. Blank counts as absent. */
export function envAgentId(env: Record<string, string | undefined> = process.env): string | undefined {
  for (const key of MESSAGES_AGENT_ID_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Resolve an identity flag: the explicit flag wins, the environment is the
 * default, and an unresolvable identity FAILS CLOSED with an actionable error
 * naming the flag and the env keys. It never resolves to an empty agent name,
 * which the store would accept and which would create an unaddressable
 * identity that no `receive` can ever drain.
 */
export function requireAgent(
  value: string | undefined,
  flag = "--agent",
  env: Record<string, string | undefined> = process.env,
): string {
  const resolved = value?.trim() || envAgentId(env);
  if (!resolved) {
    throw new Error(
      `${flag} is required: pass it explicitly or set one of ${MESSAGES_AGENT_ID_ENV_KEYS.join(", ")}`,
    );
  }
  return resolved;
}

/** Description suffix for the identity flags that default from the env. */
export const AGENT_DEFAULT_HINT = `(defaults to $${MESSAGES_AGENT_ID_ENV_KEYS.join(" / $")})`;
