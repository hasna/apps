const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3456'

export type Agent =
  | 'claude'
  | 'takumi'
  | 'codex'
  | 'gemini'
  | 'opencode'
  | 'cursor'
  | 'pi'
  | 'hermes'

export const ALL_AGENTS: Agent[] = [
  'claude', 'takumi', 'codex', 'gemini', 'opencode', 'cursor', 'pi', 'hermes',
]

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json()
}

export interface Summary {
  total_usd: number
  sessions: number
  requests: number
  tokens: number
  period: string
}

export interface DailyEntry {
  date: string
  cost_usd: number
  agent: string
}

export interface HourlyEntry {
  hour: string
  cost_usd: number
  agent: string
}

export interface Session {
  id: string
  agent: string
  project_name: string
  project_path?: string
  total_cost_usd: number
  total_tokens: number
  request_count: number
  started_at: string
  ended_at?: string | null
}

export interface ModelStat {
  model: string
  agent: string
  requests: number
  total_tokens: number
  cost_usd: number
}

export interface ProjectStat {
  project_path: string
  project_name: string
  sessions: number
  requests: number
  total_tokens: number
  cost_usd: number
  last_active: string
}

export interface AccountStat {
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

export interface Budget {
  id: string
  project_path: string | null
  agent: Agent | null
  period: "daily" | "weekly" | "monthly"
  limit_usd: number
  alert_at_percent: number
  current_spend_usd: number
  percent_used: number
  is_over_limit: boolean
  is_over_alert: boolean
}

export interface Pricing {
  model: string
  input_per_1m: number
  output_per_1m: number
  cache_read_per_1m: number
  cache_write_per_1m: number
  cache_write_1h_per_1m?: number
  cache_storage_per_1m_hour?: number
}

export interface BreakdownEntry {
  [key: string]: string | number
}

export interface BillingSummary {
  total_usd: number
  by_provider: Record<string, number>
}

export interface UsageSnapshot {
  id: string
  agent: string
  date: string
  metric: string
  value: number
  unit: string
  machine_id: string
  updated_at: string
}

export interface UsageResponse {
  snapshots: UsageSnapshot[]
  summary: Summary
}

export interface SavingsSummary {
  period: string
  api_equivalent_usd: number
  subscription_fee_usd: number
  included_consumed_usd: number
  on_demand_usd: number
  saved_usd: number
  by_agent: Record<string, Partial<SavingsSummary>>
}

export interface MachineInfo {
  machine_id: string
  sessions: number
  requests: number
  total_cost_usd: number
  last_active: string
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
  summary: Summary
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
  period: string
  estimated_usd: number
  actual_usd: number
  delta_usd: number
  delta_pct: number
  threshold_pct: number
  is_alert: boolean
  by_agent: BillingDiffRow[]
  by_provider: Record<string, number>
}

export interface MutationOk {
  ok: boolean
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

// Summary
export const getSummary = (period: 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'all') =>
  request<{ data: Summary }>(`/api/summary?period=${period}`)

// Daily
export const getDaily = (days = 30) =>
  request<{ data: DailyEntry[] }>(`/api/daily?days=${days}`)

export const getHourly = (machine?: string) => {
  const q = new URLSearchParams()
  if (machine) q.set('machine', machine)
  const query = q.toString()
  return request<{ data: HourlyEntry[] }>(`/api/hourly${query ? `?${query}` : ''}`)
}

export interface SessionRequest {
  id: string
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
}

// Sessions
export const getSessions = (params: {
  agent?: string
  search?: string
  account?: string
  limit?: number
  offset?: number
  since?: string
}) => {
  const q = new URLSearchParams()
  if (params.agent) q.set('agent', params.agent)
  if (params.search) q.set('search', params.search)
  if (params.account) q.set('account', params.account)
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.offset != null) q.set('offset', String(params.offset))
  if (params.since) q.set('since', params.since)
  return request<{ data: Session[] }>(`/api/sessions?${q}`)
}

// Session requests (per-request breakdown)
export const getSessionRequests = (sessionId: string) =>
  request<{ data: SessionRequest[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/requests`)

// Top sessions
export const getTop = (n = 10) =>
  request<{ data: Session[] }>(`/api/top?n=${n}`)

// Models
export const getModels = () =>
  request<{ data: ModelStat[] }>('/api/models')

// Projects
export const getProjects = (period: 'today' | 'week' | 'month' | 'year' | 'all' = 'all') =>
  request<{ data: ProjectStat[] }>(`/api/projects?period=${period}`)

export const getAccounts = (period: 'today' | 'week' | 'month' | 'year' | 'all' = 'all') =>
  request<{ data: AccountStat[] }>(`/api/accounts?period=${period}`)

// Breakdown
export const getBreakdown = (
  by: 'model' | 'project' | 'agent' | 'account',
  period?: 'today' | 'week' | 'month' | 'year' | 'all',
) => {
  const q = new URLSearchParams({ by })
  if (period) q.set('period', period)
  return request<{ data: BreakdownEntry[] }>(`/api/breakdown?${q}`)
}

// Budgets
export const getBudgets = () =>
  request<{ data: Budget[] }>('/api/budgets')

export const createBudget = (body: {
  project_path?: string
  agent?: Agent
  period: "daily" | "weekly" | "monthly"
  limit_usd: number
  alert_at_percent?: number
}) =>
  request<{ data: Budget }>('/api/budgets', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const deleteBudget = (id: string) =>
  request<{ data: MutationOk }>(`/api/budgets/${encodeURIComponent(id)}`, { method: 'DELETE' })

// Pricing
export const getPricing = () =>
  request<{ data: Pricing[] }>('/api/pricing')

export const getBilling = (period: 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'all' = 'month') =>
  request<{ data: BillingSummary }>(`/api/billing?period=${period}`)

export const getBillingDiff = (period: 'today' | 'week' | 'month' | 'all' = 'month', threshold = 15) =>
  request<{ data: BillingDiffSummary }>(`/api/billing/diff?period=${period}&threshold=${threshold}`)

export const syncBilling = (body: { days?: number; providers?: Array<'anthropic' | 'openai' | 'gemini'> }) =>
  request<{ data: Record<string, unknown> }>('/api/billing/sync', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const createPricing = (body: Pricing) =>
  request<{ data: Pricing }>('/api/pricing', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const deletePricing = (model: string) =>
  request<{ data: MutationOk }>(`/api/pricing/${encodeURIComponent(model)}`, {
    method: 'DELETE',
  })

export type SyncSource = 'all' | Agent

// Usage & savings
export const getUsage = (period: 'today' | 'week' | 'month' | 'year' | 'all' = 'month', agent?: string) => {
  const q = new URLSearchParams({ period })
  if (agent) q.set('agent', agent)
  return request<{ data: UsageResponse }>(`/api/usage?${q}`)
}

export const getSavings = (period: 'today' | 'week' | 'month' | 'year' | 'all' = 'month', agent?: string) => {
  const q = new URLSearchParams({ period })
  if (agent) q.set('agent', agent)
  return request<{ data: SavingsSummary }>(`/api/savings?${q}`)
}

export const getSubscriptions = () =>
  request<{ data: Subscription[] }>('/api/subscriptions')

export const createSubscription = (body: {
  id?: string
  agent?: Agent | null
  provider: string
  plan: string
  monthly_fee_usd?: number
  included_usage_usd?: number
  billing_cycle_start?: string | null
  reset_policy?: string
  active?: boolean | number
}) =>
  request<{ data: Subscription }>('/api/subscriptions', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const deleteSubscription = (id: string) =>
  request<{ data: MutationOk }>(`/api/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' })

export const getFleet = (period: 'today' | 'week' | 'month' | 'year' | 'all' = 'month') =>
  request<{ data: FleetResponse }>(`/api/fleet?period=${period}`)

// Sync
export const syncSources = (sources: SyncSource = 'all') =>
  request<{ data: Record<string, unknown> }>('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ sources }),
  })

// Goals
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
}

export const getGoals = () =>
  request<{ data: GoalStatus[] }>('/api/goals')

export const createGoal = (goal: { period: string; limit_usd: number; project_path?: string; agent?: Agent }) =>
  request<{ data: GoalStatus }>('/api/goals', {
    method: 'POST',
    body: JSON.stringify(goal),
  })

export const deleteGoalApi = (id: string) =>
  request<{ data: MutationOk }>(`/api/goals/${encodeURIComponent(id)}`, { method: 'DELETE' })
