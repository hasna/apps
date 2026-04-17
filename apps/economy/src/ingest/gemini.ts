import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { SqliteAdapter as Database } from '@hasna/cloud'
import { upsertSession, rollupSession, getIngestState, setIngestState, getMachineId } from '../db/database.js'
import type { EconomySession } from '../types/index.js'

const GEMINI_TMP_DIR = join(homedir(), '.gemini', 'tmp')

interface GeminiChatSession {
  sessionId?: string
  projectHash?: string
  startTime?: string
  lastUpdated?: string
  messages?: Array<{
    id?: string
    timestamp?: string
    type?: string
    content?: string
    usage?: {
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
    }
    model?: string
    costUsd?: number
  }>
}

export async function ingestGemini(db: Database, verbose?: boolean): Promise<{ sessions: number }> {
  if (!existsSync(GEMINI_TMP_DIR)) {
    if (verbose) console.log('Gemini tmp dir not found:', GEMINI_TMP_DIR)
    return { sessions: 0 }
  }

  const machineId = getMachineId()
  let totalSessions = 0
  const touchedSessions = new Set<string>()

  // Walk project hash dirs in ~/.gemini/tmp/
  let projectHashDirs: string[] = []
  try {
    projectHashDirs = readdirSync(GEMINI_TMP_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^[0-9a-f]{64}$/.test(d.name))
      .map(d => join(GEMINI_TMP_DIR, d.name))
  } catch { return { sessions: 0 } }

  for (const projectDir of projectHashDirs) {
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

      const sessionId = chatData.sessionId
      if (!sessionId) continue

      const startTime = chatData.startTime ?? new Date().toISOString()

      // Check if session already exists
      const existing = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(sessionId)
      if (!existing) {
        const session: EconomySession = {
          id: sessionId,
          agent: 'gemini',
          project_path: '',
          project_name: '',
          started_at: startTime,
          ended_at: chatData.lastUpdated ?? null,
          total_cost_usd: 0,
          total_tokens: 0,
          request_count: 0,
          machine_id: machineId,
        }
        upsertSession(db, session)
        touchedSessions.add(sessionId)
        totalSessions++
      }

      setIngestState(db, 'gemini', stateKey, fileMtime)
    }
  }

  // Rollup touched sessions
  for (const sessionId of touchedSessions) {
    rollupSession(db, sessionId)
  }

  return { sessions: totalSessions }
}
