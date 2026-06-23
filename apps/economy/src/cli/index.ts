#!/usr/bin/env bun
import { Command } from 'commander'
import { registerEventsCommands } from '@hasna/events/commander'
import chalk from 'chalk'
import { registerBrainsCommand } from './brains.js'
import { registerTodosCommand } from './commands/todos.js'
import { registerExtendedCommands, registerFleetCommands } from './commands/extras.js'
import { AGENTS, parseAgent } from '../lib/agents.js'
import { syncAll } from '../lib/sync-all.js'
import { maybePullFromCloud, cloudPush, cloudPull, cloudSyncFull, getCloudDatabaseUrl, getCloudPg } from '../lib/cloud-sync.js'
import { mergePeerDatabase } from '../lib/peer-sync.js'
import type { Agent } from '../lib/agents.js'
import { openDatabase, querySummary, querySessions, queryTopSessions, queryModelBreakdown, queryProjectBreakdown, queryAgentBreakdown, queryAccountBreakdown, queryDailyBreakdown, getBudgetStatuses, upsertBudget, deleteBudget, upsertProject, deleteProject, getProject, listModelPricing, upsertModelPricing, deleteModelPricing, upsertGoal, deleteGoal, getGoalStatuses, listMachines, getMachineId, listMachineRegistry } from '../db/database.js'
import { queryBillingSummary } from '../db/database.js'
import { syncAnthropicBilling, syncOpenAIBilling, syncGeminiBilling } from '../ingest/billing.js'
import { packageMetadata } from '../lib/package-metadata.js'
import { ensurePricingSeeded } from '../lib/pricing.js'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'
import type { AccountBreakdown, Period } from '../types/index.js'

const program = new Command()

program
  .name('economy')
  .description('AI coding cost tracker — Claude, Codex, Gemini, OpenCode, Cursor, Pi, Hermes')
  .version(packageMetadata.version)

// ── Auto-sync helper ──────────────────────────────────────────────────────────

async function autoSync(opts: { claude?: boolean; takumi?: boolean; codex?: boolean; gemini?: boolean; opencode?: boolean; cursor?: boolean; pi?: boolean; hermes?: boolean; verbose?: boolean } = {}): Promise<void> {
  const db = openDatabase()
  ensurePricingSeeded(db)
  await maybePullFromCloud()
  await syncAll(db, opts)
}

// ── Sparkline helper ──────────────────────────────────────────────────────────

function sparkline(values: number[]): string {
  const chars = '▁▂▃▄▅▆▇█'
  if (values.length === 0) return ''
  const max = Math.max(...values)
  if (max === 0) return chars[0]!.repeat(values.length)
  return values.map(v => chars[Math.min(Math.round((v / max) * 7), 7)]!).join('')
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(usd: number): string {
  let formatted: string
  if (usd >= 0.01) {
    formatted = '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } else if (usd >= 0.0001) {
    // Show as cents: 0.3¢
    const cents = usd * 100
    formatted = cents.toFixed(2).replace(/\.?0+$/, '') + '¢'
  } else if (usd > 0) {
    formatted = '<0.01¢'
  } else {
    formatted = '$0.00'
  }
  return chalk.green(formatted)
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString('en-US')
}

function fmtCount(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtAgent(agent: string): string {
  if (agent === 'claude') return chalk.blue('claude')
  if (agent === 'codex') return chalk.yellow('codex')
  if (agent === 'gemini') return chalk.green('gemini')
  if (agent === 'takumi') return chalk.magenta('takumi')
  if (agent === 'opencode') return chalk.cyan('opencode')
  if (agent === 'cursor') return chalk.white('cursor')
  if (agent === 'pi') return chalk.hex('#FF6B6B')('pi')
  if (agent === 'hermes') return chalk.hex('#9B59B6')('hermes')
  return chalk.gray(agent)
}

function fail(message: string): never {
  console.error(chalk.red(message))
  process.exit(1)
}

function parseFiniteCliNumber(value: string | undefined, option: string): number {
  if (value == null || value === '') fail(`${option} is required`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) fail(`${option} must be a number`)
  return parsed
}

function parsePositiveCliNumber(value: string | undefined, option: string): number {
  const parsed = parseFiniteCliNumber(value, option)
  if (parsed <= 0) fail(`${option} must be greater than 0`)
  return parsed
}

function parsePositiveCliInteger(value: string | undefined, option: string): number {
  const parsed = parsePositiveCliNumber(value, option)
  if (!Number.isInteger(parsed)) fail(`${option} must be an integer`)
  return parsed
}

function parseNonNegativeCliNumber(value: string | undefined, option: string): number {
  const parsed = parseFiniteCliNumber(value, option)
  if (parsed < 0) fail(`${option} must be non-negative`)
  return parsed
}

function parseCliPort(value: string | undefined, option: string): number {
  const port = parsePositiveCliInteger(value, option)
  if (port > 65535) fail(`${option} must be between 1 and 65535`)
  return port
}

function parseOptionalCliAgent(value: string | undefined): Agent | undefined {
  if (value == null) return undefined
  try {
    return parseAgent(value, '--agent')
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e))
  }
}

