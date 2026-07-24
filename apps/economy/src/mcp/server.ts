import { randomUUID } from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerCloudTools } from '@hasna/cloud'
import { registerAgentTools } from '@hasna/agent-registry'
import { z } from 'zod'
import { openDatabase, querySummary, querySessions, queryTopSessions, queryModelBreakdown, queryProjectBreakdown, queryAgentBreakdown, queryAccountBreakdown, queryCostCenterBreakdown, queryDailyBreakdown, getBudgetStatuses, upsertBudget, deleteBudget, upsertGoal, deleteGoal, getGoalStatuses, listSubscriptions, upsertSubscription, deleteSubscription, listMachines, getMachineId, queryBillingSummary, listModelPricing, upsertModelPricing, deleteModelPricing } from '../db/database.js'
import { syncAll } from '../lib/sync-all.js'
import { AGENTS } from '../lib/agents.js'
import { querySavingsSummary } from '../lib/savings.js'
import { queryUsageSnapshots } from '../db/database.js'
import { usageSnapshotFilterForPeriod } from '../lib/periods.js'
import { computeCostFromDb } from '../lib/pricing.js'
import { packageMetadata } from '../lib/package-metadata.js'
import { ensurePricingSeeded } from '../lib/pricing.js'
import type { CostCenterKind, Period } from '../types/index.js'
import type { Agent } from '../lib/agents.js'

export const MCP_NAME = 'economy'
export const DEFAULT_MCP_HTTP_PORT = 8860

export function buildServer(): any {
const db = openDatabase()
ensurePricingSeeded(db)

// The MCP SDK's tool-registration generics are expensive enough to make
// project-wide typecheck impractically slow here; keep the runtime object and
// avoid dragging those deep inferred types through the whole file.
const server: any = new McpServer({
  name: MCP_NAME,
  version: packageMetadata.version,
})

const SYNC_SOURCES = ['all', ...AGENTS, 'loops'] as const

const TOOL_NAMES = [
  'get_cost_summary',
  'get_sessions',
  'get_top_sessions',
  'get_model_breakdown',
  'get_project_breakdown',
  'get_agent_breakdown',
  'get_account_breakdown',
  'get_cost_center_breakdown',
  'get_budget_status',
  'set_budget',
  'remove_budget',
  'get_pricing',
  'set_pricing',
  'remove_pricing',
  'get_daily',
  'get_billing_summary',
  'get_session_detail',
  'get_usage',
  'get_savings',
  'list_subscriptions',
  'set_subscription',
  'remove_subscription',
  'sync',
  'search_tools',
  'describe_tools',
  'get_goals',
  'set_goal',
  'remove_goal',
  'list_machines',
  'register_agent',
  'heartbeat',
  'set_focus',
  'list_agents',
  'send_feedback',
] as const

const TOOL_DESCRIPTIONS: Record<string, string> = {
  get_cost_summary: 'period(today|week|month|year|all), machine?(hostname) -> {total_usd, sessions, requests, tokens, summary}',
  get_sessions: `agent(${AGENTS.join('|')}), project(partial), account?(key/name/email), machine?(hostname), limit(20) -> compact session table`,
  get_top_sessions: `n(10), agent(${AGENTS.join('|')}) -> top sessions by cost`,
  list_machines: 'limit(20), verbose?, json? -> machine_id, sessions, requests, cost, last_active',
  get_model_breakdown: 'limit(20), verbose?, json? -> model, requests, tokens, cost',
  get_project_breakdown: 'period?(today|week|month|year|all), limit(20), verbose?, json? -> project_name, sessions, tokens, cost',
  get_agent_breakdown: 'period?(today|week|month|year|all) -> agent, sessions, requests, tokens, api-equivalent, billable, included',
  get_account_breakdown: 'period?(today|week|month|year|all), limit(20), verbose?, json? -> account profile, sessions, requests, tokens, api-equivalent, billable, included',
  get_cost_center_breakdown: 'period?(today|week|month|year|all), kind?(loop|app|repo|service|team) -> cost center, sessions, requests, tokens, cost',
  get_budget_status: 'limit(20), verbose?, json? -> budget limits, current spend, percent_used, is_over_alert',
  set_budget: 'period(daily|weekly|monthly), limit_usd, project_path?, agent?, cost_center_id?, alert_at_percent? -> create budget',
  remove_budget: 'id -> delete budget',
  get_pricing: 'limit(20), verbose?, json? -> model pricing rows with input, output, cache read/write, and cache storage rates',
  set_pricing: 'model, input_per_1m, output_per_1m, cache_read_per_1m?, cache_write_per_1m?, cache_write_1h_per_1m?, cache_storage_per_1m_hour? -> create/update pricing',
  remove_pricing: 'model -> delete pricing row',
  get_daily: 'days(30) -> daily cost table grouped by date and agent',
  get_billing_summary: 'period(today|yesterday|week|month|year|all) -> actual provider billing totals',
  get_session_detail: 'session_id(prefix ok), limit(20), verbose? -> per-request breakdown with model, tokens, cost',
  get_usage: `period(today|week|month|year|all), agent?(${AGENTS.join('|')}), limit(20), json? -> usage snapshots and all-machine summary`,
  get_savings: `period(today|week|month|year|all), agent?(${AGENTS.join('|')}), limit(20), json? -> subscription/API-equivalent savings`,
  list_subscriptions: 'no params -> configured subscription plans and included usage',
  set_subscription: `provider, plan, monthly_fee_usd?, included_usage_usd?, agent?(${AGENTS.join('|')}), json? -> create/update subscription plan`,
  remove_subscription: 'id -> delete subscription plan',
  sync: `sources(${SYNC_SOURCES.join('|')}), json? -> ingest latest cost data`,
  search_tools: 'query substring -> tool name list',
  describe_tools: 'names[] -> one-line parameter hints',
  get_goals: 'limit(20), verbose?, json? -> goal progress summary',
  set_goal: 'period(day|week|month|year), limit_usd, project_path?, agent? -> create goal',
  remove_goal: 'id -> delete goal',
  register_agent: 'name, session_id? -> register agent session',
  heartbeat: 'agent_id -> update last_seen_at',
  set_focus: 'agent_id, project_id? -> set active project context',
  list_agents: 'no params -> registered agent list',
  send_feedback: 'message, email?, category? -> save feedback locally',
}

const fmtUsd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtTok = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n)
const DEFAULT_MCP_ROW_LIMIT = 20

