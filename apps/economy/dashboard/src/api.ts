const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3456'

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

export interface Session {
  session_id: string
  agent: string
  project: string
  project_path?: string
  cost_usd: number
  total_tokens: number
  requests: number
  started_at: string
  ended_at?: string
  model?: string
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
  cost_usd: number
  last_active: string
}

export interface Budget {
  id: number
  project_path: string
  period: string
  limit_usd: number
  current_spend_usd: number
  percent_used: number
  is_over_alert: boolean
}

export interface Pricing {
  model: string
  input_per_1m: number
  output_per_1m: number
  cache_read_per_1m: number
  cache_write_per_1m: number
}

export interface BreakdownEntry {
  [key: string]: string | number
}

// Summary
export const getSummary = (period: 'today' | 'week' | 'month' | 'all') =>
  request<{ data: Summary }>(`/api/summary?period=${period}`)

// Daily
export const getDaily = (days = 30) =>
  request<{ data: DailyEntry[] }>(`/api/daily?days=${days}`)

export interface SessionRequest {
  id: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_create_tokens: number
  cost_usd: number
  duration_ms: number
  timestamp: string
}

// Sessions
export const getSessions = (params: {
  agent?: string
  project?: string
  limit?: number
  offset?: number
  since?: string
}) => {
  const q = new URLSearchParams()
  if (params.agent) q.set('agent', params.agent)
  if (params.project) q.set('project', params.project)
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
export const getProjects = () =>
  request<{ data: ProjectStat[] }>('/api/projects')

// Breakdown
export const getBreakdown = (by: 'model' | 'project') =>
  request<{ data: BreakdownEntry[] }>(`/api/breakdown?by=${by}`)

// Budgets
export const getBudgets = () =>
  request<{ data: Budget[] }>('/api/budgets')

export const createBudget = (body: {
  project_path?: string
  period: string
  limit_usd: number
  alert_at_percent?: number
}) =>
  request<{ data: Budget }>('/api/budgets', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const deleteBudget = (id: number) =>
  request<{ success: boolean }>(`/api/budgets/${id}`, { method: 'DELETE' })

// Pricing
export const getPricing = () =>
  request<{ data: Pricing[] }>('/api/pricing')

export const createPricing = (body: Pricing) =>
  request<{ data: Pricing }>('/api/pricing', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const deletePricing = (model: string) =>
  request<{ success: boolean }>(`/api/pricing/${encodeURIComponent(model)}`, {
    method: 'DELETE',
  })

// Sync
export const syncSources = (sources: 'all' | 'claude' | 'codex' = 'all') =>
  request<{ success: boolean }>('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ sources }),
  })

// Goals
export interface GoalStatus {
  id: string
  period: 'day' | 'week' | 'month' | 'year'
  project_path: string | null
  agent: string | null
  limit_usd: number
  current_spend_usd: number
  percent_used: number
  is_on_track: boolean
  is_at_risk: boolean
  is_over: boolean
}

export const getGoals = () =>
  request<{ data: GoalStatus[] }>('/api/goals')

export const createGoal = (goal: { period: string; limit_usd: number; project_path?: string; agent?: string }) =>
  request<{ data: GoalStatus }>('/api/goals', {
    method: 'POST',
    body: JSON.stringify(goal),
  })

export const deleteGoalApi = (id: string) =>
  request<{ success: boolean }>(`/api/goals/${id}`, { method: 'DELETE' })
