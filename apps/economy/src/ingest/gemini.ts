import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import type { SqliteAdapter as Database } from '@hasna/cloud'
import { upsertRequest, upsertSession, rollupSession, getIngestState, setIngestState, getMachineId } from '../db/database.js'
import { computeCostFromDb } from '../lib/pricing.js'
import type { EconomySession } from '../types/index.js'

const DEFAULT_GEMINI_TMP_DIR = join(homedir(), '.gemini', 'tmp')
const DEFAULT_GEMINI_HISTORY_DIR = join(homedir(), '.gemini', 'history')

interface GeminiUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  cache_read_tokens?: number
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
  cachedContentTokenCount?: number
  toolUsePromptTokenCount?: number
  thoughtsTokenCount?: number
  prompt_token_count?: number
  candidates_token_count?: number
  total_token_count?: number
  cached_content_token_count?: number
  tool_use_prompt_token_count?: number
  thoughts_token_count?: number
}

interface GeminiMessage {
  id?: string
  timestamp?: string
  type?: string
  role?: string
  usage?: GeminiUsage
  usageMetadata?: GeminiUsage
  model?: string
  costUsd?: number
  cost_usd?: number
  response?: {
    usageMetadata?: GeminiUsage
    modelVersion?: string
    model?: string
  }
}

interface GeminiChatSession {
  sessionId?: string
  id?: string
  projectHash?: string
  projectPath?: string
  project_path?: string
  model?: string
  startTime?: string
  lastUpdated?: string
  messages?: GeminiMessage[]
}

function geminiTmpDir(): string {
  return process.env['HASNA_ECONOMY_GEMINI_TMP_DIR'] ?? DEFAULT_GEMINI_TMP_DIR
}

function geminiHistoryDir(): string {
  return process.env['HASNA_ECONOMY_GEMINI_HISTORY_DIR'] ?? DEFAULT_GEMINI_HISTORY_DIR
}

function numberField(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

function listProjectDirs(...roots: string[]): string[] {
  const dirs = new Set<string>()
  for (const root of roots) {
    if (!existsSync(root)) continue
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.add(join(root, entry.name))
      }
    } catch { /* ignore */ }
  }
  return [...dirs]
}

function projectRoot(projectDir: string, chatData: GeminiChatSession): string {
  if (chatData.projectPath) return chatData.projectPath
  if (chatData.project_path) return chatData.project_path
  const rootFile = join(projectDir, '.project_root')
  try {
    if (existsSync(rootFile)) return readFileSync(rootFile, 'utf-8').trim()
  } catch { /* ignore */ }
  return ''
}

export async function ingestGemini(db: Database, verbose?: boolean): Promise<{ sessions: number; requests: number }> {
  const tmpDir = geminiTmpDir()
  const historyDir = geminiHistoryDir()
  if (!existsSync(tmpDir) && !existsSync(historyDir)) {
    if (verbose) console.log('Gemini tmp/history dirs not found:', tmpDir, historyDir)
    return { sessions: 0, requests: 0 }
  }

  const machineId = getMachineId()
  let totalSessions = 0
  let totalRequests = 0
  const touchedSessions = new Set<string>()

  const projectDirs = listProjectDirs(tmpDir, historyDir)

  for (const projectDir of projectDirs) {
    const chatsDir = join(projectDir, 'chats')
    if (!existsSync(chatsDir)) continue

    let chatFiles: string[] = []
    try {
      chatFiles = readdirSync(chatsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => join(chatsDir, f))
    } catch { continue }

    for (const filePath of chatFiles) {
      const stateKey = filePath.replace(homedir(), '~')
      let fileMtime = '0'
      try { fileMtime = statSync(filePath).mtimeMs.toString() } catch { continue }

      const processed = getIngestState(db, 'gemini', stateKey)
      if (processed === fileMtime) continue

      let chatData: GeminiChatSession
      try {
        chatData = JSON.parse(readFileSync(filePath, 'utf-8')) as GeminiChatSession
      } catch { continue }

      const sessionId = chatData.sessionId ?? chatData.id ?? basename(filePath, '.json')
      if (!sessionId) continue

      const startTime = chatData.startTime ?? new Date().toISOString()
      const projectPath = projectRoot(projectDir, chatData)
      const projectName = projectPath ? basename(projectPath) : ''

      const existing = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(sessionId)
      if (!existing) {
        const session: EconomySession = {
          id: sessionId,
          agent: 'gemini',
          project_path: projectPath,
          project_name: projectName,
          started_at: startTime,
          ended_at: chatData.lastUpdated ?? null,
          total_cost_usd: 0,
          total_tokens: 0,
          request_count: 0,
          machine_id: machineId,
        }
        upsertSession(db, session)
        totalSessions++
      }
      touchedSessions.add(sessionId)

      for (const [index, message] of (chatData.messages ?? []).entries()) {
        const usage = message.usage ?? message.usageMetadata ?? message.response?.usageMetadata
        if (!usage) continue
        const model = message.model ?? message.response?.modelVersion ?? message.response?.model ?? chatData.model
        if (!model) continue

        const toolUsePromptTokens = numberField(usage.toolUsePromptTokenCount, usage.tool_use_prompt_token_count)
        const inputTotal = numberField(
          usage.inputTokens,
          usage.input_tokens,
          usage.promptTokenCount,
          usage.prompt_token_count,
        ) + toolUsePromptTokens
        const cacheReadTokens = numberField(
          usage.cachedInputTokens,
          usage.cache_read_tokens,
          usage.cachedContentTokenCount,
          usage.cached_content_token_count,
        )
        const inputTokens = Math.max(inputTotal - cacheReadTokens, 0)
        const thoughtsTokens = numberField(usage.thoughtsTokenCount, usage.thoughts_token_count)
        const outputTokens = numberField(
          usage.outputTokens,
          usage.output_tokens,
          usage.candidatesTokenCount,
          usage.candidates_token_count,
        ) + thoughtsTokens
        const totalTokens = numberField(usage.totalTokens, usage.total_tokens, usage.totalTokenCount, usage.total_token_count)
        if (inputTokens + outputTokens + cacheReadTokens + totalTokens === 0) continue

        const computedCost = computeCostFromDb(db, model, inputTokens, outputTokens, cacheReadTokens, 0)
        const costUsd = numberField(message.costUsd, message.cost_usd) || computedCost
        const timestamp = message.timestamp ?? chatData.lastUpdated ?? startTime
        const requestId = `gemini-${sessionId}-${message.id ?? index}`
        upsertRequest(db, {
          id: requestId,
          agent: 'gemini',
          session_id: sessionId,
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheReadTokens,
          cache_create_tokens: 0,
          cost_usd: costUsd,
          duration_ms: 0,
          timestamp,
          source_request_id: message.id ?? requestId,
          machine_id: machineId,
        })
        totalRequests++
      }

      setIngestState(db, 'gemini', stateKey, fileMtime)
    }
  }

  for (const sessionId of touchedSessions) {
    rollupSession(db, sessionId)
  }

  return { sessions: totalSessions, requests: totalRequests }
}
