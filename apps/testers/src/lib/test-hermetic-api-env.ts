/**
 * Test helper: keep CLI/MCP tests on the local fixture store.
 *
 * The CLI and MCP server resolve the hosted testers API when
 * `HASNA_TESTERS_API_URL` / `HASNA_TESTERS_API_KEY` are present in the
 * environment. Tests that spawn the CLI (or start the MCP server) against a
 * `TESTERS_DB_PATH` fixture therefore depend on the ambient machine
 * environment: with the variables set, the spawned process routes to the
 * hosted store and answers from live data instead of the fixture. Deleting
 * the variables in the test setup makes the tests hermetic.
 */
const API_ENV_KEYS = ["HASNA_TESTERS_API_URL", "HASNA_TESTERS_API_KEY"] as const

/**
 * Stash and delete the hosted-API env vars. Returns a restore function for
 * afterEach/afterAll. Safe to call when the variables are unset.
 */
export function isolateHostedApiEnv(): () => void {
  const saved = Object.fromEntries(API_ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of API_ENV_KEYS) delete process.env[key]
  return () => {
    for (const key of API_ENV_KEYS) {
      const value = saved[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
