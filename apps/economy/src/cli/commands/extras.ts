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
} from '../../db/database.js'
import { querySavingsSummary } from '../../lib/savings.js'
import { queryBillingDiff } from '../../lib/billing-diff.js'
import { usageSnapshotFilterForPeriod } from '../../lib/periods.js'
import { buildStatusLine } from './tui.js'
import { computeCostFromDb, ensurePricingSeeded } from '../../lib/pricing.js'
import { AGENTS, parseAgent } from '../../lib/agents.js'
import type { Period } from '../../types/index.js'
import {
  getStorageDatabaseUrl,
  getStorageScheduleStatus,
  registerStorageSchedule,
  removeStorageSchedule,
} from '../../lib/native-storage.js'
import {
  buildFleetCostInsights,
  buildFleetFreshness,
  MAX_FLEET_FRESHNESS_ROWS,
  MAX_FLEET_INSIGHT_ROWS,
  MAX_FLEET_PREVIEW_TABLES,
  publicFleetPeerSyncResult,
  syncFleetPeerSqlite,
} from '../../lib/fleet-sync.js'
import { existsSync } from 'fs'
import { join } from 'path'
import { printCompletion } from './completion.js'
import { agentPaths } from '../../lib/paths.js'

function fmt(usd: number): string {
  return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parsePeriod(value: string | undefined, fallback: Period = 'month'): Period {
  const p = (value ?? fallback) as Period
  if (!['today', 'yesterday', 'week', 'month', 'year', 'all'].includes(p)) {
    console.error(chalk.red('--period must be today|yesterday|week|month|year|all'))
    process.exit(1)
  }
  return p
}

function parsePositiveInt(value: string | undefined, fallback: number, option: string): number {
  const raw = value ?? String(fallback)
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(chalk.red(`${option} must be a positive integer`))
    process.exit(1)
  }
  return parsed
}

function parseBoundedPositiveInt(value: string | undefined, fallback: number, option: string, max: number): number {
  return Math.min(parsePositiveInt(value, fallback, option), max)
}

function printCompactJson(value: unknown): void {
  console.log(JSON.stringify(value))
}

function inheritedOption(
  value: string | undefined,
  valueDefault: string,
  parentValue: string | undefined,
  parentDefault: string,
): string | undefined {
  if (value != null && value !== valueDefault) return value
  if (parentValue != null && parentValue !== parentDefault) return parentValue
  return value ?? parentValue
}

