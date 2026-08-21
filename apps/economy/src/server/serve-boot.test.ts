/**
 * Regression (I38-00556): economy-serve crashed at boot because the cloud boot
 * path wired `verifyApiKey` with the deprecated `isRevoked` hook ONLY.
 *
 * `@hasna/contracts` 0.13.x refuses that wiring EAGERLY at construction — a
 * verifier that cannot refuse a key with no record is not allowed to exist —
 * so `startServer` threw inside the boot path and the process exited 1 before
 * a single request was served:
 *
 *   verifyApiKey was given only 'isRevoked', which cannot refuse a key this
 *   service has no record of: it returns false both for an active key and for
 *   one that was never registered, so an unregistered key is irrevocable.
 *
 * The serve process must boot with the auth contract in place; a refusal
 * belongs on the REQUEST path (a handled 401), never on the boot path (a
 * crash). This test boots the real cloud branch with synthetic env values and
 * asserts the server starts, /health answers, and an unauthenticated /v1
 * request is refused as a handled 401.
 *
 * This file deliberately uses the throwaway synthetic values only — no
 * credential is read, captured, or printed.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { startServer } from './serve.js'

/** Every env key that can steer backend resolution or the signing secret. */
const CLOUD_ENV_KEYS = [
  'HASNA_ECONOMY_DATABASE_URL',
  'ECONOMY_DATABASE_URL',
  'DATABASE_URL',
  'HASNA_ECONOMY_API_SIGNING_KEY',
  'HASNA_API_SIGNING_KEY',
  'API_KEY_SIGNING_SECRET',
] as const

const saved = new Map<string, string | undefined>()
for (const key of CLOUD_ENV_KEYS) saved.set(key, process.env[key])

afterEach(() => {
  for (const key of CLOUD_ENV_KEYS) {
    const value = saved.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('serve boots with the auth contract in cloud mode (I38-00556)', () => {
  it('startServer does not throw, and auth refusals are handled 401s not crashes', async () => {
    process.env['HASNA_ECONOMY_DATABASE_URL'] = 'postgresql://synthetic-user:synthetic-pass@127.0.0.1:5432/economy'
    process.env['HASNA_ECONOMY_API_SIGNING_KEY'] = 'synthetic-test-signing-secret-0123456789abcdef'

    const server = startServer(0, { log: () => {} })
    try {
      expect(server.port).toBeGreaterThan(0)
      const health = await fetch(`http://127.0.0.1:${server.port}/health`)
      expect(health.status).toBe(200)
      const payload = (await health.json()) as Record<string, string>
      expect(payload['status']).toBe('ok')

      // Auth refusal is a request-path outcome: 401 missing_token, never a boot crash.
      const unauth = await fetch(`http://127.0.0.1:${server.port}/v1/usage`)
      expect(unauth.status).toBe(401)
      const body = (await unauth.json()) as Record<string, string>
      expect(body['error']).toBe('missing_token')
    } finally {
      server.stop(true)
    }
  })
})
