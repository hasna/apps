// ── The economy Store abstraction ────────────────────────────────────────────
//
// ONE interface, TWO transports. Every CLI command, MCP tool, and SDK caller
// that reads or writes economy DATA goes through `EconomyStore`. There are
// exactly two implementations:
//
//   • LocalStore — on-box SQLite. Opens the local db lazily and delegates to the
//     query/upsert/delete helpers in ../../db/database.ts.
//   • ApiStore   — the shared HTTP API at the @hasna/contracts-resolved
//     `<origin>/v1` with a bearer key. Delegates to the contracts storage client.
//
// `getStore()` resolves which transport to use through the one storage seam
// (`src/lib/cloud-storage.ts`): a credential resolves from the @hasna/contracts
// chain (Keychain, ~/.hasna/economy/config/credentials, HASNA_ECONOMY_API_KEY,
// default fleet gateway https://api.hasna.com/economy), the explicit local
// opt-in HASNA_ECONOMY_LOCAL=1 serves the on-box store, and nothing configured
// fails closed. Retired storage-mode variables are a hard error, never a
// selector. Callers NEVER branch on mode themselves and NEVER touch sqlite or
// fetch directly — that was the split-brain bug this module eliminates.
//
// `self_hosted` and `cloud` are the SAME client code (ApiStore); only the URL and
// key differ, and that distinction is server-side tenancy. `local` is
// first-class and fully functional.
//
// SAFETY: the API key never leaves the transport; it is never logged, returned,
// or embedded in any value produced here. Only the HTTP transport ever holds it.

import { randomUUID } from 'crypto'
import { SqliteAdapter as Database } from '../../db/sqlite-adapter.js'
import {
  openDatabase,
  getMachineId,
  insertFeedback,
  querySummary,
  querySessions,
  queryTopSessions,
  queryModelBreakdown,
  queryModelBreakdownSince,
  queryProjectBreakdown,
  queryProjectBreakdownSince,
  queryAgentBreakdown,
  queryAgentBreakdownSince,
  queryAccountBreakdown,
  queryAccountBreakdownSince,
  queryCostCenterBreakdown,
  queryDailyBreakdown,
  getSessionDetail,
  getBudgetStatuses,
  upsertBudget,
  deleteBudget,
  upsertGoal,
  deleteGoal,
  getGoalStatuses,
  upsertProject,
  deleteProject,
  getProject,
  listModelPricing,
  upsertModelPricing,
  deleteModelPricing,
  listSubscriptions,
  upsertSubscription,
  deleteSubscription,
  listMachines,
  listMachineRegistry,
  queryBillingSummary,
  queryUsageSnapshots,
  queryRequestsSince,
  type MachineInfo,
  type SessionDetail,
  type DbModelPricing,
  type GoalStatus,
} from '../../db/database.js'
import { ensurePricingSeeded, estimateCostFromRows } from '../pricing.js'
import { packageMetadata } from '../package-metadata.js'
import { querySavingsSummary } from '../savings.js'
import { queryBillingDiff, type BillingDiffSummary } from '../billing-diff.js'
import { usageSnapshotFilterForPeriod } from '../periods.js'
import { buildBrief, type EconomyBrief } from '../brief.js'
import {
  queryProjectDetail,
  queryExportRows,
  queryRangeStats,
  queryForecast,
  queryModelEfficiency,
  type ProjectDetail,
  type RangeStats,
  type ForecastData,
  type ModelEfficiency,
  type ExportType,
} from '../analytics.js'
import {
  economyCloudStorage,
  cloudListItems,
  cloudObject,
  type ActiveEconomyCloudStorage,
} from '../cloud-storage.js'
import type {
  Agent,
  AgentBreakdown,
  AccountBreakdown,
  Budget,
  BudgetStatus,
  CostCenterBreakdown,
  CostCenterKind,
  CostSummary,
  EconomyRequest,
  EconomySession,
  ModelBreakdown,
  MachineRegistry,
  Period,
  ProjectBreakdown,
  Subscription,
} from '../../types/index.js'

// Re-export the types that appear in the public Store surface so SDK consumers
// can name them (return/param types of EconomyStore methods) without importing
// from the internal on-box modules.
export type { MachineInfo, SessionDetail, DbModelPricing, GoalStatus } from '../../db/database.js'
export type { BillingDiffSummary } from '../billing-diff.js'
export type { EconomyBrief } from '../brief.js'
export type { ProjectDetail, RangeStats, ForecastData, ModelEfficiency, ExportType } from '../analytics.js'

