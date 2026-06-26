import type { Database } from '../db/database.js'
import {
  querySummary, querySessions, queryTopSessions,
  queryModelBreakdown, queryProjectBreakdown, queryAgentBreakdown, queryDailyBreakdown, queryHourlyBreakdown,
  queryAccountBreakdown,
  getBudgetStatuses, upsertBudget, deleteBudget,
  listProjects, upsertProject, deleteProject,
  listModelPricing, upsertModelPricing, deleteModelPricing,
  upsertGoal, deleteGoal, getGoalStatuses,
  listSubscriptions, upsertSubscription, deleteSubscription,
  listMachines, getMachineId,
  listMachineRegistry,
  queryBillingSummary,
  openDatabase,
} from '../db/database.js'
import { ensurePricingSeeded } from '../lib/pricing.js'
import { AGENTS, isAgent } from '../lib/agents.js'
import { syncAll } from '../lib/sync-all.js'
import { querySavingsSummary } from '../lib/savings.js'
import { usageSnapshotFilterForPeriod } from '../lib/periods.js'
import { queryBillingDiff } from '../lib/billing-diff.js'
import { queryUsageSnapshots } from '../db/database.js'
import { getServeBindHost, isAuthorizedRequest, requireServeApiToken } from '../lib/serve-auth.js'
import {
  buildFleetCostInsights,
  buildFleetFreshness,
  MAX_FLEET_FRESHNESS_ROWS,
  MAX_FLEET_INSIGHT_ROWS,
} from '../lib/fleet-sync.js'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { resolve, sep } from 'path'
import type { Period } from '../types/index.js'
import type { Agent } from '../lib/agents.js'

const CORS_METHODS = 'GET,POST,PUT,DELETE,OPTIONS'
const CORS_HEADERS = 'Content-Type, Authorization, X-Economy-Token'
const AGENT_ERROR = `agent must be one of: ${AGENTS.join(', ')}`
const SYNC_SOURCES = ['all', ...AGENTS] as const
const DEFAULT_DASHBOARD_DIR = new URL('../../dashboard/dist', import.meta.url).pathname

interface StartServerOptions {
  db?: Database
  dashboardDir?: string
  hostname?: string
  log?: (message: string) => void
}

function configuredCorsOrigins(): Set<string> {
  const raw = process.env['ECONOMY_CORS_ORIGINS']?.trim() || process.env['ECONOMY_CORS_ORIGIN']?.trim() || ''
  return new Set(raw.split(',').map(origin => origin.trim()).filter(Boolean))
}

function isLocalCorsOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function isAllowedCorsOrigin(origin: string): boolean {
  return configuredCorsOrigins().has(origin) || isLocalCorsOrigin(origin)
}

function corsHeadersFor(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Allow-Headers': CORS_HEADERS,
    Vary: 'Origin',
  }
  const origin = req.headers.get('Origin')
  if (origin && isAllowedCorsOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function withCors(req: Request, response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeadersFor(req))) headers.set(key, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function ok(data: unknown, meta?: Record<string, unknown>): Response {
  return json({ data, meta: meta ?? {} })
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status)
}

function normalizeBudgetPeriod(value: unknown): 'daily' | 'weekly' | 'monthly' {
  switch (value) {
    case 'day':
    case 'daily':
      return 'daily'
    case 'week':
    case 'weekly':
      return 'weekly'
    case 'month':
    case 'monthly':
    default:
      return 'monthly'
  }
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parsePeriodParam(value: string | null, fallback: Period): Period | null {
  const raw = value ?? fallback
  return ['today', 'yesterday', 'week', 'month', 'year', 'all'].includes(raw) ? raw as Period : null
}

function positiveIntParam(value: string | null, fallback: number, max: number): number {
  const n = Number(value ?? fallback)
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback
}

async function jsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null) as unknown
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function optionalAgent(value: unknown): Agent | null | undefined {
  if (value == null || value === '') return null
  return typeof value === 'string' && (AGENTS as readonly string[]).includes(value) ? value as Agent : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function dashboardPath(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }

  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const rootPath = resolve(root)
  const filePath = resolve(rootPath, relativePath)
  return filePath === rootPath || filePath.startsWith(rootPath + sep) ? filePath : null
}

