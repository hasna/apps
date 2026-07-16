import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/runner.js'
import { EXIT_CODES } from '../src/errors.js'
import { CliError } from '../src/errors.js'
import { readHiddenSecret } from '../src/secret-input.js'
import { validateApiUrl } from '../src/config.js'
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
    expect(JSON.parse(f.stdout.value).meta.command).toBe('auth login')
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
})
