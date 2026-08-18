/**
 * Contract regression: backend resolution depends ONLY on database configuration.
 *
 * CONTRACT.md section 2 (`@hasna/contracts` 0.9.0) removed the deployment
 * concept. The contracts package's `server_backend_configuration` conformance gate
 * rejects the retired mode variables with a migration hint; economy invokes that
 * gate via `assertNoLegacyStorageMode` in `./cloud.ts`, and the rejection
 * behaviour itself is owned and tested by the contracts package.
 *
 * This file pins economy's own part of the selection contract: the sqlite
 * default and the three database-URL forms it resolves. The bare `DATABASE_URL`
 * alias is economy-specific (the contract's own resolver does not read it), so
 * it is pinned here to prevent a silent downgrade to sqlite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { resolveEconomyServerBackend } from './cloud.js'

const BACKEND_ENV_KEYS = [
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

})
