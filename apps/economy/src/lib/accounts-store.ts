/**
 * Minimal account-registry store for economy's attribution read path.
 *
 * Vendored from `@hasna/accounts` 0.2.23 (public package deprecated for
 * deletion; replacement `@hasna-internal/subscriptions` is not yet published,
 * so no dependency can point at it yet). Economy only ever used the READ side
 * of the store: `appliedProfileName` + `resolveStore` over profiles/tools for
 * spend attribution. The full accounts CLI surface (apply/launch/add/remove…)
 * is not needed here and is deliberately NOT vendored.
 *
 * Behavior mirrors @hasna/accounts 0.2.23 exactly for the vendored surface:
 *  - Local transport: on-box JSON registry at `~/.hasna/accounts/accounts.json`
 *    (env overrides `ACCOUNTS_HOME` / `ACCOUNTS_STORE_PATH`), store shape
 *    `{ version: 1, current, applied, toolLocks, profiles, tools }`, and the
 *    same parse/validation failure modes.
 *  - API transport: self-hosted accounts-serve at `<API_URL>/v1` via
 *    `HASNA_ACCOUNTS_API_URL` + `HASNA_ACCOUNTS_API_KEY` (legacy aliases
 *    `ACCOUNTS_API_URL` / `ACCOUNTS_API_KEY`), bearer + `x-api-key` auth,
 *    30s timeout, 2 retries on 408/425/429/5xx with jittered backoff — the
 *    contracts 0.5.2 HTTP-transport defaults @hasna/accounts shipped with.
 *  - Storage-mode semantics: `local` forces the local transport; `cloud` /
 *    `self_hosted` require the URL+key pair (else throw); an unset mode uses
 *    the API when the pair is present; invalid modes throw; retired modes
 *    (`remote`/`hybrid`/`s3`) degrade to the pair rule.
 *
 * When @hasna-internal/subscriptions is published, this file can be replaced
 * by a thin adapter over its SubscriptionsStore (same shape, new env vars).
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

/** Profile-name validator: same slug rule as @hasna/accounts. */
const profileNameSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lowercase alphanumeric/hyphen and start with a letter or digit')

/** Minimal profile record — the fields economy's attribution reads. */
const profileSchema = z.object({
  name: z.string(),
  tool: z.string(),
  email: z.string().optional(),
  displayName: z.string().optional(),
  dir: z.string(),
  description: z.string().optional(),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
})

/** Minimal tool definition — economy reads `id` and `envVar` (dir matching). */
const toolDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  envVar: z.string(),
  defaultDir: z.string(),
  bin: z.string(),
})

/** On-box registry file shape (identical to @hasna/accounts 0.2.23). */
const storeSchema = z.object({
  version: z.literal(1),
  current: z.record(z.string(), z.string()).default({}),
  applied: z.record(z.string(), z.string()).default({}),
  toolLocks: z.record(z.string(), z.string()).default({}),
  profiles: z.array(profileSchema).default([]),
  tools: z.array(toolDefSchema).default([]),
})

export type Profile = z.infer<typeof profileSchema>
export type ToolDef = z.infer<typeof toolDefSchema>

/**
 * The minimal store surface economy uses for attribution. Both transports
 * (local JSON and accounts-serve API) implement it.
 */
export interface AccountsStore {
  readonly transport: 'local' | 'api'
  listProfiles(tool?: string): Promise<Profile[]>
  findProfile(name: string, tool?: string): Promise<Profile | undefined>
  currentProfile(tool: string): Promise<Profile | undefined>
  listTools(): Promise<ToolDef[]>
}

function validateEnvPath(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('\x00') || /[\r\n]/.test(trimmed)) throw new Error(`invalid ${label}`)
  return trimmed
}

function accountsHome(): string {
  const override = process.env.ACCOUNTS_HOME
  if (override && override.trim()) return validateEnvPath(override, 'ACCOUNTS_HOME')
  return join(homedir(), '.hasna', 'accounts')
}

function storePath(): string {
  const override = process.env.ACCOUNTS_STORE_PATH
  if (override && override.trim()) return validateEnvPath(override, 'ACCOUNTS_STORE_PATH')
  return join(accountsHome(), 'accounts.json')
}

