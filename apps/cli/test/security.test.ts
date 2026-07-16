import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EncryptedFileStore, OsKeychainStore, type ProcessRunner } from '../src/credentials.js'
import { createPlan, requirePlanApproval } from '../src/plan.js'
import { CliError, EXIT_CODES } from '../src/errors.js'

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
    expect(EXIT_CODES.CONFIG).toBe(3)
    expect(EXIT_CODES.AUTH).toBe(4)
    expect(EXIT_CODES.UNSUPPORTED).toBe(11)
    expect(EXIT_CODES.INTERNAL).toBe(70)
  })
})
