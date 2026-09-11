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
 *  - API transport: accounts-serve at the `@hasna/contracts`-resolved `/v1`
 *    authority (env `HASNA_ACCOUNTS_API_URL` + `HASNA_ACCOUNTS_API_KEY`, the
 *    credentials file, or the Keychain, default gateway
 *    `https://api.hasna.com/accounts`), bearer + `x-api-key` auth, 30s timeout,
 *    2 retries on 408/425/429/5xx with jittered backoff — the contracts HTTP
 *    transport defaults @hasna/accounts shipped with, resolved through the
 *    shared client chain rather than by hand.
 *  - Transport selection is the resolved credential alone: the API when
 *    `@hasna/contracts` resolves an accounts credential for the environment.
 *    Deployment modes no longer exist; a stale retired `*_STORAGE_MODE` /
 *    `*_MODE` variable is inert — ignored, never a selector and never an error
 *    (owner directive 2026-08-15).
 *  - FAIL-CLOSED GATE (fleet-alignment ruling d, 2026-09-11). When no accounts
 *    credential resolves, the on-box JSON registry is served ONLY under
 *    economy's explicit local opt-in (`HASNA_ECONOMY_LOCAL=1`, alias
 *    `ECONOMY_LOCAL=1`) — the same gate economy's own store uses. Without it
 *    (a hosted client, or a client with nothing configured at all) the registry
 *    is NOT read: attribution is simply absent, announced once on stderr. A
 *    hosted run that quietly attributed its spend from an on-box JSON file was
 *    the last silent-local branch in this package.
 *
 * When @hasna-internal/subscriptions is published, this file can be replaced
 * by a thin adapter over its SubscriptionsStore (same shape, new env vars).
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { resolveClientTransport, resolveCredential, type CredentialChainOptions } from '@hasna/contracts/client'
import { LOCAL_STORAGE_OPT_IN_KEYS } from './cloud-storage.js'

/** The accounts app slug for the @hasna/contracts credential chain. */
const ACCOUNTS_APP = 'accounts'

/** Test injection for the accounts credential chain (keychain runner, tier-1 key). */
export interface ResolveAccountsStoreOptions {
  credentials?: CredentialChainOptions
}

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
 * Is the on-box JSON registry allowed for this run?
 *
 * The env dictionary ALONE, exactly like economy's own storage seam: answering
 * it must not touch the Keychain or the filesystem. Reuses economy's opt-in
 * keys rather than inventing a second spelling, so ONE flag governs every
 * on-box read this package performs.
 */
function localRegistryAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return LOCAL_STORAGE_OPT_IN_KEYS.some((key) => {
    const raw = env[key]
    if (raw === undefined) return false
    const value = raw.trim().toLowerCase()
    return value !== '' && value !== '0' && value !== 'false' && value !== 'no' && value !== 'off'
  })
}

/**
 * The minimal store surface economy uses for attribution. All three transports
 * (local JSON, accounts-serve API, and the refusing no-registry store)
 * implement it.
 */
