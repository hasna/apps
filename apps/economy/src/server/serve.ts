import type { SqliteAdapter as Database } from '@hasna/cloud'
import {
  querySummary, querySessions, queryTopSessions,
  queryModelBreakdown, queryProjectBreakdown, queryDailyBreakdown,
  getBudgetStatuses, upsertBudget, deleteBudget,
  listProjects, upsertProject, deleteProject,
  listModelPricing, upsertModelPricing, deleteModelPricing,
  upsertGoal, deleteGoal, getGoalStatuses,
  listMachines, getMachineId,
  queryBillingSummary,
  openDatabase,
} from '../db/database.js'
import { ingestClaude, ingestTakumi } from '../ingest/claude.js'
import { ingestCodex } from '../ingest/codex.js'
import { ingestGemini } from '../ingest/gemini.js'
import { ensurePricingSeeded } from '../lib/pricing.js'
import { randomUUID } from 'crypto'
import type { Period, Agent } from '../types/index.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
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

async function jsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null) as unknown
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Apply ?fields=f1,f2 filtering — reduces response size by 50-89% */
function applyFields<T extends Record<string, unknown>>(obj: T, fields?: string[]): Partial<T> {
  if (!fields || fields.length === 0) return obj
  return Object.fromEntries(fields.map(f => [f, obj[f] ?? null])) as Partial<T>
}

export function createHandler(db: Database) {
  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

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

    // Daily breakdown for charts
    if (path === '/api/daily' && method === 'GET') {
      const days = Number(url.searchParams.get('days') ?? 30)
      return ok(queryDailyBreakdown(db, days))
    }

    // Sessions — supports ?search=project|agent|session and legacy ?project=
    if (path === '/api/sessions' && method === 'GET') {
      const agent = url.searchParams.get('agent') as Agent | null
      const project = url.searchParams.get('project') ?? undefined
      const search = url.searchParams.get('search') ?? undefined
      const machine = url.searchParams.get('machine') ?? undefined
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
      return ok(queryProjectBreakdown(db))
    }

    // Breakdown (alias)
    if (path === '/api/breakdown' && method === 'GET') {
      const by = url.searchParams.get('by') ?? 'model'
      return ok(by === 'project' ? queryProjectBreakdown(db) : queryModelBreakdown(db))
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
      const now = new Date().toISOString()
      const budget = {
        id: randomUUID(),
        project_path: (body['project_path'] as string | null) ?? null,
        agent: (body['agent'] as Agent | null) ?? null,
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
      if ([input, output, cacheRead, cacheWrite, cacheWrite1h].some(v => v == null || v < 0)) {
        return err('pricing values must be non-negative numbers')
      }
      const pricing = {
        model,
        input_per_1m: input!,
        output_per_1m: output!,
        cache_read_per_1m: cacheRead!,
        cache_write_per_1m: cacheWrite!,
        cache_write_1h_per_1m: cacheWrite1h!,
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
      if (!['all', 'claude', 'takumi', 'codex', 'gemini'].includes(sources)) return err('invalid sync source')
      const results: Record<string, unknown> = {}
      if (sources === 'all') {
        try {
          const { syncOpenProjectsRegistry } = await import('../lib/open-projects.js')
          results['projects'] = await syncOpenProjectsRegistry(db)
        } catch { /* open-projects registry sync is optional */ }
      }
      if (sources === 'all' || sources === 'claude') results['claude'] = await ingestClaude(db)
      if (sources === 'all' || sources === 'takumi') results['takumi'] = await ingestTakumi(db)
      if (sources === 'all' || sources === 'codex') results['codex'] = await ingestCodex(db)
      if (sources === 'all' || sources === 'gemini') results['gemini'] = await ingestGemini(db)
      try {
        const { checkAndFireWebhooks } = await import('../lib/webhooks.js')
        await checkAndFireWebhooks(db)
      } catch { /* webhooks are optional */ }
      return ok(results)
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
      const now = new Date().toISOString()
      const goal = {
        id: randomUUID(),
        period: period as 'day' | 'week' | 'month' | 'year',
        project_path: optionalString(body['project_path']),
        agent: optionalString(body['agent']),
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
}

export function startServer(port = 3456): void {
  const db = openDatabase()
  ensurePricingSeeded(db)
  const apiHandler = createHandler(db)

  // Also serve the built dashboard from dist/dashboard/ if it exists
  const dashboardDir = new URL('../../dashboard/dist', import.meta.url).pathname

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url)

      // API routes
      if (url.pathname.startsWith('/api') || url.pathname === '/health') {
        return apiHandler(req)
      }

      // Serve dashboard static files
      try {
        const { existsSync } = await import('fs')
        if (existsSync(dashboardDir)) {
          let filePath = url.pathname === '/' ? '/index.html' : url.pathname
          const fullPath = dashboardDir + filePath
          if (existsSync(fullPath)) {
            return new Response(Bun.file(fullPath))
          }
          // SPA fallback — return index.html for any unmatched path
          const indexPath = dashboardDir + '/index.html'
          if (existsSync(indexPath)) {
            return new Response(Bun.file(indexPath))
          }
        }
      } catch { /* ignore */ }

      return apiHandler(req)
    },
  })
  console.log(`economy-serve listening on http://localhost:${port}`)
}
