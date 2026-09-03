#!/usr/bin/env bun
import { Command } from 'commander'
import { registerEventsCommands } from '@hasna/events/commander'
import chalk from 'chalk'
import { registerTodosCommand } from './commands/todos.js'
import { registerExtendedCommands, registerFleetCommands } from './commands/extras.js'
import { registerBriefCommand } from './commands/brief.js'
import { AGENTS, parseAgent } from '../lib/agents.js'
import { syncAll } from '../lib/sync-all.js'
import type { Agent } from '../lib/agents.js'
import { openDatabase, getMachineId } from '../db/database.js'
import { syncAnthropicBilling, syncOpenAIBilling, syncGeminiBilling } from '../ingest/billing.js'
import { packageMetadata } from '../lib/package-metadata.js'
import { ensurePricingSeeded } from '../lib/pricing.js'
import { execSync } from 'child_process'
import { getStore, isCloudStore } from '../lib/store/index.js'
import { syncAllToCloud, billingSyncToCloud } from '../lib/cloud-ingest.js'
import { economyCloudStorage } from '../lib/cloud-storage.js'
import { backfillMachineId, recalculateZeroCostRequests } from '../lib/sync-maintenance.js'
import { billingDeltaPct } from '../lib/billing-diff.js'
import { autoSyncDue, markAutoSync } from '../lib/autosync-gate.js'
import { HasnaHttpError } from '../lib/contracts-client/transport.js'
import type { AccountBreakdown, CostSummary, CostCenterKind, ProjectBreakdown, Period } from '../types/index.js'

const program = new Command()

program
  .name('economy')
  .description('AI coding cost tracker — Claude, Takumi, Codex, Gemini, OpenCode, Cursor, Pi, Hermes')
  .version(packageMetadata.version)

// ── Auto-sync helper ──────────────────────────────────────────────────────────

