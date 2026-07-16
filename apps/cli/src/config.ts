import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { constants } from 'node:fs'
import { mkdir, open, rm } from 'node:fs/promises'
import { CliError, EXIT_CODES } from './errors.js'
import { atomicWritePrivateFile, readPrivateFile } from './local-files.js'

export type CredentialStoreKind = 'keychain' | 'encrypted-file'
export type Profile = {
  name: string
  apiUrl: string
  orgSlug?: string
  credential?: `env:${string}` | `keychain:${string}` | `encrypted-file:${string}`
  credentialStore?: CredentialStoreKind
  connectTimeoutMs?: number
  requestTimeoutMs?: number
  allowInsecureLocalhost?: boolean
}

export type InstalledApp = {
  id: string
  version: string
  provider: string
  installedAt: string
  updatedAt: string
}

export type Config = {
  schema: 'hasna.cli_config.v1'
  currentProfile?: string
  profiles: Record<string, Profile>
  apps: Record<string, InstalledApp>
  pendingPlans?: Record<string, { operation: string; target: string; expiresAt: string; used?: boolean }>
}

export interface ConfigStore {
  readonly path: string
  load(): Promise<Config>
  save(config: Config): Promise<void>
  recordPendingPlan(digest: string, entry: NonNullable<Config['pendingPlans']>[string]): Promise<void>
  consumePendingPlan(digest: string, operation: string, target: string, now: number): Promise<boolean>
}

export function defaultConfig(): Config {
  return { schema: 'hasna.cli_config.v1', profiles: {}, apps: {} }
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config')
  return join(root, 'hasna', 'config.json')
}

export class FileConfigStore implements ConfigStore {
  readonly path: string
  constructor(path = configPath()) {
    this.path = path
  }

  async load(): Promise<Config> {
    try {
      const parsed = JSON.parse(await readPrivateFile(this.path)) as unknown
      return validateConfig(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig()
      throw new CliError('CONFIG_INVALID', 'The CLI configuration is invalid', EXIT_CODES.CONFIG, {
        cause: error,
      })
    }
  }

  async save(config: Config): Promise<void> {
    const validated = validateConfig(config)
    await atomicWritePrivateFile(this.path, `${JSON.stringify(validated, null, 2)}\n`)
  }

  async recordPendingPlan(digest: string, entry: NonNullable<Config['pendingPlans']>[string]): Promise<void> {
    await this.mutatePlans((config) => {
      config.pendingPlans ??= {}
      config.pendingPlans = Object.fromEntries(Object.entries(config.pendingPlans).filter(([, item]) => Date.parse(item.expiresAt) > Date.now() && !item.used))
      config.pendingPlans[digest] = entry
    })
  }

  async consumePendingPlan(digest: string, operation: string, target: string, now: number): Promise<boolean> {
    let consumed = false
    await this.mutatePlans((config) => {
      config.pendingPlans ??= {}
      const pending = config.pendingPlans[digest]
      consumed = Boolean(pending && !pending.used && Date.parse(pending.expiresAt) > now && pending.operation === operation && pending.target === target)
      if (consumed) delete config.pendingPlans[digest]
    })
    return consumed
  }

  private async mutatePlans(update: (config: Config) => void): Promise<void> {
    const directory = dirname(this.path)
    const lockPath = join(directory, '.plans.lock')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    let lock
    try {
      lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600)
    } catch (error) {
      throw new CliError('CONFIG_BUSY', 'Another CLI process is updating mutation plans', EXIT_CODES.CONFIG, { cause: error })
    }
    try {
      const config = await this.load()
      update(config)
      await this.save(config)
    } finally {
      await lock.close()
      await rm(lockPath, { force: true })
    }
  }
}

export function validateProfileName(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name))
    throw new CliError('VALIDATION_ERROR', 'Invalid profile name', EXIT_CODES.VALIDATION)
}

export function validateApiUrl(raw: string, options: { allowInsecureLocalhost?: boolean } = {}): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new CliError('VALIDATION_ERROR', 'Invalid API URL', EXIT_CODES.VALIDATION)
  }
  if (url.username || url.password || url.hash)
    throw new CliError('VALIDATION_ERROR', 'API URLs cannot contain credentials or fragments', EXIT_CODES.VALIDATION)
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:' && options.allowInsecureLocalhost))
    throw new CliError(
      'VALIDATION_ERROR',
      'API URLs must use HTTPS; localhost HTTP requires --allow-insecure-localhost',
      EXIT_CODES.VALIDATION,
    )
  url.pathname = url.pathname.replace(/\/$/, '')
  return url.toString().replace(/\/$/, '')
}

