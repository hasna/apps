export type Agent =
  | 'claude'
  | 'takumi'
  | 'codex'
  | 'gemini'
  | 'opencode'
  | 'cursor'
  | 'pi'
  | 'hermes'

export type Period = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'all'

export interface EconomyRequest {
  id: string
  agent: Agent
  session_id: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_create_tokens: number
  cache_create_5m_tokens?: number
  cache_create_1h_tokens?: number
  cost_usd: number
  duration_ms: number
  timestamp: string
  source_request_id: string
  machine_id?: string
}

export type SessionRequest = EconomyRequest

export interface Session {
  id: string
  agent: Agent
  project_path: string
  project_name: string
  started_at: string
  ended_at: string | null
  total_cost_usd: number
  total_tokens: number
  request_count: number
  machine_id?: string
}

export interface MachineInfo {
  machine_id: string
  sessions: number
  requests: number
  total_cost_usd: number
  last_active: string
}

export interface BillingSummary {
  total_usd: number
  by_provider: Record<string, number>
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
  agent: Agent | null
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

export interface CostSummary {
  total_usd: number
  sessions: number
  requests: number
  tokens: number
  period: Period
}

export interface ModelBreakdown {
  model: string
  agent: Agent
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
  agent: Agent
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

export interface DailyPoint {
  date: string
  cost_usd: number
  agent: string
}

export interface ModelPricing {
  model: string
  input_per_1m: number
  output_per_1m: number
  cache_read_per_1m: number
  cache_write_per_1m: number
  cache_write_1h_per_1m?: number
  cache_storage_per_1m_hour?: number
  updated_at?: string
  // Deprecated aliases kept optional for older TypeScript consumers. The REST API returns snake_case fields.
  inputPer1M?: number
  outputPer1M?: number
  cacheReadPer1M?: number
  cacheWritePer1M?: number
  cacheWrite1hPer1M?: number
  cacheStoragePer1MHour?: number
}

export interface CreatePricingInput {
  model: string
  input_per_1m: number
  output_per_1m: number
  cache_read_per_1m?: number
  cache_write_per_1m?: number
  cache_write_1h_per_1m?: number
  cache_storage_per_1m_hour?: number
}

export interface CreateBudgetInput {
  project_path?: string
  agent?: Agent
  period: 'daily' | 'weekly' | 'monthly'
  limit_usd: number
  alert_at_percent?: number
}

export interface CreateGoalInput {
  period: 'day' | 'week' | 'month' | 'year'
  limit_usd: number
  project_path?: string
  agent?: Agent
}

export interface Subscription {
  id: string
  agent: Agent | null
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

export interface CreateSubscriptionInput {
  id?: string
  agent?: Agent | null
  provider: string
  plan: string
  monthly_fee_usd?: number
  included_usage_usd?: number
  billing_cycle_start?: string | null
  reset_policy?: string
  active?: boolean | number
}

export interface GoalStatus {
  id: string
  period: 'day' | 'week' | 'month' | 'year'
  project_path: string | null
  agent: Agent | null
  limit_usd: number
  current_spend_usd: number
  percent_used: number
  is_on_track: boolean
  is_at_risk: boolean
  is_over: boolean
  created_at: string
  updated_at: string
}

export interface MutationOk {
  ok: boolean
}

export type MutationResult = MutationOk

export interface BillingSyncResult {
  anthropic?: unknown
  openai?: unknown
  gemini?: unknown
  [key: string]: unknown
}

export interface SyncResult {
  claude?: unknown
  takumi?: unknown
  codex?: unknown
  gemini?: unknown
  opencode?: unknown
  cursor?: unknown
  pi?: unknown
  hermes?: unknown
  claudeQuota?: unknown
  deduped?: number
  cloudPulled?: boolean
  cloudPushed?: boolean
  [key: string]: unknown
}

export interface UsageSnapshot {
  id: string
  agent: Agent | string
  date: string
  metric: string
  value: number
  unit: string
  machine_id: string
  updated_at: string
}

export interface UsageResponse {
  snapshots: UsageSnapshot[]
  summary: CostSummary
}

export interface SavingsSummary {
  period: Period
  api_equivalent_usd: number
  subscription_fee_usd: number
  included_consumed_usd: number
  on_demand_usd: number
  saved_usd: number
  by_agent: Record<string, Partial<SavingsSummary>>
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

export interface FleetResponse {
  summary: CostSummary
  machines: MachineInfo[]
  registry: MachineRegistry[]
  current_machine: string
}

export interface BillingDiffRow {
  agent: string
  estimated_usd: number
  actual_usd: number
  delta_usd: number
  delta_pct: number
}

export interface BillingDiffSummary {
  period: Period
  estimated_usd: number
  actual_usd: number
  delta_usd: number
  delta_pct: number
  threshold_pct: number
  is_alert: boolean
  by_agent: BillingDiffRow[]
  by_provider: Record<string, number>
}

export interface SessionFilter {
  agent?: Agent
  project?: string
  account?: string
  machine?: string
  limit?: number
  offset?: number
  since?: string
  search?: string
}
