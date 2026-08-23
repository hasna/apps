/**
 * Test helper: keep account resolution off the hosted accounts API.
 *
 * `resolveAccountForAgent` (src/lib/accounts.ts) calls `store.listTools()`
 * against the hosted accounts service when `HASNA_ACCOUNTS_API_KEY` /
 * `HASNA_ACCOUNTS_API_URL` are present in the environment — a live cloud call
 * that 401s under a mismatched app token and makes ingest tests depend on the
 * ambient machine environment. Deleting the two variables makes the store
 * resolve to the local (non-cloud) fallback, which the ingest tests were
 * written against.
 */
const ACCOUNTS_ENV_KEYS = ['HASNA_ACCOUNTS_API_KEY', 'HASNA_ACCOUNTS_API_URL'] as const

/**
 * Stash and delete the hosted-accounts env vars. Returns a restore function
 * for afterEach/afterAll. Safe to call when the variables are unset.
 */
export function isolateHostedAccountsEnv(): () => void {
  const saved = Object.fromEntries(ACCOUNTS_ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ACCOUNTS_ENV_KEYS) delete process.env[key]
  return () => {
    for (const key of ACCOUNTS_ENV_KEYS) {
      const value = saved[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
