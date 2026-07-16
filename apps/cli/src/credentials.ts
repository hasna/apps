import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { spawn } from 'node:child_process'
import type { Profile } from './config.js'
import { CliError, EXIT_CODES } from './errors.js'
import { atomicWritePrivateFile, readPrivateFile } from './local-files.js'

const scrypt = promisify(scryptCallback)
const SERVICE = 'hasna-cli'

export interface SecretStore {
  get(profile: string): Promise<string | undefined>
  set(profile: string, value: string): Promise<void>
  delete(profile: string): Promise<void>
}

export type ProcessResult = { code: number; stdout: string; stderr: string }
export type ProcessRunner = (
  executable: string,
  args: string[],
  stdin?: string,
) => Promise<ProcessResult>

export const runProcess: ProcessRunner = (executable, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    child.stdin.end(stdin)
  })

export class OsKeychainStore implements SecretStore {
  constructor(
    private readonly runner: ProcessRunner = runProcess,
    private readonly os = platform(),
  ) {}

  async get(profile: string): Promise<string | undefined> {
    try {
      const result = await this.invoke('get', profile)
      if (result.code !== 0) return undefined
      return result.stdout.trim() || undefined
    } catch {
      return undefined
    }
  }

  async set(profile: string, value: string): Promise<void> {
    try {
      const result = await this.invoke('set', profile, value)
      if (result.code === 0) return
    } catch {
      // The typed error below is intentionally independent of platform command details.
    }
      throw new CliError(
        'KEYCHAIN_UNAVAILABLE',
        'The OS keychain could not store the credential; opt in to encrypted-file storage explicitly',
        EXIT_CODES.CONFIG,
      )
  }

  async delete(profile: string): Promise<void> {
    try {
      const result = await this.invoke('delete', profile)
      if (result.code === 0) return
    } catch (error) {
      throw new CliError('KEYCHAIN_DELETE_FAILED', 'The OS keychain could not delete the credential', EXIT_CODES.CONFIG, { cause: error })
    }
    throw new CliError('KEYCHAIN_DELETE_FAILED', 'The OS keychain could not delete the credential', EXIT_CODES.CONFIG)
  }

  private invoke(operation: 'get' | 'set' | 'delete', profile: string, secret?: string) {
    if (this.os === 'linux') {
      if (operation === 'get')
        return this.runner('secret-tool', ['lookup', 'service', SERVICE, 'profile', profile])
      if (operation === 'delete')
        return this.runner('secret-tool', ['clear', 'service', SERVICE, 'profile', profile])
      return this.runner(
        'secret-tool',
        ['store', '--label', `Hasna CLI (${profile})`, 'service', SERVICE, 'profile', profile],
        secret,
      )
    }
    if (this.os === 'darwin') {
      if (operation === 'get')
        return this.runner('security', ['find-generic-password', '-s', SERVICE, '-a', profile, '-w'])
      if (operation === 'delete')
        return this.runner('security', ['delete-generic-password', '-s', SERVICE, '-a', profile])
      // Omitting the value after -w makes `security` read it interactively from stdin.
      return this.runner(
        'security',
        ['add-generic-password', '-U', '-s', SERVICE, '-a', profile, '-w'],
        `${secret ?? ''}\n`,
      )
    }
    return Promise.resolve({ code: 1, stdout: '', stderr: 'unsupported platform' })
  }
}

type EncryptedDocument = {
  schema: 'hasna.encrypted_credentials.v1'
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

export function encryptedCredentialPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config')
  return join(root, 'hasna', 'credentials.enc.json')
}

export class EncryptedFileStore implements SecretStore {
  constructor(
    private readonly passphrase: () => Promise<string>,
    readonly path = encryptedCredentialPath(),
  ) {}

  async get(profile: string): Promise<string | undefined> {
    return (await this.readAll())[profile]
  }

  async set(profile: string, value: string): Promise<void> {
    const values = await this.readAll()
    values[profile] = value
    await this.writeAll(values)
  }