function requireCliChoice<T extends string>(value: string | undefined, option: string, allowed: readonly T[]): T {
  const selected = value ?? allowed[0]!
  if ((allowed as readonly string[]).includes(selected)) return selected as T
  fail(`${option} must be one of: ${allowed.join(', ')}`)
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').replace(/\x1b\[[0-9;]*m/g, '').length)))
  const sep = widths.map(w => '─'.repeat(w + 2)).join('┼')
  const header = headers.map((h, i) => ` ${h.padEnd(widths[i] ?? 0)} `).join('│')
  console.log(`┌${sep.replace(/┼/g, '┬')}┐`)
  console.log(`│${header}│`)
  console.log(`├${sep}┤`)
  for (const row of rows) {
    const line = row.map((cell, i) => {
      const plain = cell.replace(/\x1b\[[0-9;]*m/g, '')
      return ` ${cell}${' '.repeat(Math.max(0, (widths[i] ?? 0) - plain.length))} `
    }).join('│')
    console.log(`│${line}│`)
  }
  console.log(`└${sep.replace(/┼/g, '┴')}┘`)
}

function accountDisplayName(row: AccountBreakdown): string {
  return row.account_email || row.account_name || row.account_key || 'unknown'
}

function printAccountBreakdown(rows: AccountBreakdown[]): void {
  printTable(
    ['Account', 'Agent', 'Source', 'Sessions', 'Requests', 'Tokens', 'API Eq', 'Billable', 'Included'],
    rows.map(r => [
      chalk.white(accountDisplayName(r)),
      fmtAgent(r.account_tool),
      chalk.dim(r.account_source || 'unknown'),
      String(r.sessions),
      String(r.requests),
      chalk.cyan(fmtTokens(r.total_tokens)),
      fmt(r.api_equivalent_usd),
      fmt(r.billable_usd),
      fmt(r.subscription_included_usd),
    ]),
  )
}

// ── parseSinceDate ─────────────────────────────────────────────────────────────

function parseSinceDate(since: string): string {
  // Relative shorthand: 7d, 30d, 90d
  const relMatch = since.match(/^(\d+)d$/)
  if (relMatch) {
    const days = parseInt(relMatch[1]!, 10)
    const d = new Date()
    d.setDate(d.getDate() - days)
    return d.toISOString().substring(0, 10)
  }
  // ISO date: 2026-03-01
  return since
}

function printSummary(label: string, period: Period): void {
  const db = openDatabase()
  ensurePricingSeeded(db)
  const s = querySummary(db, period)
  console.log()
  console.log(chalk.bold.cyan(`  ${label}`))
  console.log()
  printTable(
    ['Metric', 'Value'],
    [
      ['Total cost', fmt(s.total_usd)],
      ['Sessions', chalk.yellow(fmtCount(s.sessions))],
      ['Requests', chalk.yellow(fmtCount(s.requests))],
      ['Tokens', chalk.yellow(fmtTokens(s.tokens))],
    ],
  )
  console.log()
}

// ── default (no subcommand) ───────────────────────────────────────────────────

program.action(async () => {
  await autoSync()
  const db = openDatabase()
  const t = querySummary(db, 'today')
  const w = querySummary(db, 'week')
  const m = querySummary(db, 'month')
  const projects = queryProjectBreakdown(db).slice(0, 3)
  const daily = queryDailyBreakdown(db, 14).reduce((acc, d) => {
    acc[d.date] = (acc[d.date] ?? 0) + d.cost_usd
    return acc
  }, {} as Record<string, number>)
  const dailyValues = Object.values(daily)

  console.log()
  console.log(chalk.bold.cyan('  Economy'))
  console.log()
  printTable(
    ['Period', 'Cost', 'Sessions', 'Requests', 'Tokens'],
    [
      ['Today', fmt(t.total_usd), fmtCount(t.sessions), fmtCount(t.requests), fmtTokens(t.tokens)],
      ['This Week', fmt(w.total_usd), fmtCount(w.sessions), fmtCount(w.requests), fmtTokens(w.tokens)],
      ['This Month', fmt(m.total_usd), fmtCount(m.sessions), fmtCount(m.requests), fmtTokens(m.tokens)],
    ],
  )
  if (dailyValues.length > 0) {
    console.log(`\n  ${chalk.dim('14-day trend:')} ${sparkline(dailyValues)}`)
  }
  if (projects.length > 0) {
    console.log(`\n  ${chalk.dim('Top projects:')}`)
    for (const p of projects) {
      console.log(`    ${chalk.white(p.project_name.padEnd(25))} ${fmt(p.cost_usd)}`)
    }
  }
  console.log()
})

// ── sync ──────────────────────────────────────────────────────────────────────

program
  .command('sync')
  .description('Ingest cost data from all coding agents')
  .option('--claude', 'Only ingest Claude Code telemetry')
  .option('--takumi', 'Only ingest Takumi sessions')
  .option('--codex', 'Only ingest Codex sessions')
  .option('--gemini', 'Only ingest Gemini CLI sessions')
  .option('--opencode', 'Only ingest OpenCode sessions')
  .option('--cursor', 'Only ingest Cursor usage')
  .option('--pi', 'Only ingest Pi sessions')
  .option('--hermes', 'Only ingest Hermes sessions')
  .option('-v, --verbose', 'Verbose output')
  .option('--force', 'Force re-process all files (ignore mtime cache)')
  .option('--backfill-machine', 'Tag existing records that have no machine_id with current hostname')
  .option('--recalculate', 'Recalculate costs for all requests with cost_usd = 0')
  .action(async (opts: { claude?: boolean; takumi?: boolean; codex?: boolean; gemini?: boolean; opencode?: boolean; cursor?: boolean; pi?: boolean; hermes?: boolean; verbose?: boolean; force?: boolean; backfillMachine?: boolean; recalculate?: boolean }) => {
    const db = openDatabase()
    ensurePricingSeeded(db)
    const anySpecific = opts.claude || opts.takumi || opts.codex || opts.gemini || opts.opencode || opts.cursor || opts.pi || opts.hermes
    if (!anySpecific || opts.verbose) {
      try {
        const { syncOpenProjectsRegistry } = await import('../lib/open-projects.js')
        const p = await syncOpenProjectsRegistry(db)
        if (opts.verbose) console.log(chalk.dim(`Synced open-projects registry: ${p.imported} imported, ${p.skipped} skipped`))
      } catch (e) {
        if (opts.verbose) console.log(chalk.dim(`open-projects registry sync skipped: ${e instanceof Error ? e.message : String(e)}`))
      }
    }
    if (opts.force) {
      db.exec(`DELETE FROM ingest_state WHERE source IN (${AGENTS.map(a => `'${a}'`).join(', ')})`)
      if (opts.verbose) console.log(chalk.dim('Cleared ingest cache'))
    }
    process.stdout.write(chalk.cyan('→ Ingesting agent data... '))
    const result = await syncAll(db, {
      claude: opts.claude,
      takumi: opts.takumi,
      codex: opts.codex,
      gemini: opts.gemini,
      opencode: opts.opencode,
      cursor: opts.cursor,
      pi: opts.pi,
      hermes: opts.hermes,
      verbose: opts.verbose,
    })
    console.log(chalk.green(`✓ deduped ${result.deduped}${result.cloudPushed ? ', pushed to cloud' : ''}`))
    // Backfill empty machine_id records
    if (opts.backfillMachine) {
      const machine = getMachineId()
      const reqCount = db.prepare(`UPDATE requests SET machine_id = ? WHERE machine_id = '' OR machine_id IS NULL`).run(machine)
      const sessCount = db.prepare(`UPDATE sessions SET machine_id = ? WHERE machine_id = '' OR machine_id IS NULL`).run(machine)
      console.log(chalk.cyan(`→ Backfilled machine_id='${machine}': ${reqCount.changes} requests, ${sessCount.changes} sessions`))
    }
    // Recalculate zero-cost requests
    if (opts.recalculate) {
      const { computeCostFromDb } = await import('../lib/pricing.js')
      const zeroRows = db.prepare(`SELECT id, model, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cache_create_5m_tokens, cache_create_1h_tokens FROM requests WHERE cost_usd = 0 AND (input_tokens > 0 OR output_tokens > 0 OR cache_read_tokens > 0 OR cache_create_tokens > 0)`).all() as Array<{ id: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_create_tokens: number; cache_create_5m_tokens?: number; cache_create_1h_tokens?: number }>
      let fixed = 0
      for (const r of zeroRows) {
        const cache5m = r.cache_create_5m_tokens ?? r.cache_create_tokens
        const cost = computeCostFromDb(db, r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens, cache5m, r.cache_create_1h_tokens ?? 0)
        if (cost > 0) {
          db.prepare(`UPDATE requests SET cost_usd = ? WHERE id = ?`).run(cost, r.id)
          fixed++
        }
      }
      if (fixed > 0) {
        const touchedSessions = new Set(zeroRows.map(r => {
          const row = db.prepare(`SELECT session_id FROM requests WHERE id = ?`).get(r.id) as { session_id: string } | null
          return row?.session_id
        }).filter(Boolean) as string[])
        const { rollupSession } = await import('../db/database.js')
        for (const sid of touchedSessions) { rollupSession(db, sid) }
      }
      console.log(chalk.cyan(`→ Recalculated: ${fixed}/${zeroRows.length} zero-cost requests now have pricing`))
    }
    // Fire webhooks after sync
    try {
      const { checkAndFireWebhooks } = await import('../lib/webhooks.js')
      await checkAndFireWebhooks(db)
    } catch { /* webhooks are optional */ }
    console.log(chalk.bold.green('\n✓ Sync complete'))
  })

// ── today / week / month ──────────────────────────────────────────────────────

program.command('today').description('Cost summary for today').action(async () => { await autoSync(); printSummary('Today', 'today') })
program.command('week').description('Cost summary for this week').action(async () => { await autoSync(); printSummary('This Week', 'week') })
program.command('month').description('Cost summary for this month').action(async () => { await autoSync(); printSummary('This Month', 'month') })

// ── sessions ──────────────────────────────────────────────────────────────────

program
  .command('sessions')
  .description('List coding sessions with costs')
  .option('--agent <agent>', 'Filter by agent (claude|takumi|codex|gemini)')
  .option('--project <path>', 'Filter by project path')
  .option('--account <query>', 'Filter by account key, name, or email')
  .option('--machine <id>', 'Filter by machine hostname (e.g. spark01, apple01)')
  .option('--limit <n>', 'Number of sessions', '20')
  .option('--format <fmt>', 'Output format: table|compact|csv|json', 'table')
  .option('--since <date>', 'Filter sessions since date or relative (e.g. 2026-03-01, 7d, 30d)')
  .option('--search <query>', 'Search by project name, session id prefix, or agent')
  .action(async (opts: { agent?: string; project?: string; account?: string; machine?: string; limit?: string; format?: string; since?: string; search?: string }) => {
    const limit = parsePositiveCliInteger(opts.limit ?? '20', '--limit')
    const agent = parseOptionalCliAgent(opts.agent)
    await autoSync()
    const db = openDatabase()
    const sinceDate = opts.since ? parseSinceDate(opts.since) : undefined
    let sessions = querySessions(db, {
      agent,
      project: opts.project,
      account: opts.account,
      machine: opts.machine,
      limit,
      since: sinceDate,
      search: opts.search,
    })
    if (sessions.length === 0) { console.log(chalk.yellow('No sessions found.')); return }
    const f = opts.format ?? 'table'
    if (f === 'compact') {
      for (const s of sessions) process.stdout.write(`${s.id.slice(0,8)} ${s.agent} ${fmt(s.total_cost_usd)} ${fmtTokens(s.total_tokens)} ${s.project_name || '—'}\n`)
      return
    }
    if (f === 'json') { console.log(JSON.stringify(sessions, null, 2)); return }
    if (f === 'csv') {
      console.log('id,agent,project_name,total_cost_usd,total_tokens,request_count,started_at')
      for (const s of sessions) console.log(`${s.id},${s.agent},"${s.project_name}",${s.total_cost_usd},${s.total_tokens},${s.request_count},${s.started_at}`)
      return
    }
    console.log()
    printTable(
      ['Session ID', 'Agent', 'Project', 'Cost', 'Tokens', 'Requests', 'Started'],
      sessions.map(s => [
        chalk.dim(s.id.substring(0, 12)),
        fmtAgent(s.agent),
        chalk.white(s.project_name || chalk.dim('unknown')),
        fmt(s.total_cost_usd),
        chalk.cyan(fmtTokens(s.total_tokens)),
        fmtCount(s.request_count),
        chalk.dim(s.started_at.substring(0, 16)),
      ]),
    )
    console.log()
  })

// ── top ───────────────────────────────────────────────────────────────────────

program
  .command('top')
  .description('Most expensive sessions')
  .option('-n <n>', 'Number of sessions', '10')
  .option('--agent <agent>', 'Filter by agent')
  .option('--since <date>', 'Filter sessions since date or relative (e.g. 2026-03-01, 7d, 30d)')
  .action((opts: { n?: string; agent?: string; since?: string }) => {
    const count = parsePositiveCliInteger(opts.n ?? '10', '-n')
    const agent = parseOptionalCliAgent(opts.agent)
    const db = openDatabase()
    const sinceDate = opts.since ? parseSinceDate(opts.since) : undefined
    let sessions = queryTopSessions(db, count, agent)
    if (sinceDate) sessions = sessions.filter(s => s.started_at >= sinceDate)
    if (sessions.length === 0) {
      console.log(chalk.yellow('No sessions found. Run `economy sync` first.'))
      return
    }
    console.log()
    printTable(
      ['#', 'Project', 'Agent', 'Cost', 'Tokens', 'Started'],
      sessions.map((s, i) => [
        chalk.dim(String(i + 1)),
        chalk.white(s.project_name || chalk.dim('unknown')),
        fmtAgent(s.agent),
        fmt(s.total_cost_usd),
        chalk.cyan(fmtTokens(s.total_tokens)),
        chalk.dim(s.started_at.substring(0, 16)),
      ]),
    )
    console.log()
  })

// ── breakdown ─────────────────────────────────────────────────────────────────

program
  .command('breakdown')
  .description('Cost breakdown by model, agent, project, or account')
  .option('--by <dimension>', 'Dimension: model|agent|project|account', 'model')
  .option('--since <date>', 'Filter since date or relative (e.g. 2026-03-01, 7d, 30d)')
  .action((opts: { by?: string; since?: string }) => {
    const db = openDatabase()
    const sinceDate = opts.since ? parseSinceDate(opts.since) : undefined
    console.log()
    if (opts.by === 'project') {
      const rows = sinceDate
        ? db.prepare(`
          SELECT project_path, project_name,
                 COUNT(*) as sessions,
                 COALESCE(SUM(total_tokens), 0) as total_tokens,
                 COALESCE(SUM(request_count), 0) as requests,
                 COALESCE(SUM(total_cost_usd), 0) as cost_usd,
                 MAX(started_at) as last_active
          FROM sessions WHERE started_at >= ?
          GROUP BY project_path ORDER BY cost_usd DESC
        `).all(sinceDate) as Array<{ project_path: string; project_name: string; sessions: number; total_tokens: number; requests: number; cost_usd: number; last_active: string }>
        : queryProjectBreakdown(db)
      printTable(
        ['Project', 'Sessions', 'Requests', 'Tokens', 'Cost'],
        rows.map(r => [
          chalk.white(r.project_name || chalk.dim('unknown')),
          String(r.sessions),
          String(r.requests),
          chalk.cyan(fmtTokens(r.total_tokens)),
          fmt(r.cost_usd),
        ]),
      )
    } else if (opts.by === 'agent') {
      const rows = sinceDate
        ? db.prepare(`
          SELECT agent,
                 COUNT(DISTINCT session_id) as sessions,
                 COUNT(*) as requests,
                 COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as total_tokens,
                 COALESCE(SUM(cost_usd), 0) as api_equivalent_usd,
                 COALESCE(SUM(CASE WHEN cost_basis = 'metered_api' THEN cost_usd ELSE 0 END), 0) as billable_usd,
                 COALESCE(SUM(CASE WHEN cost_basis = 'subscription_included' THEN cost_usd ELSE 0 END), 0) as subscription_included_usd,
                 MAX(timestamp) as last_active
          FROM requests
          WHERE timestamp >= ?
          GROUP BY agent
          ORDER BY api_equivalent_usd DESC
        `).all(sinceDate) as Array<{ agent: string; sessions: number; requests: number; total_tokens: number; api_equivalent_usd: number; billable_usd: number; subscription_included_usd: number }>
        : queryAgentBreakdown(db)
      printTable(
        ['Agent', 'Sessions', 'Requests', 'Tokens', 'API Eq', 'Billable', 'Included'],
        rows.map(r => [
          fmtAgent(r.agent),
          String(r.sessions),
          String(r.requests),
          chalk.cyan(fmtTokens(r.total_tokens)),
          fmt(r.api_equivalent_usd),
          fmt(r.billable_usd),
          fmt(r.subscription_included_usd),
        ]),
      )
    } else if (opts.by === 'account') {
      const rows = sinceDate
        ? db.prepare(`
          WITH request_rows AS (
            SELECT
              r.session_id as session_id,
              COALESCE(NULLIF(r.agent, ''), NULLIF(s.agent, ''), NULLIF(r.account_tool, ''), NULLIF(s.account_tool, ''), 'unknown') as account_agent,
              COALESCE(NULLIF(r.account_key, ''), NULLIF(s.account_key, ''), '') as raw_account_key,
              COALESCE(NULLIF(r.account_name, ''), NULLIF(s.account_name, ''), '') as raw_account_name,
              LOWER(TRIM(COALESCE(NULLIF(r.account_email, ''), NULLIF(s.account_email, ''), ''))) as raw_account_email,
              COALESCE(NULLIF(r.account_source, ''), NULLIF(s.account_source, ''), 'unknown') as account_source,
              1 as requests,
              COALESCE(r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_create_tokens, 0) as total_tokens,
              COALESCE(r.cost_usd, 0) as cost_usd,
              COALESCE(NULLIF(r.cost_basis, ''), 'estimated') as cost_basis,
              r.timestamp as last_active
            FROM requests r
            LEFT JOIN sessions s ON s.id = r.session_id
            WHERE r.timestamp >= ?
              AND (
                COALESCE(NULLIF(r.account_key, ''), NULLIF(s.account_key, ''), '') != ''
                OR COALESCE(NULLIF(r.account_tool, ''), NULLIF(s.account_tool, ''), '') != ''
                OR COALESCE(NULLIF(r.account_name, ''), NULLIF(s.account_name, ''), '') != ''
                OR COALESCE(NULLIF(r.account_email, ''), NULLIF(s.account_email, ''), '') != ''
              )
          ),
          session_only_rows AS (
            SELECT
              s.id as session_id,
              COALESCE(NULLIF(s.agent, ''), NULLIF(s.account_tool, ''), 'unknown') as account_agent,
              s.account_key as raw_account_key,
              s.account_name as raw_account_name,
              LOWER(TRIM(COALESCE(s.account_email, ''))) as raw_account_email,
              COALESCE(NULLIF(s.account_source, ''), 'unknown') as account_source,
              COALESCE(s.request_count, 0) as requests,
              COALESCE(s.total_tokens, 0) as total_tokens,
              COALESCE(s.total_cost_usd, 0) as cost_usd,
              'estimated' as cost_basis,
              s.started_at as last_active
            FROM sessions s
            WHERE s.started_at >= ?
              AND s.id NOT IN (SELECT DISTINCT session_id FROM requests)
              AND (s.account_key != '' OR s.account_tool != '' OR s.account_name != '' OR s.account_email != '')
          ),
          normalized AS (
            SELECT
              CASE
                WHEN raw_account_email != '' THEN account_agent || ':' || raw_account_email
                WHEN raw_account_name != '' THEN account_agent || ':' || raw_account_name
                ELSE raw_account_key
              END as account_key,
              account_agent as account_tool,
              raw_account_name as account_name,
              raw_account_email as account_email,
              account_source,
              session_id,
              requests,
              total_tokens,
              cost_usd,
              cost_basis,
              last_active
            FROM request_rows
            UNION ALL
            SELECT
              CASE
                WHEN raw_account_email != '' THEN account_agent || ':' || raw_account_email
                WHEN raw_account_name != '' THEN account_agent || ':' || raw_account_name
                ELSE raw_account_key
              END as account_key,
              account_agent as account_tool,
              raw_account_name as account_name,
              raw_account_email as account_email,
              account_source,
              session_id,
              requests,
              total_tokens,
              cost_usd,
              cost_basis,
              last_active
            FROM session_only_rows
          )
          SELECT account_key,
                 account_tool,
                 COALESCE(MAX(NULLIF(account_name, '')), MAX(NULLIF(account_email, '')), account_key) as account_name,
                 NULLIF(account_email, '') as account_email,
                 COALESCE(MAX(NULLIF(account_source, 'unknown')), 'unknown') as account_source,
                 COUNT(DISTINCT session_id) as sessions,
                 COALESCE(SUM(requests), 0) as requests,
                 COALESCE(SUM(total_tokens), 0) as total_tokens,
                 COALESCE(SUM(cost_usd), 0) as api_equivalent_usd,
                 COALESCE(SUM(CASE WHEN cost_basis = 'metered_api' THEN cost_usd ELSE 0 END), 0) as billable_usd,
                 COALESCE(SUM(CASE WHEN cost_basis = 'metered_api' THEN cost_usd ELSE 0 END), 0) as metered_api_usd,
                 COALESCE(SUM(CASE WHEN cost_basis = 'subscription_included' THEN cost_usd ELSE 0 END), 0) as subscription_included_usd,
                 COALESCE(SUM(CASE WHEN cost_basis NOT IN ('metered_api', 'subscription_included', 'unknown') THEN cost_usd ELSE 0 END), 0) as estimated_usd,
                 COALESCE(SUM(CASE WHEN cost_basis = 'unknown' THEN cost_usd ELSE 0 END), 0) as unknown_usd,
                 COALESCE(SUM(cost_usd), 0) as cost_usd,
                 MAX(last_active) as last_active
          FROM normalized
          WHERE account_key != ''
          GROUP BY account_key, account_tool, account_email
          ORDER BY api_equivalent_usd DESC
        `).all(sinceDate, sinceDate) as AccountBreakdown[]
        : queryAccountBreakdown(db)
      printAccountBreakdown(rows)
    } else {
      const rows = sinceDate
        ? db.prepare(`
          SELECT model, agent,
                 COUNT(*) as requests,
                 COALESCE(SUM(input_tokens), 0) as input_tokens,
                 COALESCE(SUM(output_tokens), 0) as output_tokens,
                 COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as total_tokens,
                 COALESCE(SUM(cost_usd), 0) as cost_usd
          FROM requests WHERE timestamp >= ?
          GROUP BY model, agent ORDER BY cost_usd DESC
        `).all(sinceDate) as Array<{ model: string; agent: string; requests: number; total_tokens: number; cost_usd: number }>
        : queryModelBreakdown(db)
      printTable(
        ['Model', 'Agent', 'Requests', 'Tokens', 'Cost'],
        rows.map(r => [
          chalk.white(r.model),
          fmtAgent(r.agent),
          String(r.requests),
          chalk.cyan(fmtTokens(r.total_tokens)),
          fmt(r.cost_usd),
        ]),
      )
    }
    console.log()
  })

// ── accounts ──────────────────────────────────────────────────────────────────

const ACCOUNT_PERIODS = ['today', 'week', 'month', 'year', 'all'] as const

program
  .command('accounts [period]')
  .description('List account usage by email address and coding agent')
  .option('--json', 'Output JSON')
  .action((periodArg: string | undefined, opts: { json?: boolean }) => {
    const period = requireCliChoice(periodArg, 'period', ACCOUNT_PERIODS)
    const rows = queryAccountBreakdown(openDatabase(), period)

    if (opts.json) {
      console.log(JSON.stringify(rows, null, 2))
      return
    }

    if (rows.length === 0) {
      console.log(chalk.yellow('No account-attributed sessions yet. Run `economy sync` first.'))
      return
    }

    console.log()
    console.log(chalk.bold.cyan(`  Accounts — ${period}`))
    console.log()
    printAccountBreakdown(rows)
    console.log()
  })

// ── watch ─────────────────────────────────────────────────────────────────────

program
  .command('watch')
  .description('Live stream of incoming costs')
  .option('--interval <seconds>', 'Poll interval in seconds', '10')
  .option('--daemon', 'Watch agent data directories and sync on change')
  .option('--agent <agent>', 'Filter by agent')
  .option('--notify <amount>', 'Fire macOS notification when cumulative cost crosses this USD threshold')
  .action(async (opts: { interval?: string; daemon?: boolean; agent?: string; notify?: string }) => {
    const { watchCosts } = await import('./commands/watch.js')
    await watchCosts({
      interval: parsePositiveCliInteger(opts.interval ?? '10', '--interval'),
      daemon: Boolean(opts.daemon),
      agent: parseOptionalCliAgent(opts.agent),
      notify: opts.notify ? parsePositiveCliNumber(opts.notify, '--notify') : undefined,
    })
  })

// ── budget ────────────────────────────────────────────────────────────────────

const budgetCmd = program.command('budget').description('Manage spending budgets')

budgetCmd
  .command('set')
  .description('Set a budget')
  .option('--project <path>', 'Project path (omit for global)')
  .option('--period <period>', 'Period: daily|weekly|monthly', 'monthly')
  .option('--limit <usd>', 'Budget limit in USD')
  .option('--alert <percent>', 'Alert threshold %', '80')
  .option('--agent <agent>', 'Limit to agent (claude|takumi|codex|gemini)')
  .action((opts: { project?: string; period?: string; limit?: string; alert?: string; agent?: string }) => {
    const limitUsd = parsePositiveCliNumber(opts.limit, '--limit')
    const alertAtPercent = parsePositiveCliNumber(opts.alert ?? '80', '--alert')
    if (alertAtPercent > 100) fail('--alert must be between 1 and 100')
    const period = requireCliChoice(opts.period, '--period', ['daily', 'weekly', 'monthly'] as const)
    const agent = parseOptionalCliAgent(opts.agent) ?? null
    const db = openDatabase()
    const now = new Date().toISOString()
    upsertBudget(db, {
      id: randomUUID(),
      project_path: opts.project ?? null,
      agent,
      period,
      limit_usd: limitUsd,
      alert_at_percent: alertAtPercent,
      created_at: now,
      updated_at: now,
    })
    console.log(chalk.green(`✓ Budget set: ${opts.project ?? 'global'} — ${period} $${limitUsd}`))
  })

budgetCmd
  .command('list')
  .description('List all budgets')
  .action(() => {
    const db = openDatabase()
    const statuses = getBudgetStatuses(db)
    if (statuses.length === 0) { console.log(chalk.yellow('No budgets set.')); return }
    console.log()
    printTable(
      ['Scope', 'Period', 'Limit', 'Spent', 'Used%', 'Status'],
      statuses.map(b => {
        const pct = b.percent_used.toFixed(1)
        const status = b.is_over_limit ? chalk.red('OVER') : b.is_over_alert ? chalk.yellow('ALERT') : chalk.green('OK')
        const pctColor = b.is_over_limit ? chalk.red(pct + '%') : b.is_over_alert ? chalk.yellow(pct + '%') : chalk.green(pct + '%')
        return [
          chalk.white(b.project_path ?? 'global'),
          b.period,
          fmt(b.limit_usd),
          fmt(b.current_spend_usd),
          pctColor,
          status,
        ]
      }),
    )
    console.log()
  })

budgetCmd
  .command('remove <id>')
  .description('Remove a budget by ID')
  .action((id: string) => {
    const db = openDatabase()
    deleteBudget(db, id)
    console.log(chalk.green(`✓ Budget removed`))
  })

// ── project ───────────────────────────────────────────────────────────────────

const projectCmd = program.command('project').description('Manage tracked projects')

projectCmd
  .command('add <path>')
  .description('Add a project')
  .option('--name <name>', 'Human-readable name')
  .action((path: string, opts: { name?: string }) => {
    const db = openDatabase()
    const { basename } = require('path') as typeof import('path')
    upsertProject(db, {
      id: randomUUID(),
      path,
      name: opts.name ?? basename(path),
      description: null,
      tags: [],
      created_at: new Date().toISOString(),
    })
    console.log(chalk.green(`✓ Project added: ${path}`))
  })

projectCmd
  .command('list')
  .description('List all projects with costs')
  .action(() => {
    const db = openDatabase()
    const projects = queryProjectBreakdown(db)
    if (projects.length === 0) { console.log(chalk.yellow('No projects tracked yet.')); return }
    console.log()
    printTable(
      ['Project', 'Path', 'Sessions', 'Cost', 'Last Active'],
      projects.map(p => [
        chalk.white(p.project_name || chalk.dim('unknown')),
        chalk.dim(p.project_path.substring(0, 40)),
        String(p.sessions),
        fmt(p.cost_usd),
        chalk.dim(p.last_active?.substring(0, 16) ?? '—'),
      ]),
    )
    console.log()
  })

projectCmd
  .command('remove <path>')
  .description('Remove a project (keeps historical data)')
  .action((path: string) => {
    const db = openDatabase()
    deleteProject(db, path)
    console.log(chalk.green(`✓ Project removed`))
  })

projectCmd
  .command('rename <path> <name>')
  .description('Rename a project')
  .action((path: string, name: string) => {
    const db = openDatabase()
    const existing = getProject(db, path)
    if (!existing) { console.error(chalk.red('Project not found')); process.exit(1) }
    upsertProject(db, { ...existing, name })
    console.log(chalk.green(`✓ Renamed to: ${name}`))
  })

projectCmd
  .command('show <nameOrPath>')
  .description('Detailed project breakdown with sparkline')
  .action(async (nameOrPath: string) => {
    await autoSync()
    const db = openDatabase()
    // Find project by name or path substring
    const sessions = db.prepare(`SELECT * FROM sessions WHERE project_name LIKE ? OR project_path LIKE ? ORDER BY started_at DESC`).all(`%${nameOrPath}%`, `%${nameOrPath}%`) as Array<Record<string, unknown>>
    if (sessions.length === 0) { console.log(chalk.yellow(`No sessions found for: ${nameOrPath}`)); return }

    const projectName = sessions[0]!['project_name'] as string || nameOrPath
    const projectPath = sessions[0]!['project_path'] as string || ''
    const totalCost = sessions.reduce((s, r) => s + (r['total_cost_usd'] as number), 0)
    const totalTokens = sessions.reduce((s, r) => s + (r['total_tokens'] as number), 0)

    // Daily sparkline
    const daily = db.prepare(`
      SELECT DATE(r.timestamp) as d, SUM(r.cost_usd) as cost
      FROM requests r JOIN sessions s ON r.session_id = s.id
      WHERE (s.project_name LIKE ? OR s.project_path LIKE ?)
        AND r.timestamp >= DATE('now', '-14 days')
      GROUP BY d ORDER BY d ASC
    `).all(`%${nameOrPath}%`, `%${nameOrPath}%`) as Array<{ d: string; cost: number }>
    const dailyValues = daily.map(d => d.cost)

    // Model breakdown for project
    const models = db.prepare(`
      SELECT r.model, COUNT(*) as reqs, SUM(r.cost_usd) as cost
      FROM requests r JOIN sessions s ON r.session_id = s.id
      WHERE s.project_name LIKE ? OR s.project_path LIKE ?
      GROUP BY r.model ORDER BY cost DESC LIMIT 5
    `).all(`%${nameOrPath}%`, `%${nameOrPath}%`) as Array<{ model: string; reqs: number; cost: number }>

    console.log()
    console.log(chalk.bold.cyan(`  ${projectName}`))
    console.log(chalk.dim(`  ${projectPath}`))
    console.log()
    printTable(['Metric', 'Value'], [
      ['Total cost', fmt(totalCost)],
      ['Sessions', fmtCount(sessions.length)],
      ['Total tokens', fmtTokens(totalTokens)],
    ])
    if (dailyValues.length > 0) {
      console.log(`\n  ${chalk.dim('14-day trend:')} ${sparkline(dailyValues)}`)
    }
    if (models.length > 0) {
      console.log(`\n  ${chalk.dim('Model breakdown:')}`)
      for (const m of models) {
        console.log(`    ${chalk.white(m.model.padEnd(30))} ${fmt(m.cost)} (${fmtCount(m.reqs)} reqs)`)
      }
    }
    // Top 5 sessions
    const topSessions = sessions.sort((a, b) => (b['total_cost_usd'] as number) - (a['total_cost_usd'] as number)).slice(0, 5)
    if (topSessions.length > 0) {
      console.log(`\n  ${chalk.dim('Top sessions:')}`)
      for (const s of topSessions) {
        console.log(`    ${chalk.dim((s['id'] as string).substring(0, 12))}  ${fmt(s['total_cost_usd'] as number)}  ${chalk.dim(String(s['started_at']).substring(0, 16))}`)
      }
    }
    console.log()
  })

// ── config ────────────────────────────────────────────────────────────────────

const configCmd = program.command('config').description('Manage economy configuration')

configCmd
  .command('set <key> <value>')
  .description('Set a config value')
  .action(async (_key: string, _value: string) => {
    const { setConfigValue } = await import('../lib/config.js')
    setConfigValue(_key, _value)
    console.log(chalk.green(`✓ ${_key} = ${_value}`))
  })

configCmd
  .command('get <key>')
  .description('Get a config value')
  .action(async (key: string) => {
    const { getConfigValue } = await import('../lib/config.js')
    console.log(getConfigValue(key) ?? chalk.dim('(not set)'))
  })

configCmd
  .command('webhook-test')
  .description('Send a test payload to the configured webhook URL')
  .action(async () => {
    const { loadConfig } = await import('../lib/config.js')
    const config = loadConfig()
    const url = config['webhook-url'] as string | undefined
    if (!url) { console.log(chalk.yellow('No webhook-url configured. Run: economy config set webhook-url <url>')); return }
    const payload = {
      event: 'test',
      message: 'Economy webhook test',
      timestamp: new Date().toISOString(),
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      })
      const text = await res.text().catch(() => '')
      if (res.ok) {
        console.log(chalk.green(`✓ Webhook responded: HTTP ${res.status}`))
        if (text) console.log(chalk.dim(text.slice(0, 200)))
      } else {
        console.log(chalk.red(`✗ Webhook failed: HTTP ${res.status}`))
        if (text) console.log(chalk.dim(text.slice(0, 200)))
      }
    } catch (e) {
      console.log(chalk.red(`✗ Request failed: ${e instanceof Error ? e.message : String(e)}`))
    }
  })

