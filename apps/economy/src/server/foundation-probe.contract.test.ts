/**
 * Contract regression: the RUNTIME must speak the vocabulary the manifest declares.
 *
 * `@hasna/contracts` 0.9.0 retired the deployment-mode axis. The manifest half of
 * that migration landed in #28 (`storage.mode` -> `storage.backend`), but the
 * runtime kept emitting `mode` on the foundation probes — so economy DECLARED the
 * new vocabulary and DID the old one.
 *
 * These assertions are made with the contract's OWN schemas rather than a
 * hand-written shape, because those schemas are the exact instrument the
 * `health_shape` conformance gate runs (`HealthResponseSchema.safeParse`). They
 * are `strict`, so a stray `mode` or `service` key fails just as loudly as a
 * missing `backend`.
 *
 * This file deliberately imports nothing that the fix introduces: it must RUN,
 * and fail on the payload VALUE, against pre-fix code. A regression test that
 * dies at import time proves an export is missing, not that the defect exists.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { HealthResponseSchema, ReadyResponseSchema, VersionResponseSchema } from '@hasna/contracts/schemas'
import { openDatabase } from '../db/database.js'
import { createHandler } from './serve.js'
import type { SqliteAdapter as Database } from '../db/sqlite-adapter.js'

/** Every env key that can steer backend resolution, cleared between cases. */
const BACKEND_ENV_KEYS = [
  'HASNA_ECONOMY_STORAGE_MODE',
  'HASNA_ECONOMY_MODE',
  'ECONOMY_STORAGE_MODE',
  'ECONOMY_MODE',
  'HASNA_ECONOMY_DATABASE_URL',
  'ECONOMY_DATABASE_URL',
  'DATABASE_URL',
] as const

async function probe(
  handler: (r: Request) => Promise<Response>,
  path: string,
): Promise<{ status: number; data: unknown }> {
  const res = await handler(new Request(`http://localhost:3456${path}`))
  return { status: res.status, data: (await res.json()) as unknown }
}

describe('foundation probes speak the 0.9.0 backend vocabulary', () => {
  let handler: (r: Request) => Promise<Response>
  let db: Database
  const saved = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const key of BACKEND_ENV_KEYS) {
      saved.set(key, process.env[key])
      delete process.env[key]
    }
    db = openDatabase(':memory:', true)
    handler = createHandler(db)
  })

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    saved.clear()
  })

  it('GET /health matches the contract HealthResponseSchema exactly for a postgresql backend', async () => {
    // @hasna/contracts 1.0.2 narrowed `ServerDataBackendSchema` to
    // `z.literal("postgresql")`: SQLite is legacy import input, never a LIVE
    // backend, so the health conformance gate only speaks the authoritative
    // arm. The runtime still reports its real backend honestly (see the sqlite
    // case below); this case wires the postgresql arm and asserts the exact
    // schema instrument the `health_shape` conformance gate runs.
    process.env['HASNA_ECONOMY_DATABASE_URL'] = 'postgresql://synthetic-user:synthetic-pass@127.0.0.1:5432/economy'
    const { status, data } = await probe(handler, '/health')
    expect(status).toBe(200)
    expect((data as Record<string, unknown>)['backend']).toBe('postgresql')

    const parsed = HealthResponseSchema.safeParse(data)
    // Surface the offending keys when this fails; a bare `false` is unactionable.
    expect(
      parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    ).toEqual([])
  })

  it('GET /health reports the retired vocabulary nowhere', async () => {
    const { data } = await probe(handler, '/health')
    expect(Object.keys(data as Record<string, unknown>)).not.toContain('mode')
  })

  it('GET /health reports backend=sqlite when no database URL is configured', async () => {
    const { data } = await probe(handler, '/health')
    expect((data as Record<string, unknown>)['backend']).toBe('sqlite')
  })

  it('GET /version matches the contract VersionResponseSchema', async () => {
    const { status, data } = await probe(handler, '/version')
    expect(status).toBe(200)
    expect(VersionResponseSchema.safeParse(data).success).toBe(true)
  })

  it('GET /ready matches the contract ReadyResponseSchema', async () => {
    const { status, data } = await probe(handler, '/ready')
    expect([200, 503]).toContain(status)
    expect(ReadyResponseSchema.safeParse(data).success).toBe(true)
  })
})
