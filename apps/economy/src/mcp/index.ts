#!/usr/bin/env bun
import { randomUUID } from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerCloudTools } from '@hasna/cloud'
import { z } from 'zod'
import { openDatabase, getDbPath, querySummary, querySessions, queryTopSessions, queryModelBreakdown, queryProjectBreakdown, queryDailyBreakdown, getBudgetStatuses, upsertGoal, deleteGoal, getGoalStatuses, listMachines, getMachineId } from '../db/database.js'
import { PG_MIGRATIONS } from '../db/pg-migrations.js'
import { ingestClaude, ingestTakumi } from '../ingest/claude.js'
import { ingestCodex } from '../ingest/codex.js'
import { ingestGemini } from '../ingest/gemini.js'
import { packageMetadata } from '../lib/package-metadata.js'
import { ensurePricingSeeded } from '../lib/pricing.js'
import type { Period, Agent } from '../types/index.js'

function printHelp(): void {
  console.log(`Usage: economy-mcp [options]

Runs the ${packageMetadata.name} MCP stdio server.

Options:
  -V, --version  output the version number
  -h, --help     display help for command`)
}

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  printHelp()
  process.exit(0)
}

if (args.includes('--version') || args.includes('-V')) {
  console.log(packageMetadata.version)
  process.exit(0)
}

const db = openDatabase()
ensurePricingSeeded(db)

// The MCP SDK's tool-registration generics are expensive enough to make
// project-wide typecheck impractically slow here; keep the runtime object and
// avoid dragging those deep inferred types through the whole file.
const server: any = new McpServer({
  name: 'economy',
  version: packageMetadata.version,
})

const _econAgents = new Map<string, { id: string; name: string; last_seen_at: string; project_id?: string }>()