const EMPTY_STORE: z.infer<typeof storeSchema> = {
  version: 1,
  current: {},
  applied: {},
  toolLocks: {},
  profiles: [],
  tools: [],
}

function parseStoreFile(): z.infer<typeof storeSchema> {
  const path = storePath()
  if (!existsSync(path)) return structuredClone(EMPTY_STORE)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`could not parse store at ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  const parsed = storeSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`invalid store at ${path}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
  }
  return parsed.data
}

function loadAppliedMap(): Record<string, string> {
  const applied: Record<string, string> = {}
  for (const [toolId, name] of Object.entries(parseStoreFile().applied)) {
    if (name && profileNameSchema.safeParse(name).success) applied[toolId] = name
  }
  return applied
}

/** The profile name last applied to a tool's live default paths, if any. */
export function appliedProfileName(toolId: string): string | undefined {
  return loadAppliedMap()[toolId]
}

/** Built-in tool definitions as shipped by @hasna/accounts 0.2.23. */
const BUILTIN_TOOLS: ToolDef[] = [
  { id: 'claude', label: 'Claude Code', envVar: 'CLAUDE_CONFIG_DIR', defaultDir: join(homedir(), '.claude'), bin: 'claude' },
  { id: 'codex-app', label: 'Codex App', envVar: 'CODEX_HOME', defaultDir: join(homedir(), '.codex'), bin: '/Applications/Codex.app/Contents/MacOS/Codex' },
  { id: 'codex', label: 'Codex CLI', envVar: 'CODEX_HOME', defaultDir: join(homedir(), '.codex'), bin: 'codex' },
  { id: 'codewith', label: 'Codewith', envVar: 'CODEWITH_HOME', defaultDir: join(homedir(), '.codewith'), bin: 'codewith' },
  { id: 'takumi', label: 'Takumi', envVar: 'TAKUMI_CONFIG_DIR', defaultDir: join(homedir(), '.takumi'), bin: 'takumi' },
  { id: 'gemini', label: 'Gemini CLI', envVar: 'GEMINI_CONFIG_DIR', defaultDir: join(homedir(), '.gemini'), bin: 'gemini' },
  { id: 'opencode', label: 'opencode', envVar: 'OPENCODE_CONFIG_DIR', defaultDir: join(homedir(), '.config', 'opencode'), bin: 'opencode' },
  { id: 'cursor', label: 'Cursor Agent', envVar: 'CURSOR_CONFIG_DIR', defaultDir: join(homedir(), '.cursor'), bin: 'cursor-agent' },
  { id: 'pi', label: 'Pi Coding Agent', envVar: 'PI_CODING_AGENT_HOME', defaultDir: join(homedir(), '.pi'), bin: 'pi' },
  { id: 'hermes', label: 'Hermes', envVar: 'HERMES_HOME', defaultDir: join(homedir(), '.hermes'), bin: 'hermes' },
  { id: 'kimi', label: 'Kimi Code', envVar: 'KIMI_CODE_HOME', defaultDir: join(homedir(), '.kimi-code'), bin: 'kimi' },
  { id: 'grok', label: 'Grok Build', envVar: 'HOME', defaultDir: join(homedir(), '.grok'), bin: 'grok' },
]

/** On-box JSON registry: profiles, current selections, and custom tools. */
class LocalStore implements AccountsStore {
  readonly transport = 'local' as const

  async listProfiles(tool?: string): Promise<Profile[]> {
    const profiles = parseStoreFile().profiles
    const filtered = tool ? profiles.filter((profile) => profile.tool === tool) : profiles
    return filtered.slice().sort((a, b) => a.tool.localeCompare(b.tool) || a.name.localeCompare(b.name))
  }

  async findProfile(name: string, tool?: string): Promise<Profile | undefined> {
    const matches = parseStoreFile().profiles.filter((profile) => profile.name === name && (!tool || profile.tool === tool))
    return matches.length === 1 ? matches[0] : undefined
  }

  async currentProfile(tool: string): Promise<Profile | undefined> {
    const store = parseStoreFile()
    const name = store.current[tool]
    if (!name) return undefined
    return store.profiles.find((profile) => profile.name === name && profile.tool === tool)
  }

