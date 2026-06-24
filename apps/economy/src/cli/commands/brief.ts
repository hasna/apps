import { Command } from 'commander'
import type { SqliteAdapter as Database } from '@hasna/cloud'
import {
  listMachineRegistry,
  listMachines,
  getMachineId,
  openDatabase,
  queryAccountBreakdown,
  queryAgentBreakdown,
  querySummary,
} from '../../db/database.js'
import { ensurePricingSeeded } from '../../lib/pricing.js'
import type { AccountBreakdown, AgentBreakdown, Period } from '../../types/index.js'

type BriefPeriod = 'today' | 'week'

export interface BriefTotals {
  sessions: number
  requests: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_create_tokens: number
  cache_create_5m_tokens: number
  cache_create_1h_tokens: number
  total_tokens: number
  cost_usd: number
  last_active: string | null
}

export interface BriefPeriodSummary extends BriefTotals {
  label: string
  period: BriefPeriod | 'since'
  since?: string
}

export interface BriefMachineRow extends BriefTotals {
  machine_id: string
  last_data_at: string | null
  last_data_age: string
}

export interface BriefAgentRow extends BriefTotals {
  agent: string
}

export interface BriefAccountRow extends BriefTotals {
  account_key: string
  account_tool: string
  account_name: string
  account_email: string | null
  account_source: string
}

export interface BriefFreshnessMachine {
  machine_id: string
  max_request_at: string | null
  request_age: string
  last_merge_sync_at: string | null
  merge_sync_age: string
}

export interface EconomyBrief {
  generated_at: string
  machine: string
  since: {
    input: string
    timestamp: string
    label: string
  }
  summaries: BriefPeriodSummary[]
  machines: BriefMachineRow[]
  agents: BriefAgentRow[]
  accounts: BriefAccountRow[]
  freshness: {
    machines: BriefFreshnessMachine[]
    max_request_line: string
    merge_sync_line: string
  }
}

interface RequestTotals extends BriefTotals {
  request_sessions: number
}

interface SessionOnlyTotals {
  sessions: number
  requests: number
  total_tokens: number
  cost_usd: number
  last_active: string | null
}

interface BriefOptions {
  since?: string
  machine?: string
  now?: Date
  currentMachineId?: string
  localSyncAt?: Date
}

interface BriefCommandDeps {
  beforeRead?: () => void | Promise<void>
}

const ZERO_REQUEST_TOTALS: RequestTotals = {
  sessions: 0,
  request_sessions: 0,
  requests: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_create_tokens: 0,
  cache_create_5m_tokens: 0,
  cache_create_1h_tokens: 0,
  total_tokens: 0,
  cost_usd: 0,
  last_active: null,
}

const ZERO_SESSION_TOTALS: SessionOnlyTotals = {
  sessions: 0,
  requests: 0,
  total_tokens: 0,
  cost_usd: 0,
  last_active: null,
}

function machineFilter(machine: string | undefined): string | undefined {
  if (!machine || machine === 'all') return undefined
  return machine
}

function requestPeriodWhere(period: BriefPeriod): string {
  if (period === 'today') return `DATE(timestamp) = DATE('now')`
  return `timestamp >= DATE('now', 'weekday 0', '-7 days')`
}

function sessionPeriodWhere(period: BriefPeriod): string {
  if (period === 'today') return `DATE(started_at) = DATE('now')`
  return `started_at >= DATE('now', 'weekday 0', '-7 days')`
}

function baseRequestTotals(row: Partial<RequestTotals> | null | undefined): RequestTotals {
  return {
    ...ZERO_REQUEST_TOTALS,
    ...row,
    sessions: Number(row?.request_sessions ?? row?.sessions ?? 0),
    request_sessions: Number(row?.request_sessions ?? row?.sessions ?? 0),
    requests: Number(row?.requests ?? 0),
    input_tokens: Number(row?.input_tokens ?? 0),
    output_tokens: Number(row?.output_tokens ?? 0),
    cache_read_tokens: Number(row?.cache_read_tokens ?? 0),
    cache_create_tokens: Number(row?.cache_create_tokens ?? 0),
    cache_create_5m_tokens: Number(row?.cache_create_5m_tokens ?? 0),
    cache_create_1h_tokens: Number(row?.cache_create_1h_tokens ?? 0),
    total_tokens: Number(row?.total_tokens ?? 0),
    cost_usd: Number(row?.cost_usd ?? 0),
    last_active: row?.last_active ?? null,
  }
}