configCmd
  .action(async () => {
    const { loadConfig } = await import('../lib/config.js')
    const config = loadConfig()
    console.log()
    printTable(['Key', 'Value'], Object.entries(config).map(([k, v]) => [k, String(v)]))
    console.log()
  })

// ── pricing ───────────────────────────────────────────────────────────────────

const pricingCmd = program.command('pricing').description('Manage model pricing rates')

pricingCmd
  .command('list')
  .description('List all model prices')
  .action(() => {
    const db = openDatabase()
    ensurePricingSeeded(db)
    const rows = listModelPricing(db)
    console.log()
    printTable(
      ['Model', 'Input/1M', 'Output/1M', 'CacheR/1M', 'CacheW/1M', 'CacheStorage/1M-h', 'Out/1k'],
      rows.map(r => [
        chalk.white(r.model),
        fmt(r.input_per_1m),
        fmt(r.output_per_1m),
        fmt(r.cache_read_per_1m),
        r.cache_write_1h_per_1m ? `${fmt(r.cache_write_per_1m)} / ${fmt(r.cache_write_1h_per_1m)}` : fmt(r.cache_write_per_1m),
        fmt(r.cache_storage_per_1m_hour ?? 0),
        chalk.dim(fmt(r.output_per_1m / 1000)),
      ]),
    )
    console.log()
  })