async function autoSync(opts: { claude?: boolean; takumi?: boolean; codex?: boolean; gemini?: boolean; opencode?: boolean; cursor?: boolean; pi?: boolean; hermes?: boolean; loops?: boolean; verbose?: boolean; dedupe?: boolean } = {}): Promise<void> {
  // Staleness gate: the full ingest walks every on-box provider file (the
  // claude corpus alone can hold tens of thousands of session jsonl files),
  // which takes minutes on a grown machine — every read-only verb would hang
  // before answering. Auto-sync at most once per interval (default 10 min,
  // HASNA_ECONOMY_AUTOSYNC_INTERVAL seconds, 0 = always sync); the explicit
  // `economy sync` verb always runs the full ingest.
  if (!autoSyncDue(undefined, process.env)) return

  // self_hosted/cloud mode: ingest this machine's on-box provider files into
  // the shared API first; the reads that follow come straight from the cloud.
  if (isCloudStore()) {
    const cloud = economyCloudStorage()
    if (cloud.active) {
      await syncAllToCloud(cloud, opts)
      markAutoSync(undefined, process.env)
    }
    return
  }
  const db = openDatabase()
  ensurePricingSeeded(db)
  await syncAll(db, opts)
  markAutoSync(db, process.env)
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

function resolveRowLimit(value: string | undefined, verbose: boolean | undefined, fallback: number): number {
  if (verbose && value == null) return Number.POSITIVE_INFINITY
  return parsePositiveCliInteger(value ?? String(fallback), '--limit')
}

function printHiddenRowsHint(total: number, shown: number, detail: string): void {
  if (total <= shown) return
  console.log(chalk.dim(`  ... ${total - shown} more rows hidden. ${detail}`))
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

async function printSummary(label: string, period: Period): Promise<void> {
  const s = await getStore().summary(period)
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
  const store = getStore()
  let t: CostSummary, w: CostSummary, m: CostSummary
  let projects: ProjectBreakdown[]
  let dailyValues: number[]
  ;[t, w, m] = await Promise.all([
    store.summary('today'),
    store.summary('week'),
    store.summary('month'),
  ])
  projects = (await store.projectBreakdown()).slice(0, 3)
  const daily = (await store.daily(14)).reduce((acc, d) => {
    acc[d.date] = (acc[d.date] ?? 0) + d.cost_usd
    return acc
  }, {} as Record<string, number>)
  dailyValues = Object.values(daily)

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
  .option('--loops', 'Only ingest OpenLoops orchestration/judge token usage')
  .option('-v, --verbose', 'Verbose output')
  .option('--force', 'Force re-process all files (ignore mtime cache)')
  .option('--backfill-machine', 'Tag existing records that have no machine_id with current hostname')
  .option('--recalculate', 'Recalculate costs for all requests with cost_usd = 0')
  .action(async (opts: { claude?: boolean; takumi?: boolean; codex?: boolean; gemini?: boolean; opencode?: boolean; cursor?: boolean; pi?: boolean; hermes?: boolean; loops?: boolean; verbose?: boolean; force?: boolean; backfillMachine?: boolean; recalculate?: boolean }) => {
    // self_hosted/cloud mode: the on-box provider files exist on THIS machine,
    // so the client reads them and pushes the ingested rows to the shared API
    // (/v1/ingest) instead of a local SQLite the cloud transport never reads.
    if (isCloudStore()) {
      const cloud = economyCloudStorage()
      if (!cloud.active) {
        console.log(chalk.yellow('cloud mode: sync transport unavailable (set HASNA_ECONOMY_API_URL and HASNA_ECONOMY_API_KEY)'))
        return
      }
      const result = await syncAllToCloud(cloud, {
        claude: opts.claude,
        takumi: opts.takumi,
        codex: opts.codex,
        gemini: opts.gemini,
        opencode: opts.opencode,
        cursor: opts.cursor,
        pi: opts.pi,
        hermes: opts.hermes,
        loops: opts.loops,
        verbose: opts.verbose,
        force: opts.force,
        backfillMachine: opts.backfillMachine,
        recalculate: opts.recalculate,
      })
      if (result.posted) {
        const parts = Object.entries(result.ingested ?? {})
          .filter(([, n]) => n > 0)
          .map(([table, n]) => `${n} ${table}`)
        console.log(chalk.green(`✓ pushed ${parts.join(', ')} to the shared API (${result.total} rows)`))
      } else {
        console.log(chalk.dim('✓ no new provider data to push (mtime cache current)'))
      }
      console.log(chalk.bold.green('\n✓ Sync complete'))
      return
    }
    const db = openDatabase()
    ensurePricingSeeded(db)
    const anySpecific = opts.claude || opts.takumi || opts.codex || opts.gemini || opts.opencode || opts.cursor || opts.pi || opts.hermes || opts.loops
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
      const ingestSources = [...AGENTS, 'codex-codewith', 'loops']
      db.exec(`DELETE FROM ingest_state WHERE source IN (${ingestSources.map(a => `'${a}'`).join(', ')})`)
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
      loops: opts.loops,
      verbose: opts.verbose,
    })
    console.log(chalk.green(`✓ deduped ${result.deduped}`))
    // Backfill empty machine_id records (shared helper: local and cloud paths)
    if (opts.backfillMachine) {
      const machine = getMachineId()
      const r = backfillMachineId(db)
      console.log(chalk.cyan(`→ Backfilled machine_id='${machine}': ${r.requests} requests, ${r.sessions} sessions`))
    }
    // Recalculate zero-cost requests (shared helper: local and cloud paths)
    if (opts.recalculate) {
      const { getPricingFromDb } = await import('../lib/pricing.js')
      const r = await recalculateZeroCostRequests(db)
      console.log(chalk.cyan(`→ Recalculated: ${r.fixed}/${r.total} zero-cost requests now have pricing`))
      const zeroCostBuckets = r.buckets
      if (zeroCostBuckets.length > 0) {
        console.log(chalk.yellow('→ Zero-cost token buckets remain:'))
        for (const row of zeroCostBuckets) {
          const pricing = getPricingFromDb(db, row.model)
          const status = pricing
            ? (pricing.inputPer1M === 0 && pricing.outputPer1M === 0 && pricing.cacheReadPer1M === 0 && pricing.cacheWritePer1M === 0
                ? 'explicit zero/free pricing'
                : 'pricing configured; inspect/recalculate')
            : 'missing pricing'
          console.log(chalk.yellow(`  ${row.agent}/${row.model}: ${row.requests} requests, ${fmtTokens(row.total_tokens)} tokens (${status})`))
        }
        console.log(chalk.dim('  Add pricing with `economy pricing set <model> --input ... --output ...`, then rerun `economy sync --recalculate`.'))
      }
    }
    // Fire webhooks after sync
    try {
      const { checkAndFireWebhooks } = await import('../lib/webhooks.js')
      await checkAndFireWebhooks(db)
    } catch { /* webhooks are optional */ }
    console.log(chalk.bold.green('\n✓ Sync complete'))
  })

// ── today / week / month ──────────────────────────────────────────────────────

program.command('today').description('Cost summary for today').action(async () => { await autoSync(); await printSummary('Today', 'today') })
program.command('week').description('Cost summary for this week').action(async () => { await autoSync(); await printSummary('This Week', 'week') })
program.command('month').description('Cost summary for this month').action(async () => { await autoSync(); await printSummary('This Month', 'month') })

// ── sessions ──────────────────────────────────────────────────────────────────

program
  .command('sessions')
  .description('List coding sessions with costs')
  .option('--agent <agent>', `Filter by agent (${AGENTS.join('|')})`)
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
    const sinceDate = opts.since ? parseSinceDate(opts.since) : undefined
    const sessions = await getStore().sessions({
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
  .option('--agent <agent>', `Filter by agent (${AGENTS.join('|')})`)
  .option('--since <date>', 'Filter sessions since date or relative (e.g. 2026-03-01, 7d, 30d)')
  .action(async (opts: { n?: string; agent?: string; since?: string }) => {
    const count = parsePositiveCliInteger(opts.n ?? '10', '-n')
    const agent = parseOptionalCliAgent(opts.agent)
    const sinceDate = opts.since ? parseSinceDate(opts.since) : undefined
    const sessions = await getStore().topSessions(count, agent, sinceDate)
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
  .description('Cost breakdown by model, agent, project, account, or cost center')
  .option('--by <dimension>', 'Dimension: model|agent|project|account|cost-center|loop|app|repo', 'model')
  .option('--since <date>', 'Filter since date or relative (e.g. 2026-03-01, 7d, 30d)')
  .option('--limit <n>', 'Maximum breakdown rows to print (default: 20)')
  .option('--verbose', 'Show all breakdown rows')
  .option('--json', 'Output JSON')
  .action(async (opts: { by?: string; since?: string; limit?: string; verbose?: boolean; json?: boolean }) => {
    const store = getStore()
    const by = requireCliChoice(opts.by, '--by', ['model', 'agent', 'project', 'account', 'cost-center', 'loop', 'app', 'repo'] as const)
    const since = opts.since ? parseSinceDate(opts.since) : undefined
    const limit = resolveRowLimit(opts.limit, opts.verbose, 20)
    const costCenterKinds = new Set(['loop', 'app', 'repo'] as const)
    console.log()
    if (by === 'project') {
      const rows = await store.projectBreakdown({ since })
      if (opts.json) {
        console.log(JSON.stringify({ by, since: since ?? null, total: rows.length, rows }, null, 2))
        return
      }
      const visibleRows = rows.slice(0, limit)
      printTable(
        ['Project', 'Sessions', 'Requests', 'Tokens', 'Cost'],
        visibleRows.map(r => [
          chalk.white(r.project_name || chalk.dim('unknown')),
          String(r.sessions),
          String(r.requests),
          chalk.cyan(fmtTokens(r.total_tokens)),
          fmt(r.cost_usd),
        ]),
      )
      printHiddenRowsHint(rows.length, visibleRows.length, 'Use --limit <n>, --verbose, or --json.')
    } else if (by === 'agent') {
      const rows = await store.agentBreakdown({ since })
      if (opts.json) {
        console.log(JSON.stringify({ by, since: since ?? null, total: rows.length, rows }, null, 2))
        return
      }
      const visibleRows = rows.slice(0, limit)
      printTable(
        ['Agent', 'Sessions', 'Requests', 'Tokens', 'API Eq', 'Billable', 'Included'],
        visibleRows.map(r => [
          fmtAgent(r.agent),
          String(r.sessions),
          String(r.requests),
          chalk.cyan(fmtTokens(r.total_tokens)),
          fmt(r.api_equivalent_usd),
          fmt(r.billable_usd),
          fmt(r.subscription_included_usd),
        ]),
      )
      printHiddenRowsHint(rows.length, visibleRows.length, 'Use --limit <n>, --verbose, or --json.')
    } else if (by === 'account') {
      const rows = await store.accountBreakdown({ since })
      if (opts.json) {
        console.log(JSON.stringify({ by, since: since ?? null, total: rows.length, rows }, null, 2))
        return
      }
      const visibleRows = rows.slice(0, limit)
      printAccountBreakdown(visibleRows)
      printHiddenRowsHint(rows.length, visibleRows.length, 'Use --limit <n>, --verbose, or --json.')
    } else if (by === 'cost-center' || costCenterKinds.has(by as 'loop' | 'app' | 'repo')) {
      const kind = costCenterKinds.has(by as 'loop' | 'app' | 'repo') ? by as CostCenterKind : undefined
      const rows = await store.costCenterBreakdown({ since, kind })
      if (opts.json) {
        console.log(JSON.stringify({ by, since: since ?? null, total: rows.length, rows }, null, 2))
        return
      }
      if (rows.length === 0) {
        console.log(chalk.yellow('No cost-center usage yet. Run `economy sync --loops` or ingest app/service usage with /ingest.'))
      } else {
        const visibleRows = rows.slice(0, limit)
        printTable(
          ['Kind', 'Cost Center', 'Sessions', 'Requests', 'Tokens', 'Cost'],
          visibleRows.map(r => [
            chalk.white(r.kind),
            chalk.white(r.name),
            String(r.sessions),
            String(r.requests),
            chalk.cyan(fmtTokens(r.total_tokens)),
            fmt(r.cost_usd),
          ]),
        )
        printHiddenRowsHint(rows.length, visibleRows.length, 'Use --limit <n>, --verbose, or --json.')
      }
    } else {
      const rows = await store.modelBreakdown({ since })
      if (opts.json) {
        console.log(JSON.stringify({ by, since: since ?? null, total: rows.length, rows }, null, 2))
        return
      }
      const visibleRows = rows.slice(0, limit)
      printTable(
        ['Model', 'Agent', 'Requests', 'Tokens', 'Cost'],
        visibleRows.map(r => [
          chalk.white(r.model),
          fmtAgent(r.agent),
          String(r.requests),
          chalk.cyan(fmtTokens(r.total_tokens)),
          fmt(r.cost_usd),
        ]),
      )
      printHiddenRowsHint(rows.length, visibleRows.length, 'Use --limit <n>, --verbose, or --json.')
    }
    console.log()
  })

// ── accounts ──────────────────────────────────────────────────────────────────

const ACCOUNT_PERIODS = ['today', 'week', 'month', 'year', 'all'] as const

program
  .command('accounts [period]')
  .description('List account usage by email address and coding agent')
  .option('--limit <n>', 'Maximum account rows to print (default: 20)')
  .option('--verbose', 'Show all account rows')
  .option('--json', 'Output JSON')
  .action(async (periodArg: string | undefined, opts: { limit?: string; verbose?: boolean; json?: boolean }) => {
    const period = requireCliChoice(periodArg, 'period', ACCOUNT_PERIODS)
    const rows = await getStore().accounts(period)

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
    const limit = resolveRowLimit(opts.limit, opts.verbose, 20)
    const visibleRows = rows.slice(0, limit)
    if (visibleRows.length < rows.length) {
      console.log(chalk.dim(`  ${rows.length} rows · showing ${visibleRows.length}`))
    }
    console.log()
    printAccountBreakdown(visibleRows)
    printHiddenRowsHint(rows.length, visibleRows.length, 'Use --limit <n>, --verbose, or --json.')
    console.log()
  })

// ── watch ─────────────────────────────────────────────────────────────────────

program
  .command('watch')
  .description('Live stream of incoming costs')
  .option('--interval <seconds>', 'Poll interval in seconds', '10')
  .option('--daemon', 'Watch agent data directories and sync on change')
  .option('--agent <agent>', `Filter by agent (${AGENTS.join('|')})`)
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
  .option('--cost-center <id>', 'Cost center id (for example loop:fleet-evaluator)')
  .option('--period <period>', 'Period: daily|weekly|monthly', 'monthly')
  .option('--limit <usd>', 'Budget limit in USD')
  .option('--alert <percent>', 'Alert threshold %', '80')
  .option('--agent <agent>', `Limit to agent (${AGENTS.join('|')})`)
  .action(async (opts: { project?: string; costCenter?: string; period?: string; limit?: string; alert?: string; agent?: string }) => {
    const limitUsd = parsePositiveCliNumber(opts.limit, '--limit')
    const alertAtPercent = parsePositiveCliNumber(opts.alert ?? '80', '--alert')
    if (alertAtPercent > 100) fail('--alert must be between 1 and 100')
    const period = requireCliChoice(opts.period, '--period', ['daily', 'weekly', 'monthly'] as const)
    const agent = parseOptionalCliAgent(opts.agent) ?? null
    await getStore().setBudget({
      project_path: opts.project ?? null,
      agent,
      cost_center_id: opts.costCenter ?? null,
      period,
      limit_usd: limitUsd,
      alert_at_percent: alertAtPercent,
    })
    console.log(chalk.green(`✓ Budget set: ${opts.costCenter ?? opts.project ?? 'global'} — ${period} $${limitUsd}`))
  })

budgetCmd
  .command('list')
  .description('List all budgets')
  .option('--limit <n>', 'Maximum budget rows to print (default: 20)')
  .option('--verbose', 'Show all budget rows')
  .action(async (opts: { limit?: string; verbose?: boolean }) => {
    const statuses = await getStore().listBudgets()
    if (statuses.length === 0) { console.log(chalk.yellow('No budgets set.')); return }
    const limit = resolveRowLimit(opts.limit, opts.verbose, 20)
    const visibleStatuses = statuses.slice(0, limit)
    console.log()
    if (visibleStatuses.length < statuses.length) {
      console.log(chalk.dim(`  ${statuses.length} budgets · showing ${visibleStatuses.length}`))
      console.log()
    }
    printTable(
      ['Scope', 'Period', 'Limit', 'Spent', 'Used%', 'Status'],
      visibleStatuses.map(b => {
        const pct = b.percent_used.toFixed(1)
        const status = b.is_over_limit ? chalk.red('OVER') : b.is_over_alert ? chalk.yellow('ALERT') : chalk.green('OK')
        const pctColor = b.is_over_limit ? chalk.red(pct + '%') : b.is_over_alert ? chalk.yellow(pct + '%') : chalk.green(pct + '%')
        return [
          chalk.white(b.cost_center_id ?? b.project_path ?? 'global'),
          b.period,
          fmt(b.limit_usd),
          fmt(b.current_spend_usd),
          pctColor,
          status,
        ]
      }),
    )
    printHiddenRowsHint(statuses.length, visibleStatuses.length, 'Use --limit <n> or --verbose.')
    console.log()
  })

budgetCmd
  .command('remove <id>')
  .description('Remove a budget by ID')
  .action(async (id: string) => {
    await getStore().removeBudget(id)
    console.log(chalk.green(`✓ Budget removed`))
  })

// ── project ───────────────────────────────────────────────────────────────────

const projectCmd = program.command('project').description('Manage tracked projects')

projectCmd
  .command('add <path>')
  .description('Add a project')
  .option('--name <name>', 'Human-readable name')
  .action(async (path: string, opts: { name?: string }) => {
    const { basename } = require('path') as typeof import('path')
    const name = opts.name ?? basename(path)
    await getStore().addProject(path, name)
    console.log(chalk.green(`✓ Project added: ${path}`))
  })

projectCmd
  .command('list')
  .description('List all projects with costs')
  .option('--limit <n>', 'Maximum project rows to print (default: 20)')
  .option('--verbose', 'Show all project rows')
  .action(async (opts: { limit?: string; verbose?: boolean }) => {
    const projects = await getStore().listProjects()
    if (projects.length === 0) { console.log(chalk.yellow('No projects tracked yet.')); return }
    const limit = resolveRowLimit(opts.limit, opts.verbose, 20)
    const visibleProjects = projects.slice(0, limit)
    console.log()
    if (visibleProjects.length < projects.length) {
      console.log(chalk.dim(`  ${projects.length} projects · showing ${visibleProjects.length}`))
      console.log()
    }
    printTable(
      ['Project', 'Path', 'Sessions', 'Cost', 'Last Active'],
      visibleProjects.map(p => [
        chalk.white(p.project_name || chalk.dim('unknown')),
        chalk.dim(p.project_path.substring(0, 40)),
        String(p.sessions),
        fmt(p.cost_usd),
        chalk.dim(p.last_active?.substring(0, 16) ?? '—'),
      ]),
    )
    printHiddenRowsHint(projects.length, visibleProjects.length, 'Use --limit <n>, --verbose, or economy project show <path>.')
    console.log()
  })

projectCmd
  .command('remove <path>')
  .description('Remove a project (keeps historical data)')
  .action(async (path: string) => {
    await getStore().removeProject(path)
    console.log(chalk.green(`✓ Project removed`))
  })

projectCmd
  .command('rename <path> <name>')
  .description('Rename a project')
  .action(async (path: string, name: string) => {
    try {
      await getStore().renameProject(path, name)
    } catch (e) {
      console.error(chalk.red(e instanceof Error ? e.message : String(e))); process.exit(1)
    }
    console.log(chalk.green(`✓ Renamed to: ${name}`))
  })

projectCmd
  .command('show <nameOrPath>')
  .description('Detailed project breakdown with sparkline')
  .action(async (nameOrPath: string) => {
    await autoSync()
    const detail = await getStore().projectDetail(nameOrPath)
    if (!detail) { console.log(chalk.yellow(`No sessions found for: ${nameOrPath}`)); return }

    const dailyValues = detail.daily.map(d => d.cost_usd)

    console.log()
    console.log(chalk.bold.cyan(`  ${detail.project_name}`))
    console.log(chalk.dim(`  ${detail.project_path}`))
    console.log()
    printTable(['Metric', 'Value'], [
      ['Total cost', fmt(detail.total_cost_usd)],
      ['Sessions', fmtCount(detail.sessions)],
      ['Total tokens', fmtTokens(detail.total_tokens)],
    ])
    if (dailyValues.length > 0) {
      console.log(`\n  ${chalk.dim('14-day trend:')} ${sparkline(dailyValues)}`)
    }
    if (detail.models.length > 0) {
      console.log(`\n  ${chalk.dim('Model breakdown:')}`)
      for (const m of detail.models) {
        console.log(`    ${chalk.white(m.model.padEnd(30))} ${fmt(m.cost_usd)} (${fmtCount(m.requests)} reqs)`)
      }
    }
    if (detail.top_sessions.length > 0) {
      console.log(`\n  ${chalk.dim('Top sessions:')}`)
      for (const s of detail.top_sessions) {
        console.log(`    ${chalk.dim(s.id.substring(0, 12))}  ${fmt(s.total_cost_usd)}  ${chalk.dim(String(s.started_at).substring(0, 16))}`)
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
  .option('--limit <n>', 'Maximum pricing rows to print (default: 50)')
  .option('--verbose', 'Show all pricing rows')
  .action(async (opts: { limit?: string; verbose?: boolean }) => {
    const rows = await getStore().listPricing()
    const limit = resolveRowLimit(opts.limit, opts.verbose, 50)
    const visibleRows = rows.slice(0, limit)
    console.log()
    if (visibleRows.length < rows.length) {
      console.log(chalk.dim(`  ${rows.length} pricing rows · showing ${visibleRows.length}`))
      console.log()
    }
    printTable(
      ['Model', 'Input/1M', 'Output/1M', 'CacheR/1M', 'CacheW/1M', 'CacheStorage/1M-h', 'Out/1k'],
      visibleRows.map(r => [
        chalk.white(r.model),
        fmt(r.input_per_1m),
        fmt(r.output_per_1m),
        fmt(r.cache_read_per_1m),
        r.cache_write_1h_per_1m ? `${fmt(r.cache_write_per_1m)} / ${fmt(r.cache_write_1h_per_1m)}` : fmt(r.cache_write_per_1m),
        fmt(r.cache_storage_per_1m_hour ?? 0),
        chalk.dim(fmt(r.output_per_1m / 1000)),
      ]),
    )
    printHiddenRowsHint(rows.length, visibleRows.length, 'Use --limit <n> or --verbose.')
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
  .action(async (model: string, opts: { input?: string; output?: string; cacheRead?: string; cacheWrite?: string; cacheWrite1h?: string; cacheStorage?: string }) => {
    const input = parseNonNegativeCliNumber(opts.input, '--input')
    const output = parseNonNegativeCliNumber(opts.output, '--output')
    const cacheRead = parseNonNegativeCliNumber(opts.cacheRead ?? '0', '--cache-read')
    const cacheWrite = parseNonNegativeCliNumber(opts.cacheWrite ?? '0', '--cache-write')
    const cacheWrite1h = parseNonNegativeCliNumber(opts.cacheWrite1h ?? '0', '--cache-write-1h')
    const cacheStorage = parseNonNegativeCliNumber(opts.cacheStorage ?? '0', '--cache-storage')
    await getStore().setPricing({
      model,
      input_per_1m: input,
      output_per_1m: output,
      cache_read_per_1m: cacheRead,
      cache_write_per_1m: cacheWrite,
      cache_write_1h_per_1m: cacheWrite1h,
      cache_storage_per_1m_hour: cacheStorage,
    })
    console.log(chalk.green(`✓ Pricing updated for ${model}`))
  })

pricingCmd
  .command('remove <model>')
  .description('Remove pricing for a model')
  .action(async (model: string) => {
    await getStore().removePricing(model)
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
    startServer(port)
  })

// ── dashboard ─────────────────────────────────────────────────────────────────

program
  .command('dashboard')
  .description('Open the web dashboard (auto-starts server if not running)')
  .option('-p, --port <port>', 'Server port', '3456')
  .action(async (opts: { port?: string }) => {
    const port = parseCliPort(opts.port ?? '3456', '--port')
    const url = `http://localhost:${port}`

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
      execSync(`open ${url}`)
    } catch {
      console.log(chalk.yellow(`Open your browser at ${url}`))
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
  .option('--limit <n>', 'Number of request rows to show (default: 20)')
  .option('--verbose', 'Show up to 50 request rows')
  .action(async (id: string, opts: { limit?: string; verbose?: boolean }) => {
    const requestLimit = parsePositiveCliInteger(opts.limit ?? (opts.verbose ? '50' : '20'), '--limit')
    await autoSync()
    const detail = await getStore().sessionDetail(id)
    if (!detail) { console.log(chalk.red(`Session not found: ${id}`)); process.exit(1) }
    const { session, requests } = detail

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
      const visibleRequests = requests.slice(0, requestLimit)
      console.log(chalk.dim(`\n  Requests (${visibleRequests.length}${visibleRequests.length < requests.length ? ` of ${requests.length}` : ''}):\n`))
      printTable(
        ['Time', 'Model', 'Input', 'Output', 'Cache R', 'Cache W', 'Cost'],
        visibleRequests.map(r => [
          chalk.dim(String(r['timestamp']).substring(11, 19)),
          chalk.white(String(r['model']).substring(0, 22)),
          fmtTokens(r['input_tokens'] as number),
          fmtTokens(r['output_tokens'] as number),
          fmtTokens(r['cache_read_tokens'] as number),
          fmtTokens(r['cache_create_tokens'] as number),
          fmt(r['cost_usd'] as number),
        ]),
      )
      if (requests.length > visibleRequests.length) {
        console.log(chalk.dim(`  ... ${requests.length - visibleRequests.length} more requests hidden. Use --limit <n> or --verbose.`))
      }
    }
    console.log()
  })

// ── machines ─────────────────────────────────────────────────────────────────

program
  .command('machines')
  .description('List all machines that have synced data')
  .option('--limit <n>', 'Maximum machine rows to print (default: 20)')
  .option('--verbose', 'Show all machine rows')
  .action(async (opts: { limit?: string; verbose?: boolean }) => {
    await autoSync()
    const machines = await getStore().machines()
    const current = getMachineId()
    if (machines.length === 0) {
      console.log(chalk.yellow(`No machine data yet. Current machine: ${current}`))
      return
    }
    const limit = resolveRowLimit(opts.limit, opts.verbose, 20)
    const visibleMachines = machines.slice(0, limit)
    console.log()
    console.log(chalk.bold.cyan('  Machines'))
    if (visibleMachines.length < machines.length) {
      console.log(chalk.dim(`  ${machines.length} machines · showing ${visibleMachines.length}`))
    }
    console.log()
    printTable(
      ['Machine', 'Sessions', 'Requests', 'Cost', 'Last Active'],
      visibleMachines.map(m => [
        m.machine_id === current ? chalk.green(`${m.machine_id} (this)`) : chalk.white(m.machine_id),
        fmtCount(m.sessions),
        fmtCount(m.requests),
        fmt(m.total_cost_usd),
        chalk.dim(m.last_active?.substring(0, 16) ?? '—'),
      ]),
    )
    printHiddenRowsHint(machines.length, visibleMachines.length, 'Use --limit <n> or --verbose.')
    console.log(`\n  ${chalk.dim('Current machine:')} ${chalk.bold(current)}`)
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
    const type = opts.type === 'requests' ? 'requests' : 'sessions'
    const period = opts.period ?? 'month'
    const rows = await getStore().exportRows(type, period)
    let csv: string

    if (type === 'requests') {
      csv = 'id,agent,session_id,model,input_tokens,output_tokens,cache_read_tokens,cache_create_tokens,cost_usd,duration_ms,timestamp\n'
      for (const r of rows) {
        csv += `${r['id']},${r['agent']},${r['session_id']},${r['model']},${r['input_tokens']},${r['output_tokens']},${r['cache_read_tokens']},${r['cache_create_tokens']},${r['cost_usd']},${r['duration_ms']},${r['timestamp']}\n`
      }
    } else {
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
    const store = getStore()

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

    const [f1, t1] = dateRange(p1)
    const [f2, t2] = dateRange(p2)
    const a = await store.rangeStats(f1, t1)
    const b = await store.rangeStats(f2, t2)

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
    const f = await getStore().forecast()
    const cheapest = f.cheapest_day
    const mostExpensive = f.most_expensive_day

    console.log()
    console.log(chalk.bold.cyan(`  Forecast (${f.day_of_month} of ${f.days_in_month} days)`))
    console.log()
    printTable(['Metric', 'Value'], [
      ['Spent so far', fmt(f.spent_so_far_usd)],
      ['Daily average', fmt(f.daily_avg_usd)],
      [chalk.bold('Projected total'), chalk.bold(fmt(f.projected_usd).replace(chalk.green(''), ''))],
      ['Last 7-day rate', `${fmt(f.last7_daily_avg_usd)}/day → ${fmt(f.last7_projected_usd)}`],
      ['Cheapest day', cheapest ? `${fmt(cheapest.cost_usd)} (${cheapest.date})` : '—'],
      ['Most expensive', mostExpensive ? `${fmt(mostExpensive.cost_usd)} (${mostExpensive.date})` : '—'],
    ])
    console.log()
  })

// ── efficiency ────────────────────────────────────────────────────────────────

program
  .command('efficiency')
  .description('Show output/input token ratio per model')
  .action(async () => {
    await autoSync()
    const models = await getStore().efficiency()

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
  .option('--agent <agent>', `Scope to agent (${AGENTS.join('|')})`)
  .action(async (opts: { period?: string; limit?: string; project?: string; agent?: string }) => {
    const limitUsd = parsePositiveCliNumber(opts.limit, '--limit')
    const period = requireCliChoice(opts.period, '--period', ['day', 'week', 'month', 'year'] as const)
    const agent = parseOptionalCliAgent(opts.agent) ?? null
    await getStore().setGoal({
      period,
      project_path: opts.project ?? null,
      agent,
      limit_usd: limitUsd,
    })
    console.log(chalk.green(`✓ Goal set: ${period} $${limitUsd}${opts.project ? ` (${opts.project})` : ''}`))
  })

goalCmd
  .command('list')
  .description('List all goals with progress')
  .option('--limit <n>', 'Maximum goal rows to print (default: 20)')
  .option('--verbose', 'Show all goal rows')
  .action(async (opts: { limit?: string; verbose?: boolean }) => {
    const statuses = await getStore().listGoals()
    if (statuses.length === 0) { console.log(chalk.yellow('No goals set.')); return }
    const limit = resolveRowLimit(opts.limit, opts.verbose, 20)
    const visibleStatuses = statuses.slice(0, limit)
    console.log()
    if (visibleStatuses.length < statuses.length) {
      console.log(chalk.dim(`  ${statuses.length} goals · showing ${visibleStatuses.length}`))
      console.log()
    }
    printTable(
      ['Period', 'Scope', 'Limit', 'Spent', 'Used%', 'Status'],
      visibleStatuses.map(g => {
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
    printHiddenRowsHint(statuses.length, visibleStatuses.length, 'Use --limit <n> or --verbose.')
    console.log()
  })

goalCmd
  .command('remove <id>')
  .description('Remove a goal')
  .action(async (id: string) => {
    await getStore().removeGoal(id)
    console.log(chalk.green(`✓ Goal removed`))
  })

goalCmd
  .command('status')
  .description('Quick goal progress summary')
  .option('--limit <n>', 'Maximum goal rows to print (default: 20)')
  .option('--verbose', 'Show all goal rows')
  .action(async (opts: { limit?: string; verbose?: boolean }) => {
    const statuses = await getStore().listGoals()
    if (statuses.length === 0) { console.log(chalk.yellow('No goals set.')); return }
    const limit = resolveRowLimit(opts.limit, opts.verbose, 20)
    const visibleStatuses = statuses.slice(0, limit)
    console.log()
    for (const g of visibleStatuses) {
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
    printHiddenRowsHint(statuses.length, visibleStatuses.length, 'Use --limit <n> or --verbose.')
    console.log()
  })

// Top-level remove/uninstall — delegates to budget/project/goal/pricing remove
program
  .command('remove <type> <id>')
  .alias('rm')
  .description('Remove a record. Type: budget | project | goal | pricing')
  .action(async (type: string, id: string) => {
    const label: Record<string, string> = { budget: 'Budget', project: 'Project', goal: 'Goal', pricing: 'Pricing entry' }
    try {
      const t = type.toLowerCase()
      if (!(t in label)) {
        console.error(chalk.red(`Unknown type: ${type}. Use: budget | project | goal | pricing`))
        process.exit(1)
      }
      const store = getStore()
      switch (t) {
        case 'budget': await store.removeBudget(id); break
        case 'project': await store.removeProject(id); break
        case 'goal': await store.removeGoal(id); break
        case 'pricing': await store.removePricing(id); break
      }
      console.log(chalk.green(`✓ ${label[t]} ${id} removed`))
    } catch (e) {
      console.error(chalk.red(`Failed: ${e instanceof Error ? e.message : String(e)}`))
      process.exit(1)
    }
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
    // self_hosted/cloud mode: the provider credentials live on this machine, so
    // the client fetches the billing and pushes the rows to the shared API
    // (/v1/ingest) instead of a local SQLite the cloud transport never reads.
    if (isCloudStore()) {
      const cloud = economyCloudStorage()
      if (!cloud.active) {
        console.log(chalk.yellow('cloud mode: billing sync transport unavailable (set HASNA_ECONOMY_API_URL and HASNA_ECONOMY_API_KEY)'))
        return
      }
      const result = await billingSyncToCloud(cloud, { days, anthropic: opts.anthropic, openai: opts.openai, gemini: opts.gemini })
      for (const [provider, p] of Object.entries(result.providers)) {
        if (p.ok) console.log(chalk.green(`✓ ${provider} billing: ${p.days} days, $${p.totalUsd!.toFixed(2)}`))
        else console.log(chalk.red(`✗ ${provider}: ${p.error}`))
      }
      if (result.posted) console.log(chalk.green(`✓ pushed ${result.total} billing rows to the shared API`))
      return
    }
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
  .action(async (opts: { period?: string }) => {
    const store = getStore()
    const period = (opts.period ?? 'month') as Period
    const actual = await store.billingSummary(period)
    const estimated = await store.summary(period)
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
    // No actual billing means the ratio is undefined, not zero. Printing "0.0%"
    // here read as "estimate and billing agree" on a period where nothing had
    // been imported at all.
    const pct = billingDeltaPct(estimated.total_usd, actual.total_usd)
    const rendered = pct === null ? 'n/a' : `${diff >= 0 ? '+' : ''}${pct.toFixed(1)}%`
    console.log(`  ${chalk.dim('Difference:')}      ${fmt(Math.abs(diff))} (${rendered})`)
    if (pct === null) {
      console.log(chalk.yellow(`  ${chalk.dim('Note:')}            no provider billing recorded for ${period} — drift is UNKNOWN, not zero.`))
    }
    console.log()
  })

registerTodosCommand(program)
registerBriefCommand(program, { beforeRead: () => autoSync({ dedupe: false }) })
registerExtendedCommands(program)
registerFleetCommands(program)

registerEventsCommands(program, { source: 'economy' })

// Render any command failure as a single clean line + exit 1 — never leak a raw
// bundle stack trace. Cloud (self_hosted) API failures surface as HasnaHttpError;
// a 404 there means the server is missing the endpoint (stale deploy) rather than
// a client bug, so we say so instead of dumping the transport internals.
function reportCliError(err: unknown): never {
  if (err instanceof HasnaHttpError) {
    if (err.status === 404) {
      fail(
        `economy: the cloud API has no endpoint for this command (${err.method} ${err.path} -> 404). ` +
          `The self-hosted server is likely running an older build — it needs an ECS redeploy of the current version.`,
      )
    }
    if (err.status === 401 || err.status === 403) {
      fail(`economy: cloud API rejected the request (${err.status}). Check HASNA_ECONOMY_API_KEY.`)
    }
    fail(`economy: cloud API request failed (${err.method} ${err.path} -> ${err.status}).`)
  }
  fail(`economy: ${err instanceof Error ? err.message : String(err)}`)
}

program.parseAsync().catch(reportCliError)