function baseSessionTotals(row: Partial<SessionOnlyTotals> | null | undefined): SessionOnlyTotals {
  return {
    sessions: Number(row?.sessions ?? 0),
    requests: Number(row?.requests ?? 0),
    total_tokens: Number(row?.total_tokens ?? 0),
    cost_usd: Number(row?.cost_usd ?? 0),
    last_active: row?.last_active ?? null,
  }
}

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  return values.filter(Boolean).sort().at(-1) ?? null
}

function combineTotals(requests: RequestTotals, sessions: SessionOnlyTotals): BriefTotals {
  return {
    sessions: requests.request_sessions + sessions.sessions,
    requests: requests.requests + sessions.requests,
    input_tokens: requests.input_tokens,
    output_tokens: requests.output_tokens,
    cache_read_tokens: requests.cache_read_tokens,
    cache_create_tokens: requests.cache_create_tokens,
    cache_create_5m_tokens: requests.cache_create_5m_tokens,
    cache_create_1h_tokens: requests.cache_create_1h_tokens,
    total_tokens: requests.total_tokens + sessions.total_tokens,
    cost_usd: requests.cost_usd + sessions.cost_usd,
    last_active: latestTimestamp(requests.last_active, sessions.last_active),
  }
}

function emptyTotals(): BriefTotals {
  return combineTotals(ZERO_REQUEST_TOTALS, ZERO_SESSION_TOTALS)
}

function requestTotalsSql(where: string, machine?: string): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  let machineClause = ''
  if (machine) {
    machineClause = ' AND machine_id = ?'
    params.push(machine)
  }

  return {
    sql: `
      SELECT
        COUNT(DISTINCT session_id) as request_sessions,
        COUNT(*) as requests,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_create_tokens), 0) as cache_create_tokens,
        COALESCE(SUM(COALESCE(cache_create_5m_tokens, cache_create_tokens)), 0) as cache_create_5m_tokens,
        COALESCE(SUM(COALESCE(cache_create_1h_tokens, 0)), 0) as cache_create_1h_tokens,
        COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as cost_usd,
        MAX(timestamp) as last_active
      FROM requests
      WHERE ${where}${machineClause}
    `,
    params,
  }
}

function sessionOnlyTotalsSql(where: string, machine?: string): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  let machineClause = ''
  if (machine) {
    machineClause = ' AND machine_id = ?'
    params.push(machine)
  }

  return {
    sql: `
      SELECT
        COUNT(*) as sessions,
        COALESCE(SUM(request_count), 0) as requests,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(total_cost_usd), 0) as cost_usd,
        MAX(started_at) as last_active
      FROM sessions
      WHERE ${where}${machineClause}
        AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.session_id = sessions.id)
    `,
    params,
  }
}

function queryRequestTotals(db: Database, where: string, params: unknown[], machine?: string): RequestTotals {
  const q = requestTotalsSql(where, machine)
  return baseRequestTotals(db.prepare(q.sql).get(...params, ...q.params) as Partial<RequestTotals> | null)
}

function querySessionOnlyTotals(db: Database, where: string, params: unknown[], machine?: string): SessionOnlyTotals {
  const q = sessionOnlyTotalsSql(where, machine)
  return baseSessionTotals(db.prepare(q.sql).get(...params, ...q.params) as Partial<SessionOnlyTotals> | null)
}

function queryPeriodTotals(db: Database, period: BriefPeriod, machine?: string): BriefTotals {
  const summary = querySummary(db, period as Period, machine)
  const requests = queryRequestTotals(db, requestPeriodWhere(period), [], machine)
  const sessions = querySessionOnlyTotals(db, sessionPeriodWhere(period), [], machine)
  const totals = combineTotals(requests, sessions)

  return {
    ...totals,
    sessions: summary.sessions,
    requests: summary.requests,
    total_tokens: summary.tokens,
    cost_usd: summary.total_usd,
  }
}