pricingCmd
  .command('set <model>')
  .description('Set pricing for a model')
  .option('--input <usd>', 'Input price per 1M tokens')
  .option('--output <usd>', 'Output price per 1M tokens')
  .option('--cache-read <usd>', 'Cache read price per 1M tokens', '0')
  .option('--cache-write <usd>', '5-minute cache write price per 1M tokens', '0')
  .option('--cache-write-1h <usd>', '1-hour cache write price per 1M tokens', '0')
  .option('--cache-storage <usd>', 'Context cache storage price per 1M token-hours', '0')
  .action((model: string, opts: { input?: string; output?: string; cacheRead?: string; cacheWrite?: string; cacheWrite1h?: string; cacheStorage?: string }) => {
    const input = parseNonNegativeCliNumber(opts.input, '--input')
    const output = parseNonNegativeCliNumber(opts.output, '--output')
    const cacheRead = parseNonNegativeCliNumber(opts.cacheRead ?? '0', '--cache-read')
    const cacheWrite = parseNonNegativeCliNumber(opts.cacheWrite ?? '0', '--cache-write')
    const cacheWrite1h = parseNonNegativeCliNumber(opts.cacheWrite1h ?? '0', '--cache-write-1h')
    const cacheStorage = parseNonNegativeCliNumber(opts.cacheStorage ?? '0', '--cache-storage')
    const db = openDatabase()
    ensurePricingSeeded(db)
    upsertModelPricing(db, {
      model,
      input_per_1m: input,
      output_per_1m: output,
      cache_read_per_1m: cacheRead,
      cache_write_per_1m: cacheWrite,
      cache_write_1h_per_1m: cacheWrite1h,
      cache_storage_per_1m_hour: cacheStorage,
      updated_at: new Date().toISOString(),
    })
    console.log(chalk.green(`✓ Pricing updated for ${model}`))
  })