export interface AccountsStore {
  readonly transport: 'local' | 'api' | 'none'
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
  // Defence in depth: no code path reads the on-box registry file outside the
  // local opt-in, including the `applied` lookup that bypasses the store.
  if (!localRegistryAllowed()) return structuredClone(EMPTY_STORE)
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

/**
 * The profile name last applied to a tool's live default paths, if any.
 *
 * Reads the on-box registry directly (not through the store), so it carries
 * the same gate: without economy's local opt-in there is no applied profile,
 * because the file is not read at all.
 */
export function appliedProfileName(toolId: string): string | undefined {
  if (!localRegistryAllowed()) return undefined
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

/**
 * The no-registry store: what a run gets when no accounts credential resolves
 * and economy's local opt-in is NOT set.
 *
 * It answers the attribution queries with "nothing known" — the built-in tool
 * table (static data compiled into this package, not a local dataset) and no
 * profiles — so spend attribution is simply absent instead of being silently
 * filled in from an on-box JSON file that the hosted fleet never sees. The
 * refusal is announced once on stderr; env overrides (`ECONOMY_ACCOUNT*`) are
 * resolved before the store is consulted and keep working.
 */
class NoRegistryStore implements AccountsStore {
  readonly transport = 'none' as const

  async listProfiles(): Promise<Profile[]> {
    return []
  }

  async findProfile(): Promise<Profile | undefined> {
    return undefined
  }

  async currentProfile(): Promise<Profile | undefined> {
    return undefined
  }

  async listTools(): Promise<ToolDef[]> {
    return BUILTIN_TOOLS.slice().sort((a, b) => a.id.localeCompare(b.id))
  }
}

// ---------------------------------------------------------------------------
// API transport (accounts-serve at <API_URL>/v1).
// @hasna/accounts delegated this to the @hasna/contracts 0.5.2 HTTP transport;
// the same observable behavior is replicated here with global fetch (default
// timeout 30s, retries 2 on 408/425/429/5xx with jittered backoff, `status` +
// `body` on errors), so attribution keeps working against a configured
// accounts-serve without pulling the doomed package (or its successor) in.
// ---------------------------------------------------------------------------

const RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504]

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

/** Registry backed by the accounts-serve API. */
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
 * Resolve the active registry store for this process — the credential chain
 * first: the API transport when `@hasna/contracts` resolves an accounts
 * credential for this environment (env `HASNA_ACCOUNTS_API_KEY` / legacy
 * `ACCOUNTS_API_KEY`, the accounts credentials file, or the Keychain, with the
 * authority defaulted to the fleet gateway `https://api.hasna.com/accounts`).
 * Stale `*_STORAGE_MODE` / `*_MODE` variables are ignored — they never select
 * a store and never error (owner directive 2026-08-15).
 *
 * WITH NO CREDENTIAL the on-box JSON registry is served ONLY under economy's
 * explicit local opt-in (`HASNA_ECONOMY_LOCAL=1` / `ECONOMY_LOCAL=1`); every
 * other run gets {@link NoRegistryStore} — no on-box read, attribution absent,
 * one stderr line. Serving the on-box registry to a hosted client was the last
 * silent-local branch in economy (fleet-alignment ruling d, 2026-09-11).
 *
 * FAIL CLOSED ON MISCONFIGURATION (hasna/apps#1720): the local registry is
 * selected ONLY by "no credential AND no authority configure the API". A
 * configured-but-unusable accounts API — a URL with no key, blank or
 * disagreeing aliases, an unsafe or unreadable credentials file, a Keychain
 * item that exists but cannot be read, a deliberate override that cannot be
 * honoured — THROWS instead of silently degrading: the old catch-all fell
 * back to local attribution on any error, which is exactly the false green
 * the fail-closed ruling ends (attribution that quietly read an empty local
 * registry while the fleet API was half configured). A local selection
 * announces itself once on stderr, so a run can never be mistaken for a
 * hosted one.
 */
export function resolveStore(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveAccountsStoreOptions = {},
): AccountsStore {
  const clientEnv = env as Record<string, string | undefined>
  // ONE pass down the chain, proven by the transport: the credential is read
  // once and handed back as its tier-1 argument, so the authority pass never
  // re-reads the tiers — and the key that validated the authority is the key
  // the store sends (no TOCTOU between two reads).
  const credential = resolveCredential(ACCOUNTS_APP, clientEnv, options.credentials)
  if (credential === null) {
    // Nothing configured anywhere is the documented local answer — but a URL
    // configured without a key is a MISCONFIGURATION, and the transport's
    // refusal carries exactly that distinction ("…is not set and no API key
    // could be resolved" only when nothing at all is configured).
    try {
      resolveClientTransport(ACCOUNTS_APP, clientEnv, options.credentials ? { credentials: options.credentials } : {})
    } catch (err) {
      if (isNoAccountsCredentialConfigurationError(err)) return unconfiguredStore(env)
      throw err
    }
    // Unreachable: the transport throws whenever no credential resolves.
    return unconfiguredStore(env)
  }
  if (credential.tier === 'pointer') {
    // The API store resolves its credential synchronously at construction and
    // cannot complete a secrets-vault pointer per request. A deliberate tier
    // that cannot produce a key REFUSES here — it is never resolved around to
    // the local registry.
    throw new Error(
      `accounts: ${credential.source} names a secrets-vault item, and the local accounts API store resolves ` +
        'credentials synchronously, so it cannot complete the pointer per request. It is a deliberate ' +
        'selection and is not resolved around. Use a literal tier instead — the Keychain item ' +
        'hasna.credentials.accounts.api-key, ~/.hasna/accounts/config/credentials, or HASNA_ACCOUNTS_API_KEY.',
    )
  }
  const resolution = resolveClientTransport(ACCOUNTS_APP, clientEnv, {
    credentials: { ...options.credentials, apiKey: credential.apiKey },
  })
  return new ApiStore(resolution.baseUrl, credential.apiKey)
}

/**
 * True when the error is the resolver's "nothing configured a credential at
 * all" refusal — the only hosted-resolution outcome that may fall through to
 * the local registry. Every other refusal (URL set but no key, blank or
 * disagreeing variables, an unreadable credentials file, a failing Keychain
 * item) is a misconfiguration that MUST surface.
 *
 * The check is shape-based (error `name` + message), not `instanceof`: the
 * published @hasna/contracts package builds `./client` and `./client/storage`
 * as separate bundles, each carrying its own copy of the error class.
 */
function isNoAccountsCredentialConfigurationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; message?: unknown }
  return (
    candidate.name === 'ClientTransportConfigurationError' &&
    typeof candidate.message === 'string' &&
    candidate.message.includes('is not set and no API key could be resolved')
  )
}