function querySinceTotals(db: Database, since: string, machine?: string): BriefTotals {
  const requests = queryRequestTotals(db, 'timestamp >= ?', [since], machine)
  const sessions = querySessionOnlyTotals(db, 'started_at >= ?', [since], machine)
  return combineTotals(requests, sessions)
}

function parseSinceDate(input: string, now: Date): { timestamp: string; label: string } {
  const value = input.trim()
  const match = value.match(/^(\d+(?:\.\d+)?)(m|h|d|w)$/i)
  if (match) {
    const amount = Number(match[1])
    const unit = match[2]!.toLowerCase()
    const multiplier = unit === 'm' ? 60_000
      : unit === 'h' ? 60 * 60_000
      : unit === 'd' ? 24 * 60 * 60_000
      : 7 * 24 * 60 * 60_000
    return {
      timestamp: new Date(now.getTime() - amount * multiplier).toISOString(),
      label: value,
    }
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('--since must be a duration like 24h, 7d, 30m, 2w, or an ISO date')
  }
  return { timestamp: parsed.toISOString(), label: value }
}

function queryMachineSinceRows(db: Database, since: string, machine?: string): BriefMachineRow[] {
  const knownMachines = new Set<string>()
  for (const m of listMachines(db, 'all')) {
    if (m.machine_id) knownMachines.add(m.machine_id)
  }
  for (const m of listMachineRegistry(db)) {
    if (m.machine_id) knownMachines.add(m.machine_id)
  }
  if (machine) knownMachines.add(machine)

  const requestMachineClause = machine ? ' AND machine_id = ?' : ''
  const requestRows = db.prepare(`
    SELECT
      machine_id,
      COUNT(DISTINCT session_id) as request_sessions,
      COUNT(*) as requests,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
      COALESCE(SUM(cache_create_tokens), 0) as cache_create_tokens,
      COALESCE(SUM(COALESCE(cache_create_5m_tokens, cache_create_tokens)), 0) as cache_create_5m_tokens,
      COALESCE(SUM(COALESCE(cache_create_1h_tokens, 0)), 0) as cache_create_1h_tokens,
      COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd,
      MAX(timestamp) as last_active
    FROM requests
    WHERE timestamp >= ?
      AND machine_id != ''
      ${requestMachineClause}
    GROUP BY machine_id
  `).all(...(machine ? [since, machine] : [since])) as Array<RequestTotals & { machine_id: string }>

  const sessionMachineClause = machine ? ' AND machine_id = ?' : ''
  const sessionRows = db.prepare(`
    SELECT
      machine_id,
      COUNT(*) as sessions,
      COALESCE(SUM(request_count), 0) as requests,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(total_cost_usd), 0) as cost_usd,
      MAX(started_at) as last_active
    FROM sessions
    WHERE started_at >= ?
      AND machine_id != ''
      ${sessionMachineClause}
      AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.session_id = sessions.id)
    GROUP BY machine_id
  `).all(...(machine ? [since, machine] : [since])) as Array<SessionOnlyTotals & { machine_id: string }>

  const groups = new Map<string, BriefTotals>()
  for (const row of requestRows) {
    knownMachines.add(row.machine_id)
    groups.set(row.machine_id, combineTotals(baseRequestTotals(row), ZERO_SESSION_TOTALS))
  }
  for (const row of sessionRows) {
    knownMachines.add(row.machine_id)
    const current = groups.get(row.machine_id) ?? emptyTotals()
    const sessions = baseSessionTotals(row)
    groups.set(row.machine_id, {
      ...current,
      sessions: current.sessions + sessions.sessions,
      requests: current.requests + sessions.requests,
      total_tokens: current.total_tokens + sessions.total_tokens,
      cost_usd: current.cost_usd + sessions.cost_usd,
      last_active: latestTimestamp(current.last_active, sessions.last_active),
    })
  }

  const lastData = queryMachineLastData(db, machine)
  const rows = [...knownMachines]
    .filter(m => !machine || m === machine)
    .map((machineId) => {
      const totals = groups.get(machineId) ?? emptyTotals()
      const lastDataAt = lastData.get(machineId) ?? totals.last_active
      return {
        machine_id: machineId,
        ...totals,
        last_data_at: lastDataAt,
        last_data_age: '',
      }
    })

  return rows.sort((a, b) => b.cost_usd - a.cost_usd || a.machine_id.localeCompare(b.machine_id))
}