pricingCmd
  .command('remove <model>')
  .description('Remove pricing for a model')
  .action((model: string) => {
    const db = openDatabase()
    deleteModelPricing(db, model)
    console.log(chalk.green(`✓ Pricing removed for ${model}`))
  })

// ── serve ─────────────────────────────────────────────────────────────────────

program
  .command('serve')
  .description('Start the REST API server')
  .option('-p, --port <port>', 'Port', '3456')
  .action(async (opts: { port?: string }) => {
    const port = parseCliPort(opts.port ?? '3456', '--port')
    const { startServer } = await import('../server/serve.js')
    try {
      startServer(port)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  })

// ── dashboard ─────────────────────────────────────────────────────────────────

program
  .command('dashboard')
  .description('Open the web dashboard (auto-starts server if not running)')
  .option('-p, --port <port>', 'Server port', '3456')
  .action(async (opts: { port?: string }) => {
    const port = parseCliPort(opts.port ?? '3456', '--port')
    const { getServeApiToken } = await import('../lib/serve-auth.js')
    const token = getServeApiToken()
    if (!token) {
      console.error('ECONOMY_API_TOKEN or HASNA_ECONOMY_API_TOKEN is required to start the dashboard server')
      process.exitCode = 1
      return
    }
    const url = `http://localhost:${port}`
    const dashboardUrl = `${url}/#token=${encodeURIComponent(token)}`

    // Check if server is already running
    let serverRunning = false
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) })
      serverRunning = res.ok
    } catch { /* not running */ }

    if (!serverRunning) {
      console.log(chalk.cyan(`→ Starting economy server on port ${port}...`))
      // Spawn server as detached background process
      const { spawn } = await import('child_process')
      const { resolve, dirname } = await import('path')
      // Resolve serve script relative to this CLI binary
      const serveScript = resolve(dirname(process.argv[1]!), '..', 'server', 'index.js')
      const child = spawn(process.execPath, [serveScript], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ECONOMY_PORT: String(port) },
      })
      child.unref()
      // Wait for it to start
      let attempts = 0
      while (attempts < 20) {
        await new Promise(r => setTimeout(r, 250))
        try {
          const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(300) })
          if (res.ok) { serverRunning = true; break }
        } catch { /* wait */ }
        attempts++
      }
      if (serverRunning) {
        console.log(chalk.green(`✓ Server started`))
      } else {
        console.log(chalk.yellow(`⚠ Server didn't respond — open ${url} manually after running \`economy serve\``))
      }
    }

    console.log(chalk.cyan(`Opening ${url}`))
    try {
      execSync(`open ${JSON.stringify(dashboardUrl)}`)
    } catch {
      console.log(chalk.yellow(`Open your browser at ${dashboardUrl}`))
    }
  })

