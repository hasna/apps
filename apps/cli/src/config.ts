import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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
  pendingPlans?: Record<string, { operation: string; target: string; expiresAt: string; state?: 'pending' | 'in-flight'; reservationId?: string; reservedAt?: string }>
}

export type PendingPlanRecordStatus = 'created' | 'reused' | 'in-flight'

export interface ConfigStore {
  readonly path: string
  load(): Promise<Config>
  save(config: Config): Promise<void>
  update(change: (config: Config) => void | Promise<void>): Promise<Config>
  recordPendingPlan(digest: string, entry: NonNullable<Config['pendingPlans']>[string], now: number): Promise<PendingPlanRecordStatus>
  reservePendingPlan(digest: string, operation: string, target: string, now: number, reservationId: string): Promise<boolean>
  settlePendingPlan(digest: string, reservationId: string, outcome: 'consume' | 'release'): Promise<boolean>
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
    return this.loadUnlocked()
  }

  private async loadUnlocked(): Promise<Config> {
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
    await this.withLock(async () => this.writeUnlocked(config))
  }

  async update(change: (config: Config) => void | Promise<void>): Promise<Config> {
    return this.withLock(async () => {
      const config = await this.loadUnlocked()
      await change(config)
      await this.writeUnlocked(config)
      return config
    })
  }

  async recordPendingPlan(digest: string, entry: NonNullable<Config['pendingPlans']>[string], now: number): Promise<PendingPlanRecordStatus> {
    let status: PendingPlanRecordStatus = 'created'
    await this.update((config) => {
      config.pendingPlans ??= {}
      config.pendingPlans = Object.fromEntries(Object.entries(config.pendingPlans).filter(([, item]) => {
        return item.state === 'in-flight' || Date.parse(item.expiresAt) > now
      }))
      const existing = config.pendingPlans[digest]
      if (existing) {
        status = existing.state === 'in-flight' ? 'in-flight' : 'reused'
        return
      }
      config.pendingPlans[digest] = { ...entry, state: 'pending' }
    })
    return status
  }

  async reservePendingPlan(digest: string, operation: string, target: string, now: number, reservationId: string): Promise<boolean> {
    let reserved = false
    await this.update((config) => {
      config.pendingPlans ??= {}
      const pending = config.pendingPlans[digest]
      if (pending && (pending.state ?? 'pending') === 'pending' && Date.parse(pending.expiresAt) > now && pending.operation === operation && pending.target === target) {
        reserved = true
        config.pendingPlans[digest] = { ...pending, state: 'in-flight', reservationId, reservedAt: new Date(now).toISOString() }
      }
    })
    return reserved
  }

  async settlePendingPlan(digest: string, reservationId: string, outcome: 'consume' | 'release'): Promise<boolean> {
    let settled = false
    await this.update((config) => {
      const pending = config.pendingPlans?.[digest]
      if (!pending || pending.state !== 'in-flight' || pending.reservationId !== reservationId) return
      settled = true
      if (outcome === 'consume') delete config.pendingPlans?.[digest]
      else config.pendingPlans![digest] = { operation: pending.operation, target: pending.target, expiresAt: pending.expiresAt, state: 'pending' }
    })
    return settled
  }

  private async writeUnlocked(config: Config): Promise<void> {
    const validated = validateConfig(config)
    await atomicWritePrivateFile(this.path, `${JSON.stringify(validated, null, 2)}\n`, { skipLock: true })
  }

  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    const directory = dirname(this.path)
    const lockPath = join(directory, `.${basename(this.path)}.lock`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const owner = randomUUID()
    const lock = await this.acquireLock(lockPath, owner)
    try {
      return await action()
    } finally {
      await lock.close()
      try {
        const metadata = JSON.parse(await readPrivateFile(lockPath, 4096)) as { owner?: unknown }
        if (metadata.owner === owner) await rm(lockPath, { force: true })
      } catch {
        // A replaced lock belongs to another process and must not be removed.
      }
    }
  }

  private async acquireLock(lockPath: string, owner: string): Promise<Awaited<ReturnType<typeof open>>> {
    const candidate = `${lockPath}.${owner}`
    const handle = await open(candidate, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600)
    try {
      await handle.writeFile(`${JSON.stringify({ schema: 'hasna.cli_lock.v1', owner, pid: process.pid, createdAt: new Date().toISOString() })}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      try {
        await link(candidate, lockPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !(await this.recoverStaleLock(lockPath)))
          throw new CliError('CONFIG_BUSY', 'Another CLI process is updating local state', EXIT_CODES.CONFIG, { cause: error })
        try {
          await link(candidate, lockPath)
        } catch (retryError) {
          throw new CliError('CONFIG_BUSY', 'Another CLI process is updating local state', EXIT_CODES.CONFIG, { cause: retryError })
        }
      }
      return await open(lockPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    } finally {
      await rm(candidate, { force: true })
    }
  }

  private async recoverStaleLock(lockPath: string): Promise<boolean> {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(lockPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      const original = await handle.stat()
      if (!original.isFile() || original.nlink < 1 || original.nlink > 2 || original.size > 4096) return false
      const metadata = JSON.parse(await handle.readFile('utf8')) as { owner?: unknown; pid?: unknown; createdAt?: unknown }
      const createdAt = typeof metadata.createdAt === 'string' ? Date.parse(metadata.createdAt) : Number.NaN
      if (typeof metadata.owner !== 'string' || !/^[0-9a-f-]{36}$/.test(metadata.owner) || !Number.isInteger(metadata.pid) || !Number.isFinite(createdAt) || Date.now() - createdAt < 5 * 60_000 || isProcessAlive(metadata.pid as number)) return false
      const current = await lstat(lockPath)
      if (current.ino !== original.ino || current.dev !== original.dev) return false
      await rm(lockPath)
      await rm(`${lockPath}.${metadata.owner}`, { force: true })
      return true
    } catch {
      return false
    } finally {
      await handle?.close()
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
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
      if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !isRecord(plan) || typeof plan.operation !== 'string' || typeof plan.target !== 'string' || typeof plan.expiresAt !== 'string' || Number.isNaN(Date.parse(plan.expiresAt)) || (plan.state !== undefined && plan.state !== 'pending' && plan.state !== 'in-flight') || (plan.reservationId !== undefined && typeof plan.reservationId !== 'string') || (plan.reservedAt !== undefined && (typeof plan.reservedAt !== 'string' || Number.isNaN(Date.parse(plan.reservedAt))))) throw new Error('invalid pending plan')
      assertOnlyKeys(plan, ['operation', 'target', 'expiresAt', 'state', 'reservationId', 'reservedAt'])
      if (plan.state === 'in-flight' && (typeof plan.reservationId !== 'string' || typeof plan.reservedAt !== 'string')) throw new Error('invalid reservation')
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