function queryMachineLastData(db: Database, machine?: string): Map<string, string | null> {
  const filter = machine ? ' AND machine_id = ?' : ''
  const requestRows = db.prepare(`
    SELECT machine_id, MAX(timestamp) as last_at
    FROM requests
    WHERE machine_id != ''${filter}
    GROUP BY machine_id
  `).all(...(machine ? [machine] : [])) as Array<{ machine_id: string; last_at: string | null }>
  const sessionRows = db.prepare(`
    SELECT machine_id, MAX(started_at) as last_at
    FROM sessions
    WHERE machine_id != ''${filter}
    GROUP BY machine_id
  `).all(...(machine ? [machine] : [])) as Array<{ machine_id: string; last_at: string | null }>

  const result = new Map<string, string | null>()
  for (const row of [...requestRows, ...sessionRows]) {
    result.set(row.machine_id, latestTimestamp(result.get(row.machine_id), row.last_at))
  }
  return result
}

function queryAgentSinceRows(db: Database, since: string, machine?: string): BriefAgentRow[] {
  const requestMachineClause = machine ? ' AND machine_id = ?' : ''
  const sessionMachineClause = machine ? ' AND machine_id = ?' : ''
  const rows = db.prepare(`
    WITH request_rows AS (
      SELECT
        agent,
        session_id,
        1 as requests,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_create_tokens,
        COALESCE(cache_create_5m_tokens, cache_create_tokens) as cache_create_5m_tokens,
        COALESCE(cache_create_1h_tokens, 0) as cache_create_1h_tokens,
        input_tokens + output_tokens + cache_read_tokens + cache_create_tokens as total_tokens,
        cost_usd,
        timestamp as last_active
      FROM requests
      WHERE timestamp >= ?${requestMachineClause}
    ),
    session_only_rows AS (
      SELECT
        agent,
        id as session_id,
        COALESCE(request_count, 0) as requests,
        0 as input_tokens,
        0 as output_tokens,
        0 as cache_read_tokens,
        0 as cache_create_tokens,
        0 as cache_create_5m_tokens,
        0 as cache_create_1h_tokens,
        COALESCE(total_tokens, 0) as total_tokens,
        COALESCE(total_cost_usd, 0) as cost_usd,
        started_at as last_active
      FROM sessions
      WHERE started_at >= ?${sessionMachineClause}
        AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.session_id = sessions.id)
    ),
    combined AS (
      SELECT * FROM request_rows
      UNION ALL
      SELECT * FROM session_only_rows
    )
    SELECT
      agent,
      COUNT(DISTINCT session_id) as sessions,
      COALESCE(SUM(requests), 0) as requests,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
      COALESCE(SUM(cache_create_tokens), 0) as cache_create_tokens,
      COALESCE(SUM(cache_create_5m_tokens), 0) as cache_create_5m_tokens,
      COALESCE(SUM(cache_create_1h_tokens), 0) as cache_create_1h_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd,
      MAX(last_active) as last_active
    FROM combined
    GROUP BY agent
    ORDER BY cost_usd DESC
  `).all(...(machine ? [since, machine, since, machine] : [since, since])) as BriefAgentRow[]

  if (rows.length > 0) return rows

  return queryAgentBreakdown(db, 'all', machine)
    .filter(row => row.last_active >= since)
    .map(agentBreakdownToBriefRow)
}

function agentBreakdownToBriefRow(row: AgentBreakdown): BriefAgentRow {
  return {
    agent: row.agent,
    sessions: row.sessions,
    requests: row.requests,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_create_tokens: 0,
    cache_create_5m_tokens: 0,
    cache_create_1h_tokens: 0,
    total_tokens: row.total_tokens,
    cost_usd: row.cost_usd,
    last_active: row.last_active,
  }
}

type AccountSourceRow = {
  agent: string
  account_key: string
  account_tool: string
  account_name: string
  account_email: string
  account_source: string
  sessions: number
  requests: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_create_tokens: number
  cache_create_5m_tokens: number
  cache_create_1h_tokens: number
  total_tokens: number
  cost_usd: number
  last_active: string
}

type AccountAccumulator = BriefAccountRow

function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase()
}

