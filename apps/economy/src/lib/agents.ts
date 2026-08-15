export const AGENTS = [
  'claude',
  'takumi',
  'codex',
  'gemini',
  'opencode',
  'cursor',
  'pi',
  'hermes',
] as const

export type Agent = (typeof AGENTS)[number]

export const INGEST_AGENTS = AGENTS

export const LEGACY_AGENTS = ['claude', 'takumi', 'codex', 'gemini'] as const satisfies readonly Agent[]

export const COST_BASIS = [
  'metered_api',
  'subscription_included',
  'estimated',
  'unknown',
] as const

export type CostBasis = (typeof COST_BASIS)[number]

export function isAgent(value: string): value is Agent {
  return (AGENTS as readonly string[]).includes(value)
}

export function parseAgent(value: string | undefined, option: string): Agent | undefined {
  if (value == null) return undefined
  if (isAgent(value)) return value
  throw new Error(`${option} must be one of: ${AGENTS.join(', ')}`)
}

export function requireAgent(value: string | undefined, option: string, fallback?: Agent): Agent {
  const selected = value ?? fallback
  if (selected == null) throw new Error(`${option} is required`)
  return parseAgent(selected, option)!
}

export function agentColor(agent: string): 'blue' | 'yellow' | 'green' | 'magenta' | 'cyan' | 'white' {
  if (agent === 'claude') return 'blue'
  if (agent === 'codex') return 'yellow'
  if (agent === 'gemini') return 'green'
  if (agent === 'takumi') return 'magenta'
  if (agent === 'opencode') return 'cyan'
  if (agent === 'cursor') return 'white'
  return 'white'
}
