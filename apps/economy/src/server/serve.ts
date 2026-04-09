import type { SqliteAdapter as Database } from '@hasna/cloud'
import {
  querySummary, querySessions, queryTopSessions,
  queryModelBreakdown, queryProjectBreakdown, queryDailyBreakdown,
  getBudgetStatuses, upsertBudget, deleteBudget,
  listProjects, upsertProject, deleteProject,
  listModelPricing, upsertModelPricing, deleteModelPricing,
  upsertGoal, deleteGoal, getGoalStatuses,
  openDatabase,
} from '../db/database.js'
import { ingestClaude } from '../ingest/claude.js'
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
      return ok(querySummary(db, period))
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
      const limit = Number(url.searchParams.get('limit') ?? 50)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const since = url.searchParams.get('since') ?? undefined
      const fieldsParam = url.searchParams.get('fields')
      const fields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()).filter(Boolean) : undefined
      const sessions = querySessions(db, {
        agent: agent ?? undefined,
        project,
        search,
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
      const body = await req.json() as Record<string, unknown>
      const now = new Date().toISOString()
      upsertBudget(db, {
        id: randomUUID(),
        project_path: (body['project_path'] as string | null) ?? null,
        agent: (body['agent'] as Agent | null) ?? null,
        period: normalizeBudgetPeriod(body['period']),
        limit_usd: Number(body['limit_usd']),
        alert_at_percent: Number(body['alert_at_percent'] ?? 80),
        created_at: now,
        updated_at: now,
      })
      return ok({ ok: true })
    }
    const budgetMatch = path.match(/^\/api\/budgets\/(.+)$/)
    if (budgetMatch && method === 'DELETE') {
      deleteBudget(db, budgetMatch[1]!)
      return ok({ ok: true })
    }

    // Project management
    if (path === '/api/project-registry' && method === 'GET') {
      return ok(listProjects(db))
    }
    if (path === '/api/project-registry' && method === 'POST') {
      const body = await req.json() as Record<string, unknown>
      const { basename } = await import('path')
      const projPath = body['path'] as string
      upsertProject(db, {
        id: randomUUID(),
        path: projPath,
        name: (body['name'] as string | null) ?? basename(projPath),
        description: (body['description'] as string | null) ?? null,
        tags: (body['tags'] as string[] | null) ?? [],
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
      const body = await req.json() as Record<string, unknown>
      upsertModelPricing(db, {
        model: body['model'] as string,
        input_per_1m: Number(body['input_per_1m']),
        output_per_1m: Number(body['output_per_1m']),
        cache_read_per_1m: Number(body['cache_read_per_1m'] ?? 0),
        cache_write_per_1m: Number(body['cache_write_per_1m'] ?? 0),
        updated_at: new Date().toISOString(),
      })
      return ok({ ok: true })
    }
    const pricingMatch = path.match(/^\/api\/pricing\/(.+)$/)
    if (pricingMatch && method === 'DELETE') {
      deleteModelPricing(db, decodeURIComponent(pricingMatch[1]!))
      return ok({ ok: true })
    }

    // Sync trigger
    if (path === '/api/sync' && method === 'POST') {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      const sources = (body['sources'] as string | null) ?? 'all'
      const results: Record<string, unknown> = {}
      if (sources === 'all' || sources === 'claude') results['claude'] = await ingestClaude(db)
      if (sources === 'all' || sources === 'codex') results['codex'] = await ingestCodex(db)
      if (sources === 'all' || sources === 'gemini') results['gemini'] = await ingestGemini(db)
      return ok(results)
    }

    // Session requests detail
    const sessionRequestsMatch = path.match(/^\/api\/sessions\/([^/]+)\/requests$/)
    if (sessionRequestsMatch && method === 'GET') {
      const sessionId = sessionRequestsMatch[1]!
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
      const body = await req.json() as Record<string, unknown>
      const now = new Date().toISOString()
      upsertGoal(db, {
        id: randomUUID(),
        period: (body['period'] as 'day' | 'week' | 'month' | 'year') ?? 'month',
        project_path: (body['project_path'] as string | null) ?? null,
        agent: (body['agent'] as string | null) ?? null,
        limit_usd: Number(body['limit_usd']),
        created_at: now,
        updated_at: now,
      })
      return ok({ ok: true })
    }
    const goalMatch = path.match(/^\/api\/goals\/(.+)$/)
    if (goalMatch && method === 'DELETE') {
      deleteGoal(db, goalMatch[1]!)
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
