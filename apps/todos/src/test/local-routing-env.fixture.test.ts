/**
 * Explicit local routing baseline for subprocess tests.
 *
 * Developer machines can carry live self-hosted credentials. Local-intent tests
 * must never inherit those implicitly. Callers may still exercise remote or
 * hybrid modes by passing explicit overrides, which are applied last.
 */
export function localRoutingTestEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    ...process.env,
    HASNA_TODOS_STORAGE_MODE: "local",
    TODOS_STORAGE_MODE: "local",
    HASNA_TODOS_DB_PATH: "",
    HASNA_TODOS_API_URL: "",
    HASNA_TODOS_API_KEY: "",
    TODOS_API_URL: "",
    TODOS_API_KEY: "",
    // A live cloud DSN in the ambient env would flip the server's auth posture to
    // "hosted" (local /api/* + /mcp planes disabled). Local-intent tests must not
    // inherit one, and must not inherit an anonymous-plane opt-in either.
    HASNA_TODOS_DATABASE_URL: "",
    TODOS_DATABASE_URL: "",
    DATABASE_URL: "",
    TODOS_ALLOW_ANONYMOUS: "",
    ...overrides,
  };
}
