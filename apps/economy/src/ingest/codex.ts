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

const DEFAULT_CODEX_DB_PATH = join(homedir(), '.codex', 'state_5.sqlite')
const DEFAULT_CODEX_CONFIG_PATH = join(homedir(), '.codex', 'config.toml')
const CODEX_INGEST_VERSION = 'rollout-token-dedupe-v2'

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

function codexDbPath(): string {
  return process.env['HASNA_ECONOMY_CODEX_DB_PATH'] ?? DEFAULT_CODEX_DB_PATH
}

function codexConfigPath(): string {
  return process.env['HASNA_ECONOMY_CODEX_CONFIG_PATH'] ?? DEFAULT_CODEX_CONFIG_PATH
}

function readCodexModel(): string {
  const configPath = codexConfigPath()
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

function readTokenEvents(rolloutPath: string | null): CodexTokenEvent[] {
  if (!rolloutPath || !existsSync(rolloutPath)) return []
  const events: CodexTokenEvent[] = []
  const seen = new Set<string>()
  for (const line of readFileSync(rolloutPath, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    let entry: unknown
    try { entry = JSON.parse(line) } catch { continue }
    if (!entry || typeof entry !== 'object') continue
    const payload = (entry as Record<string, unknown>)['payload'] as Record<string, unknown> | undefined
    if (!payload || payload['type'] !== 'token_count') continue
    const info = payload['info'] as Record<string, unknown> | undefined
    const usage = info?.['last_token_usage'] as CodexTokenUsage | undefined
    if (!usage) continue
    const total = usage.total_tokens ?? ((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0))
    if (total <= 0) continue

    // Codex can emit the same final usage payload more than once in a rollout.
    // The thread tokens_used counter matches the sum of distinct payloads.
    const key = JSON.stringify(usage)
    if (seen.has(key)) continue
    seen.add(key)
    const timestamp = (entry as Record<string, unknown>)['timestamp']
    events.push({ usage, timestamp: typeof timestamp === 'string' ? timestamp : undefined })
  }
  return events
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
  const dbPath = codexDbPath()
  if (!existsSync(dbPath)) {
    if (verbose) console.log('Codex DB not found:', dbPath)
    return { sessions: 0, requests: 0 }
  }

  const machineId = getMachineId()
  let codexDb: BunDatabase | null = null
  let ingested = 0
  let requests = 0

  try {
    codexDb = new BunDatabase(dbPath, { readonly: true })
    const threads = codexDb.prepare(buildThreadQuery(codexDb)).all() as CodexThread[]

    for (const thread of threads) {
      const model = thread.model ?? readCodexModel()
      const stateValue = `${CODEX_INGEST_VERSION}:${thread.updated_at}:${thread.tokens_used}:${model}`
      const processed = getIngestState(db, 'codex', thread.id)
      if (processed === stateValue) continue

      const projectPath = thread.cwd ?? ''
      const projectName = projectPath ? basename(projectPath) : 'unknown'
      const sessionId = `codex-${thread.id}`
      const startedAt = thread.created_at
        ? new Date(thread.created_at * 1000).toISOString()
        : new Date().toISOString()
      const endedAt = thread.updated_at
        ? new Date(thread.updated_at * 1000).toISOString()
        : null

      upsertSession(db, {
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
      })

      const events = readTokenEvents(thread.rollout_path)
      const tokenEvents = events.length > 0 ? events : fallbackEvents(thread.tokens_used)

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
        upsertRequest(db, {
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
        })
        requests++
      })

      rollupSession(db, sessionId)
      setIngestState(db, 'codex', thread.id, stateValue)
      ingested++
      if (verbose) console.log(`Codex session ${thread.id}: ${thread.tokens_used} tokens on ${model}`)
    }
  } finally {
    codexDb?.close()
  }

  return { sessions: ingested, requests }
}

export { readCodexModel }