  async listTools(): Promise<ToolDef[]> {
    const custom = parseStoreFile().tools
    const byId = new Map<string, ToolDef>()
    for (const tool of BUILTIN_TOOLS) byId.set(tool.id, tool)
    for (const tool of custom) byId.set(tool.id, tool)
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  }
}

// ---------------------------------------------------------------------------
// API transport (self-hosted accounts-serve at <API_URL>/v1).
// @hasna/accounts delegated this to the @hasna/contracts 0.5.2 HTTP transport;
// the same observable behavior is replicated here with global fetch (default
// timeout 30s, retries 2 on 408/425/429/5xx with jittered backoff, `status` +
// `body` on errors), so attribution keeps working against a configured
// accounts-serve without pulling the doomed package (or its successor) in.
// ---------------------------------------------------------------------------

const CANONICAL_MODES = new Set(['local', 'self_hosted', 'cloud'])
const RETIRED_MODES = new Set(['remote', 'hybrid', 's3'])
const RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504]

/** Normalize an API URL to its `<origin>/v1` base (contracts 0.5.2 semantics). */
function toV1BaseUrl(apiUrl: string): string {
  const url = new URL(apiUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('API URL must use http or https.')
  let path = url.pathname.replace(/\/+$/, '')
  if (path.endsWith('/v1')) path = path.slice(0, -'/v1'.length)
  url.pathname = `${path}/v1`
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

class AccountsApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(method: string, path: string, status: number, body: unknown) {
    super(`accounts cloud request failed: ${method} ${path} -> ${status}`)
    this.name = 'AccountsApiError'
    this.status = status
    this.body = body
  }
}

function isNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { status?: unknown }).status === 404)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** One HTTP round-trip with the accounts-serve defaults; throws AccountsApiError/Error. */
async function cloudRequest(
  baseUrl: string,
  apiKey: string,
  path: string,
  query?: Record<string, string>,
): Promise<unknown> {
  const rel = path.startsWith('/') ? path : `/${path}`
  const url = query && Object.keys(query).length > 0
    ? `${baseUrl}${rel}?${new URLSearchParams(query).toString()}`
    : `${baseUrl}${rel}`

  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      clearTimeout(timer)
      if (attempt < 2) {
        const backoff = Math.min(2000, 200 * 2 ** attempt)
        const jitter = Math.floor(Math.random() * (backoff / 2 + 1))
        await sleep(backoff + jitter)
      }
      continue
    } finally {
      clearTimeout(timer)
    }

    const text = await res.text()
    let parsed: unknown
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    if (!res.ok) {
      lastError = new AccountsApiError('GET', rel, res.status, parsed)
      if (attempt < 2 && RETRY_STATUSES.includes(res.status)) {
        const backoff = Math.min(2000, 200 * 2 ** attempt)
        const jitter = Math.floor(Math.random() * (backoff / 2 + 1))
        await sleep(backoff + jitter)
        continue
      }
      break
    }
    return parsed
  }
  throw lastError
}

/** Shrink a cloud account record to the local Profile shape (as @hasna/accounts did). */
function toProfile(account: Record<string, unknown>): Profile {
  const profile: Profile = {
    name: String(account.name),
    tool: String(account.tool),
    dir: typeof account.dir === 'string' ? account.dir : '',
    createdAt: String(account.createdAt),
  }
  if (typeof account.email === 'string') profile.email = account.email
  if (typeof account.displayName === 'string') profile.displayName = account.displayName
  if (typeof account.description === 'string') profile.description = account.description
  if (typeof account.lastUsedAt === 'string') profile.lastUsedAt = account.lastUsedAt
  return profile
}

/** Registry backed by the self-hosted accounts-serve API. */
class ApiStore implements AccountsStore {
  readonly transport = 'api' as const

  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  async listProfiles(tool?: string): Promise<Profile[]> {
    const raw = await cloudRequest(this.baseUrl, this.apiKey, '/accounts', tool ? { tool } : undefined)
    const accounts = Array.isArray((raw as { accounts?: unknown } | undefined)?.accounts)
      ? (raw as { accounts: unknown[] }).accounts
      : []
    return accounts
      .map((account) => toProfile(account as Record<string, unknown>))
      .sort((a, b) => a.tool.localeCompare(b.tool) || a.name.localeCompare(b.name))
  }

