// Analytics query layer for @hasna/economy.
//
// Pure, Database-in functions that back the analytics CLI surfaces (project
// show, export, compare, forecast, efficiency). They live here so BOTH the
// LocalStore transport and the self_hosted/cloud serve endpoints run the exact
// same SQL — the CLI commands themselves never touch sqlite. This is the seam
// that keeps local and cloud reads identical (no split-brain).

import type { SqliteAdapter as Database } from '../db/sqlite-adapter.js'

// ── project detail (economy project show) ──────────────────────────────────────

export interface ProjectDetailModel {
  model: string
  requests: number
  cost_usd: number
}

export interface ProjectDetailSession {
  id: string
  total_cost_usd: number
  started_at: string
}

export interface ProjectDetail {
  project_name: string
  project_path: string
  total_cost_usd: number
  total_tokens: number
  sessions: number
  daily: Array<{ date: string; cost_usd: number }>
  models: ProjectDetailModel[]
  top_sessions: ProjectDetailSession[]
}

/** Detailed breakdown for a single project matched by name or path substring. */
export function queryProjectDetail(db: Database, nameOrPath: string): ProjectDetail | null {
  const like = `%${nameOrPath}%`
  const sessions = db.prepare(
    `SELECT id, project_name, project_path, total_cost_usd, total_tokens, started_at
     FROM sessions
     WHERE project_name LIKE ? OR project_path LIKE ?
     ORDER BY started_at DESC`,
  ).all(like, like) as Array<{
    id: string
    project_name: string | null
    project_path: string | null
    total_cost_usd: number
    total_tokens: number
    started_at: string
  }>
  if (sessions.length === 0) return null

  const first = sessions[0]!
  const totalCost = sessions.reduce((s, r) => s + (r.total_cost_usd ?? 0), 0)
  const totalTokens = sessions.reduce((s, r) => s + (r.total_tokens ?? 0), 0)

  const daily = db.prepare(
    `SELECT DATE(r.timestamp) as date, COALESCE(SUM(r.cost_usd), 0) as cost_usd
     FROM requests r JOIN sessions s ON r.session_id = s.id
     WHERE (s.project_name LIKE ? OR s.project_path LIKE ?)
       AND r.timestamp >= DATE('now', '-14 days')
     GROUP BY date ORDER BY date ASC`,
  ).all(like, like) as Array<{ date: string; cost_usd: number }>

  const models = db.prepare(
    `SELECT r.model as model, COUNT(*) as requests, COALESCE(SUM(r.cost_usd), 0) as cost_usd
     FROM requests r JOIN sessions s ON r.session_id = s.id
     WHERE s.project_name LIKE ? OR s.project_path LIKE ?
     GROUP BY r.model ORDER BY cost_usd DESC LIMIT 5`,
  ).all(like, like) as ProjectDetailModel[]

  const top_sessions = [...sessions]
    .sort((a, b) => (b.total_cost_usd ?? 0) - (a.total_cost_usd ?? 0))
    .slice(0, 5)
    .map((s) => ({ id: s.id, total_cost_usd: s.total_cost_usd ?? 0, started_at: s.started_at }))

  return {
    project_name: first.project_name || nameOrPath,
    project_path: first.project_path || '',
    total_cost_usd: totalCost,
    total_tokens: totalTokens,
    sessions: sessions.length,
    daily,
    models,
    top_sessions,
  }
}

// ── export (economy export) ─────────────────────────────────────────────────────

export type ExportType = 'sessions' | 'requests'

function exportDateWhere(column: string, period: string): string {
  switch (period) {
    case 'today': return `DATE(${column}) = DATE('now')`
    case 'week': return `${column} >= DATE('now', '-7 days')`
    case 'all': return '1=1'
    default: return `${column} >= DATE('now', '-30 days')`
  }
}

/** Raw rows for a CSV export. CSV formatting stays in the caller. */
export function queryExportRows(
  db: Database,
  type: ExportType,
  period: string,
): Array<Record<string, unknown>> {
  if (type === 'requests') {
    const where = exportDateWhere('timestamp', period)
    return db.prepare(`SELECT * FROM requests WHERE ${where} ORDER BY timestamp ASC`).all() as Array<Record<string, unknown>>
  }
  const where = exportDateWhere('started_at', period)
  return db.prepare(`SELECT * FROM sessions WHERE ${where} ORDER BY started_at DESC`).all() as Array<Record<string, unknown>>
}

