import chalk from 'chalk'
import { getStore, type EconomyStore } from '../../lib/store/index.js'
import { getServeApiToken } from '../../lib/serve-auth.js'
import type { SavingsSummary } from '../../lib/savings.js'
import type { AgentBreakdown, CostSummary, UsageSnapshot } from '../../types/index.js'

function fmt(usd: number): string {
  return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Everything the status surfaces need, gathered through the Store (never sqlite
 * directly) so local and self_hosted/cloud render the same numbers. */
export interface StatusData {
  today: CostSummary
  week: CostSummary
  month: CostSummary
  savings: SavingsSummary
  machineCount: number
  topAgent: string
  quota: string | null
  transport: EconomyStore['transport']
}

function topAgentFrom(rows: AgentBreakdown[]): string {
  let top: AgentBreakdown | undefined
  for (const row of rows) {
    if (!top || row.cost_usd > top.cost_usd) top = row
  }
  return top?.agent ?? '—'
}

function quotaFrom(snapshots: UsageSnapshot[]): string | null {
  const claude = snapshots.find((s) => s.agent === 'claude' && s.metric === 'five_hour_utilization')
  const codex = snapshots.find((s) => s.agent === 'codex' && s.metric === 'five_hour_utilization')
  const parts: string[] = []
  if (claude) parts.push(`claude ${claude.value.toFixed(0)}%`)
  if (codex) parts.push(`codex ${codex.value.toFixed(0)}%`)
  return parts.length ? parts.join(' · ') : null
}

/** Collect the status snapshot from the active Store transport. */
export async function gatherStatusData(store: EconomyStore = getStore()): Promise<StatusData> {
  const [today, week, month, savings, machines, agents, usage] = await Promise.all([
    store.summary('today'),
    store.summary('week'),
    store.summary('month'),
    store.savings('month') as Promise<SavingsSummary>,
    store.machines(),
    store.agentBreakdown({ period: 'month' }),
    store.usage('today') as Promise<{ snapshots: UsageSnapshot[] }>,
  ])
  return {
    today,
    week,
    month,
    savings,
    machineCount: machines.length,
    topAgent: topAgentFrom(agents),
    quota: quotaFrom(usage?.snapshots ?? []),
    transport: store.transport,
  }
}

/** Deployment label for the status line, derived purely from the active Store
 * transport: the cloud HTTP transport is self_hosted/cloud, else local. */
function modeLabel(transport: EconomyStore['transport']): string {
  return transport === 'cloud-http' ? 'self_hosted' : 'local'
}

export function buildStatusLine(data: StatusData): string {
  const parts = [
    `today ${fmt(data.today.total_usd)}`,
    `week ${fmt(data.week.total_usd)}`,
    `top ${data.topAgent}`,
    `${data.machineCount} machines`,
    modeLabel(data.transport),
  ]
  if (data.quota) parts.push(data.quota)
  return parts.join(' · ')
}

export function buildWaybarJson(data: StatusData): Record<string, unknown> {
  return {
    text: fmt(data.today.total_usd),
    tooltip: buildStatusLine(data),
    class: data.quota?.includes('%') && Number(data.quota.match(/(\d+)%/)?.[1] ?? 0) >= 80 ? 'warning' : 'default',
    percentage: null,
    savings_usd: data.savings.saved_usd,
  }
}

export async function printStatusLine(): Promise<void> {
  console.log(buildStatusLine(await gatherStatusData()))
}

export async function printWaybarJson(): Promise<void> {
  console.log(JSON.stringify(buildWaybarJson(await gatherStatusData())))
}

export async function runTui(opts: { watch?: boolean; interval?: number }): Promise<void> {
  const interval = opts.interval ?? 30

  const render = async () => {
    const data = await gatherStatusData()

    process.stdout.write('\x1b[H\x1b[2J')
    console.log(chalk.bold.cyan('  economy'))
    console.log(chalk.dim('  ─────────────────────────────────'))
    console.log(`  Today   ${chalk.green(fmt(data.today.total_usd))}   ${data.today.sessions} sessions`)
    console.log(`  Week    ${fmt(data.week.total_usd)}   ${data.week.sessions} sessions`)
    console.log(`  Month   ${fmt(data.month.total_usd)}   saved ${fmt(data.savings.saved_usd)}`)
    console.log(chalk.dim('  ─────────────────────────────────'))
    console.log(`  Top agent: ${data.topAgent}`)
    if (data.quota) console.log(`  Quota:     ${data.quota}`)
    console.log(`  Fleet:     ${data.machineCount} machines`)
    console.log(`  Store:     ${data.transport === 'cloud-http' ? 'self_hosted (cloud API)' : 'local'}`)
    if (getServeApiToken()) console.log(chalk.dim('  API auth:  HASNA_ECONOMY_API_TOKEN set'))
    console.log(chalk.dim(`\n  ${opts.watch ? `Refreshing every ${interval}s — Ctrl+C to exit` : 'Run with --watch for live refresh'}`))
  }

  await render()
  if (!opts.watch) return

  const timer = setInterval(() => { void render() }, interval * 1000)
  process.on('SIGINT', () => {
    clearInterval(timer)
    process.exit(0)
  })
  await new Promise<void>(() => {})
}