// ── mcp ───────────────────────────────────────────────────────────────────────

program
  .command('mcp')
  .description('Show MCP server install commands')
  .option('--claude', 'Install into Claude Code')
  .option('--codex', 'Install into Codex')
  .option('--gemini', 'Install into Gemini CLI')
  .option('--all', 'Install into all agents')
  .action(async (opts: { claude?: boolean; codex?: boolean; gemini?: boolean; all?: boolean }) => {
    const doAll = opts.all || (!opts.claude && !opts.codex && !opts.gemini)
    if (opts.claude || doAll) {
      console.log(chalk.bold.cyan('\nClaude Code:'))
      console.log(chalk.white('  claude mcp add --transport stdio --scope user economy -- economy-mcp'))
    }
    if (opts.codex || doAll) {
      console.log(chalk.bold.yellow('\nCodex (~/.codex/config.toml):'))
      console.log(chalk.white('  [mcp_servers.economy]\n  command = "economy-mcp"\n  args = []'))
    }
    if (opts.gemini || doAll) {
      console.log(chalk.bold.green('\nGemini (~/.gemini/settings.json):'))
      console.log(chalk.white('  "mcpServers": { "economy": { "command": "economy-mcp", "args": [] } }'))
    }
    console.log()
  })

// ── session detail ────────────────────────────────────────────────────────────

program
  .command('session <id>')
  .description('Show detailed breakdown of a single session')
  .action(async (id: string) => {
    await autoSync()
    const db = openDatabase()
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ? OR id LIKE ?`).get(id, `%${id}%`) as Record<string, unknown> | null
    if (!session) { console.log(chalk.red(`Session not found: ${id}`)); process.exit(1) }
    const requests = db.prepare(`SELECT * FROM requests WHERE session_id = ? ORDER BY timestamp ASC`).all(session['id'] as string) as Array<Record<string, unknown>>

    console.log()
    console.log(chalk.bold.cyan(`  Session: ${(session['id'] as string).substring(0, 16)}...`))
    console.log()
    printTable(['Field', 'Value'], [
      ['Agent', String(session['agent'])],
      ['Project', String(session['project_name'] || session['project_path'] || '—')],
      ['Started', String(session['started_at']).substring(0, 19)],
      ['Ended', session['ended_at'] ? String(session['ended_at']).substring(0, 19) : '—'],
      ['Total cost', fmt(session['total_cost_usd'] as number)],
      ['Total tokens', fmtTokens(session['total_tokens'] as number)],
      ['Requests', fmtCount(session['request_count'] as number)],
    ])

    if (requests.length > 0) {
      console.log(chalk.dim(`\n  Requests (${requests.length}):\n`))
      printTable(
        ['Time', 'Model', 'Input', 'Output', 'Cache R', 'Cache W', 'Cost'],
        requests.slice(0, 50).map(r => [
          chalk.dim(String(r['timestamp']).substring(11, 19)),
          chalk.white(String(r['model']).substring(0, 22)),
          fmtTokens(r['input_tokens'] as number),
          fmtTokens(r['output_tokens'] as number),
          fmtTokens(r['cache_read_tokens'] as number),
          fmtTokens(r['cache_create_tokens'] as number),
          fmt(r['cost_usd'] as number),
        ]),
      )
      if (requests.length > 50) console.log(chalk.dim(`  ... and ${requests.length - 50} more requests`))
    }
    console.log()
  })

// ── machines ─────────────────────────────────────────────────────────────────

program
  .command('machines')
  .description('List all machines that have synced data')
  .action(async () => {
    await autoSync()
    const db = openDatabase()
    const machines = listMachines(db)
    const current = getMachineId()
    if (machines.length === 0) {
      console.log(chalk.yellow(`No machine data yet. Current machine: ${current}`))
      return
    }
    console.log()
    console.log(chalk.bold.cyan('  Machines'))
    console.log()
    printTable(
      ['Machine', 'Sessions', 'Requests', 'Cost', 'Last Active'],
      machines.map(m => [
        m.machine_id === current ? chalk.green(`${m.machine_id} (this)`) : chalk.white(m.machine_id),
        fmtCount(m.sessions),
        fmtCount(m.requests),
        fmt(m.total_cost_usd),
        chalk.dim(m.last_active?.substring(0, 16) ?? '—'),
      ]),
    )
    console.log(`\n  ${chalk.dim('Current machine:')} ${chalk.bold(current)}`)
    console.log()
  })

program
  .command('merge-db <source-db>')
  .description('Merge another Economy SQLite database into this machine')
  .option('--source-machine <id>', 'Machine id to use for source rows that do not have one')
  .option('--json', 'Output JSON')
  .action((sourceDb: string, opts: { sourceMachine?: string; json?: boolean }) => {
    const db = openDatabase()
    const result = mergePeerDatabase(db, sourceDb, { sourceMachine: opts.sourceMachine })
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    console.log()
    console.log(chalk.bold.cyan(`  Merged Economy DB — ${result.source_machine}`))
    console.log(`  Rows written: ${fmtCount(result.rows_written)} · collisions remapped: ${fmtCount(result.collisions)} · deduped: ${fmtCount(result.deduped)}`)
    for (const table of result.tables) {
      console.log(
        `  ${chalk.white(table.table.padEnd(16))}`
        + ` inserted ${fmtCount(table.inserted).padStart(6)}`
        + `  updated ${fmtCount(table.updated).padStart(6)}`
        + `  skipped ${fmtCount(table.skipped).padStart(6)}`
        + `  collisions ${fmtCount(table.collisions).padStart(3)}`,
      )
    }
    console.log()
  })

// ── export ────────────────────────────────────────────────────────────────────

program
  .command('export')
  .description('Export data as CSV')
  .option('--type <type>', 'Data type: sessions or requests', 'sessions')
  .option('--period <period>', 'Period: today|week|month|all', 'month')
  .option('--output <file>', 'Output file path (default: stdout)')
  .action(async (opts: { type?: string; period?: string; output?: string }) => {
    await autoSync()
    const db = openDatabase()
    let csv: string

    if (opts.type === 'requests') {
      const where = opts.period === 'today' ? `DATE(timestamp) = DATE('now')`
        : opts.period === 'week' ? `timestamp >= DATE('now', '-7 days')`
        : opts.period === 'all' ? '1=1'
        : `timestamp >= DATE('now', '-30 days')`
      const rows = db.prepare(`SELECT * FROM requests WHERE ${where} ORDER BY timestamp ASC`).all() as Array<Record<string, unknown>>
      csv = 'id,agent,session_id,model,input_tokens,output_tokens,cache_read_tokens,cache_create_tokens,cost_usd,duration_ms,timestamp\n'
      for (const r of rows) {
        csv += `${r['id']},${r['agent']},${r['session_id']},${r['model']},${r['input_tokens']},${r['output_tokens']},${r['cache_read_tokens']},${r['cache_create_tokens']},${r['cost_usd']},${r['duration_ms']},${r['timestamp']}\n`
      }
    } else {
      const where = opts.period === 'today' ? `DATE(started_at) = DATE('now')`
        : opts.period === 'week' ? `started_at >= DATE('now', '-7 days')`
        : opts.period === 'all' ? '1=1'
        : `started_at >= DATE('now', '-30 days')`
      const rows = db.prepare(`SELECT * FROM sessions WHERE ${where} ORDER BY started_at DESC`).all() as Array<Record<string, unknown>>
      csv = 'id,agent,project_path,project_name,started_at,ended_at,total_cost_usd,total_tokens,request_count\n'
      for (const r of rows) {
        csv += `${r['id']},${r['agent']},"${r['project_path']}","${r['project_name']}",${r['started_at']},${r['ended_at'] ?? ''},${r['total_cost_usd']},${r['total_tokens']},${r['request_count']}\n`
      }
    }

    if (opts.output) {
      const { writeFileSync } = await import('fs')
      writeFileSync(opts.output, csv)
      console.log(chalk.green(`✓ Exported to ${opts.output}`))
    } else {
      process.stdout.write(csv)
    }
  })

// ── compare ───────────────────────────────────────────────────────────────────

program
  .command('compare <period1> <period2>')
  .description('Compare two periods (today/yesterday/week/lastweek/month/lastmonth)')
  .action(async (p1: string, p2: string) => {
    await autoSync()
    const db = openDatabase()

    function dateRange(period: string): [string, string] {
      const now = new Date()
      const today = now.toISOString().substring(0, 10)
      switch (period) {
        case 'today': return [today, today]
        case 'yesterday': {
          const d = new Date(now); d.setDate(d.getDate() - 1)
          const s = d.toISOString().substring(0, 10)
          return [s, s]
        }
        case 'week': {
          const d = new Date(now); d.setDate(d.getDate() - 7)
          return [d.toISOString().substring(0, 10), today]
        }
        case 'lastweek': {
          const d1 = new Date(now); d1.setDate(d1.getDate() - 14)
          const d2 = new Date(now); d2.setDate(d2.getDate() - 7)
          return [d1.toISOString().substring(0, 10), d2.toISOString().substring(0, 10)]
        }
        case 'month': {
          const d = new Date(now); d.setDate(d.getDate() - 30)
          return [d.toISOString().substring(0, 10), today]
        }
        case 'lastmonth': {
          const d1 = new Date(now); d1.setDate(d1.getDate() - 60)
          const d2 = new Date(now); d2.setDate(d2.getDate() - 30)
          return [d1.toISOString().substring(0, 10), d2.toISOString().substring(0, 10)]
        }
        default: return [today, today]
      }
    }

    function queryRange(from: string, to: string) {
      const r = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as requests, COALESCE(SUM(input_tokens+output_tokens+cache_read_tokens+cache_create_tokens),0) as tokens FROM requests WHERE DATE(timestamp) BETWEEN ? AND ?`).get(from, to) as { cost: number; requests: number; tokens: number }
      const s = db.prepare(`SELECT COUNT(*) as sessions FROM sessions WHERE DATE(started_at) BETWEEN ? AND ?`).get(from, to) as { sessions: number }
      return { ...r, sessions: s.sessions }
    }

    const [f1, t1] = dateRange(p1)
    const [f2, t2] = dateRange(p2)
    const a = queryRange(f1, t1)
    const b = queryRange(f2, t2)

    function delta(v1: number, v2: number): string {
      const d = v1 - v2
      const pct = v2 > 0 ? ((d / v2) * 100).toFixed(1) : '—'
      const sign = d >= 0 ? '+' : ''
      const color = d > 0 ? chalk.red : d < 0 ? chalk.green : chalk.dim
      return color(`${sign}${pct}%`)
    }

    console.log()
    console.log(chalk.bold.cyan(`  ${p1} vs ${p2}`))
    console.log()
    printTable(
      ['Metric', p1, p2, 'Change'],
      [
        ['Cost', fmt(a.cost), fmt(b.cost), delta(a.cost, b.cost)],
        ['Sessions', fmtCount(a.sessions), fmtCount(b.sessions), delta(a.sessions, b.sessions)],
        ['Requests', fmtCount(a.requests), fmtCount(b.requests), delta(a.requests, b.requests)],
        ['Tokens', fmtTokens(a.tokens), fmtTokens(b.tokens), delta(a.tokens, b.tokens)],
      ],
    )
    console.log()
  })