function accountKey(row: AccountSourceRow): string {
  const agent = row.agent || row.account_tool || 'unknown'
  const email = normalizeAccountEmail(row.account_email)
  if (email) return `${agent}:${email}`
  if (row.account_name) return `${agent}:${row.account_name}`
  return row.account_key || `${agent}:unknown`
}

function addAccountRow(groups: Map<string, AccountAccumulator>, row: AccountSourceRow): void {
  if (!row.account_key && !row.account_tool && !row.account_name && !row.account_email) return

  const key = accountKey(row)
  const email = normalizeAccountEmail(row.account_email)
  const current = groups.get(key) ?? {
    account_key: key,
    account_tool: row.agent || row.account_tool || 'unknown',
    account_name: row.account_name || email || row.account_key || 'unknown',
    account_email: email || null,
    account_source: row.account_source || 'unknown',
    sessions: 0,
    requests: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_create_tokens: 0,
    cache_create_5m_tokens: 0,
    cache_create_1h_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    last_active: null,
  }

  current.sessions += Number(row.sessions ?? 0)
  if (!current.account_email && email) current.account_email = email
  if ((!current.account_name || current.account_name === 'unknown') && (row.account_name || email)) {
    current.account_name = row.account_name || email
  }
  if ((!current.account_source || current.account_source === 'unknown') && row.account_source && row.account_source !== 'unknown') {
    current.account_source = row.account_source
  }
  current.requests += Number(row.requests ?? 0)
  current.input_tokens += Number(row.input_tokens ?? 0)
  current.output_tokens += Number(row.output_tokens ?? 0)
  current.cache_read_tokens += Number(row.cache_read_tokens ?? 0)
  current.cache_create_tokens += Number(row.cache_create_tokens ?? 0)
  current.cache_create_5m_tokens += Number(row.cache_create_5m_tokens ?? 0)
  current.cache_create_1h_tokens += Number(row.cache_create_1h_tokens ?? 0)
  current.total_tokens += Number(row.total_tokens ?? 0)
  current.cost_usd += Number(row.cost_usd ?? 0)
  current.last_active = latestTimestamp(current.last_active, row.last_active)
  groups.set(key, current)
}