/** Fleet roll-up: cross-machine summary + per-machine rows + machine registry. */
export interface FleetSummary {
  summary: CostSummary
  machines: MachineInfo[]
  registry: MachineRegistry[]
}

/** Options accepted by the breakdown reads. `since` (ISO date) wins over period. */
export interface BreakdownQuery {
  period?: Period
  since?: string
  machine?: string
}

/** Breakdown query for cost centers — same as `BreakdownQuery` plus a kind filter. */
export interface CostCenterQuery extends BreakdownQuery {
  kind?: CostCenterKind
}

/** Create/update input for a budget (the Store assigns id + timestamps). */
export interface BudgetInput {
  project_path: string | null
  agent: Agent | null
  cost_center_id?: string | null
  period: 'daily' | 'weekly' | 'monthly'
  limit_usd: number
  alert_at_percent: number
}

/** Create/update input for a spending goal. */
export interface GoalInput {
  period: 'day' | 'week' | 'month' | 'year'
  project_path: string | null
  agent: Agent | null
  limit_usd: number
}

/** Create/update input for a model pricing row (model is the key). */
export interface PricingInput {
  model: string
  input_per_1m: number
  output_per_1m: number
  cache_read_per_1m: number
  cache_write_per_1m: number
  cache_write_1h_per_1m: number
  cache_storage_per_1m_hour: number
}

/** Query for the fleet brief. `currentMachineId`/`localSyncAt` only apply to the
 * local transport (the cloud serve computes freshness from its own dataset). */
export interface BriefQuery {
  since?: string
  machine?: string
  currentMachineId?: string
  localSyncAt?: Date
}

/** Token counts for a pre-flight cost estimate (backs `economy estimate` /
 * `estimate_cost`). The Store resolves pricing from its own dataset so cloud
 * users estimate against the SAME pricing table they edit via set/get pricing. */
export interface EstimateInput {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cacheWrite1hTokens?: number
  cacheStorageTokenHours?: number
}

/** Input for a feedback submission (backs `send_feedback`). The Store stamps the
 * package version and machine id; the caller only supplies user-provided fields. */
export interface FeedbackInput {
  message: string
  email?: string | null
  category?: 'bug' | 'feature' | 'general'
}

/** Create/update input for a subscription plan. */
export interface SubscriptionInput {
  id?: string
  provider: string
  plan: string
  agent: Agent | null
  monthly_fee_usd: number
  included_usage_usd: number
  billing_cycle_start: string | null
  reset_policy: string
  active: number
}

/**
 * The single data interface for economy. Both LocalStore and ApiStore implement
 * it; callers hold an `EconomyStore` and never know (or branch on) which one.
 */
export interface EconomyStore {
  /** Which transport backs this store (for banners/diagnostics only). */
  readonly transport: 'local' | 'cloud-http'

  // ── Reads ──────────────────────────────────────────────────────────────────
  summary(period: Period, machine?: string): Promise<CostSummary>
  sessions(filter: {
    agent?: Agent
    project?: string
    account?: string
    machine?: string
    limit?: number
    since?: string
    search?: string
  }): Promise<EconomySession[]>
  topSessions(n: number, agent?: Agent, since?: string): Promise<EconomySession[]>
  sessionDetail(id: string): Promise<SessionDetail | null>
  modelBreakdown(query?: BreakdownQuery): Promise<ModelBreakdown[]>
  agentBreakdown(query?: BreakdownQuery): Promise<AgentBreakdown[]>
  projectBreakdown(query?: BreakdownQuery): Promise<ProjectBreakdown[]>
  accountBreakdown(query?: BreakdownQuery): Promise<AccountBreakdown[]>
  costCenterBreakdown(query?: CostCenterQuery): Promise<CostCenterBreakdown[]>
  accounts(period: Period): Promise<AccountBreakdown[]>
  daily(days: number, machine?: string): Promise<Array<{ date: string; cost_usd: number; agent: string }>>
  machines(): Promise<MachineInfo[]>
  /** Cross-machine fleet roll-up (backs `economy fleet`). */
  fleet(period: Period): Promise<FleetSummary>
  billingSummary(period: Period): Promise<{ total_usd: number; by_provider: Record<string, number> }>
  /** Estimated vs actual (provider) billing delta (backs `economy billing diff`). */
  billingDiff(period: Period): Promise<BillingDiffSummary>
  usage(period: Period, agent?: Agent): Promise<unknown>
  savings(period: Period, agent?: Agent): Promise<unknown>
  listBudgets(): Promise<BudgetStatus[]>
  listGoals(): Promise<GoalStatus[]>
  listPricing(): Promise<DbModelPricing[]>
  listSubscriptions(): Promise<Subscription[]>
  listProjects(): Promise<ProjectBreakdown[]>

