import chalk from 'chalk'
import { watch } from 'fs'
import { openDatabase } from '../../db/database.js'
import { syncAll } from '../../lib/sync-all.js'
import { getStore, isCloudStore } from '../../lib/store/index.js'
import { getWatchPaths } from '../../lib/watch-paths.js'
import type { Agent } from '../../types/index.js'
import { sendNotification } from './notification.js'

interface WatchOptions {
  interval: number
  agent?: Agent
  notify?: number
  daemon?: boolean
}

function fmt(usd: number): string {
  return chalk.green(`$${usd.toFixed(4)}`)
}

function renderHeader(todayUsd: number, weekUsd: number, mode: string): void {
  process.stdout.write('\x1b[H\x1b[2J')
  console.log(chalk.bold.cyan('  economy watch') + chalk.dim(` — live cost stream (${mode})`))
  console.log(chalk.dim('  ─────────────────────────────────────────'))
  console.log(`  Today:  ${fmt(todayUsd)}   Week: ${fmt(weekUsd)}`)
  console.log(chalk.dim('  ─────────────────────────────────────────'))
  console.log(chalk.dim('  [agent]  cost     model                  tokens   project'))
  console.log(chalk.dim('  ─────────────────────────────────────────'))
}

function agentLabel(agent: string): string {
  if (agent === 'claude') return chalk.blue('[claude]')
  if (agent === 'codex') return chalk.yellow('[codex] ')
  if (agent === 'gemini') return chalk.green('[gemini]')
  if (agent === 'takumi') return chalk.magenta('[takumi]')
  if (agent === 'opencode') return chalk.cyan('[opncde]')
  if (agent === 'cursor') return chalk.white('[cursor]')
  if (agent === 'pi') return chalk.white('[pi    ]')
  if (agent === 'hermes') return chalk.white('[hermes]')
  return chalk.gray(`[${agent.slice(0, 6).padEnd(6)}]`)
}

export async function watchCosts(opts: WatchOptions): Promise<void> {
  const store = getStore()
  const cloud = isCloudStore()
  // Local ingestion writes to the on-box db; self_hosted/cloud mode streams the
  // shared dataset from the API and never ingests local files.
  const db = cloud ? null : openDatabase()
  let lastCheck = new Date(Date.now() - opts.interval * 1000).toISOString()
  const lines: string[] = []
  const MAX_LINES = 20

  let sessionCumulativeCost = 0
  let notifyThresholdFired = 0
  let ingestPending = false
  let ingestTimer: ReturnType<typeof setTimeout> | null = null

  // File-watch ingestion only applies to the local transport.
  const daemon = opts.daemon && !cloud
  const mode = cloud ? 'cloud' : daemon ? 'daemon' : 'poll'
  const initialSummaryToday = await store.summary('today')
  const initialSummaryWeek = await store.summary('week')
  renderHeader(initialSummaryToday.total_usd, initialSummaryWeek.total_usd, mode)

  if (daemon) {
    const paths = getWatchPaths()
    console.log(chalk.dim(`\n  Watching ${paths.length} paths — sync on change, refresh every ${opts.interval}s\n`))
    for (const p of paths) {
      try {
        watch(p, { recursive: true }, () => scheduleIngest())
      } catch {
        try { watch(p, () => scheduleIngest()) } catch { /* skip unreadable paths */ }
      }
    }
  } else if (cloud) {
    console.log(chalk.dim(`\n  Streaming from cloud API every ${opts.interval}s — Ctrl+C to exit\n`))
  } else {
    console.log(chalk.dim(`\n  Polling every ${opts.interval}s — Ctrl+C to exit\n`))
  }

  function scheduleIngest(): void {
    ingestPending = true
    if (ingestTimer) return
    ingestTimer = setTimeout(() => {
      ingestTimer = null
      void poll()
    }, 500)
  }

  async function poll(): Promise<void> {
    const now = new Date().toISOString()
    const shouldSync = !daemon || ingestPending
    ingestPending = false

    if (shouldSync && db) await syncAll(db)

    const newRequests = await store.recentRequests(lastCheck)
    lastCheck = now

    for (const req of newRequests) {
      if (opts.agent && req.agent !== opts.agent) continue

      const tokens = req.input_tokens + req.output_tokens
      const tokStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)

      const line = `  ${agentLabel(req.agent)}  ${fmt(req.cost_usd).padEnd(14)}${req.model.substring(0, 24).padEnd(26)}${tokStr.padEnd(10)}${req.session_id.substring(0, 12)}`
      lines.push(line)
      if (lines.length > MAX_LINES) lines.shift()

      if (req.cost_usd > 1.0) {
        sendNotification('economy: high cost', `$${req.cost_usd.toFixed(2)} on ${req.model}`)
      }

      if (opts.notify && opts.notify > 0) {
        sessionCumulativeCost += req.cost_usd
        const crossedThresholds = Math.floor(sessionCumulativeCost / opts.notify)
        if (crossedThresholds > notifyThresholdFired) {
          notifyThresholdFired = crossedThresholds
          sendNotification('Cost Alert', `Economy: $${sessionCumulativeCost.toFixed(2)} spent this session`)
        }
      }
    }

    const today = await store.summary('today')
    const week = await store.summary('week')
    renderHeader(today.total_usd, week.total_usd, mode)
    for (const line of lines) console.log(line)
    if (lines.length === 0) console.log(chalk.dim('  Waiting for new requests...'))
    const suffix = daemon
      ? `file watch + ${opts.interval}s refresh`
      : cloud
        ? `cloud stream every ${opts.interval}s`
        : `polling every ${opts.interval}s`
    console.log(chalk.dim(`\n  Last updated: ${new Date().toLocaleTimeString()} — ${suffix} — Ctrl+C to exit`))
  }

  if (daemon) ingestPending = true
  await poll()
  // A failed poll during the interval must not crash the watcher with an
  // unhandled rejection — surface it as a dim line and keep streaming.
  const timer = setInterval(() => {
    void poll().catch((e: unknown) => {
      console.log(chalk.dim(`\n  Poll error: ${e instanceof Error ? e.message : String(e)} — retrying next tick`))
    })
  }, opts.interval * 1000)

  process.on('SIGINT', () => {
    clearInterval(timer)
    if (ingestTimer) clearTimeout(ingestTimer)
    console.log(chalk.dim('\n\n  Stopped watching.'))
    process.exit(0)
  })

  await new Promise<void>(() => {})
}