function queryAccountSinceRows(db: Database, since: string, machine?: string): BriefAccountRow[] {
  const requestMachineClause = machine ? ' AND r.machine_id = ?' : ''
  const sessionMachineClause = machine ? ' AND s.machine_id = ?' : ''
  const requestRows = db.prepare(`
    SELECT
      COALESCE(NULLIF(r.agent, ''), NULLIF(s.agent, ''), '') as agent,
      COALESCE(NULLIF(r.account_key, ''), NULLIF(s.account_key, ''), '') as account_key,
      COALESCE(NULLIF(r.account_tool, ''), NULLIF(s.account_tool, ''), '') as account_tool,
      COALESCE(NULLIF(r.account_name, ''), NULLIF(s.account_name, ''), '') as account_name,
      COALESCE(NULLIF(r.account_email, ''), NULLIF(s.account_email, ''), '') as account_email,
      COALESCE(NULLIF(r.account_source, ''), NULLIF(s.account_source, ''), 'unknown') as account_source,
      COUNT(DISTINCT r.session_id) as sessions,
      COUNT(*) as requests,
      COALESCE(SUM(r.input_tokens), 0) as input_tokens,
      COALESCE(SUM(r.output_tokens), 0) as output_tokens,
      COALESCE(SUM(r.cache_read_tokens), 0) as cache_read_tokens,
      COALESCE(SUM(r.cache_create_tokens), 0) as cache_create_tokens,
      COALESCE(SUM(COALESCE(r.cache_create_5m_tokens, r.cache_create_tokens, 0)), 0) as cache_create_5m_tokens,
      COALESCE(SUM(COALESCE(r.cache_create_1h_tokens, 0)), 0) as cache_create_1h_tokens,
      COALESCE(SUM(r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_create_tokens), 0) as total_tokens,
      COALESCE(SUM(r.cost_usd), 0) as cost_usd,
      MAX(r.timestamp) as last_active
    FROM requests r
    LEFT JOIN sessions s ON s.id = r.session_id
    WHERE r.timestamp >= ?${requestMachineClause}
    GROUP BY
      COALESCE(NULLIF(r.agent, ''), NULLIF(s.agent, ''), ''),
      COALESCE(NULLIF(r.account_key, ''), NULLIF(s.account_key, ''), ''),
      COALESCE(NULLIF(r.account_tool, ''), NULLIF(s.account_tool, ''), ''),
      COALESCE(NULLIF(r.account_name, ''), NULLIF(s.account_name, ''), ''),
      COALESCE(NULLIF(r.account_email, ''), NULLIF(s.account_email, ''), ''),
      COALESCE(NULLIF(r.account_source, ''), NULLIF(s.account_source, ''), 'unknown')
  `).all(...(machine ? [since, machine] : [since])) as AccountSourceRow[]

  const sessionRows = db.prepare(`
    SELECT
      s.agent as agent,
      s.account_key as account_key,
      s.account_tool as account_tool,
      s.account_name as account_name,
      COALESCE(s.account_email, '') as account_email,
      COALESCE(NULLIF(s.account_source, ''), 'unknown') as account_source,
      COUNT(DISTINCT s.id) as sessions,
      COALESCE(SUM(s.request_count), 0) as requests,
      0 as input_tokens,
      0 as output_tokens,
      0 as cache_read_tokens,
      0 as cache_create_tokens,
      0 as cache_create_5m_tokens,
      0 as cache_create_1h_tokens,
      COALESCE(SUM(s.total_tokens), 0) as total_tokens,
      COALESCE(SUM(s.total_cost_usd), 0) as cost_usd,
      MAX(s.started_at) as last_active
    FROM sessions s
    WHERE s.started_at >= ?${sessionMachineClause}
      AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.session_id = s.id)
    GROUP BY
      s.agent,
      s.account_key,
      s.account_tool,
      s.account_name,
      COALESCE(s.account_email, ''),
      COALESCE(NULLIF(s.account_source, ''), 'unknown')
  `).all(...(machine ? [since, machine] : [since])) as AccountSourceRow[]

  const groups = new Map<string, AccountAccumulator>()
  for (const row of requestRows) addAccountRow(groups, row)
  for (const row of sessionRows) addAccountRow(groups, row)

  const rows = [...groups.values()]
  rows.sort((a, b) => b.cost_usd - a.cost_usd || a.account_key.localeCompare(b.account_key))

  if (rows.length > 0) return rows

  return queryAccountBreakdown(db, 'all', machine)
    .filter(row => row.last_active >= since)
    .map(accountBreakdownToBriefRow)
}

function accountBreakdownToBriefRow(row: AccountBreakdown): BriefAccountRow {
  return {
    account_key: row.account_key,
    account_tool: row.account_tool,
    account_name: row.account_name,
    account_email: row.account_email,
    account_source: row.account_source,
    sessions: row.sessions,
    requests: row.requests,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_create_tokens: 0,
    cache_create_5m_tokens: 0,
    cache_create_1h_tokens: 0,
    total_tokens: row.total_tokens,
    cost_usd: row.cost_usd,
    last_active: row.last_active,
  }
}

