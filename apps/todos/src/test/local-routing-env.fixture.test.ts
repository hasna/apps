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
    HASNA_TODOS_API_URL: "",
    HASNA_TODOS_API_KEY: "",
    TODOS_API_URL: "",
    TODOS_API_KEY: "",
    ...overrides,
  };
}