export function registerExtendedCommands(program: Command): void {
  program
    .command('usage [period]')
    .description('Show subscription usage quotas and consumption metrics')
    .option('--agent <agent>', `Filter by agent (${AGENTS.join('|')})`)
    .option('--json', 'Output JSON')
    .action((periodArg: string | undefined, opts: { agent?: string; json?: boolean }) => {
      const db = openDatabase()
      const period = parsePeriod(periodArg, 'month')
      const agent = parseAgent(opts.agent, '--agent')
      const snaps = queryUsageSnapshots(db, { agent, ...usageSnapshotFilterForPeriod(period) })
      const summary = querySummary(db, period, undefined, true)

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
        for (const s of snaps) {
          console.log(`  ${chalk.white(s.agent.padEnd(10))} ${s.metric.padEnd(28)} ${s.value}${s.unit ? ` ${s.unit}` : ''}  ${chalk.dim(s.date)}`)
        }
      }
      console.log(`\n  ${chalk.dim('Fleet API-equivalent spend:')} ${fmt(summary.total_usd)}`)
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
    .option('--json', 'Output JSON')
    .action((opts: { json?: boolean }) => {
      const rows = listSubscriptions(openDatabase())
      if (opts.json) { console.log(JSON.stringify(rows, null, 2)); return }
      if (rows.length === 0) { console.log(chalk.yellow('No subscriptions configured.')); return }
      console.log()
      for (const r of rows) {
        console.log(`  ${chalk.white(r.provider)} / ${r.plan}  ${fmt(r.monthly_fee_usd)}/mo  included ${fmt(r.included_usage_usd)}  ${r.agent ?? 'all agents'}`)
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
    .description('Diagnose agents, storage, pricing, and billing health')
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
      checks.push({ ok: Boolean(getStorageDatabaseUrl()), msg: `storage: ${getStorageDatabaseUrl() ? 'HASNA_ECONOMY_DATABASE_URL set' : 'not configured'}` })

      const zeroCost = db.prepare(`SELECT COUNT(*) as c FROM requests WHERE cost_usd = 0 AND (input_tokens > 0 OR output_tokens > 0)`).get() as { c: number }
      checks.push({ ok: zeroCost.c === 0, msg: `zero-cost requests with tokens: ${zeroCost.c}` })

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
      console.log('  2. Storage sync:    export HASNA_ECONOMY_DATABASE_URL=postgresql://...')
      console.log('  3. Auto storage:    export HASNA_ECONOMY_SYNC_AUTO=1')
      console.log('  4. Cursor token:    export CURSOR_SESSION_TOKEN=...')
      console.log('  5. Run ingest:      economy sync --verbose')
      console.log('  6. Schedule sync:   economy storage schedule install --minutes 10')
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

  const storageCmd = program.commands.find(c => c.name() === 'storage')
  if (storageCmd) {
    const scheduleCmd = storageCmd.command('schedule').description('Manage automatic storage sync schedule')
    scheduleCmd
      .command('install')
      .description('Install launchd/systemd schedule')
      .option('--minutes <n>', 'Interval minutes', '10')
      .action(async (opts: { minutes?: string }) => {
        await registerStorageSchedule(Number(opts.minutes ?? 10))
        console.log(chalk.green(`✓ Storage sync scheduled every ${opts.minutes ?? 10} minutes`))
      })
    scheduleCmd
      .command('status')
      .description('Show schedule status')
      .action(async () => {
        const status = await getStorageScheduleStatus()
        console.log(JSON.stringify(status, null, 2))
      })
    scheduleCmd
      .command('remove')
      .description('Remove schedule')
      .action(async () => {
        await removeStorageSchedule()
        console.log(chalk.green('✓ Storage sync schedule removed'))
      })
  }
}

export function registerFleetCommands(program: Command): void {
  const fleetCmd = program
    .command('fleet')
    .description('Fleet-wide summaries across all machines')
    .option('--period <p>', 'Period', 'today')
    .option('--limit <n>', 'Maximum machines to print', '20')
    .option('--json', 'Output JSON')
    .action((opts: { period?: string; limit?: string; json?: boolean }) => {
      const db = openDatabase()
      const period = parsePeriod(opts.period, 'today')
      const limit = parseBoundedPositiveInt(opts.limit, 20, '--limit', MAX_FLEET_FRESHNESS_ROWS)
      const summary = querySummary(db, period, undefined, true)
      const allMachines = listMachines(db, period)
      const machines = allMachines.slice(0, limit)
      const allRegistry = listMachineRegistry(db)
      const registry = allRegistry.slice(0, limit)

      if (opts.json) {
        printCompactJson({
          schema_version: 1,
          period,
          summary,
          machines,
          registry,
          total_machines: allMachines.length,
          returned_machines: machines.length,
          truncated: allMachines.length > limit || allRegistry.length > limit,
          hints: ['use economy fleet freshness or economy fleet insights for agent-ready diagnostics'],
        })
        return
      }

      console.log()
      console.log(chalk.bold.cyan(`  Fleet — ${period}`))
      console.log(`  Total: ${fmt(summary.total_usd)} · ${summary.sessions} sessions · ${summary.requests} requests`)
      console.log()
      for (const m of machines) {
        console.log(`  ${chalk.white(m.machine_id.padEnd(12))} ${fmt(m.total_cost_usd).padEnd(10)} ${m.sessions} sessions`)
      }
      if (allMachines.length > machines.length) console.log(chalk.dim(`\n  ... ${allMachines.length - machines.length} more machines; use --limit ${allMachines.length}`))
      console.log()
    })

  fleetCmd
    .command('sync')
    .description('Snapshot and optionally merge a peer Economy SQLite database')
    .requiredOption('--source <path>', 'Peer economy SQLite database path (mounted or copied locally)')
    .option('--source-machine <id>', 'Machine id to use when the source database has no machine_id rows')
    .option('--snapshot-dir <path>', 'Directory for verified SQLite snapshot artifacts')
    .option('--apply', 'Merge the verified snapshot into the local database')
    .option('--limit <n>', 'Maximum preview tables to include', '10')
    .option('--json', 'Output compact JSON (default)')
    .option('--human', 'Output a concise human summary')
    .option('--verbose', 'Include absolute local artifact paths in JSON')
    .action((opts: { source: string; sourceMachine?: string; snapshotDir?: string; apply?: boolean; limit?: string; json?: boolean; human?: boolean; verbose?: boolean }, command: Command) => {
      const parentOpts = command.parent?.opts<{ limit?: string }>() ?? {}
      const db = openDatabase()
      const result = syncFleetPeerSqlite(db, opts.source, {
        apply: Boolean(opts.apply),
        sourceMachine: opts.sourceMachine,
        snapshotDir: opts.snapshotDir,
        limit: parseBoundedPositiveInt(inheritedOption(opts.limit, '10', parentOpts.limit, '20'), 10, '--limit', MAX_FLEET_PREVIEW_TABLES),
      })
      if (!opts.human) {
        printCompactJson(opts.verbose ? result : publicFleetPeerSyncResult(result))
        return
      }

      console.log()
      console.log(chalk.bold.cyan(`  Fleet Sync ${result.dry_run ? 'Dry Run' : 'Applied'} — ${result.source.machine_id}`))
      console.log(`  Snapshot: ${chalk.white(result.snapshot.path_ref)} (${result.snapshot.bytes} bytes, integrity ${result.snapshot.integrity.result})`)
      console.log(`  Preview: ${result.preview.total_rows.toLocaleString()} rows across ${result.preview.tables.length} shown tables`)
      if (result.merge) console.log(`  Merge: ${result.merge.rows_written.toLocaleString()} rows written · ${result.merge.collisions.toLocaleString()} collisions · ${result.merge.deduped.toLocaleString()} deduped`)
      for (const hint of result.hints) console.log(chalk.dim(`  hint: ${hint}`))
      console.log()
    })

  fleetCmd
    .command('freshness')
    .description('Report fleet sync freshness with bounded JSON')
    .option('--stale-after <minutes>', 'Mark machines stale after this many minutes', '60')
    .option('--limit <n>', 'Maximum machines to include', '20')
    .option('--json', 'Output compact JSON (default)')
    .option('--human', 'Output a concise human summary')
    .action((opts: { staleAfter?: string; limit?: string; json?: boolean; human?: boolean }, command: Command) => {
      const parentOpts = command.parent?.opts<{ limit?: string }>() ?? {}
      const db = openDatabase()
      const result = buildFleetFreshness(db, {
        staleAfterMinutes: parsePositiveInt(opts.staleAfter, 60, '--stale-after'),
        limit: parseBoundedPositiveInt(inheritedOption(opts.limit, '20', parentOpts.limit, '20'), 20, '--limit', MAX_FLEET_FRESHNESS_ROWS),
      })
      if (!opts.human) {
        printCompactJson(result)
        return
      }

      console.log()
      console.log(chalk.bold.cyan('  Fleet Freshness'))
      console.log(`  Machines: ${result.total_machines} · stale ${result.stale_machines} · unknown ${result.unknown_machines}`)
      for (const row of result.rows) {
        const age = row.age_minutes == null ? 'unknown' : `${row.age_minutes}m`
        const marker = row.status === 'fresh' ? chalk.green('fresh') : row.status === 'stale' ? chalk.yellow('stale') : chalk.gray('unknown')
        console.log(`  ${chalk.white(row.machine_id.padEnd(12))} ${marker.padEnd(14)} age ${age.padEnd(8)} cost ${fmt(row.cost_usd)}`)
      }
      for (const hint of result.hints) console.log(chalk.dim(`  hint: ${hint}`))
      console.log()
    })

  fleetCmd
    .command('insights')
    .description('Compact fleet cost, freshness, and data quality insights')
    .option('--period <p>', 'Period', 'today')
    .option('--stale-after <minutes>', 'Mark machines stale after this many minutes', '60')
    .option('--limit <n>', 'Maximum rows per insight section', '5')
    .option('--json', 'Output compact JSON (default)')
    .option('--human', 'Output a concise human summary')
    .action((opts: { period?: string; staleAfter?: string; limit?: string; json?: boolean; human?: boolean }, command: Command) => {
      const parentOpts = command.parent?.opts<{ period?: string; limit?: string }>() ?? {}
      const db = openDatabase()
      const result = buildFleetCostInsights(db, {
        period: parsePeriod(inheritedOption(opts.period, 'today', parentOpts.period, 'today'), 'today'),
        staleAfterMinutes: parsePositiveInt(opts.staleAfter, 60, '--stale-after'),
        limit: parseBoundedPositiveInt(inheritedOption(opts.limit, '5', parentOpts.limit, '20'), 5, '--limit', MAX_FLEET_INSIGHT_ROWS),
      })
      if (!opts.human) {
        printCompactJson(result)
        return
      }

      console.log()
      console.log(chalk.bold.cyan(`  Fleet Insights — ${result.period}`))
      console.log(`  Total: ${fmt(result.summary.total_usd)} · ${result.summary.sessions} sessions · ${result.summary.requests} requests`)
      console.log(`  Freshness: ${result.freshness.stale_machines}/${result.freshness.total_machines} stale · zero-cost token rows ${result.quality.zero_cost_token_requests}`)
      for (const row of result.top_machines) {
        console.log(`  ${chalk.white(row.machine_id.padEnd(12))} ${fmt(row.cost_usd).padEnd(10)} ${row.sessions} sessions · ${row.requests} requests`)
      }
      for (const hint of result.hints) console.log(chalk.dim(`  hint: ${hint}`))
      console.log()
    })

  program
    .command('completion <shell>')
    .description('Print shell completion script (bash, zsh, or fish)')
    .action((shell: string) => {
      printCompletion(shell)
    })
}
