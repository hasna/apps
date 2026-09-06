import type {
  Period,
  Agent,
  CostSummary,
  Session,
  SessionRequest,
  ModelBreakdown,
  ProjectBreakdown,
  AgentBreakdown,
  AccountBreakdown,
  BudgetStatus,
  CreateBudgetInput,
  DailyPoint,
  CreatePricingInput,
  ModelPricing,
  MachineInfo,
  BillingSummary,
  BillingSyncResult,
  SyncResult,
  SessionFilter,
  CreateGoalInput,
  GoalStatus,
  Subscription,
  CreateSubscriptionInput,
  MutationOk,
  UsageResponse,
  SavingsSummary,
  FleetResponse,
  BillingDiffSummary,
} from './types.js'

export interface EconomyClientOptions {
  baseUrl?: string
  /** API key for the self-hosted service (sent as `x-api-key`). Required for
   * the internet-facing /v1 API; optional for a loopback dev server. */
  apiKey?: string
  retries?: number
  retryDelayMs?: number
}

interface ApiResponse<T> {
  data: T
  meta: Record<string, unknown>
}

export class EconomyClient {
  private baseUrl: string
  private apiKey?: string
  private retries: number
  private retryDelayMs: number

  constructor(opts?: EconomyClientOptions) {
    this.baseUrl = (opts?.baseUrl ?? 'http://localhost:3456').replace(/\/+$/, '')
    this.apiKey = opts?.apiKey
    this.retries = opts?.retries ?? 2
    this.retryDelayMs = opts?.retryDelayMs ?? 500
  }