const TOOL_NAMES = [
  'get_cost_summary',
  'get_sessions',
  'get_top_sessions',
  'get_model_breakdown',
  'get_project_breakdown',
  'get_budget_status',
  'get_daily',
  'get_session_detail',
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
  get_sessions: 'agent(claude|codex|gemini), project(partial), machine?(hostname), limit(20) -> compact session table',
  get_top_sessions: 'n(10), agent(claude|codex|gemini) -> top sessions by cost',
  list_machines: 'no params -> machine_id, sessions, requests, cost, last_active',
  get_model_breakdown: 'no params -> model, requests, tokens, cost',
  get_project_breakdown: 'no params -> project_name, sessions, cost',
  get_budget_status: 'no params -> budget limits, current spend, percent_used, is_over_alert',
  get_daily: 'days(30) -> daily cost table grouped by date and agent',
  get_session_detail: 'session_id(prefix ok) -> per-request breakdown with model, tokens, cost',
  sync: 'sources(all|claude|codex|gemini) -> ingest latest cost data',
  search_tools: 'query substring -> tool name list',
  describe_tools: 'names[] -> one-line parameter hints',
  get_goals: 'no params -> goal progress summary',
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

function fmtSession(s: Record<string, unknown>): string {
  const id = String(s['id'] ?? '').slice(0, 8)
  const agent = String(s['agent'] ?? '')
  const proj = String(s['project_name'] || s['project_path'] || '—').slice(0, 20)
  const cost = fmtUsd(Number(s['total_cost_usd'] ?? 0))
  const tok = fmtTok(Number(s['total_tokens'] ?? 0))
  return `${id} ${agent.padEnd(6)} ${cost.padEnd(10)} ${tok.padEnd(8)} ${proj}`
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
  'List sessions. Returns compact table. Params: agent, project, machine, limit(20)',
  {
    agent: z.enum(['claude', 'takumi', 'codex', 'gemini']).optional(),
    project: z.string().optional(),
    machine: z.string().optional(),
    limit: z.number().int().positive().max(100).optional(),
  },
  async ({ agent, project, machine, limit }: { agent?: Agent; project?: string; machine?: string; limit?: number }) => {
    const sessions = querySessions(db, {
      agent,
      project,
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
    agent: z.enum(['claude', 'takumi', 'codex', 'gemini']).optional(),
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
  'Cost per model. No params.',
  {},
  async () => {
    const rows = queryModelBreakdown(db) as unknown as Array<Record<string, unknown>>
    const lines = ['model                          reqs    tokens   cost']
    for (const row of rows) {
      lines.push(`${String(row['model']).slice(0, 30).padEnd(31)}${String(row['requests']).padEnd(8)}${fmtTok(Number(row['total_tokens'])).padEnd(9)}${fmtUsd(Number(row['cost_usd']))}`)
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_project_breakdown',
  'Cost per project. No params.',
  {},
  async () => {
    const rows = queryProjectBreakdown(db) as unknown as Array<Record<string, unknown>>
    const lines = ['project              sessions tokens   cost']
    for (const row of rows) {
      const name = String(row['project_name'] || row['project_path'] || '—').slice(0, 20)
      lines.push(`${name.padEnd(21)}${String(row['sessions']).padEnd(9)}${fmtTok(Number(row['total_tokens'])).padEnd(9)}${fmtUsd(Number(row['cost_usd']))}`)
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_budget_status',
  'Budget limits vs spend, percent used, alert flags. No params.',
  {},
  async () => {
    const budgets = getBudgetStatuses(db) as unknown as Array<Record<string, unknown>>
    if (budgets.length === 0) return text('No budgets set.')

    const lines = ['scope                period   spent      limit      used%  status']
    for (const budget of budgets) {
      const scope = String(budget['project_path'] ?? 'global').slice(0, 20)
      const pct = Number(budget['percent_used']).toFixed(1)
      const status = budget['is_over_limit'] ? 'OVER' : budget['is_over_alert'] ? 'ALERT' : 'OK'
      lines.push(`${scope.padEnd(21)}${String(budget['period']).padEnd(9)}${fmtUsd(Number(budget['current_spend_usd'])).padEnd(11)}${fmtUsd(Number(budget['limit_usd'])).padEnd(11)}${pct}%`.padEnd(49) + `  ${status}`)
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_daily',
  'Daily cost table by agent. Params: days(30)',
  { days: z.number().int().positive().max(365).optional() },
  async ({ days }: { days?: number }) => {
    const rows = queryDailyBreakdown(db, days ?? 30) as Array<Record<string, unknown>>
    const byDate = new Map<string, { claude: number; codex: number; gemini: number }>()

    for (const row of rows) {
      const date = String(row['date'])
      const entry = byDate.get(date) ?? { claude: 0, codex: 0, gemini: 0 }
      if (row['agent'] === 'claude') entry.claude += Number(row['cost_usd'])
      else if (row['agent'] === 'codex') entry.codex += Number(row['cost_usd'])
      else if (row['agent'] === 'gemini') entry.gemini += Number(row['cost_usd'])
      byDate.set(date, entry)
    }

    const lines = ['date        claude     codex      gemini     total']
    for (const [date, costs] of [...byDate.entries()].sort()) {
      const total = costs.claude + costs.codex + costs.gemini
      lines.push(`${date}  ${fmtUsd(costs.claude).padEnd(11)}${fmtUsd(costs.codex).padEnd(11)}${fmtUsd(costs.gemini).padEnd(11)}${fmtUsd(total)}`)
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'get_session_detail',
  'Per-request breakdown of a single session. Params: session_id (prefix ok)',
  { session_id: z.string() },
  async ({ session_id }: { session_id: string }) => {
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ? OR id LIKE ?`).get(session_id, `${session_id}%`) as Record<string, unknown> | null
    if (!session) return textError(`Session not found: ${session_id}`)

    const requests = db.prepare(`SELECT * FROM requests WHERE session_id = ? ORDER BY timestamp ASC LIMIT 50`).all(session['id'] as string) as Array<Record<string, unknown>>
    const lines = [
      `session: ${String(session['id']).slice(0, 16)}`,
      `agent: ${session['agent']}  project: ${session['project_name'] || '—'}`,
      `cost: ${fmtUsd(Number(session['total_cost_usd']))}  tokens: ${fmtTok(Number(session['total_tokens']))}  requests: ${session['request_count']}`,
      '',
      'time      model                  input    output   cost',
    ]

    for (const request of requests) {
      lines.push(`${String(request['timestamp']).slice(11, 19)}  ${String(request['model']).slice(0, 22).padEnd(23)}${fmtTok(Number(request['input_tokens'])).padEnd(9)}${fmtTok(Number(request['output_tokens'])).padEnd(9)}${fmtUsd(Number(request['cost_usd']))}`)
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'sync',
  'Ingest new cost data. sources: all|claude|takumi|codex|gemini',
  { sources: z.enum(['all', 'claude', 'takumi', 'codex', 'gemini']).optional() },
  async ({ sources }: { sources?: 'all' | 'claude' | 'takumi' | 'codex' | 'gemini' }) => {
    const selected = sources ?? 'all'
    const parts: string[] = []

    if (selected === 'all' || selected === 'claude') {
      const result = await ingestClaude(db) as Record<string, number>
      parts.push(`claude: ${result['files']} files, ${result['requests']} requests, ${result['sessions']} sessions`)
    }
    if (selected === 'all' || selected === 'takumi') {
      const result = await ingestTakumi(db) as Record<string, number>
      parts.push(`takumi: ${result['files']} files, ${result['requests']} requests, ${result['sessions']} sessions`)
    }
    if (selected === 'all' || selected === 'codex') {
      const result = await ingestCodex(db) as Record<string, number>
      parts.push(`codex: ${result['sessions']} sessions`)
    }
    if (selected === 'all' || selected === 'gemini') {
      const result = await ingestGemini(db) as Record<string, number>
      parts.push(`gemini: ${result['sessions']} sessions`)
    }

    return text(parts.join('\n') || 'done')
  },
)

server.tool(
  'get_goals',
  'All spending goals with current progress. No params.',
  {},
  async () => {
    const goals = getGoalStatuses(db) as unknown as Array<Record<string, unknown>>
    if (goals.length === 0) return text('No goals set.')

    const lines = ['period   scope                limit      spent      used%  status']
    for (const goal of goals) {
      const scope = String(goal['project_path'] ?? goal['agent'] ?? 'global').slice(0, 20)
      const pct = Number(goal['percent_used']).toFixed(1)
      const status = goal['is_over'] ? 'OVER' : goal['is_at_risk'] ? 'AT RISK' : 'ON TRACK'
      lines.push(`${String(goal['period']).padEnd(9)}${scope.padEnd(21)}${fmtUsd(Number(goal['limit_usd'])).padEnd(11)}${fmtUsd(Number(goal['current_spend_usd'])).padEnd(11)}${pct}%  ${status}`)
    }
    return text(lines.join('\n'))
  },
)

server.tool(
  'set_goal',
  'Create/update a spending goal. period(day|week|month|year), limit_usd, project_path?, agent?',
  {
    period: z.enum(['day', 'week', 'month', 'year']),
    limit_usd: z.number().nonnegative(),
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
  'List all machines that have synced data. No params.',
  {},
  async () => {
    const machines = listMachines(db)
    if (machines.length === 0) return text(`No machine data yet. Current machine: ${getMachineId()}`)
    const lines = ['machine          sessions  requests  cost        last_active']
    for (const m of machines) {
      lines.push(`${m.machine_id.padEnd(17)}${String(m.sessions).padEnd(10)}${String(m.requests).padEnd(10)}${fmtUsd(m.total_cost_usd).padEnd(12)}${m.last_active?.substring(0, 16) ?? '—'}`)
    }
    lines.push(`\ncurrent machine: ${getMachineId()}`)
    return text(lines.join('\n'))
  },
)

server.tool(
  'register_agent',
  'Register agent session.',
  { name: z.string(), session_id: z.string().optional() },
  async ({ name }: { name: string; session_id?: string }) => {
    const existing = [..._econAgents.values()].find((agent) => agent.name === name)
    if (existing) {
      existing.last_seen_at = new Date().toISOString()
      return text(JSON.stringify(existing))
    }

    const id = Math.random().toString(36).slice(2, 10)
    const agent = { id, name, last_seen_at: new Date().toISOString() }
    _econAgents.set(id, agent)
    return text(JSON.stringify(agent))
  },
)

server.tool(
  'heartbeat',
  'Update last_seen_at.',
  { agent_id: z.string() },
  async ({ agent_id }: { agent_id: string }) => {
    const agent = _econAgents.get(agent_id)
    if (!agent) return textError('Agent not found')
    agent.last_seen_at = new Date().toISOString()
    return text(`♥ ${agent.name}`)
  },
)

server.tool(
  'set_focus',
  'Set active project context.',
  { agent_id: z.string(), project_id: z.string().optional().nullable() },
  async ({ agent_id, project_id }: { agent_id: string; project_id?: string | null }) => {
    const agent = _econAgents.get(agent_id)
    if (!agent) return textError('Agent not found')
    agent.project_id = project_id ?? undefined
    return text(project_id ? `Focus: ${project_id}` : 'Focus cleared')
  },
)

server.tool(
  'list_agents',
  'List all registered agents.',
  {},
  async () => text(JSON.stringify([..._econAgents.values()])),
)

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

const transport = new StdioServerTransport()
registerCloudTools(server, 'economy', {
  dbPath: getDbPath(),
  migrations: PG_MIGRATIONS,
})
await server.connect(transport)
