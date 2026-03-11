#!/usr/bin/env bun
import { Command } from 'commander'
import chalk from 'chalk'
import { openDatabase, querySummary, querySessions, queryTopSessions, queryModelBreakdown, queryProjectBreakdown, listBudgets, getBudgetStatuses, upsertBudget, deleteBudget, listProjects, upsertProject, deleteProject, getProject, listModelPricing, upsertModelPricing, deleteModelPricing } from '../db/database.js'
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
  .version('0.1.0')

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(usd: number): string {
  return chalk.green(`$${usd.toFixed(4)}`)
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
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
      ['Sessions', chalk.yellow(String(s.sessions))],
      ['Requests', chalk.yellow(String(s.requests))],
      ['Tokens', chalk.yellow(fmtTokens(s.tokens))],
    ],
  )
  console.log()
}

// ── sync ──────────────────────────────────────────────────────────────────────

program
  .command('sync')
  .description('Ingest cost data from Claude Code and Codex')
  .option('--claude', 'Only ingest Claude Code telemetry')
  .option('--codex', 'Only ingest Codex sessions')
  .option('-v, --verbose', 'Verbose output')
  .action(async (opts: { claude?: boolean; codex?: boolean; verbose?: boolean }) => {
    const db = openDatabase()
    ensurePricingSeeded(db)
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
    console.log(chalk.bold.green('\n✓ Sync complete'))
  })

// ── today / week / month ──────────────────────────────────────────────────────

program.command('today').description('Cost summary for today').action(() => printSummary('Today', 'today'))
program.command('week').description('Cost summary for this week').action(() => printSummary('This Week', 'week'))
program.command('month').description('Cost summary for this month').action(() => printSummary('This Month', 'month'))

// ── sessions ──────────────────────────────────────────────────────────────────

program
  .command('sessions')
  .description('List coding sessions with costs')
  .option('--agent <agent>', 'Filter by agent (claude|codex)')
  .option('--project <path>', 'Filter by project path')
  .option('--limit <n>', 'Number of sessions', '20')
  .action((opts: { agent?: string; project?: string; limit?: string }) => {
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
        String(s.request_count),
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

program.parse()