// ── forecast ──────────────────────────────────────────────────────────────────

program
  .command('forecast')
  .description('Project end-of-month cost based on current burn rate')
  .action(async () => {
    await autoSync()
    const db = openDatabase()

    const now = new Date()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const dayOfMonth = now.getDate()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    const monthSoFar = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) as cost FROM requests WHERE DATE(timestamp) >= ?`).get(monthStart) as { cost: number }
    const dailyAvg = dayOfMonth > 0 ? monthSoFar.cost / dayOfMonth : 0
    const projected = dailyAvg * daysInMonth

    // Last 7 days rate
    const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const last7 = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) as cost FROM requests WHERE DATE(timestamp) >= ?`).get(sevenDaysAgo.toISOString().substring(0, 10)) as { cost: number }
    const last7DailyAvg = last7.cost / 7
    const last7Projected = last7DailyAvg * daysInMonth

    // Min/max day
    const dailyCosts = db.prepare(`SELECT DATE(timestamp) as d, SUM(cost_usd) as cost FROM requests WHERE DATE(timestamp) >= ? GROUP BY d ORDER BY cost ASC`).all(monthStart) as Array<{ d: string; cost: number }>
    const cheapest = dailyCosts[0]
    const mostExpensive = dailyCosts[dailyCosts.length - 1]

    console.log()
    console.log(chalk.bold.cyan(`  Forecast (${dayOfMonth} of ${daysInMonth} days)`))
    console.log()
    printTable(['Metric', 'Value'], [
      ['Spent so far', fmt(monthSoFar.cost)],
      ['Daily average', fmt(dailyAvg)],
      [chalk.bold('Projected total'), chalk.bold(fmt(projected).replace(chalk.green(''), ''))],
      ['Last 7-day rate', `${fmt(last7DailyAvg)}/day → ${fmt(last7Projected)}`],
      ['Cheapest day', cheapest ? `${fmt(cheapest.cost)} (${cheapest.d})` : '—'],
      ['Most expensive', mostExpensive ? `${fmt(mostExpensive.cost)} (${mostExpensive.d})` : '—'],
    ])
    console.log()
  })

// ── efficiency ────────────────────────────────────────────────────────────────

program
  .command('efficiency')
  .description('Show output/input token ratio per model')
  .action(async () => {
    await autoSync()
    const db = openDatabase()
    const models = db.prepare(`
      SELECT model, SUM(input_tokens) as input, SUM(output_tokens) as output,
             SUM(cache_read_tokens) as cache_read, SUM(cache_create_tokens) as cache_write,
             COUNT(*) as requests, SUM(cost_usd) as cost
      FROM requests GROUP BY model ORDER BY cost DESC
    `).all() as Array<{ model: string; input: number; output: number; cache_read: number; cache_write: number; requests: number; cost: number }>

    console.log()
    console.log(chalk.bold.cyan('  Token Efficiency'))
    console.log()
    printTable(
      ['Model', 'Output/Input', 'Cache Hit%', 'Cost/1k Output', 'Requests'],
      models.map(m => {
        const ratio = m.input > 0 ? (m.output / m.input).toFixed(2) : '—'
        const totalInput = m.input + m.cache_read + m.cache_write
        const cacheHit = totalInput > 0 ? ((m.cache_read / totalInput) * 100).toFixed(1) + '%' : '—'
        const costPer1kOutput = m.output > 0 ? fmt((m.cost / m.output) * 1000) : '—'
        return [chalk.white(m.model), ratio, cacheHit, costPer1kOutput, fmtCount(m.requests)]
      }),
    )
    console.log()
  })

// ── menubar ───────────────────────────────────────────────────────────────────

const menubarCmd = program.command('menubar').description('Manage the Economy Bar macOS menubar app')

menubarCmd
  .command('install')
  .description('Download and install Economy Bar from GitHub Releases')
  .option('--force', 'Overwrite existing installation')
  .action(async (opts: { force?: boolean }) => {
    const { menubarInstall } = await import('./commands/menubar.js')
    await menubarInstall(opts)
  })

menubarCmd
  .command('uninstall')
  .description('Quit and remove Economy Bar from /Applications')
  .action(async () => {
    const { menubarUninstall } = await import('./commands/menubar.js')
    menubarUninstall()
  })

menubarCmd
  .command('start')
  .description('Launch Economy Bar')
  .action(async () => {
    const { menubarStart } = await import('./commands/menubar.js')
    menubarStart()
  })

menubarCmd
  .command('stop')
  .description('Quit Economy Bar')
  .action(async () => {
    const { menubarStop } = await import('./commands/menubar.js')
    menubarStop()
  })

// ── goal ──────────────────────────────────────────────────────────────────────

const goalCmd = program.command('goal').description('Manage spending goals')

goalCmd
  .command('set')
  .description('Set a spending goal')
  .option('--period <period>', 'Period: day|week|month|year', 'month')
  .option('--limit <usd>', 'Goal limit in USD')
  .option('--project <path>', 'Scope to project path')
  .option('--agent <agent>', 'Scope to agent')
  .action((opts: { period?: string; limit?: string; project?: string; agent?: string }) => {
    const limitUsd = parsePositiveCliNumber(opts.limit, '--limit')
    const period = requireCliChoice(opts.period, '--period', ['day', 'week', 'month', 'year'] as const)
    const agent = parseOptionalCliAgent(opts.agent) ?? null
    const db = openDatabase()
    const now = new Date().toISOString()
    upsertGoal(db, {
      id: randomUUID(),
      period,
      project_path: opts.project ?? null,
      agent,
      limit_usd: limitUsd,
      created_at: now,
      updated_at: now,
    })
    console.log(chalk.green(`✓ Goal set: ${period} $${limitUsd}${opts.project ? ` (${opts.project})` : ''}`))
  })

goalCmd
  .command('list')
  .description('List all goals with progress')
  .action(() => {
    const db = openDatabase()
    const statuses = getGoalStatuses(db)
    if (statuses.length === 0) { console.log(chalk.yellow('No goals set.')); return }
    console.log()
    printTable(
      ['Period', 'Scope', 'Limit', 'Spent', 'Used%', 'Status'],
      statuses.map(g => {
        const pct = g.percent_used.toFixed(1)
        const scope = g.project_path ?? g.agent ?? 'global'
        const status = g.is_over ? chalk.red('OVER') : g.is_at_risk ? chalk.yellow('AT RISK') : chalk.green('ON TRACK')
        const pctColor = g.is_over ? chalk.red(pct + '%') : g.is_at_risk ? chalk.yellow(pct + '%') : chalk.green(pct + '%')
        return [
          g.period,
          chalk.white(scope),
          fmt(g.limit_usd),
          fmt(g.current_spend_usd),
          pctColor,
          status,
        ]
      }),
    )
    console.log()
  })

goalCmd
  .command('remove <id>')
  .description('Remove a goal')
  .action((id: string) => {
    const db = openDatabase()
    deleteGoal(db, id)
    console.log(chalk.green(`✓ Goal removed`))
  })

