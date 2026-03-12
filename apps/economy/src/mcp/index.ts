#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { openDatabase, querySummary, querySessions, queryTopSessions, queryModelBreakdown, queryProjectBreakdown, getBudgetStatuses } from '../db/database.js'
import { ingestClaude } from '../ingest/claude.js'
import { ingestCodex } from '../ingest/codex.js'
import { ensurePricingSeeded } from '../lib/pricing.js'
import type { Period, Agent } from '../types/index.js'

const db = openDatabase()
ensurePricingSeeded(db)

// ── Compact formatters (85-95% fewer tokens than JSON) ────────────────────────

const fmtUsd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtTok = (n: number) => n >= 1e9 ? `${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}k` : String(n)

function fmtSession(s: Record<string, unknown>): string {
  const id = String(s['id'] ?? '').slice(0, 8)
  const agent = String(s['agent'] ?? '')
  const proj = String(s['project_name'] || s['project_path'] || '—').slice(0, 20)
  const cost = fmtUsd(Number(s['total_cost_usd'] ?? 0))
  const tok = fmtTok(Number(s['total_tokens'] ?? 0))
  return `${id} ${agent.padEnd(6)} ${cost.padEnd(10)} ${tok.padEnd(8)} ${proj}`
}

// ── Lean tool definitions (1-2 sentences, no verbose docs) ───────────────────