function validateConfig(value: unknown): Config {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid config')
  const config = value as Partial<Config>
  assertOnlyKeys(config as Record<string, unknown>, ['schema', 'currentProfile', 'profiles', 'apps', 'pendingPlans'])
  if (config.schema !== 'hasna.cli_config.v1' || !isRecord(config.profiles) || !isRecord(config.apps)) throw new Error('schema mismatch')
  const profiles: Record<string, Profile> = {}
  for (const [name, candidate] of Object.entries(config.profiles)) {
    validateProfileName(name)
    if (!isRecord(candidate) || candidate.name !== name || typeof candidate.apiUrl !== 'string') throw new Error('invalid profile')
    assertOnlyKeys(candidate, ['name', 'apiUrl', 'orgSlug', 'credential', 'credentialStore', 'connectTimeoutMs', 'requestTimeoutMs', 'allowInsecureLocalhost'])
    if (candidate.orgSlug !== undefined && (typeof candidate.orgSlug !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(candidate.orgSlug))) throw new Error('invalid org slug')
    if (candidate.credential !== undefined && (typeof candidate.credential !== 'string' || !/^(env:[A-Z_][A-Z0-9_]*|keychain:[a-zA-Z0-9._-]+|encrypted-file:[a-zA-Z0-9._-]+)$/.test(candidate.credential))) throw new Error('invalid credential reference')
    if (candidate.credentialStore !== undefined && candidate.credentialStore !== 'keychain' && candidate.credentialStore !== 'encrypted-file') throw new Error('invalid credential store')
    if (candidate.allowInsecureLocalhost !== undefined && typeof candidate.allowInsecureLocalhost !== 'boolean') throw new Error('invalid localhost policy')
    for (const key of ['connectTimeoutMs', 'requestTimeoutMs'] as const) if (candidate[key] !== undefined && (!Number.isInteger(candidate[key]) || Number(candidate[key]) < 100)) throw new Error('invalid timeout')
    profiles[name] = { ...(candidate as Profile), apiUrl: validateApiUrl(candidate.apiUrl, { allowInsecureLocalhost: candidate.allowInsecureLocalhost === true }) }
  }
  if (config.currentProfile !== undefined && (typeof config.currentProfile !== 'string' || !profiles[config.currentProfile])) throw new Error('invalid current profile')
  for (const [id, app] of Object.entries(config.apps)) {
    if (!isRecord(app) || app.id !== id || typeof app.version !== 'string' || typeof app.provider !== 'string' || typeof app.installedAt !== 'string' || typeof app.updatedAt !== 'string' || Number.isNaN(Date.parse(app.installedAt)) || Number.isNaN(Date.parse(app.updatedAt))) throw new Error('invalid app')
    assertOnlyKeys(app, ['id', 'version', 'provider', 'installedAt', 'updatedAt'])
  }
  if (config.pendingPlans !== undefined) {
    if (!isRecord(config.pendingPlans)) throw new Error('invalid pending plans')
    for (const [digest, plan] of Object.entries(config.pendingPlans)) {
      if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !isRecord(plan) || typeof plan.operation !== 'string' || typeof plan.target !== 'string' || typeof plan.expiresAt !== 'string' || Number.isNaN(Date.parse(plan.expiresAt)) || (plan.used !== undefined && typeof plan.used !== 'boolean')) throw new Error('invalid pending plan')
      assertOnlyKeys(plan, ['operation', 'target', 'expiresAt', 'used'])
    }
  }
  return config as Config
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('unknown config field')
}

export function resolveProfile(config: Config, requested?: string): Profile {
  const name = requested || config.currentProfile
  if (!name)
    throw new CliError('PROFILE_REQUIRED', 'Select a profile with --profile or profiles use', EXIT_CODES.CONFIG)
  const profile = config.profiles[name]
  if (!profile)
    throw new CliError('PROFILE_NOT_FOUND', `Profile ${name} was not found`, EXIT_CODES.CONFIG)
  return profile
}