function queryFreshness(
  db: Database,
  now: Date,
  machine?: string,
  localSync?: { machineId: string; syncedAt: string },
): EconomyBrief['freshness'] {
  const requestFilter = machine ? ' AND machine_id = ?' : ''
  const requestRows = db.prepare(`
    SELECT machine_id, MAX(timestamp) as max_request_at
    FROM requests
    WHERE machine_id != ''${requestFilter}
    GROUP BY machine_id
  `).all(...(machine ? [machine] : [])) as Array<{ machine_id: string; max_request_at: string | null }>
  const registryRows = listMachineRegistry(db).filter(row => !machine || row.machine_id === machine)
  const machines = new Map<string, BriefFreshnessMachine>()

  for (const row of requestRows) {
    machines.set(row.machine_id, {
      machine_id: row.machine_id,
      max_request_at: row.max_request_at,
      request_age: formatAge(row.max_request_at, now),
      last_merge_sync_at: null,
      merge_sync_age: 'never',
    })
  }

  for (const row of registryRows) {
    const current = machines.get(row.machine_id) ?? {
      machine_id: row.machine_id,
      max_request_at: null,
      request_age: 'never',
      last_merge_sync_at: null,
      merge_sync_age: 'never',
    }
    const syncAt = latestTimestamp(row.last_pull_at, row.last_push_at, row.updated_at)
    current.last_merge_sync_at = syncAt
    current.merge_sync_age = formatAge(syncAt, now)
    machines.set(row.machine_id, current)
  }

  if (localSync && (!machine || machine === localSync.machineId)) {
    const current = machines.get(localSync.machineId) ?? {
      machine_id: localSync.machineId,
      max_request_at: null,
      request_age: 'never',
      last_merge_sync_at: null,
      merge_sync_age: 'never',
    }
    current.last_merge_sync_at = latestTimestamp(current.last_merge_sync_at, localSync.syncedAt)
    current.merge_sync_age = formatAge(current.last_merge_sync_at, now)
    machines.set(localSync.machineId, current)
  }

  const rows = [...machines.values()].sort((a, b) => a.machine_id.localeCompare(b.machine_id))
  return {
    machines: rows,
    max_request_line: rows.length
      ? rows.map(row => `${row.machine_id} ${row.max_request_at ?? 'never'} (${row.request_age})`).join('; ')
      : 'none',
    merge_sync_line: rows.length
      ? rows.map(row => `${row.machine_id} ${row.last_merge_sync_at ?? 'never'} (${row.merge_sync_age})`).join('; ')
      : 'none',
  }
}

export function buildBrief(db: Database, opts: BriefOptions = {}): EconomyBrief {
  const now = opts.now ?? new Date()
  const machine = machineFilter(opts.machine)
  const sinceInput = opts.since ?? '24h'
  const since = parseSinceDate(sinceInput, now)

  const summaries: BriefPeriodSummary[] = [
    {
      label: 'Today',
      period: 'today',
      ...queryPeriodTotals(db, 'today', machine),
    },
    {
      label: 'Week',
      period: 'week',
      ...queryPeriodTotals(db, 'week', machine),
    },
    {
      label: `Since ${since.label}`,
      period: 'since',
      since: since.timestamp,
      ...querySinceTotals(db, since.timestamp, machine),
    },
  ]

  const machines = queryMachineSinceRows(db, since.timestamp, machine)
  for (const row of machines) {
    row.last_data_age = formatAge(row.last_data_at, now)
  }

  return {
    generated_at: now.toISOString(),
    machine: machine ?? 'all',
    since: {
      input: sinceInput,
      timestamp: since.timestamp,
      label: since.label,
    },
    summaries,
    machines,
    agents: queryAgentSinceRows(db, since.timestamp, machine),
    accounts: queryAccountSinceRows(db, since.timestamp, machine),
    freshness: queryFreshness(
      db,
      now,
      machine,
      opts.currentMachineId && opts.localSyncAt
        ? { machineId: opts.currentMachineId, syncedAt: opts.localSyncAt.toISOString() }
        : undefined,
    ),
  }
}

function formatUsd(usd: number): string {
  if (usd >= 0.01) return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (usd >= 0.0001) return `${(usd * 100).toFixed(2).replace(/\.?0+$/, '')}c`
  if (usd > 0) return '<0.01c'
  return '$0.00'
}

function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return formatCount(n)
}

function formatAge(timestamp: string | null | undefined, now: Date): string {
  if (!timestamp) return 'never'
  const t = new Date(timestamp).getTime()
  if (!Number.isFinite(t)) return 'unknown'
  const ageMs = Math.max(0, now.getTime() - t)
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function accountLabel(row: BriefAccountRow): string {
  return row.account_email || row.account_name || row.account_key || 'unknown'
}

function cacheLabel(row: Pick<BriefTotals, 'cache_read_tokens' | 'cache_create_tokens' | 'cache_create_5m_tokens' | 'cache_create_1h_tokens'>): string {
  const total = row.cache_read_tokens + row.cache_create_tokens
  const split = row.cache_create_5m_tokens || row.cache_create_1h_tokens
    ? `; 5m ${formatTokens(row.cache_create_5m_tokens)} / 1h ${formatTokens(row.cache_create_1h_tokens)}`
    : ''
  return `${formatTokens(total)} (r ${formatTokens(row.cache_read_tokens)} / w ${formatTokens(row.cache_create_tokens)}${split})`
}

function table(headers: string[], rows: string[][]): string[] {
  if (rows.length === 0) return ['(none)']
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map(row => (row[index] ?? '').length)))
  const lines: string[] = []
  lines.push(headers.map((header, index) => header.padEnd(widths[index]!)).join('  '))
  lines.push(widths.map(width => '-'.repeat(width)).join('  '))
  for (const row of rows) {
    lines.push(row.map((cell, index) => cell.padEnd(widths[index]!)).join('  '))
  }
  return lines
}

