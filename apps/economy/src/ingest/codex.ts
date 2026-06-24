import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { Database as BunDatabase } from 'bun:sqlite'
import type { SqliteAdapter as Database } from '@hasna/cloud'
import {
  upsertRequest, upsertSession, rollupSession, getIngestState, setIngestState, getMachineId,
} from '../db/database.js'
import { computeCostFromDb } from '../lib/pricing.js'
import { defaultCostBasisForAgent } from '../lib/savings.js'
import { resolveAccountForAgent, withAccount } from '../lib/accounts.js'

const DEFAULT_CODEX_DB_PATH = join(homedir(), '.codex', 'state_5.sqlite')
const DEFAULT_CODEX_CONFIG_PATH = join(homedir(), '.codex', 'config.toml')
const DEFAULT_CODEWITH_DB_PATH = join(homedir(), '.codewith', 'state_5.sqlite')
const DEFAULT_CODEWITH_CONFIG_PATH = join(homedir(), '.codewith', 'config.toml')
const CODEX_INGEST_VERSION = 'rollout-aggregate-v3'

interface CodexThread {
  id: string
  rollout_path: string | null
  cwd: string
  created_at: number
  updated_at: number
  tokens_used: number
  title: string | null
  model_provider: string | null
  model: string | null
}

interface CodexTokenUsage {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

interface CodexTokenEvent {
  usage: CodexTokenUsage
  timestamp?: string
}

interface CodexSource {
  label: string
  dbPath: string
  configPath: string
  sessionPrefix: string
  stateSource: string
}

function codexDbPath(): string {
  return process.env['HASNA_ECONOMY_CODEX_DB_PATH'] ?? DEFAULT_CODEX_DB_PATH
}

function codexConfigPath(): string {
  return process.env['HASNA_ECONOMY_CODEX_CONFIG_PATH'] ?? DEFAULT_CODEX_CONFIG_PATH
}

function codewithDbPath(): string {
  return process.env['HASNA_ECONOMY_CODEWITH_DB_PATH'] ?? DEFAULT_CODEWITH_DB_PATH
}

function codewithConfigPath(): string {
  return process.env['HASNA_ECONOMY_CODEWITH_CONFIG_PATH'] ?? DEFAULT_CODEWITH_CONFIG_PATH
}

function codexSources(): CodexSource[] {
  const explicitCodexPath = process.env['HASNA_ECONOMY_CODEX_DB_PATH']
  const explicitCodewithPath = process.env['HASNA_ECONOMY_CODEWITH_DB_PATH']
  const sources: CodexSource[] = [{
    label: 'Codex',
    dbPath: codexDbPath(),
    configPath: codexConfigPath(),
    sessionPrefix: 'codex',
    stateSource: 'codex',
  }]

  if (!explicitCodexPath || explicitCodewithPath) {
    sources.push({
      label: 'Codewith',
      dbPath: codewithDbPath(),
      configPath: codewithConfigPath(),
      sessionPrefix: 'codex-codewith',
      stateSource: 'codex-codewith',
    })
  }

  const seen = new Set<string>()
  return sources.filter((source) => {
    if (seen.has(source.dbPath)) return false
    seen.add(source.dbPath)
    return true
  })
}

function readCodexModel(configPath = codexConfigPath()): string {
  if (!existsSync(configPath)) return 'gpt-5-codex'
  try {
    const content = readFileSync(configPath, 'utf-8')
    const match = content.match(/^model\s*=\s*"([^"]+)"/m)
    return match?.[1] ?? 'gpt-5-codex'
  } catch {
    return 'gpt-5-codex'
  }
}

function buildThreadQuery(codexDb: BunDatabase): string {
  const cols = new Set((codexDb.prepare(`PRAGMA table_info(threads)`).all() as Array<{ name: string }>).map(c => c.name))
  const modelSelect = cols.has('model') ? 'model' : 'NULL AS model'
  const rolloutSelect = cols.has('rollout_path') ? 'rollout_path' : 'NULL AS rollout_path'
  const providerSelect = cols.has('model_provider') ? 'model_provider' : 'NULL AS model_provider'
  return `
    SELECT id, ${rolloutSelect}, cwd, created_at, updated_at, tokens_used, title,
           ${providerSelect}, ${modelSelect}
    FROM threads WHERE tokens_used > 0
  `
}

function openCodexDb(dbPath: string, verbose: boolean): BunDatabase | null {
  let lastError: unknown
  for (const readonly of [true, false]) {
    let codexDb: BunDatabase | null = null
    try {
      codexDb = readonly ? new BunDatabase(dbPath, { readonly: true }) : new BunDatabase(dbPath)
      codexDb.prepare('PRAGMA schema_version').get()
      return codexDb
    } catch (error) {
      lastError = error
      codexDb?.close()
    }
  }
  if (verbose) {
    const message = lastError instanceof Error ? lastError.message : String(lastError)
    console.log('Codex DB unreadable:', dbPath, message)
  }
  return null
}