  /**
   * Self-hosted client config from the environment: canonical
   * `HASNA_ECONOMY_API_URL` + `HASNA_ECONOMY_API_KEY` first (never a DSN). The
   * unprefixed `ECONOMY_API_URL` / `ECONOMY_API_KEY` spellings (and the legacy
   * `ECONOMY_URL`) are accepted as fallbacks for one release only. An explicit
   * `baseUrl` + `apiKey` constructor pair is the only other way in: this class
   * NEVER attaches the ambient fleet credential, so a client built with a
   * `baseUrl` and no `apiKey` goes out with no key at all (hasna/apps#1794).
   */
  static fromEnv(): EconomyClient {
    const env = typeof process !== 'undefined' ? process.env : {}
    return new EconomyClient({
      baseUrl: env['HASNA_ECONOMY_API_URL'] ?? env['ECONOMY_API_URL'] ?? env['ECONOMY_URL'] ?? 'http://localhost:3456',
      // hasna-credential-seam-waiver: @hasna/economy-sdk is a browser-targeted package whose shipped bundle must not load @hasna/contracts/client (that seam imports node:net, which no browser runtime resolves), so the SDK reads its API key from its own environment.
      apiKey: env['HASNA_ECONOMY_API_KEY'] ?? env['ECONOMY_API_KEY'],
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
            ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
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

  async getSummary(period?: Period, machine?: string): Promise<CostSummary> {
    const params = new URLSearchParams()
    if (period) params.set('period', period)
    if (machine) params.set('machine', machine)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<CostSummary>(`/v1/summary${qs}`)
  }

  async getSessions(filter?: SessionFilter): Promise<Session[]> {
    const params = new URLSearchParams()
    if (filter?.agent) params.set('agent', filter.agent)
    if (filter?.project) params.set('project', filter.project)
    if (filter?.account) params.set('account', filter.account)
    if (filter?.machine) params.set('machine', filter.machine)
    if (filter?.search) params.set('search', filter.search)
    if (filter?.limit != null) params.set('limit', String(filter.limit))
    if (filter?.offset != null) params.set('offset', String(filter.offset))
    if (filter?.since) params.set('since', filter.since)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<Session[]>(`/v1/sessions${qs}`)
  }

  async getSessionRequests(sessionId: string): Promise<SessionRequest[]> {
    return this.request<SessionRequest[]>(`/v1/sessions/${encodeURIComponent(sessionId)}/requests`)
  }

  async getMachines(): Promise<MachineInfo[]> {
    return this.request<MachineInfo[]>('/v1/machines')
  }

  async getTopSessions(n?: number, agent?: Agent | string): Promise<Session[]> {
    const params = new URLSearchParams()
    if (n != null) params.set('n', String(n))
    if (agent) params.set('agent', agent)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<Session[]>(`/v1/top${qs}`)
  }

  async getModelBreakdown(): Promise<ModelBreakdown[]> {
    return this.request<ModelBreakdown[]>('/v1/models')
  }

  async getProjectBreakdown(period?: Period): Promise<ProjectBreakdown[]> {
    const qs = period ? `?period=${encodeURIComponent(period)}` : ''
    return this.request<ProjectBreakdown[]>(`/v1/projects${qs}`)
  }

  async getAgentBreakdown(period?: Period): Promise<AgentBreakdown[]> {
    const qs = period ? `?by=agent&period=${encodeURIComponent(period)}` : '?by=agent'
    return this.request<AgentBreakdown[]>(`/v1/breakdown${qs}`)
  }

  async getAccountBreakdown(period?: Period): Promise<AccountBreakdown[]> {
    const qs = period ? `?period=${encodeURIComponent(period)}` : ''
    return this.request<AccountBreakdown[]>(`/v1/accounts${qs}`)
  }

  async getBudgets(): Promise<BudgetStatus[]> {
    return this.request<BudgetStatus[]>('/v1/budgets')
  }

  async createBudget(input: CreateBudgetInput): Promise<BudgetStatus> {
    return this.request<BudgetStatus>('/v1/budgets', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async deleteBudget(id: string): Promise<MutationOk> {
    return this.request<MutationOk>(`/v1/budgets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async getDaily(days?: number): Promise<DailyPoint[]> {
    const params = new URLSearchParams()
    if (days != null) params.set('days', String(days))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<DailyPoint[]>(`/v1/daily${qs}`)
  }

  async getPricing(): Promise<ModelPricing[]> {
    return this.request<ModelPricing[]>('/v1/pricing')
  }

  async createPricing(input: CreatePricingInput): Promise<ModelPricing> {
    return this.request<ModelPricing>('/v1/pricing', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async deletePricing(model: string): Promise<MutationOk> {
    return this.request<MutationOk>(`/v1/pricing/${encodeURIComponent(model)}`, {
      method: 'DELETE',
    })
  }

  async getGoals(): Promise<GoalStatus[]> {
    return this.request<GoalStatus[]>('/v1/goals')
  }

  async createGoal(input: CreateGoalInput): Promise<GoalStatus> {
    return this.request<GoalStatus>('/v1/goals', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async deleteGoal(id: string): Promise<MutationOk> {
    return this.request<MutationOk>(`/v1/goals/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async getSubscriptions(): Promise<Subscription[]> {
    return this.request<Subscription[]>('/v1/subscriptions')
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
    return this.request<Subscription>('/v1/subscriptions', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async deleteSubscription(id: string): Promise<MutationOk> {
    return this.request<MutationOk>(`/v1/subscriptions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  async getBilling(period?: Period): Promise<BillingSummary> {
    const params = new URLSearchParams()
    if (period) params.set('period', period)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<BillingSummary>(`/v1/billing${qs}`)
  }

  async syncBilling(opts?: { days?: number; providers?: Array<'anthropic' | 'openai' | 'gemini'> }): Promise<BillingSyncResult> {
    return this.request<BillingSyncResult>('/v1/billing/sync', {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    })
  }

  async sync(sources?: 'all' | Agent): Promise<SyncResult> {
    return this.request<SyncResult>('/v1/sync', {
      method: 'POST',
      body: JSON.stringify({ sources: sources ?? 'all' }),
    })
  }

  async getUsage(period?: Period, agent?: Agent | string): Promise<UsageResponse> {
    const params = new URLSearchParams()
    if (period) params.set('period', period)
    if (agent) params.set('agent', agent)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<UsageResponse>(`/v1/usage${qs}`)
  }

  async getSavings(period?: Period, agent?: Agent | string): Promise<SavingsSummary> {
    const params = new URLSearchParams()
    if (period) params.set('period', period)
    if (agent) params.set('agent', agent)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<SavingsSummary>(`/v1/savings${qs}`)
  }

  async getFleet(period?: Period): Promise<FleetResponse> {
    const params = new URLSearchParams()
    if (period) params.set('period', period)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<FleetResponse>(`/v1/fleet${qs}`)
  }

  async getBillingDiff(period?: Period, threshold?: number): Promise<BillingDiffSummary> {
    const params = new URLSearchParams()
    if (period) params.set('period', period)
    if (threshold != null) params.set('threshold', String(threshold))
    const qs = params.toString() ? `?${params.toString()}` : ''
    return this.request<BillingDiffSummary>(`/v1/billing/diff${qs}`)
  }
}
