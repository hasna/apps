export type Agent = 'claude' | 'codex' | 'gemini' | 'takumi'

export type Period = 'today' | 'week' | 'month' | 'all'

export interface EconomyRequest {
  id: string
  agent: Agent
  session_id: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_create_tokens: number
  cost_usd: number
  duration_ms: number
  timestamp: string
  source_request_id: string
  machine_id?: string
}

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

export interface DailyPoint {
  date: string
  cost_usd: number
  agent: string
}

export interface ModelPricing {
  model: string
  inputPer1M: number
  outputPer1M: number
  cacheReadPer1M: number
  cacheWritePer1M: number
}

export interface SyncResult {
  claude?: unknown
  codex?: unknown
  [key: string]: unknown
}

export interface SessionFilter {
  agent?: Agent
  project?: string
  machine?: string
  limit?: number
  offset?: number
  since?: string
}
