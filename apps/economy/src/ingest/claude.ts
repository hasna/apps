import { readdirSync, readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { Database } from 'bun:sqlite'
import { randomUUID } from 'crypto'
import {
  upsertRequest, upsertSession, rollupSession,
  getIngestState, setIngestState,
} from '../db/database.js'
import type { EconomySession } from '../types/index.js'

const TELEMETRY_DIR = join(homedir(), '.claude', 'telemetry')
const PROJECTS_DIR = join(homedir(), '.claude', 'projects')

interface TelemetryEvent {
  event_data?: {
    event_name?: string
    client_timestamp?: string
    model?: string
    session_id?: string
    additional_metadata?: {
      model?: string
      costUSD?: number
      inputTokens?: number
      outputTokens?: number
      cachedInputTokens?: number
      uncachedInputTokens?: number
      durationMs?: number
      requestId?: string
    }
  }
}

// Resolve project path from ~/.claude/projects/ directory structure
// Dirs are named like: -Users-hasna-Workspace-foo  (path with / replaced by -)
function resolveProjectPath(sessionId: string): { projectPath: string; projectName: string } {
  if (!existsSync(PROJECTS_DIR)) return { projectPath: '', projectName: 'unknown' }
  try {
    const projectDirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
    for (const dir of projectDirs) {
      const sessionFile = join(PROJECTS_DIR, dir.name, `${sessionId}.jsonl`)
      if (existsSync(sessionFile)) {
        // Convert dir name back to path: -Users-hasna-Workspace-foo → /Users/hasna/Workspace/foo
        const projectPath = dir.name.replace(/^-/, '/').replace(/-/g, '/')
        return { projectPath, projectName: basename(projectPath) }
      }
    }
  } catch {
    // ignore
  }
  return { projectPath: '', projectName: 'unknown' }
}

export async function ingestClaude(db: Database, verbose = false, telemetryDir = TELEMETRY_DIR): Promise<{ files: number; requests: number; sessions: number }> {
  if (!existsSync(telemetryDir)) {
    if (verbose) console.log('Claude telemetry dir not found:', telemetryDir)
    return { files: 0, requests: 0, sessions: 0 }
  }

  const files = readdirSync(telemetryDir).filter(f => f.endsWith('.json'))
  let totalRequests = 0
  let processedFiles = 0
  const touchedSessions = new Set<string>()

  for (const filename of files) {
    const stateKey = filename
    const processed = getIngestState(db, 'claude', stateKey)
    if (processed === 'done') continue

    const filePath = join(telemetryDir, filename)
    let events: TelemetryEvent[]
    try {
      const raw = readFileSync(filePath, 'utf-8')
      events = JSON.parse(raw) as TelemetryEvent[]
      if (!Array.isArray(events)) events = [events]
    } catch {
      if (verbose) console.log('Skip unreadable:', filename)
      continue
    }

    for (const event of events) {
      const ed = event.event_data
      if (!ed || ed.event_name !== 'tengu_api_success') continue
      const meta = ed.additional_metadata
      if (!meta) continue

      const sessionId = ed.session_id ?? randomUUID()
      const timestamp = ed.client_timestamp ?? new Date().toISOString()
      const model = meta.model ?? ed.model ?? 'unknown'
      const costUsd = meta.costUSD ?? 0
      const inputTokens = meta.inputTokens ?? (meta.uncachedInputTokens ?? 0)
      const outputTokens = meta.outputTokens ?? 0
      const cacheReadTokens = meta.cachedInputTokens ?? 0
      const requestId = meta.requestId ?? randomUUID()

      upsertRequest(db, {
        id: `claude-${requestId}`,
        agent: 'claude',
        session_id: sessionId,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_create_tokens: 0,
        cost_usd: costUsd,
        duration_ms: meta.durationMs ?? 0,
        timestamp,
        source_request_id: requestId,
      })

      // Ensure session row exists before rollup
      if (!touchedSessions.has(sessionId)) {
        const { projectPath, projectName } = resolveProjectPath(sessionId)
        const existing = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(sessionId)
        if (!existing) {
          const session: EconomySession = {
            id: sessionId,
            agent: 'claude',
            project_path: projectPath,
            project_name: projectName,
            started_at: timestamp,
            ended_at: null,
            total_cost_usd: 0,
            total_tokens: 0,
            request_count: 0,
          }
          upsertSession(db, session)
        }
        touchedSessions.add(sessionId)
      }

      totalRequests++
    }

    setIngestState(db, 'claude', stateKey, 'done')
    processedFiles++
    if (verbose) console.log(`Processed ${filename}: found ${events.length} events`)
  }

  // Rollup all touched sessions
  for (const sessionId of touchedSessions) {
    rollupSession(db, sessionId)
  }

  return { files: processedFiles, requests: totalRequests, sessions: touchedSessions.size }
}
