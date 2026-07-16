import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialManager, EncryptedFileStore, OsKeychainStore, type ProcessRunner, type SecretStore } from '../src/credentials.js'
import { createPlan, requirePlanApproval } from '../src/plan.js'
import { CliError, EXIT_CODES } from '../src/errors.js'
import { defaultConfig, FileConfigStore } from '../src/config.js'
import { runCli } from '../src/runner.js'
import { fixture, profileConfig } from './helpers.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('credential and mutation security', () => {
  it('encrypts credential files with authenticated encryption and no plaintext token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hasna-credentials-'))
    temporary.push(directory)
    const path = join(directory, 'credentials.enc.json')
    const store = new EncryptedFileStore(async () => 'correct horse battery staple', path)
    await store.set('prod', 'cweb_secret_token_value')
    const raw = await readFile(path, 'utf8')
    expect(raw).not.toContain('cweb_secret_token_value')
    expect(JSON.parse(raw)).toMatchObject({ schema: 'hasna.encrypted_credentials.v1' })
    expect(await store.get('prod')).toBe('cweb_secret_token_value')

    const wrong = new EncryptedFileStore(async () => 'wrong passphrase', path)
    await expect(wrong.get('prod')).rejects.toMatchObject({ code: 'CREDENTIAL_DECRYPT_FAILED' })
  })

  it('passes keychain secrets through stdin and never argv or a shell', async () => {
    const calls: Array<{ executable: string; args: string[]; stdin?: string }> = []
    const runner: ProcessRunner = async (executable, args, stdin) => {
      calls.push({ executable, args, stdin })
      return { code: 0, stdout: '', stderr: '' }
    }
    const store = new OsKeychainStore(runner, 'linux')
    await store.set('prod', 'keychain-secret')
    expect(calls[0]?.executable).toBe('secret-tool')
    expect(calls[0]?.args.join(' ')).not.toContain('keychain-secret')
    expect(calls[0]?.stdin).toBe('keychain-secret')
  })

  it('creates deterministic plans and rejects mismatch or absent confirmation', () => {
    const one = createPlan('apps.install', 'cweb', { version: '1.1.0', enabled: true })
    const two = createPlan('apps.install', 'cweb', { enabled: true, version: '1.1.0' })
    expect(one.digest).toBe(two.digest)
    expect(() => requirePlanApproval(one, `sha256:${'0'.repeat(64)}`, true)).toThrowError(CliError)
    expect(() => requirePlanApproval(one, one.digest, false)).toThrowError(CliError)
    expect(() => requirePlanApproval(one, one.digest, true)).not.toThrow()
  })

  it('keeps public exit code meanings stable', () => {
    expect(EXIT_CODES.CONFIG).toBe(2)
    expect(EXIT_CODES.AUTH).toBe(3)
    expect(EXIT_CODES.REMOTE).toBe(8)
    expect(EXIT_CODES.UNSUPPORTED).toBe(11)
    expect(EXIT_CODES.INTERNAL).toBe(70)
  })

  it('rejects symlinked private config state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hasna-config-'))
    temporary.push(directory)
    const target = join(directory, 'target.json')
    const path = join(directory, 'config.json')
    await writeFile(target, '{}', { mode: 0o600 })
    await chmod(directory, 0o700)
    await symlink(target, path)
    await expect(new FileConfigStore(path).load()).rejects.toMatchObject({ code: 'CONFIG_INVALID', exitCode: EXIT_CODES.CONFIG })
  })

  it('deletes credentials only from the selected store', async () => {
    const calls: string[] = []
    const store = (name: string): SecretStore => ({
      get: async () => undefined,
      set: async () => undefined,
      delete: async () => { calls.push(name) },
    })
    const manager = new CredentialManager(store('keychain'), store('encrypted'))
    await manager.delete({ name: 'prod', apiUrl: 'https://hasna.com', credentialStore: 'keychain', credential: 'keychain:prod' })
    expect(calls).toEqual(['keychain'])
  })

  it('recovers only stale dead-owner config locks and preserves live locks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hasna-lock-'))
    temporary.push(directory)
    await chmod(directory, 0o700)
    const configPath = join(directory, 'config.json')
    const lockPath = join(directory, '.config.json.lock')
    const stale = { schema: 'hasna.cli_lock.v1', owner: '00000000-0000-4000-8000-000000000001', pid: 99999999, createdAt: new Date(Date.now() - 600_000).toISOString() }
    await writeFile(lockPath, `${JSON.stringify(stale)}\n`, { mode: 0o600 })
    await new FileConfigStore(configPath).save(defaultConfig())
    const live = { ...stale, owner: '00000000-0000-4000-8000-000000000002', pid: process.pid }
    await writeFile(lockPath, `${JSON.stringify(live)}\n`, { mode: 0o600 })
    await expect(new FileConfigStore(configPath).save(defaultConfig())).rejects.toMatchObject({ code: 'CONFIG_BUSY' })
    await rm(lockPath)
    const store = new FileConfigStore(configPath)
    await store.save(profileConfig())
    const liveContents = `${JSON.stringify(live)}\n`
    await writeFile(lockPath, liveContents, { mode: 0o600 })
    const f = fixture({ config: profileConfig() })
    f.runtime.config = store
    f.credentials.values.set('prod', 'bearer')
    const result = await runCli(['--json', 'careers', 'jobs', 'delete', 'ea', '--version', '1'], f.runtime)
    expect(result.exitCode).toBe(EXIT_CODES.CONFLICT)
    expect(f.transport.requests).toHaveLength(0)
    expect(await readFile(lockPath, 'utf8')).toBe(liveContents)
  })

  it('reuses a pending file-backed plan but never resets an in-flight reservation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hasna-plan-record-'))
    temporary.push(directory)
    await chmod(directory, 0o700)
    const store = new FileConfigStore(join(directory, 'config.json'))
    const digest = `sha256:${'a'.repeat(64)}`
    const now = Date.now()
    const first = { operation: 'careers.jobs.delete', target: 'ea', expiresAt: new Date(now + 60_000).toISOString() }
    expect(await store.recordPendingPlan(digest, first, now)).toBe('created')
    expect(await store.recordPendingPlan(digest, { ...first, expiresAt: new Date(now + 120_000).toISOString() }, now + 1)).toBe('reused')
    expect((await store.load()).pendingPlans?.[digest]?.expiresAt).toBe(first.expiresAt)
    expect(await store.reservePendingPlan(digest, first.operation, first.target, now + 2, 'reservation-1')).toBe(true)
    const reserved = structuredClone((await store.load()).pendingPlans?.[digest])
    expect(await store.recordPendingPlan(digest, first, now + 3)).toBe('in-flight')
    expect((await store.load()).pendingPlans?.[digest]).toEqual(reserved)
    const expiredDigest = `sha256:${'b'.repeat(64)}`
    const expired = { ...first, expiresAt: new Date(now - 1_000).toISOString() }
    expect(await store.recordPendingPlan(expiredDigest, expired, now - 2_000)).toBe('created')
    const replacement = { ...first, expiresAt: new Date(now + 180_000).toISOString() }
    expect(await store.recordPendingPlan(expiredDigest, replacement, now)).toBe('created')
    expect((await store.load()).pendingPlans?.[expiredDigest]?.expiresAt).toBe(replacement.expiresAt)
    const crashDigest = `sha256:${'c'.repeat(64)}`
    expect(await store.recordPendingPlan(crashDigest, first, now)).toBe('created')
    expect(await store.reservePendingPlan(crashDigest, first.operation, first.target, now + 1, 'reservation-crash')).toBe(true)
    await store.update((config) => {
      config.pendingPlans![crashDigest]!.expiresAt = new Date(now - 1).toISOString()
    })
    const crashReservation = structuredClone((await store.load()).pendingPlans?.[crashDigest])
    expect(await store.recordPendingPlan(crashDigest, replacement, now)).toBe('in-flight')
    expect((await store.load()).pendingPlans?.[crashDigest]).toEqual(crashReservation)
  })

  it('allows exactly one destructive call across independent file-store runtimes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hasna-plan-race-'))
    temporary.push(directory)
    await chmod(directory, 0o700)
    const configPath = join(directory, 'config.json')
    await new FileConfigStore(configPath).save(profileConfig())
    const first = fixture({ config: profileConfig() })
    const second = fixture({ config: profileConfig() })
    first.runtime.config = new FileConfigStore(configPath)
    second.runtime.config = new FileConfigStore(configPath)
    first.credentials.values.set('prod', 'bearer')
    second.credentials.values.set('prod', 'bearer')
    second.runtime.transport = () => first.transport
    const command = ['careers', 'jobs', 'delete', 'ea', '--version', '1']
    const planned = await runCli(['--json', ...command], first.runtime)
    const digest = (planned.result as { ok: true; data: { digest: string } }).data.digest
    let release!: () => void
    first.transport.request = async (options) => {
      first.transport.requests.push(structuredClone(options))
      return new Promise((resolve) => {
        release = () => resolve({ status: 200, headers: {}, body: { ok: true, data: {} }, text: '{}', requestId: 'file-race-request' })
      })
    }
    const firstApply = runCli(['--json', ...command, '--apply', digest, '--yes'], first.runtime)
    while (!release) await new Promise((resolve) => setImmediate(resolve))
    second.runtime.now = () => new Date('2026-07-16T12:11:00.000Z')
    const reserved = structuredClone((await first.runtime.config.load()).pendingPlans?.[digest])
    expect((await runCli(['--json', ...command], second.runtime)).exitCode).toBe(EXIT_CODES.CONFLICT)
    expect((await second.runtime.config.load()).pendingPlans?.[digest]).toEqual(reserved)
    expect((await runCli(['--json', ...command, '--apply', digest, '--yes'], second.runtime)).exitCode).toBe(EXIT_CODES.CONFLICT)
    expect(first.transport.requests).toHaveLength(1)
    release()
    expect((await firstApply).exitCode).toBe(EXIT_CODES.SUCCESS)
    expect(first.transport.requests).toHaveLength(1)
  })
})
