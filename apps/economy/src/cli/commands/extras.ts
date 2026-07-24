import { Command } from 'commander'
import chalk from 'chalk'
import { randomUUID } from 'crypto'
import {
  openDatabase,
  querySummary,
  queryUsageSnapshots,
  listSubscriptions,
  upsertSubscription,
  deleteSubscription,
  listMachines,
  listMachineRegistry,
  queryBillingSummary,
  dedupeRequests,
  queryZeroCostTokenizedModels,
} from '../../db/database.js'
import { querySavingsSummary } from '../../lib/savings.js'
import { queryBillingDiff } from '../../lib/billing-diff.js'
import { usageSnapshotFilterForPeriod } from '../../lib/periods.js'
import { buildStatusLine } from './tui.js'
import { computeCostFromDb, ensurePricingSeeded, getPricingFromDb } from '../../lib/pricing.js'
import { AGENTS, parseAgent } from '../../lib/agents.js'
import type { Period } from '../../types/index.js'
import {
  getCloudDatabaseUrl,
  getCloudScheduleStatus,
  registerCloudSchedule,
  removeCloudSchedule,
} from '../../lib/cloud-sync.js'
import { existsSync } from 'fs'
import { join } from 'path'
import { printCompletion } from './completion.js'
import { agentPaths } from '../../lib/paths.js'

function fmt(usd: number): string {
  return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString('en-US')
}

function parsePeriod(value: string | undefined, fallback: Period = 'month'): Period {
  const p = (value ?? fallback) as Period
  if (!['today', 'yesterday', 'week', 'month', 'year', 'all'].includes(p)) {
    console.error(chalk.red('--period must be today|yesterday|week|month|year|all'))
    process.exit(1)
  }
  return p
}

function parseLimit(value: string | undefined, fallback: number, verbose?: boolean): number {
  if (verbose && value == null) return Number.POSITIVE_INFINITY
  const parsed = Number(value ?? String(fallback))
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    console.error(chalk.red('--limit must be a positive integer'))
    process.exit(1)
  }
  return parsed
}

