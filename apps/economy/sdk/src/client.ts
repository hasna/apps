import type {
  Period,
  Agent,
  CostSummary,
  Session,
  ModelBreakdown,
  ProjectBreakdown,
  BudgetStatus,
  DailyPoint,
  ModelPricing,
  SyncResult,
  SessionFilter,
} from './types.js'

export interface EconomyClientOptions {
  baseUrl?: string
  retries?: number
  retryDelayMs?: number
}

interface ApiResponse<T> {
  data: T
  meta: Record<string, unknown>
}

export class EconomyClient {
  private baseUrl: string
  private retries: number
  private retryDelayMs: number

  constructor(opts?: EconomyClientOptions) {
    this.baseUrl = opts?.baseUrl ?? 'http://localhost:3456'
    this.retries = opts?.retries ?? 2
    this.retryDelayMs = opts?.retryDelayMs ?? 500
  }

  static fromEnv(): EconomyClient {
    return new EconomyClient({
      baseUrl: (typeof process !== 'undefined' ? process.env['ECONOMY_URL'] : undefined) ?? 'http://localhost:3456',
    })
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async request<T>(path: string, opts?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await this.sleep(this.retryDelayMs * attempt)
      }

      try {
        const res = await fetch(url, {
          ...opts,
          headers: {
            'Content-Type': 'application/json',
            ...(opts?.headers ?? {}),
          },
        })

        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText)
          throw new Error(`HTTP ${res.status}: ${text}`)
        }

        const json = (await res.json()) as ApiResponse<T>
        return json.data
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        // Don't retry client errors (4xx)
        if (lastError.message.startsWith('HTTP 4')) break
      }
    }

    throw lastError ?? new Error(`Request failed: ${url}`)
  }

  async getSummary(period?: Period): Promise<CostSummary> {
    const params = new URLSearchParams()
    if (period) params.set('period', period)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<CostSummary>(`/api/summary${qs}`)
  }

  async getSessions(filter?: SessionFilter): Promise<Session[]> {
    const params = new URLSearchParams()
    if (filter?.agent) params.set('agent', filter.agent)
    if (filter?.project) params.set('project', filter.project)
    if (filter?.limit != null) params.set('limit', String(filter.limit))
    if (filter?.offset != null) params.set('offset', String(filter.offset))
    if (filter?.since) params.set('since', filter.since)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<Session[]>(`/api/sessions${qs}`)
  }

  async getTopSessions(n?: number, agent?: Agent | string): Promise<Session[]> {
    const params = new URLSearchParams()
    if (n != null) params.set('n', String(n))
    if (agent) params.set('agent', agent)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<Session[]>(`/api/top${qs}`)
  }

  async getModelBreakdown(): Promise<ModelBreakdown[]> {
    return this.request<ModelBreakdown[]>('/api/models')
  }

  async getProjectBreakdown(): Promise<ProjectBreakdown[]> {
    return this.request<ProjectBreakdown[]>('/api/projects')
  }

  async getBudgets(): Promise<BudgetStatus[]> {
    return this.request<BudgetStatus[]>('/api/budgets')
  }

  async getDaily(days?: number): Promise<DailyPoint[]> {
    const params = new URLSearchParams()
    if (days != null) params.set('days', String(days))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<DailyPoint[]>(`/api/daily${qs}`)
  }

  async getPricing(): Promise<ModelPricing[]> {
    return this.request<ModelPricing[]>('/api/pricing')
  }

  async sync(sources?: 'all' | 'claude' | 'codex'): Promise<SyncResult> {
    return this.request<SyncResult>('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ sources: sources ?? 'all' }),
    })
  }
}
