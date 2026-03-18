import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { Database } from 'bun:sqlite'
import {
  upsertRequest, upsertSession, rollupSession,
  getIngestState, setIngestState,
} from '../db/database.js'

function autoDetectProject(cwd: string, projects: Array<{path: string, name: string}>): { path: string; name: string } | undefined {
  return projects.find(p => cwd === p.path || cwd.startsWith(p.path + '/'))
}
import { computeCostFromDb } from '../lib/pricing.js'
import type { EconomySession } from '../types/index.js'

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')

interface MessageUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
}

interface SessionLine {
  type?: string
  message?: {
    role?: string
    model?: string
    usage?: MessageUsage
  }
  sessionId?: string
  timestamp?: string
  cwd?: string
  gitBranch?: string
}

// Derive project path from the projects dir entry name:
// -Users-hasna-Workspace-foo → /Users/hasna/Workspace/foo
function dirNameToPath(dirName: string): string {
  return dirName.replace(/^-/, '/').replace(/-/g, '/').replace(/\/\//g, '/-')
}

// Collect all JSONL session files recursively (main sessions + subagent sessions)
function collectJsonlFiles(projectDir: string): string[] {
  const files: string[] = []
  function walk(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name))
        else if (entry.name.endsWith('.jsonl')) files.push(join(dir, entry.name))
      }
    } catch { /* ignore permission errors */ }
  }
  walk(projectDir)
  return files
}

export async function ingestClaude(
  db: Database,
  verbose = false,
  _telemetryDir?: string, // kept for test compat, unused
): Promise<{ files: number; requests: number; sessions: number }> {
  if (!existsSync(PROJECTS_DIR)) {
    if (verbose) console.log('Claude projects dir not found:', PROJECTS_DIR)
    return { files: 0, requests: 0, sessions: 0 }
  }

  let totalFiles = 0
  let totalRequests = 0
  const touchedSessions = new Set<string>()

  // Load registered projects once for auto-detection (longest path first for best match)
  const registeredProjects = db.prepare(`SELECT path, name FROM projects ORDER BY LENGTH(path) DESC`).all() as Array<{path: string, name: string}>

  const projectDirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())

  for (const projectDirEntry of projectDirs) {
    const projectDirPath = join(PROJECTS_DIR, projectDirEntry.name)
    const projectPath = dirNameToPath(projectDirEntry.name)

    const jsonlFiles = collectJsonlFiles(projectDirPath)

    for (const filePath of jsonlFiles) {
      // Use file path as state key, also check mtime to reprocess updated files
      const stateKey = filePath.replace(PROJECTS_DIR, '')
      let fileMtime = '0'
      try { fileMtime = statSync(filePath).mtimeMs.toString() } catch { continue }

      const processed = getIngestState(db, 'claude', stateKey)
      if (processed === fileMtime) continue // already processed at this mtime

      let lines: string[]
      try {
        lines = readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim())
      } catch { continue }

      // Determine session ID from the filename (for main sessions) or parent dir
      // Main session files: <sessionId>.jsonl or <sessionId>/<subdir>.jsonl
      const fileBasename = basename(filePath, '.jsonl')
      const isUuid = /^[0-9a-f-]{36}$/.test(fileBasename)
      let sessionId = isUuid ? fileBasename : fileBasename.replace(/^agent-/, '')

      let sessionCwd = projectPath

      for (const line of lines) {
        let entry: SessionLine
        try { entry = JSON.parse(line) } catch { continue }

        // Pick up session ID and cwd from the first user message
        if (entry.sessionId) sessionId = entry.sessionId
        if (entry.cwd) sessionCwd = entry.cwd

        // Only process assistant messages with usage data
        if (entry.message?.role !== 'assistant') continue
        const usage = entry.message.usage
        if (!usage) continue
        const model = entry.message.model
        if (!model) continue

        const inputTokens = usage.input_tokens ?? 0
        const outputTokens = usage.output_tokens ?? 0
        const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0
        const cacheReadTokens = usage.cache_read_input_tokens ?? 0
        const timestamp = entry.timestamp ?? new Date().toISOString()

        // Skip entries with zero tokens (no actual LLM call)
        if (inputTokens + outputTokens + cacheWriteTokens === 0) continue

        const costUsd = computeCostFromDb(db, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens)
        const reqId = `claude-${sessionId}-${timestamp}`

        upsertRequest(db, {
          id: reqId,
          agent: 'claude',
          session_id: sessionId,
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheReadTokens,
          cache_create_tokens: cacheWriteTokens,
          cost_usd: costUsd,
          duration_ms: 0,
          timestamp,
          source_request_id: reqId,
        })

        // Ensure session exists
        if (!touchedSessions.has(sessionId)) {
          const existing = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(sessionId)
          if (!existing) {
            const effectiveCwd = sessionCwd || projectPath
            // Auto-detect registered project from cwd
            const detectedProject = autoDetectProject(effectiveCwd, registeredProjects)
            const session: EconomySession = {
              id: sessionId,
              agent: 'claude',
              project_path: detectedProject ? detectedProject.path : effectiveCwd,
              project_name: detectedProject ? detectedProject.name : basename(effectiveCwd),
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

      setIngestState(db, 'claude', stateKey, fileMtime)
      totalFiles++
    }
  }

  // Rollup all touched sessions
  for (const sessionId of touchedSessions) {
    rollupSession(db, sessionId)
  }

  return { files: totalFiles, requests: totalRequests, sessions: touchedSessions.size }
}
