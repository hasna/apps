export type Agent = 'claude' | 'codex' | 'gemini'

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
  cost_usd: number
  duration_ms: number
  timestamp: string
  source_request_id: string
}

export interface EconomySession {
  id: string
  agent: Agent
  project_path: string
  project_name: string
  started_at: string
  ended_at: string | null
  total_cost_usd: number
  total_tokens: number
  request_count: number
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

export interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
  cacheReadPer1M: number
  cacheWritePer1M: number
}

export interface SyncOptions {
  claude?: boolean
  codex?: boolean
  verbose?: boolean
}

export interface SessionFilter {
  agent?: Agent
  project?: string
  limit?: number
  offset?: number
  since?: string
  search?: string
}