  // ── Analytics reads ──────────────────────────────────────────────────────────
  /** Fleet-wide usage brief (backs `economy brief`). */
  brief(query?: BriefQuery): Promise<EconomyBrief>
  /** Detailed breakdown for one project by name or path substring. */
  projectDetail(nameOrPath: string): Promise<ProjectDetail | null>
  /** Raw rows for a CSV export of sessions or requests over a period. */
  exportRows(type: ExportType, period: string): Promise<Array<Record<string, unknown>>>
  /** Cost/request/token/session totals for an inclusive [from,to] date range. */
  rangeStats(from: string, to: string): Promise<RangeStats>
  /** End-of-month projection from the current burn rate. */
  forecast(): Promise<ForecastData>
  /** Per-model token efficiency (output/input, cache hit%, cost/1k out). */
  efficiency(): Promise<ModelEfficiency[]>
  /** Requests recorded at or after an ISO timestamp (live cost stream). */
  recentRequests(since: string): Promise<EconomyRequest[]>
  /** Pre-flight cost estimate for token counts, priced from this store's dataset. */
  estimate(input: EstimateInput): Promise<number>

  // ── Writes ─────────────────────────────────────────────────────────────────
  /** Create a budget; resolves to its id ('' if the transport does not echo one). */
  setBudget(input: BudgetInput): Promise<string>
  removeBudget(id: string): Promise<void>
  setGoal(input: GoalInput): Promise<void>
  removeGoal(id: string): Promise<void>
  setPricing(input: PricingInput): Promise<void>
  removePricing(model: string): Promise<void>
  setSubscription(input: SubscriptionInput): Promise<Subscription>
  removeSubscription(id: string): Promise<void>
  addProject(path: string, name: string): Promise<void>
  renameProject(path: string, name: string): Promise<void>
  removeProject(path: string): Promise<void>
  /** Record user feedback (LocalStore -> local `feedback` table; ApiStore ->
   * POST /v1/feedback on the shared cloud). */
  sendFeedback(input: FeedbackInput): Promise<void>
}

// ── LocalStore ────────────────────────────────────────────────────────────────

export class LocalStore implements EconomyStore {
  readonly transport = 'local' as const
  private _db: Database | undefined

  private db(): Database {
    if (!this._db) {
      this._db = openDatabase()
      ensurePricingSeeded(this._db)
    }
    return this._db
  }

  async summary(period: Period, machine?: string): Promise<CostSummary> {
    return querySummary(this.db(), period, machine)
  }

  async sessions(filter: {
    agent?: Agent
    project?: string
    account?: string
    machine?: string
    limit?: number
    since?: string
    search?: string
  }): Promise<EconomySession[]> {
    return querySessions(this.db(), filter)
  }

  async topSessions(n: number, agent?: Agent, since?: string): Promise<EconomySession[]> {
    return queryTopSessions(this.db(), n, agent, since)
  }

  async sessionDetail(id: string): Promise<SessionDetail | null> {
    return getSessionDetail(this.db(), id)
  }

  async modelBreakdown(query: BreakdownQuery = {}): Promise<ModelBreakdown[]> {
    return query.since ? queryModelBreakdownSince(this.db(), query.since) : queryModelBreakdown(this.db())
  }

  async agentBreakdown(query: BreakdownQuery = {}): Promise<AgentBreakdown[]> {
    return query.since
      ? queryAgentBreakdownSince(this.db(), query.since)
      : queryAgentBreakdown(this.db(), query.period ?? 'all', query.machine)
  }

  async projectBreakdown(query: BreakdownQuery = {}): Promise<ProjectBreakdown[]> {
    return query.since
      ? queryProjectBreakdownSince(this.db(), query.since, query.machine)
      : queryProjectBreakdown(this.db(), query.period ?? 'all', query.machine)
  }

