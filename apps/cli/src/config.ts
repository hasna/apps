import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { CliError, EXIT_CODES } from './errors.js'

export type CredentialStoreKind = 'keychain' | 'encrypted-file'
export type Profile = {
  name: string
  apiUrl: string
  orgSlug?: string
  credential?: `env:${string}` | `keychain:${string}` | `encrypted-file:${string}`
  credentialStore?: CredentialStoreKind
  connectTimeoutMs?: number
  requestTimeoutMs?: number
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
}

export interface ConfigStore {
  readonly path: string
  load(): Promise<Config>
  save(config: Config): Promise<void>
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
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<Config>
      if (parsed.schema !== 'hasna.cli_config.v1' || !parsed.profiles || !parsed.apps)
        throw new Error('schema mismatch')
      return parsed as Config
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig()
      throw new CliError('CONFIG_INVALID', 'The CLI configuration is invalid', EXIT_CODES.CONFIG, {
        cause: error,
      })
    }
  }

  async save(config: Config): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    await chmod(temporary, 0o600)
    await rename(temporary, this.path)
  }
}

export function validateProfileName(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name))
    throw new CliError('VALIDATION_ERROR', 'Invalid profile name', EXIT_CODES.VALIDATION)
}

export function validateApiUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new CliError('VALIDATION_ERROR', 'Invalid API URL', EXIT_CODES.VALIDATION)
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new CliError(
      'VALIDATION_ERROR',
      'API URLs must use HTTPS except localhost',
      EXIT_CODES.VALIDATION,
    )
  url.pathname = url.pathname.replace(/\/$/, '')
  return url.toString().replace(/\/$/, '')
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
