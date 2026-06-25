import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Database } from '../db/database.js'
import {
  upsertRequest, upsertSession, rollupSession,
  getIngestState, setIngestState, getMachineId,
} from '../db/database.js'
import { computeCostFromDb, normalizeModelName } from '../lib/pricing.js'
import { defaultCostBasisForAgent } from '../lib/savings.js'
import { resolveAccountForAgent, withAccount } from '../lib/accounts.js'

const OPENCODE_STORAGE = join(homedir(), '.local', 'share', 'opencode', 'storage')

interface OpenCodeMessage {
  role?: string
  model?: string
  provider?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    cost?: number
  }
  time?: { created?: number }
}

function walkJsonFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walkJsonFiles(p, acc)
    else if (entry.name.endsWith('.json')) acc.push(p)
  }
  return acc
}

function parseSessionIdFromPath(filePath: string): string | null {
  const parts = filePath.split('/')
  const msgIdx = parts.indexOf('message')
  if (msgIdx >= 0 && parts[msgIdx + 1]) return parts[msgIdx + 1]!
  const sessionIdx = parts.indexOf('session')
  if (sessionIdx >= 0 && parts[parts.length - 1]?.endsWith('.json')) {
    return parts[parts.length - 1]!.replace(/\.json$/, '')
  }
  return null
}

export async function ingestOpenCode(db: Database, verbose = false): Promise<{ files: number; requests: number; sessions: number }> {
  const messageDir = join(OPENCODE_STORAGE, 'message')
  const files = walkJsonFiles(messageDir)
  let requests = 0
  const touched = new Set<string>()
  const machineId = getMachineId()
  const now = new Date().toISOString()
  const account = await resolveAccountForAgent('opencode')

  for (const file of files) {
    const mtime = statSync(file).mtimeMs
    const stateKey = file
    const prev = getIngestState(db, 'opencode', stateKey)
    if (prev && Number(prev) >= mtime) continue

    let parsed: OpenCodeMessage
    try {
      parsed = JSON.parse(readFileSync(file, 'utf-8')) as OpenCodeMessage
    } catch {
      continue
    }
    if (parsed.role !== 'assistant') continue
    const usage = parsed.usage
    if (!usage) continue

    const sessionId = parseSessionIdFromPath(file) ?? `opencode-${statSync(file).ino}`
    const model = normalizeModelName(parsed.model ?? 'unknown')
    const input = usage.inputTokens ?? 0
    const output = usage.outputTokens ?? 0
    const cacheRead = usage.cacheReadTokens ?? 0
    const cacheWrite = usage.cacheWriteTokens ?? 0
    if (input + output + cacheRead + cacheWrite === 0 && !usage.cost) continue

    const timestamp = usage && parsed.time?.created
      ? new Date(parsed.time.created).toISOString()
      : new Date(statSync(file).mtime).toISOString()
    const sourceId = file.replace(OPENCODE_STORAGE, '')
    const reqId = `opencode-${sourceId}`

    const costUsd = usage.cost ?? computeCostFromDb(db, model, input, output, cacheRead, cacheWrite, 0)

    upsertRequest(db, withAccount({
      id: reqId,
      agent: 'opencode',
      session_id: sessionId,
      model,
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: cacheRead,
      cache_create_tokens: cacheWrite,
      cost_usd: costUsd,
      cost_basis: defaultCostBasisForAgent('opencode'),
      duration_ms: 0,
      timestamp,
      source_request_id: sourceId,
      machine_id: machineId,
      updated_at: now,
    }, account))
    requests++

    if (!touched.has(sessionId)) {
      upsertSession(db, withAccount({
        id: sessionId,
        agent: 'opencode',
        project_path: '',
        project_name: '',
        started_at: timestamp,
        ended_at: null,
        total_cost_usd: 0,
        total_tokens: 0,
        request_count: 0,
        machine_id: machineId,
        updated_at: now,
      }, account))
      touched.add(sessionId)
    }

    setIngestState(db, 'opencode', stateKey, String(mtime))
    if (verbose) console.log(`  opencode: ${reqId} ${model} $${costUsd.toFixed(4)}`)
  }

  for (const sid of touched) rollupSession(db, sid)
  return { files: files.length, requests, sessions: touched.size }
}
