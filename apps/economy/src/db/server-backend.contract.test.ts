/**
 * Contract regression: backend resolution depends ONLY on database configuration;
 * stale deployment-mode variables are ignored, never a selector and never an error.
 *
 * CONTRACT.md section 2 (`@hasna/contracts` 0.9.0): retired `STORAGE_MODE` and
 * `MODE` variables must never steer resolution — the `server_backend_configuration`
 * conformance gate enforces this via `resolveServerDataBackend`.
 *
 * Pre-fix, `isCloudMode()` READ `HASNA_ECONOMY_STORAGE_MODE` and branched on it,
 * and a later guard made its survival a startup error. Both behaviours are gone:
 * the variable is ignored entirely and the backend comes from the DSN alone
 * (owner directive 2026-08-15).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { resolveEconomyServerBackend } from './cloud.js'

const BACKEND_ENV_KEYS = [
  'HASNA_ECONOMY_STORAGE_MODE',
  'HASNA_ECONOMY_MODE',
  'ECONOMY_STORAGE_MODE',
  'ECONOMY_MODE',
  'HASNA_ECONOMY_DATABASE_URL',
  'ECONOMY_DATABASE_URL',
  'DATABASE_URL',
] as const

describe('server backend resolution depends only on database configuration', () => {
  const saved = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const key of BACKEND_ENV_KEYS) {
      saved.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    saved.clear()
  })

  it('defaults to sqlite with no database URL', () => {
    expect(resolveEconomyServerBackend()).toBe('sqlite')
  })

  it('selects postgresql from the canonical database URL', () => {
    process.env['HASNA_ECONOMY_DATABASE_URL'] = 'postgres://user@host:5432/economy'
    expect(resolveEconomyServerBackend()).toBe('postgresql')
  })

  it('selects postgresql from the ECONOMY_DATABASE_URL alias', () => {
    process.env['ECONOMY_DATABASE_URL'] = 'postgres://user@host:5432/economy'
    expect(resolveEconomyServerBackend()).toBe('postgresql')
  })

  // Economy has always accepted the bare alias, and the deployed migrate task
  // documents it. The contract's own resolver does NOT read it, so switching to
  // that resolver wholesale would silently downgrade such a deployment to sqlite
  // -- a wrong backend reported as healthy. This case pins the alias.
  it('selects postgresql from the bare DATABASE_URL alias economy has always accepted', () => {
    process.env['DATABASE_URL'] = 'postgres://user@host:5432/economy'
    expect(resolveEconomyServerBackend()).toBe('postgresql')
  })

  // Stale deployment-mode variables never gate the server (owner directive
  // 2026-08-15): the backend is decided by the database configuration alone,
  // and a retired `STORAGE_MODE` / `MODE` variable is ignored — never an
  // error, never a selector. The pre-fix `isCloudMode()` branch is gone.
  it.each([
    ['HASNA_ECONOMY_STORAGE_MODE', 'cloud'],
    ['HASNA_ECONOMY_MODE', 'cloud'],
    ['ECONOMY_STORAGE_MODE', 'local'],
    ['ECONOMY_MODE', 'local'],
  ])('ignores the retired %s and still defaults to sqlite without a database URL', (key, value) => {
    process.env[key] = value
    expect(resolveEconomyServerBackend()).toBe('sqlite')
  })

  it('ignores a retired mode variable when a valid database URL is present', () => {
    process.env['HASNA_ECONOMY_DATABASE_URL'] = 'postgres://user@host:5432/economy'
    process.env['HASNA_ECONOMY_STORAGE_MODE'] = 'cloud'
    expect(resolveEconomyServerBackend()).toBe('postgresql')
  })
})