function compactValue(value: unknown): string {
  if (value == null) return '—'
  if (Array.isArray(value)) return `${value.length} items`
  if (typeof value === 'object') return `${Object.keys(value as Record<string, unknown>).length} fields`
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

export function registerExtendedCommands(program: Command): void {
  program
    .command('usage [period]')
    .description('Show subscription usage quotas and consumption metrics')
    .option('--agent <agent>', `Filter by agent (${AGENTS.join('|')})`)
    .option('--limit <n>', 'Maximum snapshot rows to print (default: 20)')
    .option('--verbose', 'Show all snapshot rows')
    .option('--json', 'Output JSON')
    .action((periodArg: string | undefined, opts: { agent?: string; limit?: string; verbose?: boolean; json?: boolean }) => {
      const db = openDatabase()
      const period = parsePeriod(periodArg, 'month')
      const agent = parseAgent(opts.agent, '--agent')
      const snaps = queryUsageSnapshots(db, { agent, ...usageSnapshotFilterForPeriod(period) })
      const summary = querySummary(db, period, undefined, true, agent)

      if (opts.json) {
        console.log(JSON.stringify({ period, agent: agent ?? 'all', snapshots: snaps, summary }, null, 2))
        return
      }

      console.log()
      console.log(chalk.bold.cyan(`  Usage — ${period}`))
      console.log()
      if (snaps.length === 0) {
        console.log(chalk.yellow('  No usage snapshots yet. Run: economy sync --cursor'))
      } else {
        const limit = parseLimit(opts.limit, 20, opts.verbose)
        const visibleSnaps = snaps.slice(0, limit)
        if (visibleSnaps.length < snaps.length) {
          console.log(chalk.dim(`  ${snaps.length} snapshots · showing ${visibleSnaps.length}`))
          console.log()
        }
        for (const s of visibleSnaps) {
          console.log(`  ${chalk.white(s.agent.padEnd(10))} ${s.metric.padEnd(28)} ${s.value}${s.unit ? ` ${s.unit}` : ''}  ${chalk.dim(s.date)}`)
        }
        if (visibleSnaps.length < snaps.length) {
          console.log(chalk.dim(`\n  ... ${snaps.length - visibleSnaps.length} more snapshots hidden. Use --limit <n>, --verbose, or --json.`))
        }
      }
      const spendLabel = agent ? `${agent} API-equivalent spend:` : 'Fleet API-equivalent spend:'
      console.log(`\n  ${chalk.dim(spendLabel)} ${fmt(summary.total_usd)}`)
      console.log()
    })

  program
    .command('savings [period]')
    .description('Subscription vs API-equivalent savings breakdown')
    .option('--agent <agent>', 'Filter by agent')
    .option('--json', 'Output JSON')
    .action((periodArg: string | undefined, opts: { agent?: string; json?: boolean }) => {
      const db = openDatabase()
      const period = parsePeriod(periodArg, 'month')
      const agent = parseAgent(opts.agent, '--agent')
      const savings = querySavingsSummary(db, period, agent)

      if (opts.json) {
        console.log(JSON.stringify(savings, null, 2))
        return
      }

      console.log()
      console.log(chalk.bold.cyan(`  Savings — ${period}${agent ? ` (${agent})` : ''}`))
      console.log()
      console.log(`  API equivalent:     ${fmt(savings.api_equivalent_usd)}`)
      console.log(`  Subscription fee:   ${fmt(savings.subscription_fee_usd)}`)
      console.log(`  Included consumed:  ${fmt(savings.included_consumed_usd)}`)
      console.log(`  On-demand:          ${fmt(savings.on_demand_usd)}`)
      console.log(`  ${chalk.bold('Saved:')}              ${chalk.green(fmt(savings.saved_usd))}`)
      console.log()
    })

  const subsCmd = program.command('subscriptions').description('Manage subscription plans')

  subsCmd
    .command('set')
    .description('Set a subscription plan')
    .requiredOption('--provider <name>', 'Provider name')
    .requiredOption('--plan <name>', 'Plan name')
    .option('--agent <agent>', 'Agent scope')
    .option('--fee <usd>', 'Monthly fee USD', '0')
    .option('--included <usd>', 'Included usage USD', '0')
    .action((opts: { provider: string; plan: string; agent?: string; fee?: string; included?: string }) => {
      const db = openDatabase()
      const now = new Date().toISOString()
      const agent = parseAgent(opts.agent, '--agent') ?? null
      upsertSubscription(db, {
        id: randomUUID(),
        agent,
        provider: opts.provider,
        plan: opts.plan,
        monthly_fee_usd: Number(opts.fee),
        included_usage_usd: Number(opts.included),
        billing_cycle_start: null,
        reset_policy: 'monthly',
        active: 1,
        created_at: now,
        updated_at: now,
      })
      console.log(chalk.green(`✓ Subscription set: ${opts.provider} / ${opts.plan}`))
    })

  subsCmd
    .command('list')
    .description('List subscription plans')
    .option('--limit <n>', 'Maximum subscription rows to print (default: 20)')
    .option('--verbose', 'Show all subscription rows')
    .option('--json', 'Output JSON')
    .action((opts: { limit?: string; verbose?: boolean; json?: boolean }) => {
      const rows = listSubscriptions(openDatabase())
      if (opts.json) { console.log(JSON.stringify(rows, null, 2)); return }
      if (rows.length === 0) { console.log(chalk.yellow('No subscriptions configured.')); return }
      const limit = parseLimit(opts.limit, 20, opts.verbose)
      const visibleRows = rows.slice(0, limit)
      console.log()
      if (visibleRows.length < rows.length) {
        console.log(chalk.dim(`  ${rows.length} subscriptions · showing ${visibleRows.length}`))
        console.log()
      }
      for (const r of visibleRows) {
        console.log(`  ${chalk.white(r.provider)} / ${r.plan}  ${fmt(r.monthly_fee_usd)}/mo  included ${fmt(r.included_usage_usd)}  ${r.agent ?? 'all agents'}`)
      }
      if (visibleRows.length < rows.length) {
        console.log(chalk.dim(`\n  ... ${rows.length - visibleRows.length} more subscriptions hidden. Use --limit <n>, --verbose, or --json.`))
      }
      console.log()
    })

  subsCmd
    .command('remove <id>')
    .description('Remove subscription by id')
    .action((id: string) => {
      deleteSubscription(openDatabase(), id)
      console.log(chalk.green('✓ Subscription removed'))
    })

  program
    .command('status')
    .description('One-line fleet health and spend summary')
    .action(() => {
      console.log(buildStatusLine(openDatabase()))
    })

  program
    .command('doctor')
    .description('Diagnose agents, cloud, pricing, and billing health')
    .action(async () => {
      const db = openDatabase()
      ensurePricingSeeded(db)
      const checks: Array<{ ok: boolean; msg: string }> = []

      const paths: Array<[string, string]> = [
        ['claude', agentPaths().claudeProjects],
        ['codex', agentPaths().codexDb],
        ['gemini', join(agentPaths().geminiTmp, '..')],
        ['opencode', join(agentPaths().opencodeMessages, '..', '..')],
        ['pi', agentPaths().piSessions],
        ['hermes', agentPaths().hermesDb],
      ]
      for (const [agent, path] of paths) {
        checks.push({ ok: existsSync(path), msg: `${agent}: ${existsSync(path) ? path : 'not found'}` })
      }
      checks.push({ ok: Boolean(process.env['CURSOR_SESSION_TOKEN']), msg: `cursor token: ${process.env['CURSOR_SESSION_TOKEN'] ? 'set' : 'missing CURSOR_SESSION_TOKEN'}` })
      checks.push({ ok: Boolean(getCloudDatabaseUrl()), msg: `cloud: ${getCloudDatabaseUrl() ? 'ECONOMY_CLOUD_DATABASE_URL set' : 'not configured'}` })

      const zeroCostBuckets = queryZeroCostTokenizedModels(db, 5)
      const zeroCost = db.prepare(`
        SELECT COUNT(*) as c
        FROM requests
        WHERE cost_usd = 0
          AND (input_tokens > 0 OR output_tokens > 0 OR cache_read_tokens > 0 OR cache_create_tokens > 0)
      `).get() as { c: number }
      const zeroCostSuffix = zeroCostBuckets.length > 0
        ? `; top buckets: ${zeroCostBuckets.map(row => {
            const pricing = getPricingFromDb(db, row.model)
            const status = pricing ? 'pricing configured' : 'missing pricing'
            return `${row.agent}/${row.model} ${row.requests} req ${fmtTokens(row.total_tokens)} tok (${status})`
          }).join('; ')}`
        : ''
      checks.push({ ok: zeroCost.c === 0, msg: `zero-cost requests with tokens: ${zeroCost.c}${zeroCostSuffix}` })

      const estimated = querySummary(db, 'month', undefined, true)
      const actual = queryBillingSummary(db, 'month')
      const drift = actual.total_usd > 0 ? Math.abs(estimated.total_usd - actual.total_usd) / actual.total_usd : 0
      checks.push({ ok: drift < 0.15, msg: `billing drift month: ${(drift * 100).toFixed(1)}%` })

      const removed = dedupeRequests(db)
      if (removed > 0) checks.push({ ok: true, msg: `deduped ${removed} duplicate requests` })

      console.log()
      console.log(chalk.bold.cyan('  Economy Doctor'))
      console.log()
      for (const c of checks) {
        console.log(`  ${c.ok ? chalk.green('✓') : chalk.yellow('!')} ${c.msg}`)
      }
      console.log()
    })

  program
    .command('init')
    .description('First-run setup wizard hints')
    .action(async () => {
      console.log(chalk.bold.cyan('\n  Economy Init\n'))
      console.log('  1. Set machine id:  export ECONOMY_MACHINE_ID=spark01')
      console.log('  2. Cloud sync:      export ECONOMY_CLOUD_DATABASE_URL=postgresql://...')
      console.log('  3. Auto cloud:      export ECONOMY_CLOUD_AUTO=1')
      console.log('  4. Cursor token:    export CURSOR_SESSION_TOKEN=...')
      console.log('  5. Run ingest:      economy sync --verbose')
      console.log('  6. Schedule sync:   economy cloud schedule install --minutes 10')
      console.log('  7. MCP install:     economy mcp --all')
      console.log('  8. Subscriptions:   economy subscriptions set --provider cursor --plan pro --fee 20 --included 20 --agent cursor')
      console.log('  9. OTel sidecar:   economy-otel --port 4318')
      console.log('  10. API auth:      export ECONOMY_API_TOKEN=... (serve binds localhost)')
      console.log('  11. Linux status:  economy tui --watch  |  economy waybar')
      console.log()
    })

  program
    .command('tui')
    .description('Terminal status dashboard (Linux/SSH friendly)')
    .option('--watch', 'Live refresh')
    .option('--interval <seconds>', 'Refresh interval', '30')
    .action(async (opts: { watch?: boolean; interval?: string }) => {
      const { runTui } = await import('./tui.js')
      await runTui({
        watch: Boolean(opts.watch),
        interval: Number(opts.interval ?? 30),
      })
    })

  program
    .command('waybar')
    .description('Print waybar-compatible JSON status line')
    .action(async () => {
      const { printWaybarJson } = await import('./tui.js')
      printWaybarJson()
    })

  const barCmd = program.command('bar').description('Status bar helpers (Linux)')
  barCmd
    .command('tui')
    .description('Alias for economy tui')
    .option('--watch', 'Live refresh')
    .action(async (opts: { watch?: boolean }) => {
      const { runTui } = await import('./tui.js')
      await runTui({ watch: Boolean(opts.watch) })
    })
  barCmd
    .command('waybar')
    .description('Alias for economy waybar')
    .action(async () => {
      const { printWaybarJson } = await import('./tui.js')
      printWaybarJson()
    })

  program
    .command('estimate')
    .description('Estimate cost for token counts')
    .requiredOption('--model <model>', 'Model name')
    .option('--input <n>', 'Input tokens', '0')
    .option('--output <n>', 'Output tokens', '0')
    .action((opts: { model: string; input?: string; output?: string }) => {
      const db = openDatabase()
      ensurePricingSeeded(db)
      const cost = computeCostFromDb(db, opts.model, Number(opts.input), Number(opts.output), 0, 0, 0)
      console.log(`${opts.model}: ${fmt(cost)} (${opts.input} in / ${opts.output} out)`)
    })

  const billingCmd = program.commands.find(c => c.name() === 'billing')
  if (billingCmd) {
    billingCmd
      .command('diff')
      .description('Show estimated vs actual billing delta')
      .option('--period <p>', 'Period', 'month')
      .action((opts: { period?: string }) => {
        const db = openDatabase()
        const period = parsePeriod(opts.period, 'month')
        const diff = queryBillingDiff(db, period)

        console.log()
        console.log(chalk.bold.cyan(`  Billing diff — ${period}`))
        console.log(`  Estimated:  ${fmt(diff.estimated_usd)}`)
        console.log(`  Actual:     ${fmt(diff.actual_usd)}`)
        console.log(`  Delta:      ${fmt(Math.abs(diff.delta_usd))} (${diff.delta_usd >= 0 ? '+' : ''}${diff.delta_pct.toFixed(1)}%)`)
        if (diff.is_alert) console.log(chalk.yellow('\n  Suggestion: economy sync --recalculate && economy billing sync'))
        console.log()
      })
  }

  const cloudCmd = program.commands.find(c => c.name() === 'cloud')
  if (cloudCmd) {
    const scheduleCmd = cloudCmd.command('schedule').description('Manage automatic cloud sync schedule')
    scheduleCmd
      .command('install')
      .description('Install launchd/systemd schedule')
      .option('--minutes <n>', 'Interval minutes', '10')
      .action(async (opts: { minutes?: string }) => {
        await registerCloudSchedule(Number(opts.minutes ?? 10))
        console.log(chalk.green(`✓ Cloud sync scheduled every ${opts.minutes ?? 10} minutes`))
      })
    scheduleCmd
      .command('status')
      .description('Show schedule status')
      .option('--json', 'Output JSON')
      .action(async (opts: { json?: boolean }) => {
        const status = await getCloudScheduleStatus()
        if (opts.json) {
          console.log(JSON.stringify(status, null, 2))
          return
        }
        console.log()
        console.log(chalk.bold.cyan('  Cloud Schedule'))
        console.log()
        for (const [key, value] of Object.entries(status as unknown as Record<string, unknown>)) {
          console.log(`  ${key.padEnd(18)} ${compactValue(value)}`)
        }
        console.log()
      })
    scheduleCmd
      .command('remove')
      .description('Remove schedule')
      .action(async () => {
        await removeCloudSchedule()
        console.log(chalk.green('✓ Cloud sync schedule removed'))
      })
  }
}

export function registerFleetCommands(program: Command): void {
  program
    .command('fleet')
    .description('Fleet-wide summaries across all machines')
    .option('--period <p>', 'Period', 'today')
    .option('--limit <n>', 'Maximum machine rows to print (default: 20)')
    .option('--verbose', 'Show all machine rows')
    .option('--json', 'Output JSON')
    .action((opts: { period?: string; limit?: string; verbose?: boolean; json?: boolean }) => {
      const db = openDatabase()
      const period = parsePeriod(opts.period, 'today')
      const summary = querySummary(db, period, undefined, true)
      const machines = listMachines(db, period)
      const registry = listMachineRegistry(db)

      if (opts.json) {
        console.log(JSON.stringify({ period, summary, machines, registry }, null, 2))
        return
      }

      const limit = parseLimit(opts.limit, 20, opts.verbose)
      const visibleMachines = machines.slice(0, limit)
      console.log()
      console.log(chalk.bold.cyan(`  Fleet — ${period}`))
      console.log(`  Total: ${fmt(summary.total_usd)} · ${summary.sessions} sessions · ${summary.requests} requests`)
      if (visibleMachines.length < machines.length) {
        console.log(chalk.dim(`  ${machines.length} machines · showing ${visibleMachines.length}`))
      }
      console.log()
      for (const m of visibleMachines) {
        console.log(`  ${chalk.white(m.machine_id.padEnd(12))} ${fmt(m.total_cost_usd).padEnd(10)} ${m.sessions} sessions`)
      }
      if (visibleMachines.length < machines.length) {
        console.log(chalk.dim(`\n  ... ${machines.length - visibleMachines.length} more machines hidden. Use --limit <n>, --verbose, or --json.`))
      }
      console.log()
    })

  program
    .command('completion <shell>')
    .description('Print shell completion script (bash, zsh, or fish)')
    .action((shell: string) => {
      printCompletion(shell)
    })
}
