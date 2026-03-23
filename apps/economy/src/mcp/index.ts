#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { openDatabase, querySummary, querySessions, queryTopSessions, queryModelBreakdown, queryProjectBreakdown, queryDailyBreakdown, getBudgetStatuses, upsertGoal, deleteGoal, getGoalStatuses } from '../db/database.js'
import { ingestClaude } from '../ingest/claude.js'
import { ingestCodex } from '../ingest/codex.js'
import { ingestGemini } from '../ingest/gemini.js'
import { ensurePricingSeeded } from '../lib/pricing.js'
import type { Period, Agent } from '../types/index.js'

const db = openDatabase()
ensurePricingSeeded(db)

const server = new Server(
  { name: 'economy', version: '0.2.2' },
  { capabilities: { tools: {} } },
)

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
  { name: 'get_cost_summary',      description: 'Cost summary (total_usd, sessions, requests, tokens, human summary). period: today|week|month|year|all', inputSchema: { type: 'object', properties: { period: { type: 'string', enum: ['today','week','month','year','all'] } } } },
  { name: 'get_sessions',          description: 'List sessions. Returns compact table. Params: agent, project, limit(20)', inputSchema: { type: 'object', properties: { agent: { type: 'string' }, project: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'get_top_sessions',      description: 'Top sessions by cost. Params: n(10), agent', inputSchema: { type: 'object', properties: { n: { type: 'number' }, agent: { type: 'string' } } } },
  { name: 'get_model_breakdown',   description: 'Cost per model. No params.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_project_breakdown', description: 'Cost per project. No params.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_budget_status',     description: 'Budget limits vs spend, percent used, alert flags. No params.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_daily',             description: 'Daily cost table by agent. Params: days(30)', inputSchema: { type: 'object', properties: { days: { type: 'number' } } } },
  { name: 'get_session_detail',    description: 'Per-request breakdown of a single session. Params: session_id (prefix ok)', inputSchema: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'] } },
  { name: 'sync',                  description: 'Ingest new cost data. sources: all|claude|codex|gemini', inputSchema: { type: 'object', properties: { sources: { type: 'string', enum: ['all','claude','codex','gemini'] } } } },
  { name: 'search_tools',          description: 'List tool names matching query. Use first to find relevant tools.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'describe_tools',        description: 'Get param hints for specific tools by name.', inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] } },
  { name: 'get_goals',    description: 'All spending goals with current progress. No params.', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_goal',     description: 'Create/update a spending goal. period(day|week|month|year), limit_usd, project_path?, agent?', inputSchema: { type: 'object', properties: { period: { type: 'string' }, limit_usd: { type: 'number' }, project_path: { type: 'string' }, agent: { type: 'string' } }, required: ['period', 'limit_usd'] } },
  { name: 'remove_goal',  description: 'Delete a goal by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'register_agent', description: 'Register agent session.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, session_id: { type: 'string' } }, required: ['name'] } },
  { name: 'heartbeat', description: 'Update last_seen_at.', inputSchema: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'] } },
  { name: 'set_focus', description: 'Set active project context.', inputSchema: { type: 'object', properties: { agent_id: { type: 'string' }, project_id: { type: 'string' } }, required: ['agent_id'] } },
  { name: 'send_feedback', description: 'Send feedback about this service.', inputSchema: { type: 'object', properties: { message: { type: 'string' }, email: { type: 'string' }, category: { type: 'string', enum: ['bug','feature','general'] } }, required: ['message'] } },
]

const TOOL_DESCRIPTIONS: Record<string, string> = {
  get_cost_summary:      'period(today|week|month|year|all) → {total_usd, sessions, requests, tokens, summary}',
  get_sessions:          'agent(claude|codex), project(partial), limit(20) → compact session table',
  get_top_sessions:      'n(10), agent(claude|codex) → top sessions by cost',
  get_model_breakdown:   'no params → model, requests, tokens, cost',
  get_project_breakdown: 'no params → project_name, sessions, cost',
  get_budget_status:     'no params → budget limits, current spend, percent_used, is_over_alert',
  get_daily:             'days(30) → daily cost table grouped by date and agent',
  get_session_detail:    'session_id(prefix ok) → per-request breakdown with model, tokens, cost',
  sync:                  'sources(all|claude|codex|gemini) → {files, requests, sessions} ingested',
  get_goals:   'no params → period, scope, limit, spent, percent, status(ON TRACK/AT RISK/OVER)',
  set_goal:    'period(day|week|month|year), limit_usd, project_path?, agent? → creates/updates goal',
  remove_goal: 'id → deletes goal',
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
        }) as unknown as Array<Record<string, unknown>>
        // Header + compact rows
        const lines = ['id       agent  cost       tokens   project']
        for (const s of sessions) lines.push(fmtSession(s))
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_top_sessions': {
        const sessions = queryTopSessions(db, Number(a['n'] ?? 10), a['agent'] as string | undefined) as unknown as Array<Record<string, unknown>>
        const lines = ['rank  id       agent  cost       tokens   project']
        sessions.forEach((s, i) => lines.push(`${String(i+1).padEnd(5)} ${fmtSession(s)}`))
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_model_breakdown': {
        const rows = queryModelBreakdown(db) as unknown as Array<Record<string, unknown>>
        const lines = ['model                          reqs    tokens   cost']
        for (const r of rows) {
          lines.push(`${String(r['model']).slice(0,30).padEnd(31)}${String(r['requests']).padEnd(8)}${fmtTok(Number(r['total_tokens'])).padEnd(9)}${fmtUsd(Number(r['cost_usd']))}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_project_breakdown': {
        const rows = queryProjectBreakdown(db) as unknown as Array<Record<string, unknown>>
        const lines = ['project              sessions tokens   cost']
        for (const r of rows) {
          const name = String(r['project_name'] || r['project_path'] || '—').slice(0, 20)
          lines.push(`${name.padEnd(21)}${String(r['sessions']).padEnd(9)}${fmtTok(Number(r['total_tokens'])).padEnd(9)}${fmtUsd(Number(r['cost_usd']))}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_budget_status': {
        const budgets = getBudgetStatuses(db) as unknown as Array<Record<string, unknown>>
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

      case 'get_daily': {
        const days = Number(a['days'] ?? 30)
        const rows = queryDailyBreakdown(db, days) as Array<Record<string, unknown>>
        const lines = ['date        claude     codex      gemini     total']
        // Group by date, sum by agent
        const byDate = new Map<string, {claude: number, codex: number, gemini: number}>()
        for (const r of rows) {
          const d = String(r['date'])
          const entry = byDate.get(d) ?? { claude: 0, codex: 0, gemini: 0 }
          if (r['agent'] === 'claude') entry.claude += Number(r['cost_usd'])
          else if (r['agent'] === 'codex') entry.codex += Number(r['cost_usd'])
          else if (r['agent'] === 'gemini') entry.gemini += Number(r['cost_usd'])
          byDate.set(d, entry)
        }
        for (const [date, costs] of [...byDate.entries()].sort()) {
          const total = costs.claude + costs.codex + costs.gemini
          lines.push(`${date}  ${fmtUsd(costs.claude).padEnd(11)}${fmtUsd(costs.codex).padEnd(11)}${fmtUsd(costs.gemini).padEnd(11)}${fmtUsd(total)}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_session_detail': {
        const sid = String(a['session_id'] ?? '')
        const session = db.prepare(`SELECT * FROM sessions WHERE id = ? OR id LIKE ?`).get(sid, `${sid}%`) as Record<string, unknown> | null
        if (!session) return { content: [{ type: 'text', text: `Session not found: ${sid}` }], isError: true }
        const requests = db.prepare(`SELECT * FROM requests WHERE session_id = ? ORDER BY timestamp ASC LIMIT 50`).all(session['id'] as string) as Array<Record<string, unknown>>
        const lines = [
          `session: ${String(session['id']).slice(0,16)}`,
          `agent: ${session['agent']}  project: ${session['project_name'] || '—'}`,
          `cost: ${fmtUsd(Number(session['total_cost_usd']))}  tokens: ${fmtTok(Number(session['total_tokens']))}  requests: ${session['request_count']}`,
          '',
          'time      model                  input    output   cost'
        ]
        for (const r of requests) {
          lines.push(`${String(r['timestamp']).slice(11,19)}  ${String(r['model']).slice(0,22).padEnd(23)}${fmtTok(Number(r['input_tokens'])).padEnd(9)}${fmtTok(Number(r['output_tokens'])).padEnd(9)}${fmtUsd(Number(r['cost_usd']))}`)
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
        if (sources === 'all' || sources === 'gemini') {
          const r = await ingestGemini(db) as Record<string, number>
          parts.push(`gemini: ${r['sessions']} sessions`)
        }
        return { content: [{ type: 'text', text: parts.join('\n') || 'done' }] }
      }

      case 'get_goals': {
        const goals = getGoalStatuses(db) as unknown as Array<Record<string, unknown>>
        if (goals.length === 0) return { content: [{ type: 'text', text: 'No goals set.' }] }
        const lines = ['period   scope                limit      spent      used%  status']
        for (const g of goals) {
          const scope = String(g['project_path'] ?? g['agent'] ?? 'global').slice(0, 20)
          const pct = Number(g['percent_used']).toFixed(1)
          const status = g['is_over'] ? 'OVER' : g['is_at_risk'] ? 'AT RISK' : 'ON TRACK'
          lines.push(`${String(g['period']).padEnd(9)}${scope.padEnd(21)}${fmtUsd(Number(g['limit_usd'])).padEnd(11)}${fmtUsd(Number(g['current_spend_usd'])).padEnd(11)}${pct}%  ${status}`)
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'set_goal': {
        const { randomUUID } = await import('crypto')
        const now = new Date().toISOString()
        upsertGoal(db, {
          id: randomUUID(),
          period: String(a['period'] ?? 'month') as 'day' | 'week' | 'month' | 'year',
          project_path: (a['project_path'] as string | undefined) ?? null,
          agent: (a['agent'] as string | undefined) ?? null,
          limit_usd: Number(a['limit_usd']),
          created_at: now,
          updated_at: now,
        })
        return { content: [{ type: 'text', text: `Goal set: ${a['period']} $${a['limit_usd']}` }] }
      }

      case 'remove_goal': {
        deleteGoal(db, String(a['id'] ?? ''))
        return { content: [{ type: 'text', text: 'Goal removed.' }] }
      }

      case 'register_agent': {
        const n = String(args['name'] ?? '');
        const ex = [..._econAgents.values()].find(x => x.name === n);
        if (ex) { ex.last_seen_at = new Date().toISOString(); return { content: [{ type: 'text', text: JSON.stringify(ex) }] }; }
        const id = Math.random().toString(36).slice(2, 10);
        const ag = { id, name: n, last_seen_at: new Date().toISOString() };
        _econAgents.set(id, ag);
        return { content: [{ type: 'text', text: JSON.stringify(ag) }] };
      }
      case 'heartbeat': {
        const ag = _econAgents.get(String(args['agent_id'] ?? ''));
        if (!ag) return { content: [{ type: 'text', text: `Agent not found` }], isError: true };
        ag.last_seen_at = new Date().toISOString();
        return { content: [{ type: 'text', text: `♥ ${ag.name}` }] };
      }
      case 'set_focus': {
        const ag = _econAgents.get(String(args['agent_id'] ?? ''));
        if (!ag) return { content: [{ type: 'text', text: `Agent not found` }], isError: true };
        (ag as Record<string, unknown>)['project_id'] = args['project_id'];
        return { content: [{ type: 'text', text: String(args['project_id'] ? `Focus: ${args['project_id']}` : 'Focus cleared') }] };
      }
      case 'send_feedback': {
        try {
          const pkg = require('../../package.json');
          db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)").run(
            String(a['message']), a['email'] || null, a['category'] || 'general', pkg.version
          );
          return { content: [{ type: 'text', text: 'Feedback saved. Thank you!' }] };
        } catch (e) {
          return { content: [{ type: 'text', text: String(e) }], isError: true };
        }
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }
  }
})


const _econAgents = new Map<string, { id: string; name: string; last_seen_at: string }>();

const transport = new StdioServerTransport()
await server.connect(transport)