  async accountBreakdown(query: BreakdownQuery = {}): Promise<AccountBreakdown[]> {
    return query.since
      ? queryAccountBreakdownSince(this.db(), query.since)
      : queryAccountBreakdown(this.db(), query.period ?? 'all', query.machine)
  }

  async costCenterBreakdown(query: CostCenterQuery = {}): Promise<CostCenterBreakdown[]> {
    return queryCostCenterBreakdown(this.db(), query.period ?? 'all', {
      kind: query.kind,
      machine: query.machine,
      since: query.since,
    })
  }

  async accounts(period: Period): Promise<AccountBreakdown[]> {
    return queryAccountBreakdown(this.db(), period)
  }

  async daily(days: number, machine?: string): Promise<Array<{ date: string; cost_usd: number; agent: string }>> {
    return queryDailyBreakdown(this.db(), days, machine)
  }

  async machines(): Promise<MachineInfo[]> {
    return listMachines(this.db())
  }

  async fleet(period: Period): Promise<FleetSummary> {
    return {
      summary: querySummary(this.db(), period, undefined, true),
      machines: listMachines(this.db(), period),
      registry: listMachineRegistry(this.db()),
    }
  }

  async billingSummary(period: Period): Promise<{ total_usd: number; by_provider: Record<string, number> }> {
    return queryBillingSummary(this.db(), period)
  }

  async billingDiff(period: Period): Promise<BillingDiffSummary> {
    return queryBillingDiff(this.db(), period)
  }

  async usage(period: Period, agent?: Agent): Promise<unknown> {
    const snapshots = queryUsageSnapshots(this.db(), { agent, ...usageSnapshotFilterForPeriod(period) })
    const summary = querySummary(this.db(), period, undefined, true, agent)
    return { snapshots, summary }
  }

  async savings(period: Period, agent?: Agent): Promise<unknown> {
    return querySavingsSummary(this.db(), period, agent)
  }

  async listBudgets(): Promise<BudgetStatus[]> {
    return getBudgetStatuses(this.db())
  }

  async listGoals(): Promise<GoalStatus[]> {
    return getGoalStatuses(this.db())
  }

  async listPricing(): Promise<DbModelPricing[]> {
    return listModelPricing(this.db())
  }

  async listSubscriptions(): Promise<Subscription[]> {
    return listSubscriptions(this.db())
  }

  async listProjects(): Promise<ProjectBreakdown[]> {
    return queryProjectBreakdown(this.db())
  }

  async brief(query: BriefQuery = {}): Promise<EconomyBrief> {
    return buildBrief(this.db(), {
      since: query.since,
      machine: query.machine,
      currentMachineId: query.currentMachineId,
      localSyncAt: query.localSyncAt,
    })
  }

  async projectDetail(nameOrPath: string): Promise<ProjectDetail | null> {
    return queryProjectDetail(this.db(), nameOrPath)
  }

  async exportRows(type: ExportType, period: string): Promise<Array<Record<string, unknown>>> {
    return queryExportRows(this.db(), type, period)
  }

  async rangeStats(from: string, to: string): Promise<RangeStats> {
    return queryRangeStats(this.db(), from, to)
  }

  async forecast(): Promise<ForecastData> {
    return queryForecast(this.db())
  }

  async efficiency(): Promise<ModelEfficiency[]> {
    return queryModelEfficiency(this.db())
  }

  async recentRequests(since: string): Promise<EconomyRequest[]> {
    return queryRequestsSince(this.db(), since)
  }

  async estimate(input: EstimateInput): Promise<number> {
    return estimateCostFromRows(
      listModelPricing(this.db()),
      input.model,
      input.inputTokens,
      input.outputTokens,
      input.cacheReadTokens ?? 0,
      input.cacheWriteTokens ?? 0,
      input.cacheWrite1hTokens ?? 0,
      input.cacheStorageTokenHours ?? 0,
    )
  }

  async setBudget(input: BudgetInput): Promise<string> {
    const now = new Date().toISOString()
    const budget: Budget = { id: randomUUID(), ...input, created_at: now, updated_at: now }
    upsertBudget(this.db(), budget)
    return budget.id
  }

  async removeBudget(id: string): Promise<void> {
    deleteBudget(this.db(), id)
  }

  async setGoal(input: GoalInput): Promise<void> {
    const now = new Date().toISOString()
    upsertGoal(this.db(), { id: randomUUID(), ...input, created_at: now, updated_at: now })
  }

  async removeGoal(id: string): Promise<void> {
    deleteGoal(this.db(), id)
  }