export function createServerFetch(apiHandler: (req: Request) => Promise<Response>, dashboardDir = DEFAULT_DASHBOARD_DIR) {
  return async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    // API routes
    if (url.pathname.startsWith('/api') || url.pathname === '/health') {
      return apiHandler(req)
    }

    // Serve dashboard static files
    if (existsSync(dashboardDir)) {
      const filePath = dashboardPath(dashboardDir, url.pathname)
      if (filePath && existsSync(filePath)) {
        return new Response(Bun.file(filePath))
      }

      // SPA fallback — return index.html for any unmatched path
      const indexPath = dashboardPath(dashboardDir, '/')
      if (indexPath && existsSync(indexPath)) {
        return new Response(Bun.file(indexPath))
      }
    }

    return apiHandler(req)
  }
}

/** Apply ?fields=f1,f2 filtering — reduces response size by 50-89% */
function applyFields<T extends Record<string, unknown>>(obj: T, fields?: string[]): Partial<T> {
  if (!fields || fields.length === 0) return obj
  return Object.fromEntries(fields.map(f => [f, obj[f] ?? null])) as Partial<T>
}

export function createHandler(db: Database) {
  return async function handler(req: Request): Promise<Response> {
    return withCors(req, await handleApiRequest(db, req))
  }
}