  async findProfile(name: string, tool?: string): Promise<Profile | undefined> {
    if (tool) {
      try {
        const account = await cloudRequest(
          this.baseUrl,
          this.apiKey,
          `/accounts/${encodeURIComponent(tool)}/${encodeURIComponent(name)}`,
        )
        return account ? toProfile(account as Record<string, unknown>) : undefined
      } catch (err) {
        if (isNotFound(err)) return undefined
        throw err
      }
    }
    const matches = (await this.listProfiles()).filter((profile) => profile.name === name)
    return matches.length === 1 ? matches[0] : undefined
  }

  async currentProfile(tool: string): Promise<Profile | undefined> {
    let current: Record<string, unknown> | null
    try {
      const raw = await cloudRequest(this.baseUrl, this.apiKey, `/current/${encodeURIComponent(tool)}`)
      current = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
    } catch (err) {
      if (isNotFound(err)) return undefined
      throw err
    }
    if (!current || typeof current.name !== 'string') return undefined
    return this.findProfile(current.name, tool)
  }

  async listTools(): Promise<ToolDef[]> {
    const raw = await cloudRequest(this.baseUrl, this.apiKey, '/tools')
    const tools = Array.isArray((raw as { tools?: unknown } | undefined)?.tools)
      ? (raw as { tools: unknown[] }).tools
      : []
    const custom: ToolDef[] = []
    for (const item of tools) {
      if (item === null || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      // Only entries explicitly marked builtin:false are custom definitions.
      if (record.builtin !== false) continue
      const parsed = toolDefSchema.safeParse(item)
      if (!parsed.success) {
        throw new Error(
          `invalid custom tool "${String(record.id)}" returned by accounts-serve: ` +
            parsed.error.issues.map((issue) => issue.message).join('; '),
        )
      }
      custom.push(parsed.data)
    }
    const byId = new Map<string, ToolDef>()
    for (const tool of BUILTIN_TOOLS) byId.set(tool.id, tool)
    for (const tool of custom) byId.set(tool.id, tool)
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  }
}

/**
 * Resolve the active registry store for this process — same selection rules as
 * @hasna/accounts 0.2.23: the API when self-hosted cloud mode is configured
 * (URL + key present and mode not forced local), else the local JSON store.
 */
export function resolveStore(env: NodeJS.ProcessEnv = process.env): AccountsStore {
  const url = env.HASNA_ACCOUNTS_API_URL || env.ACCOUNTS_API_URL
  const key = env.HASNA_ACCOUNTS_API_KEY || env.ACCOUNTS_API_KEY
  const rawMode = (env.HASNA_ACCOUNTS_STORAGE_MODE || env.ACCOUNTS_STORAGE_MODE || env.HASNA_ACCOUNTS_MODE || '').trim().toLowerCase()
  const explicitMode = CANONICAL_MODES.has(rawMode) ? rawMode : ''
  if (rawMode && !explicitMode && !RETIRED_MODES.has(rawMode)) {
    throw new Error(`invalid accounts storage mode "${rawMode}"; expected local, self_hosted, or cloud`)
  }
  if (explicitMode === 'local') return new LocalStore()
  if (explicitMode === 'self_hosted' || explicitMode === 'cloud') {
    if (!url || !key) {
      const missing = [!url ? 'HASNA_ACCOUNTS_API_URL' : '', !key ? 'HASNA_ACCOUNTS_API_KEY' : '']
        .filter(Boolean)
        .join(' and ')
      throw new Error(`${explicitMode} storage mode requires ${missing}`)
    }
    return cloudStore(url, key)
  }
  if (url && key) return cloudStore(url, key)
  return new LocalStore()
}

function cloudStore(url: string, key: string): AccountsStore {
  try {
    return new ApiStore(toV1BaseUrl(url), key)
  } catch (err) {
    // Same degradation as @hasna/accounts: an unusable API URL falls back to
    // the local store rather than crashing attribution.
    console.warn(`accounts: invalid API URL "${url}" (${err instanceof Error ? err.message : String(err)}); using local store`)
    return new LocalStore()
  }
}