  async setPricing(input: PricingInput): Promise<void> {
    upsertModelPricing(this.db(), { ...input, updated_at: new Date().toISOString() })
  }

  async removePricing(model: string): Promise<void> {
    deleteModelPricing(this.db(), model)
  }

  async setSubscription(input: SubscriptionInput): Promise<Subscription> {
    const now = new Date().toISOString()
    const row: Subscription = {
      id: input.id ?? randomUUID(),
      provider: input.provider,
      plan: input.plan,
      agent: input.agent,
      monthly_fee_usd: input.monthly_fee_usd,
      included_usage_usd: input.included_usage_usd,
      billing_cycle_start: input.billing_cycle_start,
      reset_policy: input.reset_policy,
      active: input.active,
      created_at: now,
      updated_at: now,
    }
    upsertSubscription(this.db(), row)
    return row
  }

  async removeSubscription(id: string): Promise<void> {
    deleteSubscription(this.db(), id)
  }

  async addProject(path: string, name: string): Promise<void> {
    upsertProject(this.db(), {
      id: randomUUID(),
      path,
      name,
      description: null,
      tags: [],
      created_at: new Date().toISOString(),
    })
  }

  async renameProject(path: string, name: string): Promise<void> {
    const existing = getProject(this.db(), path)
    if (!existing) throw new Error('Project not found')
    upsertProject(this.db(), { ...existing, name })
  }

  async removeProject(path: string): Promise<void> {
    deleteProject(this.db(), path)
  }

  async sendFeedback(input: FeedbackInput): Promise<void> {
    insertFeedback(this.db(), {
      message: input.message,
      email: input.email ?? null,
      category: input.category ?? 'general',
      version: packageMetadata.version,
      machine_id: getMachineId(),
    })
  }
}

// ── ApiStore ────────────────────────────────────────────────────────────────

/** Drop nullish query entries so we never send empty params to the API. */
function q(params: Record<string, string | number | boolean | null | undefined>): Record<string, string | number | boolean | null | undefined> {
  const out: Record<string, string | number | boolean | null | undefined> = {}
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') out[k] = v
  return out
}

export class ApiStore implements EconomyStore {
  readonly transport = 'cloud-http' as const
  constructor(private readonly cloud: ActiveEconomyCloudStorage) {}

  async summary(period: Period, machine?: string): Promise<CostSummary> {
    return cloudObject<CostSummary>(this.cloud, '/summary', q({ period, machine }))
  }

  async sessions(filter: {
    agent?: Agent
    project?: string
    account?: string
    machine?: string
    limit?: number
    since?: string
    search?: string
  }): Promise<EconomySession[]> {
    return cloudListItems<EconomySession>(this.cloud, 'sessions', q({ ...filter }))
  }

  async topSessions(n: number, agent?: Agent, since?: string): Promise<EconomySession[]> {
    return cloudListItems<EconomySession>(this.cloud, 'top', q({ n, agent, since }))
  }

  async sessionDetail(id: string): Promise<SessionDetail | null> {
    const matches = await cloudListItems<Record<string, unknown>>(this.cloud, 'sessions', q({ search: id, limit: 1 }))
    const session = matches[0]
    if (!session) return null
    const requests = await cloudObject<Array<Record<string, unknown>>>(
      this.cloud,
      `/sessions/${encodeURIComponent(String(session['id']))}/requests`,
    )
    return { session, requests: requests ?? [] }
  }

  async modelBreakdown(query: BreakdownQuery = {}): Promise<ModelBreakdown[]> {
    return cloudListItems<ModelBreakdown>(this.cloud, 'breakdown', q({ by: 'model', period: query.period, since: query.since }))
  }

  async agentBreakdown(query: BreakdownQuery = {}): Promise<AgentBreakdown[]> {
    return cloudListItems<AgentBreakdown>(this.cloud, 'breakdown', q({ by: 'agent', period: query.period, since: query.since }))
  }

  async projectBreakdown(query: BreakdownQuery = {}): Promise<ProjectBreakdown[]> {
    return cloudListItems<ProjectBreakdown>(this.cloud, 'breakdown', q({ by: 'project', period: query.period, since: query.since, machine: query.machine }))
  }

  async accountBreakdown(query: BreakdownQuery = {}): Promise<AccountBreakdown[]> {
    return cloudListItems<AccountBreakdown>(this.cloud, 'breakdown', q({ by: 'account', period: query.period, since: query.since }))
  }

