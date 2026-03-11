#!/usr/bin/env bun
import { Command } from 'commander'
import chalk from 'chalk'
import { openDatabase, querySummary, querySessions, queryTopSessions, queryModelBreakdown, queryProjectBreakdown, queryDailyBreakdown, listBudgets, getBudgetStatuses, upsertBudget, deleteBudget, listProjects, upsertProject, deleteProject, getProject, listModelPricing, upsertModelPricing, deleteModelPricing } from '../db/database.js'
import { ingestClaude } from '../ingest/claude.js'
import { ingestCodex } from '../ingest/codex.js'
import { ensurePricingSeeded } from '../lib/pricing.js'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'
import type { Period, Agent } from '../types/index.js'

const program = new Command()

program
  .name('economy')
  .description('AI coding cost tracker — Claude Code, Codex, and Gemini')
  .version('0.1.1')

// ── Auto-sync helper ──────────────────────────────────────────────────────────

async function autoSync(): Promise<void> {
  const db = openDatabase()
  ensurePricingSeeded(db)
  await ingestClaude(db)
  await ingestCodex(db)
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
  } else {
    formatted = '$' + usd.toFixed(6)
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
  .description('Ingest cost data from Claude Code and Codex')
  .option('--claude', 'Only ingest Claude Code telemetry')
  .option('--codex', 'Only ingest Codex sessions')
  .option('-v, --verbose', 'Verbose output')
  .option('--force', 'Force re-process all files (ignore mtime cache)')
  .action(async (opts: { claude?: boolean; codex?: boolean; verbose?: boolean; force?: boolean }) => {
    const db = openDatabase()
    ensurePricingSeeded(db)
    if (opts.force) {
      db.exec(`DELETE FROM ingest_state WHERE source = 'claude'`)
      if (opts.verbose) console.log(chalk.dim('Cleared ingest cache'))
    }
    const doClaude = opts.claude || (!opts.claude && !opts.codex)
    const doCodex = opts.codex || (!opts.claude && !opts.codex)
    if (doClaude) {
      process.stdout.write(chalk.cyan('→ Ingesting Claude Code telemetry... '))
      const r = await ingestClaude(db, opts.verbose)
      console.log(chalk.green(`✓ ${r.files} files, ${r.requests} requests, ${r.sessions} sessions`))
    }
    if (doCodex) {
      process.stdout.write(chalk.cyan('→ Ingesting Codex sessions... '))
      const r = await ingestCodex(db, opts.verbose)
      console.log(chalk.green(`✓ ${r.sessions} sessions`))
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
  .option('--agent <agent>', 'Filter by agent (claude|codex)')
  .option('--project <path>', 'Filter by project path')
  .option('--limit <n>', 'Number of sessions', '20')
  .action(async (opts: { agent?: string; project?: string; limit?: string }) => {
    await autoSync()
    const db = openDatabase()
    const sessions = querySessions(db, {
      agent: opts.agent as Agent | undefined,
      project: opts.project,
      limit: Number(opts.limit ?? 20),
    })
    if (sessions.length === 0) {
      console.log(chalk.yellow('No sessions found. Run `economy sync` first.'))
      return
    }
    console.log()
    printTable(
      ['Session ID', 'Agent', 'Project', 'Cost', 'Tokens', 'Requests', 'Started'],
      sessions.map(s => [
        chalk.dim(s.id.substring(0, 12)),
        s.agent === 'claude' ? chalk.blue('claude') : chalk.yellow('codex'),
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
  .action((opts: { n?: string; agent?: string }) => {
    const db = openDatabase()
    const sessions = queryTopSessions(db, Number(opts.n ?? 10), opts.agent)
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
        s.agent === 'claude' ? chalk.blue('claude') : chalk.yellow('codex'),
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
  .description('Cost breakdown by model, agent, or project')
  .option('--by <dimension>', 'Dimension: model|agent|project', 'model')
  .action((opts: { by?: string }) => {
    const db = openDatabase()
    console.log()
    if (opts.by === 'project') {
      const rows = queryProjectBreakdown(db)
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
    } else {
      const rows = queryModelBreakdown(db)
      printTable(
        ['Model', 'Agent', 'Requests', 'Tokens', 'Cost'],
        rows.map(r => [
          chalk.white(r.model),
          r.agent === 'claude' ? chalk.blue('claude') : chalk.yellow('codex'),
          String(r.requests),
          chalk.cyan(fmtTokens(r.total_tokens)),
          fmt(r.cost_usd),
        ]),
      )
    }
    console.log()
  })

// ── watch ─────────────────────────────────────────────────────────────────────

program
  .command('watch')
  .description('Live stream of incoming costs')
  .option('--interval <seconds>', 'Poll interval in seconds', '10')
  .option('--agent <agent>', 'Filter by agent')
  .action(async (opts: { interval?: string; agent?: string }) => {
    const { watchCosts } = await import('./commands/watch.js')
    await watchCosts({ interval: Number(opts.interval ?? 10), agent: opts.agent as Agent | undefined })
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
  .option('--agent <agent>', 'Limit to agent (claude|codex)')
  .action((opts: { project?: string; period?: string; limit?: string; alert?: string; agent?: string }) => {
    if (!opts.limit) { console.error(chalk.red('--limit is required')); process.exit(1) }
    const db = openDatabase()
    const now = new Date().toISOString()
    upsertBudget(db, {
      id: randomUUID(),
      project_path: opts.project ?? null,
      agent: opts.agent as Agent ?? null,
      period: (opts.period ?? 'monthly') as 'daily' | 'weekly' | 'monthly',
      limit_usd: Number(opts.limit),
      alert_at_percent: Number(opts.alert ?? 80),
      created_at: now,
      updated_at: now,
    })
    console.log(chalk.green(`✓ Budget set: ${opts.project ?? 'global'} — ${opts.period} $${opts.limit}`))
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
      ['Model', 'Input/1M', 'Output/1M', 'CacheRead/1M', 'CacheWrite/1M'],
      rows.map(r => [
        chalk.white(r.model),
        fmt(r.input_per_1m),
        fmt(r.output_per_1m),
        fmt(r.cache_read_per_1m),
        fmt(r.cache_write_per_1m),
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
  .option('--cache-write <usd>', 'Cache write price per 1M tokens', '0')
  .action((model: string, opts: { input?: string; output?: string; cacheRead?: string; cacheWrite?: string }) => {
    if (!opts.input || !opts.output) { console.error(chalk.red('--input and --output are required')); process.exit(1) }
    const db = openDatabase()
    ensurePricingSeeded(db)
    upsertModelPricing(db, {
      model,
      input_per_1m: Number(opts.input),
      output_per_1m: Number(opts.output),
      cache_read_per_1m: Number(opts.cacheRead ?? 0),
      cache_write_per_1m: Number(opts.cacheWrite ?? 0),
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
    const port = Number(opts.port ?? 3456)
    const { startServer } = await import('../server/index.js')
    startServer(port)
  })

// ── dashboard ─────────────────────────────────────────────────────────────────

program
  .command('dashboard')
  .description('Open the web dashboard (auto-starts server if not running)')
  .option('-p, --port <port>', 'Server port', '3456')
  .action(async (opts: { port?: string }) => {
    const port = Number(opts.port ?? 3456)
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
  .option('--all', 'Install into all agents')
  .action(async (opts: { claude?: boolean; codex?: boolean; all?: boolean }) => {
    const doAll = opts.all || (!opts.claude && !opts.codex)
    if (opts.claude || doAll) {
      console.log(chalk.bold.cyan('\nClaude Code:'))
      console.log(chalk.white('  claude mcp add --transport stdio --scope user economy -- economy-mcp'))
    }
    if (opts.codex || doAll) {
      console.log(chalk.bold.yellow('\nCodex (~/.codex/config.toml):'))
      console.log(chalk.white('  [mcp_servers.economy]\n  command = "economy-mcp"\n  args = []'))
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
    const today = now.toISOString().substring(0, 10)

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

program.parse()