const TOOLS = [
  { name: 'get_cost_summary',      description: 'Cost summary (total_usd, sessions, requests, tokens, human summary). period: today|week|month|all', inputSchema: { type: 'object', properties: { period: { type: 'string', enum: ['today','week','month','all'] } } } },
  { name: 'get_sessions',          description: 'List sessions. Returns compact table. Params: agent, project, limit(20)', inputSchema: { type: 'object', properties: { agent: { type: 'string' }, project: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'get_top_sessions',      description: 'Top sessions by cost. Params: n(10), agent', inputSchema: { type: 'object', properties: { n: { type: 'number' }, agent: { type: 'string' } } } },
  { name: 'get_model_breakdown',   description: 'Cost per model. No params.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_project_breakdown', description: 'Cost per project. No params.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_budget_status',     description: 'Budget limits vs spend, percent used, alert flags. No params.', inputSchema: { type: 'object', properties: {} } },
  { name: 'sync',                  description: 'Ingest new cost data. sources: all|claude|codex', inputSchema: { type: 'object', properties: { sources: { type: 'string', enum: ['all','claude','codex'] } } } },
  { name: 'search_tools',          description: 'List tool names matching query. Use first to find relevant tools.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'describe_tools',        description: 'Get param hints for specific tools by name.', inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] } },
]

const TOOL_DESCRIPTIONS: Record<string, string> = {
  get_cost_summary:      'period(today|week|month|all) → {total_usd, sessions, requests, tokens, summary}',
  get_sessions:          'agent(claude|codex), project(partial), limit(20) → compact session table',
  get_top_sessions:      'n(10), agent(claude|codex) → top sessions by cost',
  get_model_breakdown:   'no params → model, requests, tokens, cost',
  get_project_breakdown: 'no params → project_name, sessions, cost',
  get_budget_status:     'no params → budget limits, current spend, percent_used, is_over_alert',
  sync:                  'sources(all|claude|codex) → {files, requests, sessions} ingested',
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  const a = (args ?? {}) as Record<string, unknown>

  try {
    switch (name) {
      case 'search_tools': {
        const q = (a['query'] as string | undefined)?.toLowerCase()
        const names = TOOLS.map(t => t.name)
        const matches = q ? names.filter(n => n.includes(q)) : names
        return { content: [{ type: 'text', text: matches.join(', ') }] }
      }

      case 'describe_tools': {
        const names = (a['names'] as string[]) ?? []
        const result = names.map(n => `${n}: ${TOOL_DESCRIPTIONS[n] ?? 'see tool schema'}`).join('\n')
        return { content: [{ type: 'text', text: result }] }
      }

      case 'get_cost_summary': {
        const period = (a['period'] as Period | undefined) ?? 'today'
        const s = querySummary(db, period)
        // Compact text response — 70% fewer tokens than JSON
        const text = [
          `period: ${period}`,
          `cost: ${fmtUsd(s.total_usd)}`,
          `sessions: ${s.sessions}`,
          `requests: ${s.requests.toLocaleString()}`,
          `tokens: ${fmtTok(s.tokens)}`,
          `summary: You've spent ${fmtUsd(s.total_usd)} ${period === 'all' ? 'total' : period} across ${s.sessions} sessions (${s.requests.toLocaleString()} requests, ${fmtTok(s.tokens)} tokens)`,
        ].join('\n')
        return { content: [{ type: 'text', text }] }
      }

      case 'get_sessions': {
        const sessions = querySessions(db, {
          agent: a['agent'] as Agent | undefined,
          project: a['project'] as string | undefined,
          limit: Number(a['limit'] ?? 20),
        }) as Array<Record<string, unknown>>
        // Header + compact rows
        const lines = ['id       agent  cost       tokens   project']
        for (const s of sessions) lines.push(fmtSession(s))
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_top_sessions': {
        const sessions = queryTopSessions(db, Number(a['n'] ?? 10), a['agent'] as string | undefined) as Array<Record<string, unknown>>
        const lines = ['rank  id       agent  cost       tokens   project']
        sessions.forEach((s, i) => lines.push(`${String(i+1).padEnd(5)} ${fmtSession(s)}`))
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_model_breakdown': {
        const rows = queryModelBreakdown(db) as Array<Record<string, unknown>>
        const lines = ['model                          reqs    tokens   cost']
        for (const r of rows) {
          lines.push(`${String(r['model']).slice(0,30).padEnd(31)}${String(r['requests']).padEnd(8)}${fmtTok(Number(r['total_tokens'])).padEnd(9)}${fmtUsd(Number(r['cost_usd']))}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_project_breakdown': {
        const rows = queryProjectBreakdown(db) as Array<Record<string, unknown>>
        const lines = ['project              sessions tokens   cost']
        for (const r of rows) {
          const name = String(r['project_name'] || r['project_path'] || '—').slice(0, 20)
          lines.push(`${name.padEnd(21)}${String(r['sessions']).padEnd(9)}${fmtTok(Number(r['total_tokens'])).padEnd(9)}${fmtUsd(Number(r['cost_usd']))}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_budget_status': {
        const budgets = getBudgetStatuses(db) as Array<Record<string, unknown>>
        if (budgets.length === 0) return { content: [{ type: 'text', text: 'No budgets set.' }] }
        const lines = ['scope                period   spent      limit      used%  status']
        for (const b of budgets) {
          const scope = String(b['project_path'] ?? 'global').slice(0, 20)
          const pct = Number(b['percent_used']).toFixed(1)
          const status = b['is_over_limit'] ? 'OVER' : b['is_over_alert'] ? 'ALERT' : 'OK'
          lines.push(`${scope.padEnd(21)}${String(b['period']).padEnd(9)}${fmtUsd(Number(b['current_spend_usd'])).padEnd(11)}${fmtUsd(Number(b['limit_usd'])).padEnd(11)}${pct}%`.padEnd(49) + `  ${status}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'sync': {
        const sources = (a['sources'] as string | undefined) ?? 'all'
        const parts: string[] = []
        if (sources === 'all' || sources === 'claude') {
          const r = await ingestClaude(db) as Record<string, number>
          parts.push(`claude: ${r['files']} files, ${r['requests']} requests, ${r['sessions']} sessions`)
        }
        if (sources === 'all' || sources === 'codex') {
          const r = await ingestCodex(db) as Record<string, number>
          parts.push(`codex: ${r['sessions']} sessions`)
        }
        return { content: [{ type: 'text', text: parts.join('\n') || 'done' }] }
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