function clampLimit(limit: number | undefined, fallback = DEFAULT_MCP_ROW_LIMIT, max = 100): number {
  if (limit == null) return fallback
  if (!Number.isFinite(limit)) return fallback
  return Math.max(1, Math.min(max, Math.floor(limit)))
}

function rowLimit(limit: number | undefined, verbose?: boolean): number {
  return verbose ? Number.POSITIVE_INFINITY : clampLimit(limit)
}

function hiddenRowsHint(total: number, shown: number, noun: string): string | undefined {
  return total > shown ? `... ${total - shown} more ${noun} hidden; call with limit, verbose=true, or json=true.` : undefined
}

function fmtSession(s: Record<string, unknown>): string {
  const id = String(s['id'] ?? '').slice(0, 8)
  const agent = String(s['agent'] ?? '')
  const proj = String(s['project_name'] || s['project_path'] || '—').slice(0, 20)
  const cost = fmtUsd(Number(s['total_cost_usd'] ?? 0))
  const tok = fmtTok(Number(s['total_tokens'] ?? 0))
  return `${id} ${agent.padEnd(6)} ${cost.padEnd(10)} ${tok.padEnd(8)} ${proj}`
}

function compactPrimitive(value: unknown): string {
  if (value == null) return 'none'
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('en-US') : String(value)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

function compactObject(value: unknown): string {
  if (value == null) return 'none'
  if (Array.isArray(value)) return `${value.length} rows`
  if (typeof value !== 'object') return compactPrimitive(value)
  const entries = Object.entries(value as Record<string, unknown>)
  const primitives = entries
    .filter(([, entry]) => entry == null || ['string', 'number', 'boolean'].includes(typeof entry))
    .slice(0, 6)
    .map(([key, entry]) => `${key}=${compactPrimitive(entry)}`)
  return primitives.length ? primitives.join(', ') : `${entries.length} fields`
}

function text(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

function textError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

server.tool(
  'search_tools',
  'List tool names matching query. Use first to find relevant tools.',
  { query: z.string().optional() },
  async ({ query }: { query?: string }) => {
    const q = query?.toLowerCase()
    const matches = q ? TOOL_NAMES.filter((name) => name.includes(q)) : [...TOOL_NAMES]
    return text(matches.join(', '))
  },
)

server.tool(
  'describe_tools',
  'Get param hints for specific tools by name.',
  { names: z.array(z.string()) },
  async ({ names }: { names: string[] }) => {
    const result = names.map((name) => `${name}: ${TOOL_DESCRIPTIONS[name] ?? 'see tool schema'}`).join('\n')
    return text(result)
  },
)

server.tool(
  'get_cost_summary',
  'Cost summary (total_usd, sessions, requests, tokens, human summary). period: today|week|month|year|all. machine: filter by hostname.',
  { period: z.enum(['today', 'week', 'month', 'year', 'all']).optional(), machine: z.string().optional() },
  async ({ period, machine }: { period?: Exclude<Period, 'yesterday'>; machine?: string }) => {
    const resolved = (period ?? 'today') as Exclude<Period, 'yesterday'>
    const s = querySummary(db, resolved, machine)
    const machineLabel = machine ? ` on ${machine}` : ''
    return text([
      `period: ${resolved}${machineLabel}`,
      `cost: ${fmtUsd(s.total_usd)}`,
      `sessions: ${s.sessions}`,
      `requests: ${s.requests.toLocaleString()}`,
      `tokens: ${fmtTok(s.tokens)}`,
      `summary: You've spent ${fmtUsd(s.total_usd)} ${resolved === 'all' ? 'total' : resolved}${machineLabel} across ${s.sessions} sessions (${s.requests.toLocaleString()} requests, ${fmtTok(s.tokens)} tokens)`,
    ].join('\n'))
  },
)

server.tool(
  'get_sessions',
  'List sessions. Returns compact table. Params: agent, project, account, machine, limit(20)',
  {
    agent: z.enum(AGENTS).optional(),
    project: z.string().optional(),
    account: z.string().optional(),
    machine: z.string().optional(),
    limit: z.number().int().positive().max(100).optional(),
  },
  async ({ agent, project, account, machine, limit }: { agent?: Agent; project?: string; account?: string; machine?: string; limit?: number }) => {
    const sessions = querySessions(db, {
      agent,
      project,
      account,
      machine,
      limit: limit ?? 20,
    }) as unknown as Array<Record<string, unknown>>
    const lines = ['id       agent  cost       tokens   project']
    for (const session of sessions) lines.push(fmtSession(session))
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_top_sessions',
  'Top sessions by cost. Params: n(10), agent',
  {
    n: z.number().int().positive().max(100).optional(),
    agent: z.enum(AGENTS).optional(),
  },
  async ({ n, agent }: { n?: number; agent?: Agent }) => {
    const sessions = queryTopSessions(db, n ?? 10, agent) as unknown as Array<Record<string, unknown>>
    const lines = ['rank  id       agent  cost       tokens   project']
    sessions.forEach((session, i) => lines.push(`${String(i + 1).padEnd(5)} ${fmtSession(session)}`))
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_model_breakdown',
  'Cost per model. Params: limit(20), verbose, json.',
  { limit: z.number().int().positive().max(100).optional(), verbose: z.boolean().optional(), json: z.boolean().optional() },
  async ({ limit, verbose, json }: { limit?: number; verbose?: boolean; json?: boolean }) => {
    const rows = queryModelBreakdown(db) as unknown as Array<Record<string, unknown>>
    if (json) return text(JSON.stringify(rows, null, 2))
    const visibleRows = rows.slice(0, rowLimit(limit, verbose))
    const lines = ['model                          agent     reqs    tokens   cost']
    for (const row of visibleRows) {
      lines.push(`${String(row['model']).slice(0, 30).padEnd(31)}${String(row['agent']).padEnd(10)}${String(row['requests']).padEnd(8)}${fmtTok(Number(row['total_tokens'])).padEnd(9)}${fmtUsd(Number(row['cost_usd']))}`)
    }
    const hint = hiddenRowsHint(rows.length, visibleRows.length, 'models')
    if (hint) lines.push(hint)
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_project_breakdown',
  'Cost per project. Params: period(today|week|month|year|all), limit(20), verbose, json.',
  { period: z.enum(['today', 'week', 'month', 'year', 'all']).optional(), limit: z.number().int().positive().max(100).optional(), verbose: z.boolean().optional(), json: z.boolean().optional() },
  async ({ period, limit, verbose, json }: { period?: Exclude<Period, 'yesterday'>; limit?: number; verbose?: boolean; json?: boolean }) => {
    const rows = queryProjectBreakdown(db, period ?? 'all') as unknown as Array<Record<string, unknown>>
    if (json) return text(JSON.stringify(rows, null, 2))
    const visibleRows = rows.slice(0, rowLimit(limit, verbose))
    const lines = ['project              sessions tokens   cost']
    for (const row of visibleRows) {
      const name = String(row['project_name'] || row['project_path'] || '—').slice(0, 20)
      lines.push(`${name.padEnd(21)}${String(row['sessions']).padEnd(9)}${fmtTok(Number(row['total_tokens'])).padEnd(9)}${fmtUsd(Number(row['cost_usd']))}`)
    }
    const hint = hiddenRowsHint(rows.length, visibleRows.length, 'projects')
    if (hint) lines.push(hint)
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_agent_breakdown',
  'Cost per coding agent. Params: period(today|week|month|year|all). Shows API-equivalent, billable API, and subscription-included usage.',
  { period: z.enum(['today', 'week', 'month', 'year', 'all']).optional() },
  async ({ period }: { period?: Exclude<Period, 'yesterday'> }) => {
    const rows = queryAgentBreakdown(db, period ?? 'all') as unknown as Array<Record<string, unknown>>
    if (rows.length === 0) return text('No agent usage yet.')
    const lines = ['agent      sessions requests tokens   api_eq    billable  included']
    for (const row of rows) {
      lines.push(
        `${String(row['agent']).slice(0, 10).padEnd(11)}` +
        `${String(row['sessions']).padEnd(9)}` +
        `${String(row['requests']).padEnd(9)}` +
        `${fmtTok(Number(row['total_tokens'])).padEnd(9)}` +
        `${fmtUsd(Number(row['api_equivalent_usd'] ?? row['cost_usd'])).padEnd(10)}` +
        `${fmtUsd(Number(row['billable_usd'] ?? 0)).padEnd(10)}` +
        `${fmtUsd(Number(row['subscription_included_usd'] ?? 0))}`,
      )
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_account_breakdown',
  'Cost per account/profile. Params: period(today|week|month|year|all), limit(20), verbose, json. Shows API-equivalent, billable API, and subscription-included usage.',
  { period: z.enum(['today', 'week', 'month', 'year', 'all']).optional(), limit: z.number().int().positive().max(100).optional(), verbose: z.boolean().optional(), json: z.boolean().optional() },
  async ({ period, limit, verbose, json }: { period?: Exclude<Period, 'yesterday'>; limit?: number; verbose?: boolean; json?: boolean }) => {
    const rows = queryAccountBreakdown(db, period ?? 'all') as unknown as Array<Record<string, unknown>>
    if (json) return text(JSON.stringify(rows, null, 2))
    if (rows.length === 0) return text('No account-attributed sessions yet.')
    const visibleRows = rows.slice(0, rowLimit(limit, verbose))
    const lines = ['account              agent      sessions requests tokens   api_eq    billable  included']
    for (const row of visibleRows) {
      const label = String(row['account_email'] || row['account_name'] || row['account_key'] || '—').slice(0, 20)
      lines.push(
        `${label.padEnd(21)}` +
        `${String(row['account_tool'] ?? '').slice(0, 10).padEnd(11)}` +
        `${String(row['sessions']).padEnd(9)}` +
        `${String(row['requests']).padEnd(9)}` +
        `${fmtTok(Number(row['total_tokens'])).padEnd(9)}` +
        `${fmtUsd(Number(row['api_equivalent_usd'] ?? row['cost_usd'])).padEnd(10)}` +
        `${fmtUsd(Number(row['billable_usd'] ?? 0)).padEnd(10)}` +
        `${fmtUsd(Number(row['subscription_included_usd'] ?? 0))}`,
      )
    }
    const hint = hiddenRowsHint(rows.length, visibleRows.length, 'accounts')
    if (hint) lines.push(hint)
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_cost_center_breakdown',
  'Cost per cost center. Params: period(today|week|month|year|all), kind(loop|app|repo|service|team).',
  {
    period: z.enum(['today', 'week', 'month', 'year', 'all']).optional(),
    kind: z.enum(['loop', 'app', 'repo', 'service', 'team']).optional(),
  },
  async ({ period, kind }: { period?: Exclude<Period, 'yesterday'>; kind?: CostCenterKind }) => {
    const rows = queryCostCenterBreakdown(db, period ?? 'all', { kind }) as unknown as Array<Record<string, unknown>>
    if (rows.length === 0) return text('No cost-center usage yet.')
    const lines = ['kind     cost_center          sessions requests tokens   cost']
    for (const row of rows) {
      lines.push(
        `${String(row['kind']).slice(0, 8).padEnd(9)}` +
        `${String(row['name'] || row['cost_center_id'] || '—').slice(0, 20).padEnd(21)}` +
        `${String(row['sessions']).padEnd(9)}` +
        `${String(row['requests']).padEnd(9)}` +
        `${fmtTok(Number(row['total_tokens'])).padEnd(9)}` +
        `${fmtUsd(Number(row['cost_usd']))}`,
      )
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_budget_status',
  'Budget limits vs spend, percent used, alert flags. Params: limit(20), verbose, json.',
  { limit: z.number().int().positive().max(100).optional(), verbose: z.boolean().optional(), json: z.boolean().optional() },
  async ({ limit, verbose, json }: { limit?: number; verbose?: boolean; json?: boolean }) => {
    const budgets = getBudgetStatuses(db) as unknown as Array<Record<string, unknown>>
    if (json) return text(JSON.stringify(budgets, null, 2))
    if (budgets.length === 0) return text('No budgets set.')
    const visibleBudgets = budgets.slice(0, rowLimit(limit, verbose))

    const lines = ['scope                period   spent      limit      used%  status']
    for (const budget of visibleBudgets) {
      const scope = String(budget['cost_center_id'] ?? budget['project_path'] ?? 'global').slice(0, 20)
      const pct = Number(budget['percent_used']).toFixed(1)
      const status = budget['is_over_limit'] ? 'OVER' : budget['is_over_alert'] ? 'ALERT' : 'OK'
      lines.push(`${scope.padEnd(21)}${String(budget['period']).padEnd(9)}${fmtUsd(Number(budget['current_spend_usd'])).padEnd(11)}${fmtUsd(Number(budget['limit_usd'])).padEnd(11)}${pct}%`.padEnd(49) + `  ${status}`)
    }
    const hint = hiddenRowsHint(budgets.length, visibleBudgets.length, 'budgets')
    if (hint) lines.push(hint)
    return text(lines.join('\n'))
  },
)

server.tool(
  'set_budget',
  'Create a spending budget. period: daily|weekly|monthly. limit_usd must be positive. alert_at_percent defaults to 80.',
  {
    period: z.enum(['daily', 'weekly', 'monthly']),
    limit_usd: z.number().positive(),
    project_path: z.string().optional(),
    agent: z.enum(AGENTS).optional(),
    cost_center_id: z.string().optional(),
    alert_at_percent: z.number().positive().max(100).optional(),
  },
  async ({ period, limit_usd, project_path, agent, cost_center_id, alert_at_percent }: { period: 'daily' | 'weekly' | 'monthly'; limit_usd: number; project_path?: string; agent?: Agent; cost_center_id?: string; alert_at_percent?: number }) => {
    const now = new Date().toISOString()
    const id = randomUUID()
    upsertBudget(db, {
      id,
      project_path: project_path ?? null,
      agent: agent ?? null,
      cost_center_id: cost_center_id ?? null,
      period,
      limit_usd,
      alert_at_percent: alert_at_percent ?? 80,
      created_at: now,
      updated_at: now,
    })
    return text(`Budget set: ${id}`)
  },
)

server.tool(
  'remove_budget',
  'Delete a budget by id.',
  { id: z.string() },
  async ({ id }: { id: string }) => {
    deleteBudget(db, id)
    return text('Budget removed.')
  },
)

server.tool(
  'get_pricing',
  'Editable model pricing rows. Includes input/output/cache rates and context-cache storage. Params: limit(20), verbose, json.',
  { limit: z.number().int().positive().max(100).optional(), verbose: z.boolean().optional(), json: z.boolean().optional() },
  async ({ limit, verbose, json }: { limit?: number; verbose?: boolean; json?: boolean }) => {
    const rows = listModelPricing(db)
    if (json) return text(JSON.stringify(rows, null, 2))
    const visibleRows = rows.slice(0, rowLimit(limit, verbose))
    const lines = ['model                          input    output   cache-r  cache-w  cache-1h storage-h']
    for (const row of visibleRows) {
      lines.push(
        `${row.model.slice(0, 30).padEnd(31)}` +
        `${fmtUsd(row.input_per_1m).padEnd(9)}` +
        `${fmtUsd(row.output_per_1m).padEnd(9)}` +
        `${fmtUsd(row.cache_read_per_1m).padEnd(9)}` +
        `${fmtUsd(row.cache_write_per_1m).padEnd(9)}` +
        `${fmtUsd(row.cache_write_1h_per_1m ?? 0).padEnd(9)}` +
        `${fmtUsd(row.cache_storage_per_1m_hour ?? 0)}`,
      )
    }
    const hint = hiddenRowsHint(rows.length, visibleRows.length, 'pricing rows')
    if (hint) lines.push(hint)
    return text(lines.join('\n'))
  },
)

server.tool(
  'set_pricing',
  'Create or update a model pricing row. Values are USD per 1M tokens except cache_storage_per_1m_hour.',
  {
    model: z.string().min(1),
    input_per_1m: z.number().nonnegative(),
    output_per_1m: z.number().nonnegative(),
    cache_read_per_1m: z.number().nonnegative().optional(),
    cache_write_per_1m: z.number().nonnegative().optional(),
    cache_write_1h_per_1m: z.number().nonnegative().optional(),
    cache_storage_per_1m_hour: z.number().nonnegative().optional(),
  },
  async (input: { model: string; input_per_1m: number; output_per_1m: number; cache_read_per_1m?: number; cache_write_per_1m?: number; cache_write_1h_per_1m?: number; cache_storage_per_1m_hour?: number }) => {
    const model = input.model.trim()
    if (!model) return textError('model is required')
    upsertModelPricing(db, {
      model,
      input_per_1m: input.input_per_1m,
      output_per_1m: input.output_per_1m,
      cache_read_per_1m: input.cache_read_per_1m ?? 0,
      cache_write_per_1m: input.cache_write_per_1m ?? 0,
      cache_write_1h_per_1m: input.cache_write_1h_per_1m ?? 0,
      cache_storage_per_1m_hour: input.cache_storage_per_1m_hour ?? 0,
      updated_at: new Date().toISOString(),
    })
    return text(`Pricing set: ${model}`)
  },
)

server.tool(
  'remove_pricing',
  'Delete a model pricing row by model id.',
  { model: z.string() },
  async ({ model }: { model: string }) => {
    deleteModelPricing(db, model)
    return text('Pricing removed.')
  },
)

server.tool(
  'get_daily',
  'Daily cost table by agent. Params: days(30)',
  { days: z.number().int().positive().max(365).optional() },
  async ({ days }: { days?: number }) => {
    const rows = queryDailyBreakdown(db, days ?? 30) as Array<Record<string, unknown>>
    const byDate = new Map<string, { claude: number; takumi: number; codex: number; gemini: number }>()

    for (const row of rows) {
      const date = String(row['date'])
      const entry = byDate.get(date) ?? { claude: 0, takumi: 0, codex: 0, gemini: 0 }
      if (row['agent'] === 'claude') entry.claude += Number(row['cost_usd'])
      else if (row['agent'] === 'takumi') entry.takumi += Number(row['cost_usd'])
      else if (row['agent'] === 'codex') entry.codex += Number(row['cost_usd'])
      else if (row['agent'] === 'gemini') entry.gemini += Number(row['cost_usd'])
      byDate.set(date, entry)
    }

    const lines = ['date        claude     takumi     codex      gemini     total']
    for (const [date, costs] of [...byDate.entries()].sort()) {
      const total = costs.claude + costs.takumi + costs.codex + costs.gemini
      lines.push(`${date}  ${fmtUsd(costs.claude).padEnd(11)}${fmtUsd(costs.takumi).padEnd(11)}${fmtUsd(costs.codex).padEnd(11)}${fmtUsd(costs.gemini).padEnd(11)}${fmtUsd(total)}`)
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_billing_summary',
  'Actual provider billing totals from admin API sync. Params: period(today|yesterday|week|month|year|all)',
  { period: z.enum(['today', 'yesterday', 'week', 'month', 'year', 'all']).optional() },
  async ({ period }: { period?: Period }) => {
    const summary = queryBillingSummary(db, period ?? 'month')
    const lines = ['provider    billed']
    for (const [provider, cost] of Object.entries(summary.by_provider)) {
      lines.push(`${provider.padEnd(11)}${fmtUsd(cost)}`)
    }
    lines.push(`total       ${fmtUsd(summary.total_usd)}`)
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_session_detail',
  'Per-request breakdown of a single session. Params: session_id (prefix ok), limit(20), verbose.',
  { session_id: z.string(), limit: z.number().int().positive().max(100).optional(), verbose: z.boolean().optional() },
  async ({ session_id, limit, verbose }: { session_id: string; limit?: number; verbose?: boolean }) => {
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ? OR id LIKE ?`).get(session_id, `${session_id}%`) as Record<string, unknown> | null
    if (!session) return textError(`Session not found: ${session_id}`)

    const requestLimit = clampLimit(limit, verbose ? 50 : DEFAULT_MCP_ROW_LIMIT)
    const requestCount = db.prepare(`SELECT COUNT(*) as count FROM requests WHERE session_id = ?`).get(session['id'] as string) as { count: number }
    const requests = db.prepare(`SELECT * FROM requests WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?`).all(session['id'] as string, requestLimit) as Array<Record<string, unknown>>
    const lines = [
      `session: ${String(session['id']).slice(0, 16)}`,
      `agent: ${session['agent']}  project: ${session['project_name'] || '—'}`,
      `cost: ${fmtUsd(Number(session['total_cost_usd']))}  tokens: ${fmtTok(Number(session['total_tokens']))}  requests: ${session['request_count']}`,
      '',
      'time      model                  input    output   cache-r  cache-5m cache-1h cost',
    ]

    for (const request of requests) {
      lines.push(
        `${String(request['timestamp']).slice(11, 19)}  ` +
        `${String(request['model']).slice(0, 22).padEnd(23)}` +
        `${fmtTok(Number(request['input_tokens'])).padEnd(9)}` +
        `${fmtTok(Number(request['output_tokens'])).padEnd(9)}` +
        `${fmtTok(Number(request['cache_read_tokens'])).padEnd(9)}` +
        `${fmtTok(Number(request['cache_create_5m_tokens'] ?? request['cache_create_tokens'] ?? 0)).padEnd(9)}` +
        `${fmtTok(Number(request['cache_create_1h_tokens'] ?? 0)).padEnd(9)}` +
        `${fmtUsd(Number(request['cost_usd']))}`,
      )
    }
    if (requestCount.count > requests.length) {
      lines.push(`... ${requestCount.count - requests.length} more requests hidden; call with limit or verbose=true for more.`)
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'sync',
  `Ingest new cost data. sources: ${SYNC_SOURCES.join('|')}. Set json=true for the full result object.`,
  { sources: z.enum([...SYNC_SOURCES] as [string, ...string[]]).optional(), json: z.boolean().optional() },
  async ({ sources, json }: { sources?: typeof SYNC_SOURCES[number]; json?: boolean }) => {
    const selected = sources ?? 'all'
    const opts = selected === 'all' ? {} : { [selected]: true } as Record<string, boolean>
    const result = await syncAll(db, opts)
    if (json) return text(JSON.stringify(result, null, 2))
    const lines = [
      `sync: ${selected}`,
      `deduped: ${result.deduped}`,
      `cloud_pushed: ${result.cloudPushed ? 'yes' : 'no'}`,
      `cloud_pulled: ${result.cloudPulled ? 'yes' : 'no'}`,
    ]
    for (const [source, value] of Object.entries(result)) {
      if (['deduped', 'cloudPushed', 'cloudPulled'].includes(source)) continue
      if (value == null) continue
      lines.push(`${source}: ${compactObject(value)}`)
    }
    lines.push('Use json=true for the full sync result.')
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_usage',
  'Usage snapshots and fleet summary. period: today|week|month|year|all, agent, limit(20). Set json=true for full data.',
  { period: z.enum(['today', 'week', 'month', 'year', 'all']).optional(), agent: z.enum(AGENTS).optional(), limit: z.number().int().positive().max(100).optional(), json: z.boolean().optional() },
  async ({ period, agent, limit, json }: { period?: Exclude<Period, 'yesterday'>; agent?: Agent; limit?: number; json?: boolean }) => {
    const p = (period ?? 'month') as Period
    const snaps = queryUsageSnapshots(db, { agent, ...usageSnapshotFilterForPeriod(p) })
    const summary = querySummary(db, p, undefined, true)
    if (json) return text(JSON.stringify({ snapshots: snaps, summary }, null, 2))
    const rowLimit = clampLimit(limit)
    const lines = [
      `period: ${p}${agent ? `  agent: ${agent}` : ''}`,
      `fleet: ${fmtUsd(summary.total_usd)}  sessions: ${summary.sessions}  requests: ${summary.requests.toLocaleString()}  tokens: ${fmtTok(summary.tokens)}`,
      `snapshots: ${snaps.length}${snaps.length > rowLimit ? ` (showing ${rowLimit})` : ''}`,
    ]
    if (snaps.length > 0) {
      lines.push('', 'date        agent      metric                      value        unit     machine')
      for (const snapshot of snaps.slice(0, rowLimit)) {
        lines.push(
          `${snapshot.date.padEnd(12)}` +
          `${snapshot.agent.slice(0, 10).padEnd(11)}` +
          `${snapshot.metric.slice(0, 27).padEnd(28)}` +
          `${compactPrimitive(snapshot.value).padEnd(13)}` +
          `${(snapshot.unit ?? '').slice(0, 8).padEnd(9)}` +
          `${snapshot.machine_id ?? '—'}`,
        )
      }
      if (snaps.length > rowLimit) lines.push(`... ${snaps.length - rowLimit} more snapshots hidden; call with limit or json=true.`)
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_savings',
  'Subscription vs API savings summary. Params: period, agent, limit(20). Set json=true for full data.',
  { period: z.enum(['today', 'week', 'month', 'year', 'all']).optional(), agent: z.enum(AGENTS).optional(), limit: z.number().int().positive().max(100).optional(), json: z.boolean().optional() },
  async ({ period, agent, limit, json }: { period?: Period; agent?: Agent; limit?: number; json?: boolean }) => {
    const savings = querySavingsSummary(db, period ?? 'month', agent)
    if (json) return text(JSON.stringify(savings, null, 2))
    const lines = [
      `period: ${savings.period}${agent ? `  agent: ${agent}` : ''}`,
      `api_equivalent: ${fmtUsd(savings.api_equivalent_usd)}`,
      `subscription_fee: ${fmtUsd(savings.subscription_fee_usd)}`,
      `included_consumed: ${fmtUsd(savings.included_consumed_usd)}`,
      `on_demand: ${fmtUsd(savings.on_demand_usd)}`,
      `saved: ${fmtUsd(savings.saved_usd)}`,
    ]
    const rows = Object.entries(savings.by_agent)
    if (rows.length > 0) {
      const rowLimit = clampLimit(limit)
      lines.push('', `by_agent: ${rows.length}${rows.length > rowLimit ? ` (showing ${rowLimit})` : ''}`, 'agent      api_eq    sub_fee   included  on_demand saved')
      for (const [agentName, row] of rows.slice(0, rowLimit)) {
        lines.push(
          `${agentName.slice(0, 10).padEnd(11)}` +
          `${fmtUsd(Number(row.api_equivalent_usd ?? 0)).padEnd(10)}` +
          `${fmtUsd(Number(row.subscription_fee_usd ?? 0)).padEnd(10)}` +
          `${fmtUsd(Number(row.included_consumed_usd ?? 0)).padEnd(10)}` +
          `${fmtUsd(Number(row.on_demand_usd ?? 0)).padEnd(10)}` +
          `${fmtUsd(Number(row.saved_usd ?? 0))}`,
        )
      }
      if (rows.length > rowLimit) lines.push(`... ${rows.length - rowLimit} more agents hidden; call with limit or json=true.`)
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'list_subscriptions',
  'List configured subscription plans used by savings calculations.',
  {},
  async () => {
    const rows = listSubscriptions(db)
    if (rows.length === 0) return text('No subscriptions configured.')
    const lines = ['id                 provider   plan       agent      fee       included  active']
    for (const row of rows) {
      lines.push(
        `${row.id.slice(0, 18).padEnd(19)}` +
        `${row.provider.slice(0, 10).padEnd(11)}` +
        `${row.plan.slice(0, 10).padEnd(11)}` +
        `${(row.agent ?? 'all').slice(0, 10).padEnd(11)}` +
        `${fmtUsd(row.monthly_fee_usd).padEnd(10)}` +
        `${fmtUsd(row.included_usage_usd).padEnd(10)}` +
        `${row.active ? 'yes' : 'no'}`,
      )
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'set_subscription',
  'Create or update a subscription plan used by subscription-vs-API savings calculations.',
  {
    id: z.string().optional(),
    provider: z.string().min(1),
    plan: z.string().min(1),
    agent: z.enum(AGENTS).optional(),
    monthly_fee_usd: z.number().nonnegative().optional(),
    included_usage_usd: z.number().nonnegative().optional(),
    billing_cycle_start: z.string().optional(),
    reset_policy: z.string().optional(),
    active: z.boolean().optional(),
    json: z.boolean().optional(),
  },
  async (input: { id?: string; provider: string; plan: string; agent?: Agent; monthly_fee_usd?: number; included_usage_usd?: number; billing_cycle_start?: string; reset_policy?: string; active?: boolean; json?: boolean }) => {
    const now = new Date().toISOString()
    const row = {
      id: input.id ?? randomUUID(),
      provider: input.provider,
      plan: input.plan,
      agent: input.agent ?? null,
      monthly_fee_usd: input.monthly_fee_usd ?? 0,
      included_usage_usd: input.included_usage_usd ?? 0,
      billing_cycle_start: input.billing_cycle_start ?? null,
      reset_policy: input.reset_policy ?? 'monthly',
      active: input.active === false ? 0 : 1,
      created_at: now,
      updated_at: now,
    }
    upsertSubscription(db, row)
    if (input.json) return text(JSON.stringify(row, null, 2))
    return text(`Subscription set: ${row.id}\nprovider: ${row.provider}\nplan: ${row.plan}\nagent: ${row.agent ?? 'all'}\nfee: ${fmtUsd(row.monthly_fee_usd)}\nincluded: ${fmtUsd(row.included_usage_usd)}`)
  },
)

server.tool(
  'remove_subscription',
  'Delete a subscription plan by id.',
  { id: z.string() },
  async ({ id }: { id: string }) => {
    deleteSubscription(db, id)
    return text('Subscription removed.')
  },
)

server.tool(
  'estimate_cost',
  'Pre-flight cost estimate for token counts',
  { model: z.string(), input_tokens: z.number().optional(), output_tokens: z.number().optional() },
  async ({ model, input_tokens, output_tokens }: { model: string; input_tokens?: number; output_tokens?: number }) => {
    const cost = computeCostFromDb(db, model, input_tokens ?? 0, output_tokens ?? 0, 0, 0, 0)
    return text(`${model}: ${fmtUsd(cost)} (${input_tokens ?? 0} in / ${output_tokens ?? 0} out)`)
  },
)

server.tool(
  'get_goals',
  'All spending goals with current progress. Params: limit(20), verbose, json.',
  { limit: z.number().int().positive().max(100).optional(), verbose: z.boolean().optional(), json: z.boolean().optional() },
  async ({ limit, verbose, json }: { limit?: number; verbose?: boolean; json?: boolean }) => {
    const goals = getGoalStatuses(db) as unknown as Array<Record<string, unknown>>
    if (json) return text(JSON.stringify(goals, null, 2))
    if (goals.length === 0) return text('No goals set.')
    const visibleGoals = goals.slice(0, rowLimit(limit, verbose))

    const lines = ['period   scope                limit      spent      used%  status']
    for (const goal of visibleGoals) {
      const scope = String(goal['project_path'] ?? goal['agent'] ?? 'global').slice(0, 20)
      const pct = Number(goal['percent_used']).toFixed(1)
      const status = goal['is_over'] ? 'OVER' : goal['is_at_risk'] ? 'AT RISK' : 'ON TRACK'
      lines.push(`${String(goal['period']).padEnd(9)}${scope.padEnd(21)}${fmtUsd(Number(goal['limit_usd'])).padEnd(11)}${fmtUsd(Number(goal['current_spend_usd'])).padEnd(11)}${pct}%  ${status}`)
    }
    const hint = hiddenRowsHint(goals.length, visibleGoals.length, 'goals')
    if (hint) lines.push(hint)
    return text(lines.join('\n'))
  },
)

server.tool(
  'set_goal',
  'Create/update a spending goal. period(day|week|month|year), limit_usd, project_path?, agent?',
  {
    period: z.enum(['day', 'week', 'month', 'year']),
    limit_usd: z.number().positive(),
    project_path: z.string().optional(),
    agent: z.string().optional(),
  },
  async ({ period, limit_usd, project_path, agent }: { period: 'day' | 'week' | 'month' | 'year'; limit_usd: number; project_path?: string; agent?: string }) => {
    const now = new Date().toISOString()
    upsertGoal(db, {
      id: randomUUID(),
      period,
      project_path: project_path ?? null,
      agent: agent ?? null,
      limit_usd,
      created_at: now,
      updated_at: now,
    })
    return text(`Goal set: ${period} $${limit_usd}`)
  },
)

server.tool(
  'remove_goal',
  'Delete a goal by id.',
  { id: z.string() },
  async ({ id }: { id: string }) => {
    deleteGoal(db, id)
    return text('Goal removed.')
  },
)

server.tool(
  'list_machines',
  'List all machines that have synced data. Params: limit(20), verbose, json.',
  { limit: z.number().int().positive().max(100).optional(), verbose: z.boolean().optional(), json: z.boolean().optional() },
  async ({ limit, verbose, json }: { limit?: number; verbose?: boolean; json?: boolean }) => {
    const machines = listMachines(db)
    if (json) return text(JSON.stringify(machines, null, 2))
    if (machines.length === 0) return text(`No machine data yet. Current machine: ${getMachineId()}`)
    const visibleMachines = machines.slice(0, rowLimit(limit, verbose))
    const lines = ['machine          sessions  requests  cost        last_active']
    for (const m of visibleMachines) {
      lines.push(`${m.machine_id.padEnd(17)}${String(m.sessions).padEnd(10)}${String(m.requests).padEnd(10)}${fmtUsd(m.total_cost_usd).padEnd(12)}${m.last_active?.substring(0, 16) ?? '—'}`)
    }
    const hint = hiddenRowsHint(machines.length, visibleMachines.length, 'machines')
    if (hint) lines.push(hint)
    lines.push(`\ncurrent machine: ${getMachineId()}`)
    return text(lines.join('\n'))
  },
)

// register_agent, heartbeat, set_focus, and list_agents are the canonical
// @hasna/agent-registry implementation (persistent, shared across services)
// rather than a hand-rolled in-memory Map. send_feedback stays local (below)
// since it persists into economy's own `feedback` table with a category enum.
registerAgentTools(server, { includeFeedback: false })

server.tool(
  'send_feedback',
  'Send feedback about this service.',
  {
    message: z.string(),
    email: z.string().optional(),
    category: z.enum(['bug', 'feature', 'general']).optional(),
  },
  async ({ message, email, category }: { message: string; email?: string; category?: 'bug' | 'feature' | 'general' }) => {
    try {
      db.prepare('INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)').run(
        message,
        email ?? null,
        category ?? 'general',
        packageMetadata.version,
      )
      return text('Feedback saved. Thank you!')
    } catch (error) {
      return textError(String(error))
    }
  },
)

registerCloudTools(server, MCP_NAME)
return server
}
