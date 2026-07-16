import { describe, expect, it } from 'vitest'
import { runCli } from '../src/runner.js'
import { fixture, jsonResponse, profileConfig } from './helpers.js'
import { EXIT_CODES } from '../src/errors.js'

describe('cweb auth commands', () => {
  it('logs in with the exact cweb body, stores token, and redacts output', async () => {
    const f = fixture({ config: profileConfig() })
    f.runtime.env.HASNA_2FA = '123456'
    f.transport.responses.push(jsonResponse({ token: 'returned-secret', tokenPrefix: 'cweb_abc', scopes: ['cweb:careers.jobs.read'] }))
    await runCli(['--json', 'auth', 'login', '--email', 'owner@example.com', '--org', 'hasna', '--two-factor-env', 'HASNA_2FA'], f.runtime)
    expect(f.transport.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'owner@example.com', password: 'password-from-safe-input', orgSlug: 'hasna', twoFactorCode: '123456' },
    })
    expect(f.credentials.values.get('prod')).toBe('returned-secret')
    expect(f.stdout.value).not.toContain('returned-secret')
  })

  it('rejects two-factor codes in argv and does not prompt or add 2FA when absent', async () => {
    const rejected = fixture({ config: profileConfig() })
    const result = await runCli(['--json', 'auth', 'login', '--email', 'owner@example.com', '--org', 'hasna', '--two-factor-code', '123456'], rejected.runtime)
    expect(result.exitCode).toBe(2)
    expect(rejected.transport.requests).toHaveLength(0)

    const plain = fixture({ config: profileConfig() })
    plain.transport.responses.push(jsonResponse({ token: 'returned-secret' }))
    await runCli(['--json', 'auth', 'login', '--email', 'owner@example.com', '--org', 'hasna'], plain.runtime)
    expect(plain.transport.requests[0]?.body).not.toHaveProperty('twoFactorCode')
  })

  it('maps whoami and logout and removes the local token', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    f.transport.responses.push(jsonResponse({ userId: 'user' }), jsonResponse({ revoked: true }))
    await runCli(['--json', 'auth', 'whoami'], f.runtime)
    await runCli(['--json', 'auth', 'logout'], f.runtime)
    expect(f.transport.requests.map((request) => request.path)).toEqual(['/api/v1/auth/whoami', '/api/v1/auth/logout'])
    expect(f.credentials.values.has('prod')).toBe(false)
  })

  it('uses exact token lifecycle endpoints and idempotency header', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    await runCli(['--json', 'auth', 'tokens', 'list'], f.runtime)
    for (const command of [
      ['auth', 'tokens', 'rotate', 'tok_1', '--idempotency-key', 'rotate-123'],
      ['auth', 'tokens', 'revoke', 'tok_1'],
      ['auth', 'tokens', 'revoke-all'],
    ]) {
      const planned = await runCli(['--json', ...command], f.runtime)
      const digest = (planned.result as { ok: true; data: { digest: string } }).data.digest
      await runCli(['--json', ...command, '--apply', digest, '--yes'], f.runtime)
    }
    expect(f.transport.requests.map((request) => request.path)).toEqual([
      '/api/v1/orgs/hasna/auth/tokens',
      '/api/v1/orgs/hasna/auth/tokens/tok_1/rotate',
      '/api/v1/orgs/hasna/auth/tokens/tok_1',
      '/api/v1/orgs/hasna/auth/tokens/revoke-all',
    ])
    expect(f.transport.requests[1]?.headers?.['Idempotency-Key']).toBe('rotate-123')
  })

  it('creates scoped tokens at the exact endpoint and validates required fields', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    await runCli(
      ['--json', 'auth', 'tokens', 'create', '--name', 'automation', '--scopes', 'cweb:careers.jobs.read,cweb:careers.jobs.write', '--expires-in-days', '30'],
      f.runtime,
    )
    expect(f.transport.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/orgs/hasna/auth/tokens',
      body: {
        name: 'automation',
        scopes: ['cweb:careers.jobs.read', 'cweb:careers.jobs.write'],
        expiresInDays: 30,
      },
    })
  })

  it('maps a successful login response without a token as malformed remote data', async () => {
    const f = fixture({ config: profileConfig() })
    f.transport.responses.push(jsonResponse({ userId: 'user' }))
    const result = await runCli(['--json', 'auth', 'login', '--email', 'owner@example.com', '--org', 'hasna'], f.runtime)
    expect(result.exitCode).toBe(EXIT_CODES.REMOTE)
    expect(f.credentials.values.size).toBe(0)
  })
})
