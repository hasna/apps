import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialManager, EncryptedFileStore, OsKeychainStore, type ProcessRunner, type SecretStore } from '../src/credentials.js'
import { createPlan, requirePlanApproval } from '../src/plan.js'
import { CliError, EXIT_CODES } from '../src/errors.js'
import { defaultConfig, FileConfigStore } from '../src/config.js'

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
  })
})
