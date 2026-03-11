import chalk from 'chalk'
import { openDatabase, querySummary, queryRequestsSince } from '../../db/database.js'
import { ingestClaude } from '../../ingest/claude.js'
import { ingestCodex } from '../../ingest/codex.js'
import type { Agent } from '../../types/index.js'

interface WatchOptions {
  interval: number
  agent?: Agent
}

function fmt(usd: number): string {
  return chalk.green(`$${usd.toFixed(4)}`)
}

function notify(title: string, body: string): void {
  try {
    const { execSync } = require('child_process') as typeof import('child_process')
    execSync(`osascript -e 'display notification "${body.replace(/'/g, '')}" with title "${title.replace(/'/g, '')}"'`, { stdio: 'ignore' })
  } catch { /* non-macOS */ }
}

function renderHeader(todayUsd: number, weekUsd: number): void {
  process.stdout.write('\x1b[H\x1b[2J') // clear screen
  console.log(chalk.bold.cyan('  economy watch') + chalk.dim(' — live cost stream'))
  console.log(chalk.dim('  ─────────────────────────────────────────'))
  console.log(`  Today:  ${fmt(todayUsd)}   Week: ${fmt(weekUsd)}`)
  console.log(chalk.dim('  ─────────────────────────────────────────'))
  console.log(chalk.dim('  [agent]  cost     model                  tokens   project'))
  console.log(chalk.dim('  ─────────────────────────────────────────'))
}

export async function watchCosts(opts: WatchOptions): Promise<void> {
  const db = openDatabase()
  let lastCheck = new Date(Date.now() - opts.interval * 1000).toISOString()
  const lines: string[] = []
  const MAX_LINES = 20

  // Initial render
  const initialSummaryToday = querySummary(db, 'today')
  const initialSummaryWeek = querySummary(db, 'week')
  renderHeader(initialSummaryToday.total_usd, initialSummaryWeek.total_usd)

  console.log(chalk.dim(`\n  Polling every ${opts.interval}s — Ctrl+C to exit\n`))

  async function poll(): Promise<void> {
    const now = new Date().toISOString()

    // Incremental ingest
    await ingestClaude(db)
    await ingestCodex(db)

    // Get new requests since last check
    const newRequests = queryRequestsSince(db, lastCheck)
    lastCheck = now

    for (const req of newRequests) {
      if (opts.agent && req.agent !== opts.agent) continue

      const agentLabel = req.agent === 'claude' ? chalk.blue('[claude]') : chalk.yellow('[codex] ')
      const tokens = req.input_tokens + req.output_tokens
      const tokStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)

      const line = `  ${agentLabel}  ${fmt(req.cost_usd).padEnd(14)}${req.model.substring(0, 24).padEnd(26)}${tokStr.padEnd(10)}${req.session_id.substring(0, 12)}`
      lines.push(line)
      if (lines.length > MAX_LINES) lines.shift()

      // Notify on large cost
      if (req.cost_usd > 1.0) {
        notify('economy: high cost', `$${req.cost_usd.toFixed(2)} on ${req.model}`)
      }
    }

    // Re-render
    const today = querySummary(db, 'today')
    const week = querySummary(db, 'week')
    renderHeader(today.total_usd, week.total_usd)
    for (const line of lines) console.log(line)
    if (lines.length === 0) console.log(chalk.dim('  Waiting for new requests...'))
    console.log(chalk.dim(`\n  Last updated: ${new Date().toLocaleTimeString()} — polling every ${opts.interval}s — Ctrl+C to exit`))
  }

  // Run immediately
  await poll()

  // Then poll on interval
  const timer = setInterval(poll, opts.interval * 1000)

  // Clean exit
  process.on('SIGINT', () => {
    clearInterval(timer)
    console.log(chalk.dim('\n\n  Stopped watching.'))
    process.exit(0)
  })

  // Keep process alive
  await new Promise<void>(() => {})
}