  async costCenterBreakdown(query: CostCenterQuery = {}): Promise<CostCenterBreakdown[]> {
    const rows = await cloudListItems<CostCenterBreakdown>(this.cloud, 'breakdown', q({
      by: query.kind ?? 'cost-center',
      period: query.period,
      since: query.since,
    }))
    // A serve older than the cost-center release ignores an unknown `by` and
    // falls through to the model breakdown, which would render as a table of
    // `undefined` cost centers. Only surface rows the server actually attributed
    // to a cost center, so an un-upgraded API reports "no cost-center usage"
    // instead of silently mislabelling model rows.
    return rows.filter(row => Boolean(row?.cost_center_id))
  }

  async accounts(period: Period): Promise<AccountBreakdown[]> {
    return cloudListItems<AccountBreakdown>(this.cloud, 'accounts', q({ period }))
  }

  async daily(days: number, machine?: string): Promise<Array<{ date: string; cost_usd: number; agent: string }>> {
    return cloudListItems<{ date: string; cost_usd: number; agent: string }>(this.cloud, 'daily', q({ days, machine }))
  }

  async machines(): Promise<MachineInfo[]> {
    return cloudListItems<MachineInfo>(this.cloud, 'machines')
  }

  async fleet(period: Period): Promise<FleetSummary> {
    const data = await cloudObject<FleetSummary>(this.cloud, '/fleet', q({ period }))
    return {
      summary: data.summary,
      machines: data.machines ?? [],
      registry: data.registry ?? [],
    }
  }

  async billingSummary(period: Period): Promise<{ total_usd: number; by_provider: Record<string, number> }> {
    return cloudObject<{ total_usd: number; by_provider: Record<string, number> }>(this.cloud, '/billing', q({ period }))
  }

  async billingDiff(period: Period): Promise<BillingDiffSummary> {
    return cloudObject<BillingDiffSummary>(this.cloud, '/billing/diff', q({ period }))
  }

  async usage(period: Period, agent?: Agent): Promise<unknown> {
    return cloudObject<unknown>(this.cloud, '/usage', q({ period, agent }))
  }

  async savings(period: Period, agent?: Agent): Promise<unknown> {
    return cloudObject<unknown>(this.cloud, '/savings', q({ period, agent }))
  }

  async listBudgets(): Promise<BudgetStatus[]> {
    return cloudListItems<BudgetStatus>(this.cloud, 'budgets')
  }

  async listGoals(): Promise<GoalStatus[]> {
    return cloudListItems<GoalStatus>(this.cloud, 'goals')
  }

  async listPricing(): Promise<DbModelPricing[]> {
    return cloudListItems<DbModelPricing>(this.cloud, 'pricing')
  }

  async listSubscriptions(): Promise<Subscription[]> {
    return cloudListItems<Subscription>(this.cloud, 'subscriptions')
  }

  async listProjects(): Promise<ProjectBreakdown[]> {
    return cloudListItems<ProjectBreakdown>(this.cloud, 'projects')
  }

  async brief(query: BriefQuery = {}): Promise<EconomyBrief> {
    // The serve computes the brief from the shared dataset; local-only sync
    // hints (currentMachineId/localSyncAt) do not apply and are not sent.
    return cloudObject<EconomyBrief>(this.cloud, '/brief', q({ since: query.since, machine: query.machine }))
  }

  async projectDetail(nameOrPath: string): Promise<ProjectDetail | null> {
    return cloudObject<ProjectDetail | null>(this.cloud, '/projects/detail', q({ q: nameOrPath }))
  }

  async exportRows(type: ExportType, period: string): Promise<Array<Record<string, unknown>>> {
    return cloudListItems<Record<string, unknown>>(this.cloud, 'export', q({ type, period }))
  }

  async rangeStats(from: string, to: string): Promise<RangeStats> {
    return cloudObject<RangeStats>(this.cloud, '/compare', q({ from, to }))
  }

  async forecast(): Promise<ForecastData> {
    return cloudObject<ForecastData>(this.cloud, '/forecast')
  }

  async efficiency(): Promise<ModelEfficiency[]> {
    return cloudListItems<ModelEfficiency>(this.cloud, 'efficiency')
  }

  async recentRequests(since: string): Promise<EconomyRequest[]> {
    return cloudListItems<EconomyRequest>(this.cloud, 'requests', q({ since }))
  }

