import { appliedProfileName, resolveStore } from './accounts-store.js'
import type { AccountsStore, Profile as AccountsProfile, ToolDef as AccountsTool } from './accounts-store.js'
import type { Agent } from './agents.js'

export interface AccountAttribution {
  account_key: string
  account_tool: string
  account_name: string
  account_email?: string
  account_source: 'override' | 'env' | 'applied' | 'current'
}

const AGENT_ACCOUNT_TOOLS: Record<Agent, string[]> = {
  claude: ['claude'],
  takumi: ['takumi', 'claude'],
  codex: ['codex'],
  gemini: ['gemini'],
  opencode: ['opencode'],
  cursor: ['cursor'],
  pi: ['pi'],
  hermes: ['hermes'],
}

function normalizeEmail(email: string | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

function accountKey(tool: string, name: string, email?: string): string {
  const normalizedEmail = normalizeEmail(email)
  return `${tool}:${normalizedEmail || name}`
}

function normalizeDir(value: string): string {
  return value.replace(/\/+$/, '')
}

function fromProfile(profile: AccountsProfile, source: AccountAttribution['account_source']): AccountAttribution {
  return {
    account_key: accountKey(profile.tool, profile.name, profile.email),
    account_tool: profile.tool,
    account_name: profile.name,
    ...(profile.email ? { account_email: normalizeEmail(profile.email) } : {}),
    account_source: source,
  }
}

function fromOverride(raw: string, agent: Agent): AccountAttribution | null {
  const value = raw.trim()
  if (!value) return null
  const candidateTool = AGENT_ACCOUNT_TOOLS[agent][0] ?? agent
  const [tool, name] = value.includes(':') ? value.split(':', 2) : [candidateTool, value]
  if (!tool || !name) return null
  const email = name.includes('@') ? normalizeEmail(name) : undefined
  return {
    account_key: accountKey(tool, name, email),
    account_tool: tool,
    account_name: name,
    ...(email ? { account_email: email } : {}),
    account_source: 'override',
  }
}

function envOverride(agent: Agent, env: NodeJS.ProcessEnv): AccountAttribution | null {
  const agentPrefix = agent.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const raw = env[`ECONOMY_${agentPrefix}_ACCOUNT_KEY`]
    ?? env[`ECONOMY_${agentPrefix}_ACCOUNT`]
    ?? env['ECONOMY_ACCOUNT_KEY']
    ?? env['ECONOMY_ACCOUNT']
  if (raw) return fromOverride(raw, agent)

  const tool = env[`ECONOMY_${agentPrefix}_ACCOUNT_TOOL`] ?? env['ECONOMY_ACCOUNT_TOOL']
  const name = env[`ECONOMY_${agentPrefix}_ACCOUNT_NAME`] ?? env['ECONOMY_ACCOUNT_NAME']
  if (!tool || !name) return null
  const email = normalizeEmail(env[`ECONOMY_${agentPrefix}_ACCOUNT_EMAIL`] ?? env['ECONOMY_ACCOUNT_EMAIL'])
  return {
    account_key: accountKey(tool, name, email),
    account_tool: tool,
    account_name: name,
    ...(email ? { account_email: email } : {}),
    account_source: 'override',
  }
}

async function profileForEnvDir(
  store: AccountsStore,
  tool: AccountsTool,
  env: NodeJS.ProcessEnv,
): Promise<AccountsProfile | null> {
  const configuredDir = env[tool.envVar]
  if (!configuredDir) return null
  const normalized = normalizeDir(configuredDir)
  return (await store.listProfiles(tool.id))
    .find((profile) => normalizeDir(profile.dir) === normalized) ?? null
}

export async function resolveAccountForAgent(
  agent: Agent,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AccountAttribution | null> {
  const override = envOverride(agent, env)
  if (override) return override

  const store = resolveStore(env)
  const tools = new Map((await store.listTools()).map((tool) => [tool.id, tool]))
  for (const toolId of AGENT_ACCOUNT_TOOLS[agent]) {
    const tool = tools.get(toolId)
    if (!tool) continue

    const envProfile = await profileForEnvDir(store, tool, env)
    if (envProfile) return fromProfile(envProfile, 'env')

    const appliedName = appliedProfileName(toolId)
    if (appliedName) {
      const applied = await store.findProfile(appliedName, toolId)
      if (applied) return fromProfile(applied, 'applied')
    }

    const current = await store.currentProfile(toolId)
    if (current) return fromProfile(current, 'current')
  }

  return null
}

export function withAccount<T extends object>(
  record: T,
  account: AccountAttribution | null,
): T & Partial<AccountAttribution> {
  if (!account) return record
  return {
    ...record,
    account_key: account.account_key,
    account_tool: account.account_tool,
    account_name: account.account_name,
    account_email: account.account_email ?? '',
    account_source: account.account_source,
  }
}