function readTokenEvents(rolloutPath: string | null): CodexTokenEvent[] {
  if (!rolloutPath || !existsSync(rolloutPath)) return []
  const fallbackUsages = new Map<string, CodexTokenUsage>()
  let fallbackTimestamp: string | undefined
  let aggregate: CodexTokenEvent | null = null
  for (const line of readFileSync(rolloutPath, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    let entry: unknown
    try { entry = JSON.parse(line) } catch { continue }
    if (!entry || typeof entry !== 'object') continue
    const payload = (entry as Record<string, unknown>)['payload'] as Record<string, unknown> | undefined
    if (!payload || payload['type'] !== 'token_count') continue
    const info = payload['info'] as Record<string, unknown> | undefined
    const timestamp = (entry as Record<string, unknown>)['timestamp']
    const entryTimestamp = typeof timestamp === 'string' ? timestamp : undefined
    const totalUsage = info?.['total_token_usage'] as CodexTokenUsage | undefined
    if (totalUsage && tokenTotal(totalUsage) > 0) {
      aggregate = { usage: totalUsage, timestamp: entryTimestamp }
      continue
    }

    const usage = info?.['last_token_usage'] as CodexTokenUsage | undefined
    if (!usage) continue
    if (tokenTotal(usage) <= 0) continue

    // Older rollouts may only have per-call usage. Deduplicate repeated payloads
    // and aggregate them into one Economy request to keep historical sync fast.
    const key = JSON.stringify(usage)
    if (!fallbackUsages.has(key)) fallbackUsages.set(key, usage)
    fallbackTimestamp = entryTimestamp ?? fallbackTimestamp
  }
  if (aggregate) return [aggregate]
  if (fallbackUsages.size === 0) return []
  return [{ usage: sumTokenUsages([...fallbackUsages.values()]), timestamp: fallbackTimestamp }]
}

function tokenTotal(usage: CodexTokenUsage): number {
  return usage.total_tokens ?? ((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0))
}

function sumTokenUsages(usages: CodexTokenUsage[]): CodexTokenUsage {
  const result: CodexTokenUsage = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  }
  for (const usage of usages) {
    result.input_tokens = (result.input_tokens ?? 0) + (usage.input_tokens ?? 0)
    result.cached_input_tokens = (result.cached_input_tokens ?? 0) + (usage.cached_input_tokens ?? 0)
    result.output_tokens = (result.output_tokens ?? 0) + (usage.output_tokens ?? 0)
    result.reasoning_output_tokens = (result.reasoning_output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0)
    result.total_tokens = (result.total_tokens ?? 0) + tokenTotal(usage)
  }
  return result
}

function fallbackEvents(totalTokens: number): CodexTokenEvent[] {
  const inputTokens = Math.floor(totalTokens * 0.6)
  return [{
    usage: {
      input_tokens: inputTokens,
      cached_input_tokens: 0,
      output_tokens: totalTokens - inputTokens,
      total_tokens: totalTokens,
    },
  }]
}

export async function ingestCodex(db: Database, verbose = false): Promise<{ sessions: number; requests: number }> {
  const machineId = getMachineId()
  let ingested = 0
  let requests = 0
  const account = await resolveAccountForAgent('codex')

  for (const source of codexSources()) {
    if (!existsSync(source.dbPath)) {
      if (verbose) console.log(`${source.label} DB not found:`, source.dbPath)
      continue
    }

    let codexDb: BunDatabase | null = null
    try {
      codexDb = openCodexDb(source.dbPath, verbose)
      if (!codexDb) continue

      const threads = codexDb.prepare(buildThreadQuery(codexDb)).all() as CodexThread[]

      for (const thread of threads) {
        const model = thread.model ?? readCodexModel(source.configPath)
        const stateValue = `${CODEX_INGEST_VERSION}:${thread.updated_at}:${thread.tokens_used}:${model}`
        const processed = getIngestState(db, source.stateSource, thread.id)
        if (processed === stateValue) continue

        const projectPath = thread.cwd ?? ''
        const projectName = projectPath ? basename(projectPath) : 'unknown'
        const sessionId = `${source.sessionPrefix}-${thread.id}`
        const startedAt = thread.created_at
          ? new Date(thread.created_at * 1000).toISOString()
          : new Date().toISOString()
        const endedAt = thread.updated_at
          ? new Date(thread.updated_at * 1000).toISOString()
          : null

        upsertSession(db, withAccount({
          id: sessionId,
          agent: 'codex',
          project_path: projectPath,
          project_name: projectName,
          started_at: startedAt,
          ended_at: endedAt,
          total_cost_usd: 0,
          total_tokens: 0,
          request_count: 0,
          machine_id: machineId,
        }, account))

        const events = readTokenEvents(thread.rollout_path)
        const tokenEvents = events.length > 0 ? events : fallbackEvents(thread.tokens_used)
        const ingestedTokens = tokenEvents.reduce((sum, event) => sum + tokenTotal(event.usage), 0)

        db.prepare(`DELETE FROM requests WHERE session_id = ?`).run(sessionId)

        tokenEvents.forEach((event, index) => {
          const usage = event.usage
          const inputTotal = usage.input_tokens ?? 0
          const cacheReadTokens = usage.cached_input_tokens ?? 0
          const inputTokens = Math.max(inputTotal - cacheReadTokens, 0)
          const outputTokens = usage.output_tokens ?? Math.max((usage.total_tokens ?? 0) - inputTotal, 0)
          const costUsd = computeCostFromDb(db, model, inputTokens, outputTokens, cacheReadTokens, 0)
          const timestamp = event.timestamp ?? (thread.created_at
            ? new Date((thread.created_at * 1000) + index).toISOString()
            : new Date().toISOString())
          const requestId = `${sessionId}-${index}`
          upsertRequest(db, withAccount({
            id: requestId,
            agent: 'codex',
            session_id: sessionId,
            model,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_read_tokens: cacheReadTokens,
            cache_create_tokens: 0,
            cost_usd: costUsd,
            cost_basis: defaultCostBasisForAgent('codex'),
            duration_ms: 0,
            timestamp,
            source_request_id: requestId,
            machine_id: machineId,
          }, account))
          requests++
        })

        rollupSession(db, sessionId)
        setIngestState(db, source.stateSource, thread.id, stateValue)
        ingested++
        if (verbose) console.log(`${source.label} session ${thread.id}: ${ingestedTokens} tokens on ${model}`)
      }
    } finally {
      codexDb?.close()
    }
  }

  return { sessions: ingested, requests }
}

export { readCodexModel }