goalCmd
  .command('status')
  .description('Quick goal progress summary')
  .action(() => {
    const db = openDatabase()
    const statuses = getGoalStatuses(db)
    if (statuses.length === 0) { console.log(chalk.yellow('No goals set.')); return }
    console.log()
    for (const g of statuses) {
      const scope = g.project_path ?? g.agent ?? 'global'
      const pct = Math.min(g.percent_used, 100)
      const barFilled = Math.round(pct / 10)
      const barEmpty = 10 - barFilled
      const bar = '█'.repeat(barFilled) + '░'.repeat(barEmpty)
      const statusStr = g.is_over
        ? chalk.red('✗ OVER')
        : g.is_at_risk
        ? chalk.yellow('⚠ AT RISK')
        : chalk.green('✓ ON TRACK')
      const label = `${g.period} (${scope})`.padEnd(20)
      console.log(`  ${label}  ${bar}  ${fmt(g.current_spend_usd)} / ${fmt(g.limit_usd)}  (${g.percent_used.toFixed(0)}%)  ${statusStr}`)
    }
    console.log()
  })

// Top-level remove/uninstall — delegates to budget/project/goal/pricing remove
program
  .command('remove <type> <id>')
  .alias('rm')
  .description('Remove a record. Type: budget | project | goal | pricing')
  .action((type: string, id: string) => {
    const db = openDatabase()
    try {
      switch (type.toLowerCase()) {
        case 'budget':
          deleteBudget(db, id)
          console.log(chalk.green(`✓ Budget ${id} removed`))
          break
        case 'project':
          deleteProject(db, id)
          console.log(chalk.green(`✓ Project ${id} removed`))
          break
        case 'goal':
          deleteGoal(db, id)
          console.log(chalk.green(`✓ Goal ${id} removed`))
          break
        case 'pricing':
          deleteModelPricing(db, id)
          console.log(chalk.green(`✓ Pricing entry ${id} removed`))
          break
        default:
          console.error(chalk.red(`Unknown type: ${type}. Use: budget | project | goal | pricing`))
          process.exit(1)
      }
    } catch (e) {
      console.error(chalk.red(`Failed: ${e instanceof Error ? e.message : String(e)}`))
      process.exit(1)
    }
  })

// ── cloud ────────────────────────────────────────────────────────────────────

const cloudCmd = program.command('cloud').description('Cross-machine sync via cloud PostgreSQL')

cloudCmd
  .command('push')
  .description('Push local economy data to cloud PostgreSQL')
  .option('--tables <tables>', 'Comma-separated table names (default: all)')
  .action(async (opts: { tables?: string }) => {
    const tableList = opts.tables ? opts.tables.split(',').map(t => t.trim()) : undefined
    process.stdout.write(chalk.cyan('→ Pushing to cloud... '))
    const r = await cloudPush({ tables: tableList })
    console.log(chalk.green(`✓ ${r.rows} rows from ${r.machine}`))
  })

cloudCmd
  .command('pull')
  .description('Pull cloud PostgreSQL data to local')
  .option('--tables <tables>', 'Comma-separated table names (default: all)')
  .action(async (opts: { tables?: string }) => {
    const tableList = opts.tables ? opts.tables.split(',').map(t => t.trim()) : undefined
    process.stdout.write(chalk.cyan('→ Pulling from cloud... '))
    const r = await cloudPull({ tables: tableList })
    console.log(chalk.green(`✓ ${r.rows} rows to ${r.machine}`))
  })

cloudCmd
  .command('sync')
  .description('Full sync: ingest local → push to cloud → pull from cloud')
  .action(async () => {
    console.log(chalk.bold.cyan(`  Cloud Sync — ${getMachineId()}\n`))
    process.stdout.write(chalk.cyan('→ Ingesting local data... '))
    await autoSync()
    console.log(chalk.green('✓'))
    process.stdout.write(chalk.cyan('→ Cloud round-trip... '))
    const r = await cloudSyncFull()
    console.log(chalk.green(`✓ push ${r.push} / pull ${r.pull}`))
    console.log(chalk.bold.green('\n✓ Cloud sync complete'))
  })

cloudCmd
  .command('status')
  .description('Check cloud connection and fleet machine registry')
  .action(async () => {
    console.log()
    console.log(`  Machine: ${chalk.white(getMachineId())}`)
    console.log(`  Cloud URL: ${chalk.white(getCloudDatabaseUrl() ?? '(not set — export ECONOMY_CLOUD_DATABASE_URL)')}`)
    const registry = listMachineRegistry(openDatabase())
    if (registry.length > 0) {
      console.log(chalk.dim('\n  Fleet registry:'))
      for (const m of registry) {
        console.log(`    ${m.machine_id.padEnd(12)} push ${m.last_push_at?.substring(0, 16) ?? '—'}  pull ${m.last_pull_at?.substring(0, 16) ?? '—'}`)
      }
    }
    try {
      const cloud = await getCloudPg()
      await cloud.get('SELECT 1 as ok')
      const tables = await cloud.all("SELECT tablename FROM pg_tables WHERE schemaname = 'public'") as Array<{ tablename: string }>
      console.log(`\n  PostgreSQL: ${chalk.green('connected')}`)
      console.log(`  Tables: ${chalk.white(tables.map(t => t.tablename).join(', ') || '(none)')}`)
      await cloud.close()
    } catch (err: unknown) {
      console.log(`\n  PostgreSQL: ${chalk.red(`failed — ${err instanceof Error ? err.message : String(err)}`)}`)
    }
    console.log()
  })

// ── billing ──────────────────────────────────────────────────────────────────

const billingCmd = program.command('billing').description('Pull actual billing from provider billing sources (ground truth)')

billingCmd
  .command('sync')
  .description('Sync actual billing from Anthropic, OpenAI, and Gemini billing sources')
  .option('--days <n>', 'Days of history to fetch', '31')
  .option('--anthropic', 'Only sync Anthropic')
  .option('--openai', 'Only sync OpenAI')
  .option('--gemini', 'Only sync Gemini')
  .action(async (opts: { days?: string; anthropic?: boolean; openai?: boolean; gemini?: boolean }) => {
    const days = parsePositiveCliInteger(opts.days ?? '31', '--days')
    if (days > 366) fail('--days must be between 1 and 366')
    const db = openDatabase()
    const doAll = !opts.anthropic && !opts.openai && !opts.gemini

    if (opts.anthropic || doAll) {
      process.stdout.write(chalk.cyan('→ Syncing Anthropic billing... '))
      try {
        const r = await syncAnthropicBilling(db, { days })
        console.log(chalk.green(`✓ ${r.days} days, $${r.totalUsd.toFixed(2)}`))
      } catch (e) {
        console.log(chalk.red(`✗ ${e instanceof Error ? e.message : String(e)}`))
      }
    }
    if (opts.openai || doAll) {
      process.stdout.write(chalk.cyan('→ Syncing OpenAI billing... '))
      try {
        const r = await syncOpenAIBilling(db, { days })
        console.log(chalk.green(`✓ ${r.days} days, $${r.totalUsd.toFixed(2)}`))
      } catch (e) {
        console.log(chalk.red(`✗ ${e instanceof Error ? e.message : String(e)}`))
      }
    }
    if (opts.gemini || doAll) {
      process.stdout.write(chalk.cyan('→ Syncing Gemini billing... '))
      try {
        const r = await syncGeminiBilling(db, { days })
        if (r.skipped) {
          console.log(chalk.yellow(`skipped — ${r.skipped}`))
        } else {
          console.log(chalk.green(`✓ ${r.days} days, $${r.totalUsd.toFixed(2)}`))
        }
      } catch (e) {
        console.log(chalk.red(`✗ ${e instanceof Error ? e.message : String(e)}`))
      }
    }
  })

billingCmd
  .command('show')
  .description('Show actual billing totals vs our estimated costs')
  .option('--period <p>', 'Period: today|yesterday|week|month|year|all', 'month')
  .action((opts: { period?: string }) => {
    const db = openDatabase()
    const period = (opts.period ?? 'month') as Period
    const actual = queryBillingSummary(db, period)
    const estimated = querySummary(db, period)
    console.log()
    console.log(chalk.bold.cyan(`  Billing ${period} (actual from admin APIs)\n`))
    printTable(
      ['Provider', 'Actual (billed)'],
      Object.entries(actual.by_provider).map(([p, c]) => [chalk.white(p), fmt(c)]),
    )
    console.log()
    console.log(`  ${chalk.bold('Actual total:')}    ${fmt(actual.total_usd)}`)
    console.log(`  ${chalk.dim('Our estimate:')}    ${fmt(estimated.total_usd)}`)
    const diff = estimated.total_usd - actual.total_usd
    const pct = actual.total_usd > 0 ? (diff / actual.total_usd) * 100 : 0
    console.log(`  ${chalk.dim('Difference:')}      ${fmt(Math.abs(diff))} (${diff >= 0 ? '+' : ''}${pct.toFixed(1)}%)`)
    console.log()
  })

// ── brains ─────────────────────────────────────────────────────────────────────

registerBrainsCommand(program)
registerTodosCommand(program)
registerExtendedCommands(program)
registerFleetCommands(program)

registerEventsCommands(program, { source: 'economy' })

program.parse()
