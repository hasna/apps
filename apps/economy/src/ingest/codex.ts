import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { Database as BunDatabase } from 'bun:sqlite'
import type { SqliteAdapter as Database } from '@hasna/cloud'
import {
  upsertSession, getIngestState, setIngestState,
} from '../db/database.js'

const CODEX_DB_PATH = join(homedir(), '.codex', 'state_5.sqlite')
const CODEX_CONFIG_PATH = join(homedir(), '.codex', 'config.toml')

interface CodexThread {
  id: string
  cwd: string
  created_at: number
  updated_at: number
  tokens_used: number
  title: string | null
  model_provider: string | null
}

function readCodexModel(): string {
  if (!existsSync(CODEX_CONFIG_PATH)) return 'gpt-5.3-codex'
  try {
    const content = readFileSync(CODEX_CONFIG_PATH, 'utf-8')
    const match = content.match(/^model\s*=\s*"([^"]+)"/m)
    return match?.[1] ?? 'gpt-5.3-codex'
  } catch {
    return 'gpt-5.3-codex'
  }
}

export async function ingestCodex(db: Database, verbose = false): Promise<{ sessions: number }> {
  if (!existsSync(CODEX_DB_PATH)) {
    if (verbose) console.log('Codex DB not found:', CODEX_DB_PATH)
    return { sessions: 0 }
  }

  let codexDb: BunDatabase | null = null
  let ingested = 0

  try {
    codexDb = new BunDatabase(CODEX_DB_PATH, { readonly: true })
    const threads = codexDb.prepare(
      `SELECT id, cwd, created_at, updated_at, tokens_used, title FROM threads WHERE tokens_used > 0`
    ).all() as CodexThread[]

    for (const thread of threads) {
      const stateKey = thread.id
      const processed = getIngestState(db, 'codex', stateKey)
      if (processed === 'done') continue

      // Codex CLI is subscription-based (not pay-per-token), so cost_usd = 0.
      // Token counts are still tracked for usage awareness.
      // Users can set a monthly subscription cost via `economy pricing set codex-subscription`.
      const costUsd = 0

      const projectPath = thread.cwd ?? ''
      const projectName = projectPath ? basename(projectPath) : 'unknown'

      // Codex stores timestamps as Unix seconds (integer)
      const startedAt = thread.created_at
        ? new Date(thread.created_at * 1000).toISOString()
        : new Date().toISOString()
      const endedAt = thread.updated_at
        ? new Date(thread.updated_at * 1000).toISOString()
        : null

      upsertSession(db, {
        id: `codex-${thread.id}`,
        agent: 'codex',
        project_path: projectPath,
        project_name: projectName,
        started_at: startedAt,
        ended_at: endedAt,
        total_cost_usd: costUsd,
        total_tokens: thread.tokens_used,
        request_count: 1,
      })

      setIngestState(db, 'codex', stateKey, 'done')
      ingested++
      if (verbose) console.log(`Codex session ${thread.id}: ${thread.tokens_used} tokens → $${costUsd.toFixed(4)}`)
    }
  } finally {
    codexDb?.close()
  }

  return { sessions: ingested }
}

export { readCodexModel }
