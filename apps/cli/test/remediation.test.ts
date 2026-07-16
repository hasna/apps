import { PassThrough, Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/runner.js'
import { EXIT_CODES } from '../src/errors.js'
import { CliError } from '../src/errors.js'
import { readHiddenSecret, readStdinLine } from '../src/secret-input.js'
import { validateApiUrl } from '../src/config.js'
import { builtinProviders } from '../src/providers/cweb.js'
import type { HasnaProvider } from '../src/providers/types.js'
import { fixture, profileConfig } from './helpers.js'

class Capture extends Writable {
  value = ''
  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void) {
    this.value += String(chunk)
    callback()
  }
}

describe('release remediation regressions', () => {
  it('rejects typo and misplaced flags before destructive transport calls', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    const typo = await runCli(['--json', 'careers', 'jobs', 'delete', 'ea', '--version', '1', '--dry-rnu'], f.runtime)
    expect(typo.exitCode).toBe(EXIT_CODES.USAGE)
    expect(f.transport.requests).toHaveLength(0)
    const misplaced = await runCli(['--json', 'careers', 'jobs', 'list', '--title', 'secret-canary'], f.runtime)
    expect(misplaced.exitCode).toBe(EXIT_CODES.USAGE)
    expect(f.transport.requests).toHaveLength(0)
  })

  it('does not leak option values into command metadata', async () => {
    const f = fixture({ config: profileConfig() })
    await runCli(['--json', 'auth', 'login', '--two-factor-code', '654321'], f.runtime)
    expect(f.stdout.value).not.toContain('654321')
    expect(JSON.parse(f.stdout.value).meta.command).toBe('help')
  })

  it('processes pasted secret and enter from one TTY chunk', async () => {
    const input = new PassThrough() as PassThrough & { isTTY: true; setRawMode(value: boolean): void }
    input.isTTY = true
    input.setRawMode = () => undefined
    const output = new Capture()
    const pending = readHiddenSecret('Secret: ', input as never, output as never)
    input.write(Buffer.from('pasted-secret\r'))
    await expect(pending).resolves.toBe('pasted-secret')
  })

  it('rejects unsupported idempotency and invalid supported keys', async () => {
    const one = fixture({ config: profileConfig() })
    one.credentials.values.set('prod', 'bearer')
    expect((await runCli(['--json', 'auth', 'tokens', 'create', '--name', 'x', '--scopes', 'read', '--idempotency-key', 'ignored-key'], one.runtime)).exitCode).toBe(EXIT_CODES.USAGE)
    expect(one.transport.requests).toHaveLength(0)
    const two = fixture({ config: profileConfig() })
    two.credentials.values.set('prod', 'bearer')
    expect((await runCli(['--json', 'auth', 'tokens', 'rotate', 'tok', '--idempotency-key', 'bad key!'], two.runtime)).exitCode).toBe(EXIT_CODES.VALIDATION)
    expect(two.transport.requests).toHaveLength(0)
  })

  it('fails closed with partial exit when export page cap is reached', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    let calls = 0
    f.transport.request = async () => {
      calls += 1
      return { status: 200, headers: { 'x-export-complete': 'false', 'x-next-cursor': String(calls) }, body: '', text: calls === 1 ? 'id,name' : 'id,name' }
    }
    const result = await runCli(['--json', 'careers', 'applications', 'export'], f.runtime)
    expect(result.exitCode).toBe(EXIT_CODES.PARTIAL)
    expect(calls).toBe(1000)
  })

  it('forwards the department jobs filter', async () => {
    const f = fixture({ config: profileConfig() })
    await runCli(['--json', 'careers', 'jobs', 'list', '--department', 'Operations'], f.runtime)
    expect(f.transport.requests[0]?.query?.department).toBe('Operations')
  })

  it('consumes high-impact plans once and rejects replay', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    const command = ['careers', 'jobs', 'delete', 'ea', '--version', '1']
    const planned = await runCli(['--json', ...command], f.runtime)
    const digest = (planned.result as { ok: true; data: { digest: string } }).data.digest
    expect(f.transport.requests).toHaveLength(0)
    expect((await runCli(['--json', ...command, '--apply', digest, '--yes'], f.runtime)).exitCode).toBe(0)
    expect(f.transport.requests).toHaveLength(1)
    expect((await runCli(['--json', ...command, '--apply', digest, '--yes'], f.runtime)).exitCode).toBe(EXIT_CODES.CONFLICT)
    expect(f.transport.requests).toHaveLength(1)
  })

  it('enforces the API URL credential, fragment, TLS, and localhost opt-in policy', () => {
    expect(() => validateApiUrl('https://user:password@example.com')).toThrow()
    expect(() => validateApiUrl('https://example.com/#fragment')).toThrow()
    expect(() => validateApiUrl('http://localhost:3000')).toThrow()
    expect(validateApiUrl('http://localhost:3000', { allowInsecureLocalhost: true })).toBe('http://localhost:3000')
  })

  it('preserves only a safe remote request id in failure metadata', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    f.transport.request = async () => { throw new CliError('REMOTE_SERVER_ERROR', 'Generic remote failure', EXIT_CODES.REMOTE, { requestId: 'request-safe-1' }) }
    await runCli(['--json', 'auth', 'whoami'], f.runtime)
    expect(JSON.parse(f.stdout.value)).toMatchObject({ ok: false, meta: { requestId: 'request-safe-1' } })
  })

  it('requires an explicit valid idempotency key before creating a rotation plan', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    const result = await runCli(['--json', 'auth', 'tokens', 'rotate', 'tok_1'], f.runtime)
    expect(result.exitCode).toBe(EXIT_CODES.USAGE)
    expect(f.transport.requests).toHaveLength(0)
    expect(f.config.value.pendingPlans).toBeUndefined()
  })

  it('releases plan reservations on transient network failure and consumes them on success', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    const command = ['careers', 'jobs', 'delete', 'ea', '--version', '1']
    const planned = await runCli(['--json', ...command], f.runtime)
    const digest = (planned.result as { ok: true; data: { digest: string } }).data.digest
    const original = f.transport.request.bind(f.transport)
    let first = true
    f.transport.request = async (options) => {
      if (first) { first = false; throw new CliError('NETWORK_ERROR', 'Transient failure', EXIT_CODES.NETWORK, { retryable: true }) }
      return original(options)
    }
    expect((await runCli(['--json', ...command, '--apply', digest, '--yes'], f.runtime)).exitCode).toBe(EXIT_CODES.NETWORK)
    expect(f.config.value.pendingPlans?.[digest]?.state).toBe('pending')
    expect((await runCli(['--json', ...command, '--apply', digest, '--yes'], f.runtime)).exitCode).toBe(0)
    expect(f.config.value.pendingPlans?.[digest]).toBeUndefined()
  })

  it('keeps an in-flight reservation exclusive and consumes definitive remote failures', async () => {
    const concurrent = fixture({ config: profileConfig() })
    concurrent.credentials.values.set('prod', 'bearer')
    const command = ['careers', 'jobs', 'delete', 'ea', '--version', '1']
    const planned = await runCli(['--json', ...command], concurrent.runtime)
    const digest = (planned.result as { ok: true; data: { digest: string } }).data.digest
    let release!: () => void
    concurrent.transport.request = async (options) => new Promise((resolve) => {
      concurrent.transport.requests.push(structuredClone(options))
      release = () => resolve({ status: 200, headers: {}, body: { ok: true, data: {} }, text: '{}', requestId: 'request-test' })
    })
    const firstApply = runCli(['--json', ...command, '--apply', digest, '--yes'], concurrent.runtime)
    while (!release) await new Promise((resolve) => setImmediate(resolve))
    concurrent.runtime.now = () => new Date('2026-07-16T12:11:00.000Z')
    const reservation = structuredClone(concurrent.config.value.pendingPlans?.[digest])
    expect((await runCli(['--json', ...command], concurrent.runtime)).exitCode).toBe(EXIT_CODES.CONFLICT)
    expect(concurrent.config.value.pendingPlans?.[digest]).toEqual(reservation)
    expect(concurrent.transport.requests).toHaveLength(1)
    expect((await runCli(['--json', ...command, '--apply', digest, '--yes'], concurrent.runtime)).exitCode).toBe(EXIT_CODES.CONFLICT)
    expect(concurrent.transport.requests).toHaveLength(1)
    release()
    expect((await firstApply).exitCode).toBe(0)

    const definitive = fixture({ config: profileConfig() })
    definitive.credentials.values.set('prod', 'bearer')
    const nextPlan = await runCli(['--json', ...command], definitive.runtime)
    const nextDigest = (nextPlan.result as { ok: true; data: { digest: string } }).data.digest
    definitive.transport.request = async () => { throw new CliError('REMOTE_REQUEST_REJECTED', 'Remote rejected', EXIT_CODES.REMOTE) }
    expect((await runCli(['--json', ...command, '--apply', nextDigest, '--yes'], definitive.runtime)).exitCode).toBe(EXIT_CODES.REMOTE)
    expect((await runCli(['--json', ...command, '--apply', nextDigest, '--yes'], definitive.runtime)).exitCode).toBe(EXIT_CODES.CONFLICT)
  })

  it('bounds settlement retries and emits partial after a successful remote mutation cannot be consumed', async () => {
    const recovered = fixture({ config: profileConfig() })
    recovered.credentials.values.set('prod', 'bearer')
    const command = ['careers', 'jobs', 'delete', 'ea', '--version', '1']
    const plan = await runCli(['--json', ...command], recovered.runtime)
    const digest = (plan.result as { ok: true; data: { digest: string } }).data.digest
    const settle = recovered.config.settlePendingPlan.bind(recovered.config)
    let transientAttempts = 0
    recovered.config.settlePendingPlan = async (...args) => {
      transientAttempts += 1
      if (transientAttempts < 3) throw new CliError('CONFIG_BUSY', 'busy', EXIT_CODES.CONFIG)
      return settle(...args)
    }
    expect((await runCli(['--json', ...command, '--apply', digest, '--yes'], recovered.runtime)).exitCode).toBe(EXIT_CODES.SUCCESS)
    expect(transientAttempts).toBe(3)
    expect(recovered.transport.requests).toHaveLength(1)

    const partial = fixture({ config: profileConfig() })
    partial.credentials.values.set('prod', 'bearer')
    const partialPlan = await runCli(['--json', ...command], partial.runtime)
    const partialDigest = (partialPlan.result as { ok: true; data: { digest: string } }).data.digest
    let failedAttempts = 0
    partial.config.settlePendingPlan = async () => {
      failedAttempts += 1
      throw new CliError('CONFIG_BUSY', 'busy', EXIT_CODES.CONFIG)
    }
    const result = await runCli(['--json', ...command, '--apply', partialDigest, '--yes'], partial.runtime)
    expect(result.exitCode).toBe(EXIT_CODES.PARTIAL)
    expect(result.result).toMatchObject({ ok: false, error: { code: 'MUTATION_SETTLEMENT_PARTIAL' }, meta: { requestId: 'request-test' } })
    expect(failedAttempts).toBe(3)
    expect(partial.transport.requests).toHaveLength(1)
    expect(partial.config.value.pendingPlans?.[partialDigest]?.state).toBe('in-flight')
    expect((await runCli(['--json', ...command, '--apply', partialDigest, '--yes'], partial.runtime)).exitCode).toBe(EXIT_CODES.CONFLICT)
    expect(partial.transport.requests).toHaveLength(1)
  })

  it('bounds reservation contention and fails closed as conflict before transport', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    const command = ['careers', 'jobs', 'delete', 'ea', '--version', '1']
    const plan = await runCli(['--json', ...command], f.runtime)
    const digest = (plan.result as { ok: true; data: { digest: string } }).data.digest
    let attempts = 0
    f.config.reservePendingPlan = async () => {
      attempts += 1
      throw new CliError('CONFIG_BUSY', 'busy', EXIT_CODES.CONFIG)
    }
    expect((await runCli(['--json', ...command, '--apply', digest, '--yes'], f.runtime)).exitCode).toBe(EXIT_CODES.CONFLICT)
    expect(attempts).toBe(3)
    expect(f.transport.requests).toHaveLength(0)
  })

  it('provides an explicit no-transport operator path for ambiguous in-flight plans', async () => {
    const f = fixture({ config: profileConfig() })
    f.credentials.values.set('prod', 'bearer')
    const command = ['careers', 'jobs', 'delete', 'ea', '--version', '1']
    const planned = await runCli(['--json', ...command], f.runtime)
    const digest = (planned.result as { ok: true; data: { digest: string } }).data.digest
    expect(await f.config.reservePendingPlan(digest, 'careers.jobs.delete', 'ea', f.runtime.now().getTime(), 'operator-reservation')).toBe(true)
    expect((await runCli(['--json', 'plans', 'list'], f.runtime)).result).toMatchObject({ ok: true, data: [{ digest, state: 'in-flight' }] })
    expect((await runCli(['--json', 'plans', 'show', digest], f.runtime)).result).toMatchObject({ ok: true, data: { digest, reservationId: '<redacted>' } })
    expect((await runCli(['--json', 'plans', 'resolve', digest, '--outcome', 'not-applied'], f.runtime)).exitCode).toBe(EXIT_CODES.CANCELLED)
    expect(f.config.value.pendingPlans?.[digest]?.state).toBe('in-flight')
    const resolved = await runCli(['--json', 'plans', 'resolve', digest, '--outcome', 'not-applied', '--yes'], f.runtime)
    expect(resolved.exitCode).toBe(EXIT_CODES.SUCCESS)
    expect(resolved.result).toMatchObject({ ok: true, data: { digest, resolved: true, outcome: 'not-applied' } })
    expect(JSON.stringify(resolved.result)).toContain('independently verifying')
    expect(f.transport.requests).toHaveLength(0)
    expect(f.config.value.pendingPlans?.[digest]?.state).toBe('pending')
    expect((await runCli(['--json', ...command, '--apply', digest, '--yes'], f.runtime)).exitCode).toBe(EXIT_CODES.SUCCESS)
    expect(f.transport.requests).toHaveLength(1)

    const applied = fixture({ config: profileConfig() })
    applied.credentials.values.set('prod', 'bearer')
    const nextPlan = await runCli(['--json', ...command], applied.runtime)
    const nextDigest = (nextPlan.result as { ok: true; data: { digest: string } }).data.digest
    expect(await applied.config.reservePendingPlan(nextDigest, 'careers.jobs.delete', 'ea', applied.runtime.now().getTime(), 'applied-reservation')).toBe(true)
    expect((await runCli(['--json', 'plans', 'resolve', nextDigest, '--outcome', 'applied', '--yes'], applied.runtime)).exitCode).toBe(EXIT_CODES.SUCCESS)
    expect(applied.config.value.pendingPlans?.[nextDigest]).toBeUndefined()
    expect(applied.transport.requests).toHaveLength(0)
    expect((await runCli(['--json', 'plans', 'show', 'sha256:not-a-digest'], applied.runtime)).exitCode).toBe(EXIT_CODES.VALIDATION)
  })

  it('enforces secret input limits in UTF-8 bytes', async () => {
    await expect(readStdinLine(Readable.from('é'.repeat(524_289)))).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
    const input = new PassThrough() as PassThrough & { isTTY: true; setRawMode(value: boolean): void }
    input.isTTY = true
    input.setRawMode = () => undefined
    const pending = readHiddenSecret('Secret: ', input as never, new Capture() as never)
    input.write(Buffer.from('é'.repeat(524_289)))
    await expect(pending).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
  })

  it('binds future account plans to profile, API, org, and provider context', async () => {
    const provider: HasnaProvider = {
      id: 'future',
      manifest: { schema: 'hasna.app_manifest.v1', id: 'future', name: 'Future', version: '2.0.0', provider: 'builtin:future', description: 'test', capabilities: ['accounts.provision'], api: { openApiPath: '/openapi.json', minimumVersion: '1.0.0' }, execution: 'none' },
      accounts: { list: async () => [], show: async () => ({}), provision: async () => ({}) },
    }
    builtinProviders.set(provider.id, provider)
    try {
      const f = fixture({ config: profileConfig() })
      f.credentials.values.set('prod', 'bearer')
      await runCli(['--json', 'accounts', 'provision', '--app', 'future'], f.runtime)
      expect(JSON.parse(f.stdout.value).data.changes.context).toEqual({ profile: 'prod', apiUrl: 'https://hasna.com', org: 'hasna', provider: 'builtin:future', providerVersion: '2.0.0' })
    } finally {
      builtinProviders.delete(provider.id)
    }
  })
})
