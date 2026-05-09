import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import type { SqliteAdapter as Database } from '@hasna/cloud'
import {
  upsertRequest, upsertSession, rollupSession,
  getIngestState, setIngestState, getMachineId,
} from '../db/database.js'

function autoDetectProject(cwd: string, projects: Array<{path: string, name: string}>): { path: string; name: string } | undefined {
  return projects.find(p => cwd === p.path || cwd.startsWith(p.path + '/'))
}
import { computeCostFromDb, normalizeModelName } from '../lib/pricing.js'
import type { EconomySession, Agent } from '../types/index.js'

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const TAKUMI_PROJECTS_DIR = join(homedir(), '.takumi', 'projects')

interface MessageUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
  speed?: string
  inference_geo?: string
  server_tool_use?: {
    web_search_requests?: number
  }
}

interface SessionLine {
  type?: string
  uuid?: string
  requestId?: string
  request_id?: string
  speed?: string
  inference_geo?: string
  message?: {
    id?: string
    role?: string
    model?: string
    usage?: MessageUsage
    speed?: string
    inference_geo?: string
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
  projectsDir = CLAUDE_PROJECTS_DIR,
): Promise<{ files: number; requests: number; sessions: number }> {
  return ingestJsonlProjects(db, projectsDir, 'claude', verbose)
}

export async function ingestTakumi(
  db: Database,
  verbose = false,
  projectsDir = TAKUMI_PROJECTS_DIR,
): Promise<{ files: number; requests: number; sessions: number }> {
  return ingestJsonlProjects(db, projectsDir, 'takumi', verbose)
}

export async function ingestJsonlProjects(
  db: Database,
  projectsDir: string,
  agentName: Agent,
  verbose = false,
): Promise<{ files: number; requests: number; sessions: number }> {
  if (!existsSync(projectsDir)) {
    if (verbose) console.log(`${agentName} projects dir not found:`, projectsDir)
    return { files: 0, requests: 0, sessions: 0 }
  }

  const machineId = getMachineId()
  let totalFiles = 0
  let totalRequests = 0
  const touchedSessions = new Set<string>()

  // Load registered projects once for auto-detection (longest path first for best match)
  const registeredProjects = db.prepare(`SELECT path, name FROM projects ORDER BY LENGTH(path) DESC`).all() as Array<{path: string, name: string}>

  const projectDirs = readdirSync(projectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())

  for (const projectDirEntry of projectDirs) {
    const projectDirPath = join(projectsDir, projectDirEntry.name)
    const projectPath = dirNameToPath(projectDirEntry.name)

    const jsonlFiles = collectJsonlFiles(projectDirPath)

    for (const filePath of jsonlFiles) {
      const stateKey = filePath.replace(projectsDir, '')
      let fileMtime = '0'
      try { fileMtime = statSync(filePath).mtimeMs.toString() } catch { continue }

      const processed = getIngestState(db, agentName, stateKey)
      if (processed === fileMtime) continue

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
        const cacheWrite5mTokens = usage.cache_creation?.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens ?? 0
        const cacheWrite1hTokens = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0
        const cacheWriteTokens = cacheWrite5mTokens + cacheWrite1hTokens
        const cacheReadTokens = usage.cache_read_input_tokens ?? 0
        const timestamp = entry.timestamp ?? new Date().toISOString()

        // Skip entries with zero tokens (no actual LLM call)
        if (inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens === 0) continue

        let costUsd = computeCostFromDb(db, model, inputTokens, outputTokens, cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens)
        costUsd = applyClaudeModifiers(costUsd, model, usage, entry)
        const serverToolUse = usage.server_tool_use
        if (serverToolUse?.web_search_requests) {
          costUsd += serverToolUse.web_search_requests * 0.01
        }
        const sourceRequestId = entry.requestId ?? entry.request_id ?? entry.message.id ?? entry.uuid ?? `${sessionId}-${timestamp}`
        const reqId = `${agentName}-${sourceRequestId}`

        upsertRequest(db, {
          id: reqId,
          agent: agentName,
          session_id: sessionId,
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheReadTokens,
          cache_create_tokens: cacheWriteTokens,
          cache_create_5m_tokens: cacheWrite5mTokens,
          cache_create_1h_tokens: cacheWrite1hTokens,
          cost_usd: costUsd,
          duration_ms: 0,
          timestamp,
          source_request_id: sourceRequestId,
          machine_id: machineId,
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
              agent: agentName,
              project_path: detectedProject ? detectedProject.path : effectiveCwd,
              project_name: detectedProject ? detectedProject.name : '',
              started_at: timestamp,
              ended_at: null,
              total_cost_usd: 0,
              total_tokens: 0,
              request_count: 0,
              machine_id: machineId,
            }
            upsertSession(db, session)
          }
          touchedSessions.add(sessionId)
        }

        totalRequests++
      }

      setIngestState(db, agentName, stateKey, fileMtime)
      totalFiles++
    }
  }

  // Rollup all touched sessions
  for (const sessionId of touchedSessions) {
    rollupSession(db, sessionId)
  }

  return { files: totalFiles, requests: totalRequests, sessions: touchedSessions.size }
}

function applyClaudeModifiers(costUsd: number, model: string, usage: MessageUsage, entry: SessionLine): number {
  let multiplier = 1
  const speed = usage.speed ?? entry.message?.speed ?? entry.speed
  if (speed === 'fast' && model.includes('opus-4-6')) {
    multiplier *= 6
  }

  const inferenceGeo = usage.inference_geo ?? entry.message?.inference_geo ?? entry.inference_geo
  if (inferenceGeo && ['us', 'us-only', 'us_only'].includes(inferenceGeo) && supportsClaudeDataResidencyPricing(model)) {
    multiplier *= 1.1
  }

  return costUsd * multiplier
}

function supportsClaudeDataResidencyPricing(model: string): boolean {
  const normalized = normalizeModelName(model)
  const match = normalized.match(/^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?(?:-|$)/)
  if (!match) return false

  const major = Number(match[2])
  const minor = match[3] ? Number(match[3]) : 0
  return major > 4 || (major === 4 && minor >= 6)
}