/**
 * The store for "no accounts credential resolved": the on-box registry under
 * economy's explicit local opt-in, otherwise the refusing no-registry store.
 * Either way the run says on stderr, once, which one it got.
 */
function unconfiguredStore(env: NodeJS.ProcessEnv): AccountsStore {
  if (localRegistryAllowed(env)) {
    announceAccountsLocalMode()
    return new LocalStore()
  }
  announceAccountsRefusal()
  return new NoRegistryStore()
}

/** The one line a local run prints, so attribution from the local registry is never silent. */
function accountsLocalModeNotice(): string {
  return (
    `accounts: LOCAL mode (${LOCAL_STORAGE_OPT_IN_KEYS[0]}=1) — no Hasna Accounts credential resolved, so ` +
    'attribution reads the on-box JSON registry (~/.hasna/accounts/accounts.json) instead of accounts-serve. ' +
    'To go hosted, put the fleet key in the Keychain item hasna.credentials.accounts.api-key, write ' +
    '~/.hasna/accounts/config/credentials, or set HASNA_ACCOUNTS_API_KEY.'
  )
}

/** The one line a refused run prints: the on-box registry was NOT read. */
function accountsRefusalNotice(): string {
  return (
    'accounts: no Hasna Accounts credential resolved (Keychain item hasna.credentials.accounts.api-key, ' +
    '~/.hasna/accounts/config/credentials, HASNA_ACCOUNTS_API_KEY), so spend attribution is omitted. The ' +
    `on-box registry (~/.hasna/accounts/accounts.json) is NOT read without ${LOCAL_STORAGE_OPT_IN_KEYS[0]}=1 — ` +
    'economy fails closed instead of attributing hosted spend from an on-box file.'
  )
}

let accountsLocalNoticePrinted = false

/** Test seam: forget that the local-mode line was printed. */
export function __resetAccountsLocalNotice(): void {
  accountsLocalNoticePrinted = false
}

/** Say — once per process, on stderr — that this install reads the local registry. */
function announceAccountsLocalMode(): void {
  if (accountsLocalNoticePrinted) return
  accountsLocalNoticePrinted = true
  process.stderr.write(`${accountsLocalModeNotice()}\n`)
}

/** Say — once per process, on stderr — that the on-box registry was refused. */
function announceAccountsRefusal(): void {
  if (accountsLocalNoticePrinted) return
  accountsLocalNoticePrinted = true
  process.stderr.write(`${accountsRefusalNotice()}\n`)
}