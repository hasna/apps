import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { SqliteAdapter as Database } from '@hasna/cloud'
import {
  upsertRequest, upsertSession, rollupSession,
  getIngestState, setIngestState, getMachineId,
} from '../db/database.js'
import { defaultCostBasisForAgent } from '../lib/savings.js'

const PI_SESSION_DIR = process.env['PI_CODING_AGENT_SESSION_DIR']
  ?? join(homedir(), '.pi', 'agent', 'sessions')

interface PiTurn {
  model?: string
  provider?: string
  usage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    cost?: number
  }
  timestamp?: string
}

interface PiSessionFile {
  id?: string
  turns?: PiTurn[]
  messages?: Array<{ role?: string; model?: string; usage?: PiTurn['usage']; timestamp?: string }>
}

function walkSessions(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walkSessions(p, acc)
    else if (entry.name.endsWith('.json')) acc.push(p)
  }
  return acc
}

export async function ingestPi(db: Database, verbose = false): Promise<{ files: number; requests: number; sessions: number }> {
  const files = walkSessions(PI_SESSION_DIR)
  let requests = 0
  const touched = new Set<string>()
  const machineId = getMachineId()
  const now = new Date().toISOString()

  for (const file of files) {
    const mtime = statSync(file).mtimeMs
    const prev = getIngestState(db, 'pi', file)
    if (prev && Number(prev) >= mtime) continue

    let data: PiSessionFile
    try {
      data = JSON.parse(readFileSync(file, 'utf-8')) as PiSessionFile
    } catch {
      continue
    }

    const sessionId = data.id ?? file.replace(/\.json$/, '').split('/').pop() ?? `pi-${statSync(file).ino}`
    const turns = data.turns ?? data.messages?.filter(m => m.role === 'assistant') ?? []

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i]!
      const usage = turn.usage
      if (!usage) continue
      const input = usage.input ?? 0
      const output = usage.output ?? 0
      if (input + output === 0 && !usage.cost) continue

      const model = turn.model ?? turn.provider ?? 'unknown'
      const timestamp = turn.timestamp ?? new Date(statSync(file).mtime).toISOString()
      const reqId = `pi-${sessionId}-${i}`

      upsertRequest(db, {
        id: reqId,
        agent: 'pi',
        session_id: sessionId,
        model,
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: usage.cacheRead ?? 0,
        cache_create_tokens: usage.cacheWrite ?? 0,
        cost_usd: usage.cost ?? 0,
        cost_basis: defaultCostBasisForAgent('pi'),
        duration_ms: 0,
        timestamp,
        source_request_id: `${sessionId}-${i}`,
        machine_id: machineId,
        updated_at: now,
      })
      requests++
    }

    if (turns.length > 0) {
      upsertSession(db, {
        id: sessionId,
        agent: 'pi',
        project_path: '',
        project_name: '',
        started_at: turns[0]?.timestamp ?? now,
        ended_at: null,
        total_cost_usd: 0,
        total_tokens: 0,
        request_count: 0,
        machine_id: machineId,
        updated_at: now,
      })
      touched.add(sessionId)
    }

    setIngestState(db, 'pi', file, String(mtime))
    if (verbose) console.log(`  pi: ${sessionId} (${turns.length} turns)`)
  }

  for (const sid of touched) rollupSession(db, sid)
  return { files: files.length, requests, sessions: touched.size }
}
