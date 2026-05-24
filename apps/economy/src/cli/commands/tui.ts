import chalk from 'chalk'
import type { SqliteAdapter as Database } from '@hasna/cloud'
import {
  openDatabase, querySummary, queryUsageSnapshots, listMachines,
} from '../../db/database.js'
import { querySavingsSummary } from '../../lib/savings.js'
import { getCloudDatabaseUrl, getLastCloudPull } from '../../lib/cloud-sync.js'
import { getServeApiToken } from '../../lib/serve-auth.js'

function fmt(usd: number): string {
  return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function topAgent(db: Database): string {
  const row = db.prepare(`
    SELECT agent, COALESCE(SUM(cost_usd), 0) as total
    FROM requests
    WHERE timestamp >= DATE('now', 'start of month')
    GROUP BY agent
    ORDER BY total DESC
    LIMIT 1
  `).get() as { agent: string; total: number } | null
  return row?.agent ?? '—'
}

function quotaHint(db: Database): string | null {
  const snaps = queryUsageSnapshots(db, { since: new Date().toISOString().substring(0, 10) })
  const claude = snaps.find((s) => s.agent === 'claude' && s.metric === 'five_hour_utilization')
  const codex = snaps.find((s) => s.agent === 'codex' && s.metric === 'five_hour_utilization')
  const parts: string[] = []
  if (claude) parts.push(`claude ${claude.value.toFixed(0)}%`)
  if (codex) parts.push(`codex ${codex.value.toFixed(0)}%`)
  return parts.length ? parts.join(' · ') : null
}

export function buildStatusLine(db: Database): string {
  const today = querySummary(db, 'today', undefined, true)
  const week = querySummary(db, 'week', undefined, true)
  const agent = topAgent(db)
  const quota = quotaHint(db)
  const cloud = getCloudDatabaseUrl() ? 'cloud' : 'local'
  const lastPull = getLastCloudPull()
  const pullAge = lastPull
    ? `${Math.round((Date.now() - new Date(lastPull).getTime()) / 60000)}m`
    : 'never'
  const machines = listMachines(db).length
  const parts = [
    `today ${fmt(today.total_usd)}`,
    `week ${fmt(week.total_usd)}`,
    `top ${agent}`,
    `${machines} machines`,
    `${cloud} pull ${pullAge}`,
  ]
  if (quota) parts.push(quota)
  return parts.join(' · ')
}

export function buildWaybarJson(db: Database): Record<string, unknown> {
  const today = querySummary(db, 'today', undefined, true)
  const savings = querySavingsSummary(db, 'month')
  const quota = quotaHint(db)
  return {
    text: fmt(today.total_usd),
    tooltip: buildStatusLine(db),
    class: quota?.includes('%') && Number(quota.match(/(\d+)%/)?.[1] ?? 0) >= 80 ? 'warning' : 'default',
    percentage: null,
    savings_usd: savings.saved_usd,
  }
}

export function printStatusLine(): void {
  const db = openDatabase()
  console.log(buildStatusLine(db))
}

export function printWaybarJson(): void {
  const db = openDatabase()
  console.log(JSON.stringify(buildWaybarJson(db)))
}

export async function runTui(opts: { watch?: boolean; interval?: number }): Promise<void> {
  const interval = opts.interval ?? 30

  const render = () => {
    const db = openDatabase()
    const today = querySummary(db, 'today', undefined, true)
    const week = querySummary(db, 'week', undefined, true)
    const month = querySummary(db, 'month', undefined, true)
    const savings = querySavingsSummary(db, 'month')
    const machines = listMachines(db)
    const quota = quotaHint(db)

    process.stdout.write('\x1b[H\x1b[2J')
    console.log(chalk.bold.cyan('  economy'))
    console.log(chalk.dim('  ─────────────────────────────────'))
    console.log(`  Today   ${chalk.green(fmt(today.total_usd))}   ${today.sessions} sessions`)
    console.log(`  Week    ${fmt(week.total_usd)}   ${week.sessions} sessions`)
    console.log(`  Month   ${fmt(month.total_usd)}   saved ${fmt(savings.saved_usd)}`)
    console.log(chalk.dim('  ─────────────────────────────────'))
    console.log(`  Top agent: ${topAgent(db)}`)
    if (quota) console.log(`  Quota:     ${quota}`)
    console.log(`  Fleet:     ${machines.length} machines`)
    console.log(`  Cloud:     ${getCloudDatabaseUrl() ? 'connected' : 'local-only'}`)
    if (getServeApiToken()) console.log(chalk.dim('  API auth:  ECONOMY_API_TOKEN set'))
    console.log(chalk.dim(`\n  ${opts.watch ? `Refreshing every ${interval}s — Ctrl+C to exit` : 'Run with --watch for live refresh'}`))
  }

  render()
  if (!opts.watch) return

  const timer = setInterval(render, interval * 1000)
  process.on('SIGINT', () => {
    clearInterval(timer)
    process.exit(0)
  })
  await new Promise<void>(() => {})
}