  async estimate(input: EstimateInput): Promise<number> {
    // Price against the SHARED cloud pricing table (the same rows served to
    // get_pricing / set_pricing), using the identical matching + tier logic as
    // the local path — so a cloud user's estimate matches their edited pricing.
    const rows = await this.listPricing()
    return estimateCostFromRows(
      rows,
      input.model,
      input.inputTokens,
      input.outputTokens,
      input.cacheReadTokens ?? 0,
      input.cacheWriteTokens ?? 0,
      input.cacheWrite1hTokens ?? 0,
      input.cacheStorageTokenHours ?? 0,
    )
  }

  async setBudget(input: BudgetInput): Promise<string> {
    const created = await this.cloud.client.create<{ id?: string }>('budgets', {
      project_path: input.project_path,
      ...(input.agent ? { agent: input.agent } : {}),
      ...(input.cost_center_id ? { cost_center_id: input.cost_center_id } : {}),
      period: input.period,
      limit_usd: input.limit_usd,
      alert_at_percent: input.alert_at_percent,
    })
    return created?.id ?? ''
  }

  async removeBudget(id: string): Promise<void> {
    await this.cloud.client.delete('budgets', id)
  }

  async setGoal(input: GoalInput): Promise<void> {
    await this.cloud.client.create('goals', {
      period: input.period,
      project_path: input.project_path,
      ...(input.agent ? { agent: input.agent } : {}),
      limit_usd: input.limit_usd,
    })
  }

  async removeGoal(id: string): Promise<void> {
    await this.cloud.client.delete('goals', id)
  }

  async setPricing(input: PricingInput): Promise<void> {
    await this.cloud.client.create('pricing', { ...input, updated_at: new Date().toISOString() })
  }

  async removePricing(model: string): Promise<void> {
    await this.cloud.client.delete('pricing', model)
  }

  async setSubscription(input: SubscriptionInput): Promise<Subscription> {
    const now = new Date().toISOString()
    const row: Subscription = {
      id: input.id ?? randomUUID(),
      provider: input.provider,
      plan: input.plan,
      agent: input.agent,
      monthly_fee_usd: input.monthly_fee_usd,
      included_usage_usd: input.included_usage_usd,
      billing_cycle_start: input.billing_cycle_start,
      reset_policy: input.reset_policy,
      active: input.active,
      created_at: now,
      updated_at: now,
    }
    await this.cloud.client.create('subscriptions', row)
    return row
  }

  async removeSubscription(id: string): Promise<void> {
    await this.cloud.client.delete('subscriptions', id)
  }

  async addProject(path: string, name: string): Promise<void> {
    await this.cloud.client.create('project-registry', { path, name, description: null, tags: [] })
  }

  async renameProject(path: string, name: string): Promise<void> {
    // No PUT for project-registry; rename = delete-by-path then re-create.
    await this.cloud.client.delete('project-registry', path)
    await this.cloud.client.create('project-registry', { path, name, description: null, tags: [] })
  }

  async removeProject(path: string): Promise<void> {
    await this.cloud.client.delete('project-registry', path)
  }

  async sendFeedback(input: FeedbackInput): Promise<void> {
    // POST /v1/feedback on the shared cloud — never a local SQLite file. The
    // serve stamps its own version/machine, so only the user fields are sent.
    await this.cloud.client.create('feedback', {
      message: input.message,
      ...(input.email ? { email: input.email } : {}),
      category: input.category ?? 'general',
    })
  }
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Resolve the active {@link EconomyStore} for the current environment. Returns an
 * {@link ApiStore} when the @hasna/contracts resolver produces an authenticated
 * cloud-http client, else a {@link LocalStore} when the explicit local opt-in
 * applies; a retired `HASNA_ECONOMY_STORAGE_MODE`-family variable is a hard
 * error, and NO credential + no opt-in FAILS CLOSED. Throws if the API is
 * configured but misconfigured (so callers can never silently read the wrong
 * dataset).
 */
export function getStore(env: NodeJS.ProcessEnv = process.env): EconomyStore {
  const cloud = economyCloudStorage(env)
  return cloud.active ? new ApiStore(cloud) : new LocalStore()
}

/** True when the resolved store is the cloud HTTP transport (skips local sync). */
export function isCloudStore(env: NodeJS.ProcessEnv = process.env): boolean {
  return economyCloudStorage(env).active
}