// ── compare (economy compare) ───────────────────────────────────────────────────

export interface RangeStats {
  cost: number
  requests: number
  tokens: number
  sessions: number
}

/** Cost/request/token/session totals for an inclusive [from,to] date range. */
export function queryRangeStats(db: Database, from: string, to: string): RangeStats {
  const r = db.prepare(
    `SELECT COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as requests,
            COALESCE(SUM(input_tokens+output_tokens+cache_read_tokens+cache_create_tokens),0) as tokens
     FROM requests WHERE DATE(timestamp) BETWEEN ? AND ?`,
  ).get(from, to) as { cost: number; requests: number; tokens: number }
  const s = db.prepare(
    `SELECT COUNT(*) as sessions FROM sessions WHERE DATE(started_at) BETWEEN ? AND ?`,
  ).get(from, to) as { sessions: number }
  return { cost: r.cost, requests: r.requests, tokens: r.tokens, sessions: s.sessions }
}

// ── forecast (economy forecast) ─────────────────────────────────────────────────

export interface ForecastData {
  day_of_month: number
  days_in_month: number
  spent_so_far_usd: number
  daily_avg_usd: number
  projected_usd: number
  last7_daily_avg_usd: number
  last7_projected_usd: number
  cheapest_day: { date: string; cost_usd: number } | null
  most_expensive_day: { date: string; cost_usd: number } | null
}

/** End-of-month projection based on current burn rate. */
export function queryForecast(db: Database, now: Date = new Date()): ForecastData {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayOfMonth = now.getDate()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const monthSoFar = db.prepare(
    `SELECT COALESCE(SUM(cost_usd),0) as cost FROM requests WHERE DATE(timestamp) >= ?`,
  ).get(monthStart) as { cost: number }
  const dailyAvg = dayOfMonth > 0 ? monthSoFar.cost / dayOfMonth : 0
  const projected = dailyAvg * daysInMonth

  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const last7 = db.prepare(
    `SELECT COALESCE(SUM(cost_usd),0) as cost FROM requests WHERE DATE(timestamp) >= ?`,
  ).get(sevenDaysAgo.toISOString().substring(0, 10)) as { cost: number }
  const last7DailyAvg = last7.cost / 7

  const dailyCosts = db.prepare(
    `SELECT DATE(timestamp) as date, COALESCE(SUM(cost_usd),0) as cost_usd
     FROM requests WHERE DATE(timestamp) >= ? GROUP BY date ORDER BY cost_usd ASC`,
  ).all(monthStart) as Array<{ date: string; cost_usd: number }>

  return {
    day_of_month: dayOfMonth,
    days_in_month: daysInMonth,
    spent_so_far_usd: monthSoFar.cost,
    daily_avg_usd: dailyAvg,
    projected_usd: projected,
    last7_daily_avg_usd: last7DailyAvg,
    last7_projected_usd: last7DailyAvg * daysInMonth,
    cheapest_day: dailyCosts[0] ?? null,
    most_expensive_day: dailyCosts[dailyCosts.length - 1] ?? null,
  }
}

// ── efficiency (economy efficiency) ─────────────────────────────────────────────

export interface ModelEfficiency {
  model: string
  input: number
  output: number
  cache_read: number
  cache_write: number
  requests: number
  cost: number
}

/** Per-model token efficiency (output/input ratio, cache hit %, cost/1k out). */
export function queryModelEfficiency(db: Database): ModelEfficiency[] {
  return db.prepare(
    `SELECT model,
            COALESCE(SUM(input_tokens),0) as input,
            COALESCE(SUM(output_tokens),0) as output,
            COALESCE(SUM(cache_read_tokens),0) as cache_read,
            COALESCE(SUM(cache_create_tokens),0) as cache_write,
            COUNT(*) as requests,
            COALESCE(SUM(cost_usd),0) as cost
     FROM requests GROUP BY model ORDER BY cost DESC`,
  ).all() as ModelEfficiency[]
}