export function renderBriefText(brief: EconomyBrief): string {
  const lines: string[] = []
  lines.push(`Economy Brief - ${brief.machine === 'all' ? 'fleet' : brief.machine}`)
  lines.push(`Generated: ${brief.generated_at}`)
  lines.push(`Since: ${brief.since.label} (${brief.since.timestamp})`)
  lines.push('')

  lines.push('SUMMARY')
  lines.push(...table(
    ['Period', 'Sessions', 'Requests', 'Input', 'Output', 'Cache', 'Tokens', 'Cost'],
    brief.summaries.map(row => [
      row.label,
      formatCount(row.sessions),
      formatCount(row.requests),
      formatTokens(row.input_tokens),
      formatTokens(row.output_tokens),
      cacheLabel(row),
      formatTokens(row.total_tokens),
      formatUsd(row.cost_usd),
    ]),
  ))
  lines.push('')

  lines.push(`PER-MACHINE - since ${brief.since.label}`)
  lines.push(...table(
    ['Machine', 'Sessions', 'Tokens', 'Cache', 'Cost', 'Last Data Age'],
    brief.machines.map(row => [
      row.machine_id,
      formatCount(row.sessions),
      formatTokens(row.total_tokens),
      cacheLabel(row),
      formatUsd(row.cost_usd),
      row.last_data_age,
    ]),
  ))
  lines.push('')

  lines.push(`PER-AGENT - since ${brief.since.label}`)
  lines.push(...table(
    ['Agent', 'Sessions', 'Requests', 'Tokens', 'Cache', 'Cost', 'Last Active'],
    brief.agents.map(row => [
      row.agent,
      formatCount(row.sessions),
      formatCount(row.requests),
      formatTokens(row.total_tokens),
      cacheLabel(row),
      formatUsd(row.cost_usd),
      row.last_active?.substring(0, 19) ?? '-',
    ]),
  ))
  lines.push('')

  lines.push(`PER-ACCOUNT - since ${brief.since.label}`)
  lines.push(...table(
    ['Account', 'Agent', 'Sessions', 'Requests', 'Tokens', 'Cost', 'Last Active'],
    brief.accounts.map(row => [
      accountLabel(row),
      row.account_tool,
      formatCount(row.sessions),
      formatCount(row.requests),
      formatTokens(row.total_tokens),
      formatUsd(row.cost_usd),
      row.last_active?.substring(0, 19) ?? '-',
    ]),
  ))
  lines.push('')

  lines.push('FRESHNESS')
  lines.push(`Max request: ${brief.freshness.max_request_line}`)
  lines.push(`Merge/sync: ${brief.freshness.merge_sync_line}`)
  lines.push('')

  return lines.join('\n')
}

export function registerBriefCommand(program: Command, deps: BriefCommandDeps = {}): void {
  program
    .command('brief')
    .description('Fleet-wide usage brief with tokens, cache, cost, breakdowns, and freshness')
    .option('--since <duration-or-date>', 'Since window for breakdown tables (24h, 7d, ISO date)', '24h')
    .option('--machine <id|all>', 'Filter to one machine, or all machines', 'all')
    .option('--json', 'Output JSON')
    .action(async (opts: { since?: string; machine?: string; json?: boolean }) => {
      try {
        let localSyncAt: Date | undefined
        if (deps.beforeRead) {
          await deps.beforeRead()
          localSyncAt = new Date()
        }
        const db = openDatabase()
        ensurePricingSeeded(db)
        const brief = buildBrief(db, {
          since: opts.since,
          machine: opts.machine,
          currentMachineId: localSyncAt ? getMachineId() : undefined,
          localSyncAt,
        })
        if (opts.json) {
          console.log(JSON.stringify(brief, null, 2))
          return
        }
        console.log(renderBriefText(brief))
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })
}
