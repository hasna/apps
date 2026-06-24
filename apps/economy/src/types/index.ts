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

export interface LoopAttribution {
  id: string
  request_id: string
  session_id: string
  loop_id: string
  loop_name: string
  loop_run_id: string
  goal_id: string
  goal_run_id: string
  workflow_run_id: string
  workflow_step_id: string
  thread_id: string
  account_key: string
  account_tool: string
  account_name: string
  provider: string
  model: string
  phase: string
  status: string
  loop_status: string
  schedule_json: string
  scheduled_for: string
  started_at: string
  finished_at: string
  duration_ms: number
  attempt: number
  tokens: number
  api_equivalent_usd: number
  subscription_included_usd: number
  billable_usd: number
  failure_retry_usd: number
  cost_basis: import('../lib/agents.js').CostBasis
  machine_id: string
  created_at: string
  updated_at: string
}

export interface LoopAttributionFilter {
  since?: string
  machine?: string
  loop?: string
  provider?: string
  account?: string
  model?: string
}

export interface LoopEfficiencyGroup {
  key: string
  loop_id?: string
  loop_name?: string
  provider?: string
  account_key?: string
  model?: string
  row_count: number
  runs: number
  failed_runs: number
  retry_runs: number
  tokens: number
  api_equivalent_usd: number
  subscription_included_usd: number
  billable_usd: number
  failure_retry_usd: number
  avg_duration_ms: number
  max_duration_ms: number
  last_active: string
}

export interface LoopEfficiencySummary {
  filters: LoopAttributionFilter
  totals: Omit<LoopEfficiencyGroup, 'key'>
  rows: LoopAttribution[]
  by_loop: LoopEfficiencyGroup[]
  by_provider: LoopEfficiencyGroup[]
  by_account: LoopEfficiencyGroup[]
  by_model: LoopEfficiencyGroup[]
}

export type EconomyProvider = 'codewith' | 'codex' | 'claude' | 'cursor' | 'aicopilot' | 'opencode' | 'gemini'
export type ProviderHealth = 'ok' | 'missing' | 'unknown' | 'not_required'

export interface ProviderReadinessRow {
  provider: EconomyProvider
  installed: boolean
  available: boolean
  authenticated: boolean
  routable: boolean
  key_health: ProviderHealth
  pricing_health: ProviderHealth
  subscription_backed: boolean
  representative_model: string
  api_cost_per_1m: number | null
  material_savings_vs_baseline: boolean
  flags: string[]
}

export interface SubscriptionAwareRouting {
  preferred: EconomyProvider[]
  avoid: EconomyProvider[]
  third_party_candidates: EconomyProvider[]
  recommendation: string
}

export interface ProviderReadinessSummary {
  generated_at: string
  baseline_model: string
  baseline_api_cost_per_1m: number | null
  zero_cost_token_rows: number
  providers: ProviderReadinessRow[]
  flags: string[]
  routing: SubscriptionAwareRouting
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
