/**
 * Test helper: keep account resolution off the hosted accounts API.
 *
 * `resolveAccountForAgent` (src/lib/accounts.ts) resolves the accounts
 * credential through the @hasna/contracts chain — env
 * `HASNA_ACCOUNTS_API_KEY` / `HASNA_ACCOUNTS_API_URL`, then
 * `~/.hasna/accounts/config/credentials` (root anchored on `HASNA_HOME` /
 * `HOME`), then the Keychain on macOS. A live cloud call 401s under a
 * mismatched app token and makes ingest tests depend on the ambient machine
 * environment, so this helper neutralises every tier the resolver can reach:
 * the env vars are deleted and the disk root is redirected to a fresh empty
 * directory (a station that already received
 * `~/.hasna/accounts/config/credentials` must not make resolution fall back
 * into a real cloud call). The Keychain tier remains ambient-off on non-mac
 * platforms and absent on macs (no item exists for the fixture machine), so
 * neither arm performs a real network call.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ACCOUNTS_ENV_KEYS = ['HASNA_ACCOUNTS_API_KEY', 'HASNA_ACCOUNTS_API_URL'] as const

/**
 * Stash and delete the hosted-accounts env vars, and redirect the resolver's
 * disk root to an empty temp dir. Returns a restore function for
 * afterEach/afterAll. Safe to call when the variables are unset.
 */
export function isolateHostedAccountsEnv(): () => void {
  const saved = Object.fromEntries(ACCOUNTS_ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ACCOUNTS_ENV_KEYS) delete process.env[key]
  const savedHasnaHome = process.env['HASNA_HOME']
  const emptyRoot = mkdtempSync(join(tmpdir(), 'economy-accounts-hermetic-'))
  process.env['HASNA_HOME'] = emptyRoot
  return () => {
    for (const key of ACCOUNTS_ENV_KEYS) {
      const value = saved[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (savedHasnaHome === undefined) delete process.env['HASNA_HOME']
    else process.env['HASNA_HOME'] = savedHasnaHome
    rmSync(emptyRoot, { recursive: true, force: true })
  }
}