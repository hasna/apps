export type { Agent, CostBasis } from '../lib/agents.js'
export { AGENTS, COST_BASIS, isAgent } from '../lib/agents.js'

export type Period = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'all'
export type EconomyAgent = import('../lib/agents.js').Agent | 'app' | 'service' | 'repo' | 'loop'

export type CostCenterKind = 'loop' | 'app' | 'repo' | 'service' | 'team'

export interface CostCenter {
  id: string
  kind: CostCenterKind
  name: string
  repo_path?: string | null
  labels_json: string
  created_at: string
  updated_at?: string
}

export interface EconomyRequest {
  id: string
  agent: EconomyAgent
  session_id: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_create_tokens: number
  cache_create_5m_tokens?: number
  cache_create_1h_tokens?: number
  cost_usd: number
  cost_basis?: import('../lib/agents.js').CostBasis
  duration_ms: number
  timestamp: string
  source_request_id: string
  machine_id?: string
  cost_center_id?: string | null
  attribution_tag?: string
  account_key?: string
  account_tool?: string
  account_name?: string
  account_email?: string
  account_source?: string
  updated_at?: string
  synced_at?: string
}

export interface EconomySession {
  id: string
  agent: EconomyAgent
  project_path: string
  project_name: string
  started_at: string
  ended_at: string | null
  total_cost_usd: number
  total_tokens: number
  request_count: number
  machine_id?: string
  cost_center_id?: string | null
  attribution_tag?: string
  account_key?: string
  account_tool?: string
  account_name?: string
  account_email?: string
  account_source?: string
  updated_at?: string
  synced_at?: string
}

export interface EconomyProject {
  id: string
  path: string
  name: string
  description: string | null
  tags: string[]
  created_at: string
}

export interface Budget {
  id: string
  project_path: string | null
  agent: import('../lib/agents.js').Agent | null
  cost_center_id?: string | null
  period: 'daily' | 'weekly' | 'monthly'
  limit_usd: number
  alert_at_percent: number
  created_at: string
  updated_at: string
}

export interface BudgetStatus extends Budget {
  current_spend_usd: number
  percent_used: number
  is_over_limit: boolean
  is_over_alert: boolean
}

export interface IngestState {
  source: string
  key: string
  value: string
}

export interface CostSummary {
  total_usd: number
  sessions: number
  requests: number
  tokens: number
  period: Period
}

export interface ModelBreakdown {
  model: string
  agent: EconomyAgent
  requests: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
}

export interface ProjectBreakdown {
  project_path: string
  project_name: string
  sessions: number
  requests: number
  total_tokens: number
  cost_usd: number
  last_active: string
}

export interface AgentBreakdown {
  agent: EconomyAgent
  sessions: number
  requests: number
  total_tokens: number
  api_equivalent_usd: number
  billable_usd: number
  metered_api_usd: number
  subscription_included_usd: number
  estimated_usd: number
  unknown_usd: number
  cost_usd: number
  last_active: string
}

export interface AccountBreakdown {
  account_key: string
  account_tool: string
  account_name: string
  account_email: string | null
  account_source: string
  sessions: number
  requests: number
  total_tokens: number
  api_equivalent_usd: number
  billable_usd: number
  metered_api_usd: number
  subscription_included_usd: number
  estimated_usd: number
  unknown_usd: number
  cost_usd: number
  last_active: string
}

export interface CostCenterBreakdown {
  cost_center_id: string
  kind: CostCenterKind
  name: string
  repo_path: string | null
  labels_json: string
  sessions: number
  requests: number
  total_tokens: number
  api_equivalent_usd: number
  billable_usd: number
  metered_api_usd: number
  subscription_included_usd: number
  estimated_usd: number
  unknown_usd: number
  cost_usd: number
  last_active: string
}

export interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
  cacheReadPer1M: number
  cacheWritePer1M: number
  cacheWrite1hPer1M?: number
  cacheStoragePer1MHour?: number
}

export interface SyncOptions {
  claude?: boolean
  takumi?: boolean
  codex?: boolean
  gemini?: boolean
  opencode?: boolean
  cursor?: boolean
  pi?: boolean
  hermes?: boolean
  loops?: boolean
  verbose?: boolean
}

export interface SessionFilter {
  agent?: import('../lib/agents.js').Agent
  project?: string
  account?: string
  limit?: number
  offset?: number
  since?: string
  search?: string
  machine?: string
}

export interface Subscription {
  id: string
  agent: import('../lib/agents.js').Agent | null
  provider: string
  plan: string
  monthly_fee_usd: number
  included_usage_usd: number
  billing_cycle_start: string | null
  reset_policy: string
  active: number
  created_at: string
  updated_at: string
}

export interface UsageSnapshot {
  id: string
  agent: import('../lib/agents.js').Agent
  date: string
  metric: string
  value: number
  unit: string
  machine_id: string
  updated_at: string
}

export interface MachineRegistry {
  machine_id: string
  hostname: string
  last_seen_at: string | null
  last_push_at: string | null
  last_pull_at: string | null
  economy_version: string | null
  updated_at: string
}