async function handleApiRequest(db: Database, req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    if (method === 'OPTIONS') {
      const origin = req.headers.get('Origin')
      return new Response(null, { status: origin && !isAllowedCorsOrigin(origin) ? 403 : 204 })
    }

    if (!isAuthorizedRequest(req, path)) return err('Unauthorized', 401)

    // Health
    if (path === '/health') return ok({ status: 'ok', ts: new Date().toISOString() })

    // Summary
    if (path === '/api/summary' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'today') as Period
      const machine = url.searchParams.get('machine') ?? undefined
      return ok(querySummary(db, period, machine))
    }

    // Machines
    if (path === '/api/machines' && method === 'GET') {
      return ok(listMachines(db), { current_machine: getMachineId() })
    }

    if (path === '/api/fleet' && method === 'GET') {
      const period = parsePeriodParam(url.searchParams.get('period'), 'month')
      if (!period) return err('period must be today|yesterday|week|month|year|all')
      const machine = url.searchParams.get('machine') ?? undefined
      return ok({
        summary: querySummary(db, period, machine),
        machines: listMachines(db, period),
        registry: listMachineRegistry(db),
        current_machine: getMachineId(),
      })
    }

    if (path === '/api/fleet/freshness' && method === 'GET') {
      const staleAfterMinutes = positiveIntParam(url.searchParams.get('stale_after_minutes') ?? url.searchParams.get('staleAfterMinutes'), 60, 60 * 24 * 30)
      const limit = positiveIntParam(url.searchParams.get('limit'), 20, MAX_FLEET_FRESHNESS_ROWS)
      return ok(buildFleetFreshness(db, {
        staleAfterMinutes,
        limit,
      }))
    }

    if (path === '/api/fleet/insights' && method === 'GET') {
      const period = parsePeriodParam(url.searchParams.get('period'), 'today')
      if (!period) return err('period must be today|yesterday|week|month|year|all')
      const staleAfterMinutes = positiveIntParam(url.searchParams.get('stale_after_minutes') ?? url.searchParams.get('staleAfterMinutes'), 60, 60 * 24 * 30)
      const limit = positiveIntParam(url.searchParams.get('limit'), 5, MAX_FLEET_INSIGHT_ROWS)
      return ok(buildFleetCostInsights(db, {
        period,
        staleAfterMinutes,
        limit,
      }))
    }

    // Daily breakdown for charts
    if (path === '/api/daily' && method === 'GET') {
      const days = Number(url.searchParams.get('days') ?? 30)
      const machine = url.searchParams.get('machine') ?? undefined
      return ok(queryDailyBreakdown(db, days, machine))
    }

    if (path === '/api/hourly' && method === 'GET') {
      const machine = url.searchParams.get('machine') ?? undefined
      const rawHours = url.searchParams.get('hours')
      let hours: number | undefined
      if (rawHours != null) {
        const parsedHours = Number(rawHours)
        if (!Number.isInteger(parsedHours) || parsedHours < 1 || parsedHours > 48) {
          return err('hours must be between 1 and 48')
        }
        hours = parsedHours
      }
      return ok(queryHourlyBreakdown(db, machine, hours))
    }

    // Sessions — supports ?search=project|agent|session and legacy ?project=
    if (path === '/api/sessions' && method === 'GET') {
      const agent = url.searchParams.get('agent') as Agent | null
      const project = url.searchParams.get('project') ?? undefined
      const search = url.searchParams.get('search') ?? undefined
      const machine = url.searchParams.get('machine') ?? undefined
      const account = url.searchParams.get('account') ?? undefined
      const limit = Number(url.searchParams.get('limit') ?? 50)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const since = url.searchParams.get('since') ?? undefined
      const fieldsParam = url.searchParams.get('fields')
      const fields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()).filter(Boolean) : undefined
      const sessions = querySessions(db, {
        agent: agent ?? undefined,
        project,
        search,
        machine,
        account,
        limit,
        offset,
        since,
      })
      return ok(fields ? sessions.map(s => applyFields(s as unknown as Record<string, unknown>, fields)) : sessions, { limit, offset })
    }

    // Top sessions
    if (path === '/api/top' && method === 'GET') {
      const n = Number(url.searchParams.get('n') ?? 10)
      const agent = url.searchParams.get('agent') ?? undefined
      return ok(queryTopSessions(db, n, agent))
    }

    // Model breakdown
    if (path === '/api/models' && method === 'GET') {
      return ok(queryModelBreakdown(db))
    }

    // Ground-truth provider billing imported from admin APIs.
    if (path === '/api/billing' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'month') as Period
      return ok(queryBillingSummary(db, period))
    }

    if (path === '/api/billing/diff' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'month') as Period
      const threshold = Number(url.searchParams.get('threshold') ?? 15)
      return ok(queryBillingDiff(db, period, Number.isFinite(threshold) ? threshold : 15))
    }
    if (path === '/api/billing/sync' && method === 'POST') {
      const body = await jsonBody(req) ?? {}
      const days = Number(body['days'] ?? 31)
      if (!Number.isFinite(days) || days <= 0 || days > 366) return err('days must be between 1 and 366')
      const providers = Array.isArray(body['providers']) ? body['providers'] as string[] : ['anthropic', 'openai', 'gemini']
      const allowedProviders = new Set(['anthropic', 'openai', 'gemini'])
      if (providers.some(provider => !allowedProviders.has(provider))) return err('invalid billing provider')
      const results: Record<string, unknown> = {}
      const { syncAnthropicBilling, syncOpenAIBilling, syncGeminiBilling } = await import('../ingest/billing.js')
      async function capture(provider: string, fn: () => Promise<unknown>): Promise<void> {
        try {
          results[provider] = await fn()
        } catch (e) {
          results[provider] = { error: e instanceof Error ? e.message : String(e) }
        }
      }
      if (providers.includes('anthropic')) await capture('anthropic', () => syncAnthropicBilling(db, { days }))
      if (providers.includes('openai')) await capture('openai', () => syncOpenAIBilling(db, { days }))
      if (providers.includes('gemini')) await capture('gemini', () => syncGeminiBilling(db, { days }))
      return ok(results)
    }

    // Project breakdown
    if (path === '/api/projects' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'all') as Period
      const machine = url.searchParams.get('machine') ?? undefined
      return ok(queryProjectBreakdown(db, period, machine))
    }

    if (path === '/api/accounts' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'all') as Period
      const machine = url.searchParams.get('machine') ?? undefined
      return ok(queryAccountBreakdown(db, period, machine))
    }

    // Breakdown (alias)
    if (path === '/api/breakdown' && method === 'GET') {
      const by = url.searchParams.get('by') ?? 'model'
      const period = (url.searchParams.get('period') ?? 'all') as Period
      const machine = url.searchParams.get('machine') ?? undefined
      if (by === 'project') return ok(queryProjectBreakdown(db, period, machine))
      if (by === 'agent') return ok(queryAgentBreakdown(db, period, machine))
      if (by === 'account') return ok(queryAccountBreakdown(db, period, machine))
      return ok(queryModelBreakdown(db))
    }

    // Budgets
    if (path === '/api/budgets' && method === 'GET') {
      return ok(getBudgetStatuses(db))
    }
    if (path === '/api/budgets' && method === 'POST') {
      const body = await jsonBody(req)
      if (!body) return err('invalid JSON body')
      const limitUsd = finiteNumber(body['limit_usd'])
      const alertAtPercent = finiteNumber(body['alert_at_percent'] ?? 80)
      if (limitUsd == null || limitUsd <= 0) return err('limit_usd must be a positive number')
      if (alertAtPercent == null || alertAtPercent <= 0 || alertAtPercent > 100) return err('alert_at_percent must be between 1 and 100')
      const agent = optionalAgent(body['agent'])
      if (agent === undefined) return err(AGENT_ERROR)
      const now = new Date().toISOString()
      const budget = {
        id: randomUUID(),
        project_path: (body['project_path'] as string | null) ?? null,
        agent,
        period: normalizeBudgetPeriod(body['period']),
        limit_usd: limitUsd,
        alert_at_percent: alertAtPercent,
        created_at: now,
        updated_at: now,
      }
      upsertBudget(db, budget)
      return ok(getBudgetStatuses(db).find(b => b.id === budget.id) ?? budget)
    }
    const budgetMatch = path.match(/^\/api\/budgets\/(.+)$/)
    if (budgetMatch && method === 'DELETE') {
      deleteBudget(db, decodeURIComponent(budgetMatch[1]!))
      return ok({ ok: true })
    }

    // Project management
    if (path === '/api/project-registry' && method === 'GET') {
      return ok(listProjects(db))
    }
    if (path === '/api/project-registry' && method === 'POST') {
      const body = await jsonBody(req)
      if (!body) return err('invalid JSON body')
      const { basename } = await import('path')
      const projPath = optionalString(body['path'])?.trim()
      if (!projPath) return err('path is required')
      upsertProject(db, {
        id: randomUUID(),
        path: projPath,
        name: optionalString(body['name']) ?? basename(projPath),
        description: optionalString(body['description']),
        tags: stringArray(body['tags']),
        created_at: new Date().toISOString(),
      })
      return ok({ ok: true })
    }
    const projMatch = path.match(/^\/api\/project-registry\/(.+)$/)
    if (projMatch && method === 'DELETE') {
      deleteProject(db, decodeURIComponent(projMatch[1]!))
      return ok({ ok: true })
    }

    // Pricing
    if (path === '/api/pricing' && method === 'GET') {
      return ok(listModelPricing(db))
    }
    if (path === '/api/pricing' && method === 'POST') {
      const body = await jsonBody(req)
      if (!body) return err('invalid JSON body')
      const model = String(body['model'] ?? '').trim()
      if (!model) return err('model is required')
      const input = finiteNumber(body['input_per_1m'])
      const output = finiteNumber(body['output_per_1m'])
      const cacheRead = finiteNumber(body['cache_read_per_1m'] ?? 0)
      const cacheWrite = finiteNumber(body['cache_write_per_1m'] ?? 0)
      const cacheWrite1h = finiteNumber(body['cache_write_1h_per_1m'] ?? 0)
      const cacheStorage = finiteNumber(body['cache_storage_per_1m_hour'] ?? 0)
      if ([input, output, cacheRead, cacheWrite, cacheWrite1h, cacheStorage].some(v => v == null || v < 0)) {
        return err('pricing values must be non-negative numbers')
      }
      const pricing = {
        model,
        input_per_1m: input!,
        output_per_1m: output!,
        cache_read_per_1m: cacheRead!,
        cache_write_per_1m: cacheWrite!,
        cache_write_1h_per_1m: cacheWrite1h!,
        cache_storage_per_1m_hour: cacheStorage!,
        updated_at: new Date().toISOString(),
      }
      upsertModelPricing(db, pricing)
      return ok(pricing)
    }
    const pricingMatch = path.match(/^\/api\/pricing\/(.+)$/)
    if (pricingMatch && method === 'DELETE') {
      deleteModelPricing(db, decodeURIComponent(pricingMatch[1]!))
      return ok({ ok: true })
    }

    // Sync trigger
    if (path === '/api/sync' && method === 'POST') {
      const body = await jsonBody(req) ?? {}
      const sources = (body['sources'] as string | null) ?? 'all'
      if (!(SYNC_SOURCES as readonly string[]).includes(sources)) return err('invalid sync source')
      const results: Record<string, unknown> = {}
      if (sources === 'all') {
        try {
          const { syncOpenProjectsRegistry } = await import('../lib/open-projects.js')
          results['projects'] = await syncOpenProjectsRegistry(db)
        } catch { /* open-projects registry sync is optional */ }
      }
      const selected = sources === 'all'
        ? {}
        : { [sources]: true } as Record<string, boolean>
      const syncResult = await syncAll(db, selected)
      Object.assign(results, syncResult)
      try {
        const { checkAndFireWebhooks } = await import('../lib/webhooks.js')
        await checkAndFireWebhooks(db)
      } catch { /* webhooks are optional */ }
      return ok(results)
    }

    if (path === '/api/usage' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'month') as Period
      const agent = url.searchParams.get('agent') ?? undefined
      return ok({
        snapshots: queryUsageSnapshots(db, {
          agent: agent && isAgent(agent) ? agent : undefined,
          ...usageSnapshotFilterForPeriod(period),
        }),
        summary: querySummary(db, period, undefined, true),
      })
    }

    if (path === '/api/savings' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'month') as Period
      const agent = url.searchParams.get('agent') ?? undefined
      return ok(querySavingsSummary(db, period, agent && isAgent(agent) ? agent : undefined))
    }

    if (path === '/api/subscriptions' && method === 'GET') {
      return ok(listSubscriptions(db))
    }

    if (path === '/api/subscriptions' && method === 'POST') {
      const body = await jsonBody(req)
      if (!body) return err('invalid JSON body')
      const provider = optionalString(body['provider'])?.trim()
      const plan = optionalString(body['plan'])?.trim()
      if (!provider) return err('provider is required')
      if (!plan) return err('plan is required')
      const monthlyFee = finiteNumber(body['monthly_fee_usd'] ?? body['fee_usd'] ?? 0)
      const includedUsage = finiteNumber(body['included_usage_usd'] ?? 0)
      if (monthlyFee == null || monthlyFee < 0) return err('monthly_fee_usd must be a non-negative number')
      if (includedUsage == null || includedUsage < 0) return err('included_usage_usd must be a non-negative number')
      const agent = optionalAgent(body['agent'])
      if (agent === undefined) return err(AGENT_ERROR)
      const now = new Date().toISOString()
      const subscription = {
        id: optionalString(body['id'])?.trim() || randomUUID(),
        agent,
        provider,
        plan,
        monthly_fee_usd: monthlyFee,
        included_usage_usd: includedUsage,
        billing_cycle_start: optionalString(body['billing_cycle_start']),
        reset_policy: optionalString(body['reset_policy']) ?? 'monthly',
        active: body['active'] === false || body['active'] === 0 ? 0 : 1,
        created_at: optionalString(body['created_at']) ?? now,
        updated_at: now,
      }
      upsertSubscription(db, subscription)
      return ok(subscription)
    }

    const subscriptionMatch = path.match(/^\/api\/subscriptions\/(.+)$/)
    if (subscriptionMatch && method === 'DELETE') {
      deleteSubscription(db, decodeURIComponent(subscriptionMatch[1]!))
      return ok({ ok: true })
    }

    // Session requests detail
    const sessionRequestsMatch = path.match(/^\/api\/sessions\/([^/]+)\/requests$/)
    if (sessionRequestsMatch && method === 'GET') {
      const sessionId = decodeURIComponent(sessionRequestsMatch[1]!)
      const session = db.prepare(`SELECT * FROM sessions WHERE id = ? OR id LIKE ?`).get(sessionId, `${sessionId}%`) as Record<string, unknown> | null
      if (!session) return err('Session not found', 404)
      const requests = db.prepare(`SELECT * FROM requests WHERE session_id = ? ORDER BY timestamp ASC`).all(session['id'] as string) as Array<Record<string, unknown>>
      return ok(requests, { session_id: session['id'], count: requests.length })
    }

    // Goals
    if (path === '/api/goals' && method === 'GET') {
      return ok(getGoalStatuses(db))
    }
    if (path === '/api/goals' && method === 'POST') {
      const body = await jsonBody(req)
      if (!body) return err('invalid JSON body')
      const period = body['period'] ?? 'month'
      if (!['day', 'week', 'month', 'year'].includes(String(period))) return err('period must be day, week, month, or year')
      const limitUsd = finiteNumber(body['limit_usd'])
      if (limitUsd == null || limitUsd <= 0) return err('limit_usd must be a positive number')
      const agent = optionalAgent(body['agent'])
      if (agent === undefined) return err(AGENT_ERROR)
      const now = new Date().toISOString()
      const goal = {
        id: randomUUID(),
        period: period as 'day' | 'week' | 'month' | 'year',
        project_path: optionalString(body['project_path']),
        agent,
        limit_usd: limitUsd,
        created_at: now,
        updated_at: now,
      }
      upsertGoal(db, goal)
      return ok(getGoalStatuses(db).find(g => g.id === goal.id) ?? goal)
    }
    const goalMatch = path.match(/^\/api\/goals\/(.+)$/)
    if (goalMatch && method === 'DELETE') {
      deleteGoal(db, decodeURIComponent(goalMatch[1]!))
      return ok({ ok: true })
    }

    return err('Not found', 404)
}

export function startServer(port = 3456, options: StartServerOptions = {}): ReturnType<typeof Bun.serve> {
  requireServeApiToken()
  const db = options.db ?? openDatabase()
  ensurePricingSeeded(db)
  const apiHandler = createHandler(db)
  const hostname = options.hostname ?? getServeBindHost()
  const server = Bun.serve({
    port,
    hostname,
    fetch: createServerFetch(apiHandler, options.dashboardDir),
  })
  const address = `http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${server.port}`
  const log = options.log ?? console.log
  log(`economy-serve listening on ${address}`)
  return server
}
