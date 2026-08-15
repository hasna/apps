import { Command } from 'commander'
import { getMachineId } from '../../db/database.js'
import { getStore, isCloudStore } from '../../lib/store/index.js'
import { formatAge } from '../../lib/brief.js'
import type {
  BriefAccountRow,
  BriefTotals,
  EconomyBrief,
} from '../../lib/brief.js'

export type { EconomyBrief } from '../../lib/brief.js'

interface BriefCommandDeps {
  beforeRead?: () => void | Promise<void>
}

function formatUsd(usd: number): string {
  if (usd >= 0.01) return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (usd >= 0.0001) return `${(usd * 100).toFixed(2).replace(/\.?0+$/, '')}c`
  if (usd > 0) return '<0.01c'
  return '$0.00'
}

function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return formatCount(n)
}

function accountLabel(row: BriefAccountRow): string {
  return row.account_email || row.account_name || row.account_key || 'unknown'
}

function cacheLabel(row: Pick<BriefTotals, 'cache_read_tokens' | 'cache_create_tokens' | 'cache_create_5m_tokens' | 'cache_create_1h_tokens'>): string {
  const total = row.cache_read_tokens + row.cache_create_tokens
  const split = row.cache_create_5m_tokens || row.cache_create_1h_tokens
    ? `; 5m ${formatTokens(row.cache_create_5m_tokens)} / 1h ${formatTokens(row.cache_create_1h_tokens)}`
    : ''
  return `${formatTokens(total)} (r ${formatTokens(row.cache_read_tokens)} / w ${formatTokens(row.cache_create_tokens)}${split})`
}

function table(headers: string[], rows: string[][]): string[] {
  if (rows.length === 0) return ['(none)']
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map(row => (row[index] ?? '').length)))
  const lines: string[] = []
  lines.push(headers.map((header, index) => header.padEnd(widths[index]!)).join('  '))
  lines.push(widths.map(width => '-'.repeat(width)).join('  '))
  for (const row of rows) {
    lines.push(row.map((cell, index) => cell.padEnd(widths[index]!)).join('  '))
  }
  return lines
}

export function renderBriefText(brief: EconomyBrief): string {
  const lines: string[] = []
  lines.push(`Economy Brief - ${brief.machine === 'all' ? 'fleet' : brief.machine}`)
  lines.push(`Generated: ${brief.generated_at}`)
  lines.push(`Since: ${brief.since.label} (${brief.since.timestamp})`)
  lines.push('')

  lines.push('SUMMARY')
  lines.push(...table(
    ['Period', 'Sessions', 'Requests', 'Input', 'Output', 'Cache', 'Tokens', 'Cost'],
    brief.summaries.map(row => [
      row.label,
      formatCount(row.sessions),
      formatCount(row.requests),
      formatTokens(row.input_tokens),
      formatTokens(row.output_tokens),
      cacheLabel(row),
      formatTokens(row.total_tokens),
      formatUsd(row.cost_usd),
    ]),
  ))
  lines.push('')

  lines.push(`PER-MACHINE - since ${brief.since.label}`)
  lines.push(...table(
    ['Machine', 'Sessions', 'Tokens', 'Cache', 'Cost', 'Last Data Age'],
    brief.machines.map(row => [
      row.machine_id,
      formatCount(row.sessions),
      formatTokens(row.total_tokens),
      cacheLabel(row),
      formatUsd(row.cost_usd),
      row.last_data_age,
    ]),
  ))
  lines.push('')

  lines.push(`PER-AGENT - since ${brief.since.label}`)
  lines.push(...table(
    ['Agent', 'Sessions', 'Requests', 'Tokens', 'Cache', 'Cost', 'Last Active'],
    brief.agents.map(row => [
      row.agent,
      formatCount(row.sessions),
      formatCount(row.requests),
      formatTokens(row.total_tokens),
      cacheLabel(row),
      formatUsd(row.cost_usd),
      row.last_active?.substring(0, 19) ?? '-',
    ]),
  ))
  lines.push('')

  lines.push(`PER-ACCOUNT - since ${brief.since.label}`)
  lines.push(...table(
    ['Account', 'Agent', 'Sessions', 'Requests', 'Tokens', 'Cost', 'Last Active'],
    brief.accounts.map(row => [
      accountLabel(row),
      row.account_tool,
      formatCount(row.sessions),
      formatCount(row.requests),
      formatTokens(row.total_tokens),
      formatUsd(row.cost_usd),
      row.last_active?.substring(0, 19) ?? '-',
    ]),
  ))
  lines.push('')

  lines.push('FRESHNESS')
  lines.push(`Max request: ${brief.freshness.max_request_line}`)
  lines.push(`Merge/sync: ${brief.freshness.merge_sync_line}`)
  lines.push('')

  return lines.join('\n')
}

// formatAge is re-exported for callers that render brief rows externally.
export { formatAge }

export function registerBriefCommand(program: Command, deps: BriefCommandDeps = {}): void {
  program
    .command('brief')
    .description('Fleet-wide usage brief with tokens, cache, cost, breakdowns, and freshness')
    .option('--since <duration-or-date>', 'Since window for breakdown tables (24h, 7d, ISO date)', '24h')
    .option('--machine <id|all>', 'Filter to one machine, or all machines', 'all')
    .option('--json', 'Output JSON')
    .action(async (opts: { since?: string; machine?: string; json?: boolean }) => {
      try {
        // Local mode ingests fresh data before reading; cloud mode reads the
        // shared dataset straight from the API (beforeRead no-ops there).
        let localSyncAt: Date | undefined
        if (deps.beforeRead) {
          await deps.beforeRead()
          if (!isCloudStore()) localSyncAt = new Date()
        }
        const brief = await getStore().brief({
          since: opts.since,
          machine: opts.machine,
          currentMachineId: localSyncAt ? getMachineId() : undefined,
          localSyncAt,
        })
        if (opts.json) {
          console.log(JSON.stringify(brief, null, 2))
          return
        }
        console.log(renderBriefText(brief))
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })
}