  async delete(profile: string): Promise<void> {
    try { await lstat(this.path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const values = await this.readAll()
    if (!(profile in values)) return
    delete values[profile]
    await this.writeAll(values)
  }

  private async readAll(): Promise<Record<string, string>> {
    let document: EncryptedDocument
    try {
      document = JSON.parse(await readPrivateFile(this.path)) as EncryptedDocument
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw new CliError('CREDENTIAL_FILE_INVALID', 'Encrypted credential file is invalid', EXIT_CODES.CONFIG)
    }
    if (document.schema !== 'hasna.encrypted_credentials.v1')
      throw new CliError('CREDENTIAL_FILE_INVALID', 'Encrypted credential file is invalid', EXIT_CODES.CONFIG)
    const fields = Object.keys(document as unknown as Record<string, unknown>).sort()
    if (fields.join(',') !== 'ciphertext,iv,salt,schema,tag' ||
      ![document.salt, document.iv, document.tag, document.ciphertext].every((value) => typeof value === 'string') ||
      Buffer.from(document.salt, 'base64').length !== 16 || Buffer.from(document.iv, 'base64').length !== 12 || Buffer.from(document.tag, 'base64').length !== 16)
      throw new CliError('CREDENTIAL_FILE_INVALID', 'Encrypted credential file is invalid', EXIT_CODES.CONFIG)
    try {
      const key = (await scrypt(await this.passphrase(), Buffer.from(document.salt, 'base64'), 32)) as Buffer
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(document.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(document.tag, 'base64'))
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(document.ciphertext, 'base64')),
        decipher.final(),
      ])
      return JSON.parse(plaintext.toString('utf8')) as Record<string, string>
    } catch (error) {
      throw new CliError(
        'CREDENTIAL_DECRYPT_FAILED',
        'Encrypted credentials could not be decrypted',
        EXIT_CODES.AUTH,
        { cause: error },
      )
    }
  }

  private async writeAll(values: Record<string, string>): Promise<void> {
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const key = (await scrypt(await this.passphrase(), salt, 32)) as Buffer
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(values), 'utf8'),
      cipher.final(),
    ])
    const document: EncryptedDocument = {
      schema: 'hasna.encrypted_credentials.v1',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
    await atomicWritePrivateFile(this.path, `${JSON.stringify(document)}\n`)
  }
}

export class CredentialManager {
  constructor(
    private readonly keychain: SecretStore,
    private readonly encrypted?: SecretStore,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async resolve(profile: Profile): Promise<string> {
    if (profile.credential?.startsWith('env:')) {
      const name = profile.credential.slice(4)
      const value = this.env[name]
      if (value) return value
    }
    const keychain = await this.keychain.get(profile.name)
    if (keychain) return keychain
    if (profile.credentialStore === 'encrypted-file' && this.encrypted) {
      const encrypted = await this.encrypted.get(profile.name)
      if (encrypted) return encrypted
    }
    throw new CliError('AUTH_REQUIRED', `No credential is available for profile ${profile.name}`, EXIT_CODES.AUTH)
  }

  async store(profile: Profile, token: string): Promise<Profile> {
    if (profile.credential?.startsWith('env:'))
      throw new CliError(
        'ENV_CREDENTIAL_READ_ONLY',
        'Environment credential references are read-only',
        EXIT_CODES.CONFIG,
      )
    if (profile.credentialStore === 'encrypted-file') {
      if (!this.encrypted)
        throw new CliError('ENCRYPTED_STORE_UNAVAILABLE', 'Encrypted storage is unavailable', EXIT_CODES.CONFIG)
      await this.encrypted.set(profile.name, token)
      return { ...profile, credential: `encrypted-file:${profile.name}` }
    }
    await this.keychain.set(profile.name, token)
    return { ...profile, credentialStore: 'keychain', credential: `keychain:${profile.name}` }
  }

  async delete(profile: Profile): Promise<void> {
    if (profile.credential?.startsWith('env:')) return
    if (profile.credentialStore === 'encrypted-file' || profile.credential?.startsWith('encrypted-file:')) {
      if (!this.encrypted) throw new CliError('ENCRYPTED_STORE_UNAVAILABLE', 'Encrypted storage is unavailable', EXIT_CODES.CONFIG)
      await this.encrypted.delete(profile.name)
      return
    }
    await this.keychain.delete(profile.name)
  }
}
