import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join } from 'path'
import type { GatherResult, GathererOptions, TrainingExample } from './types.js'

interface Message {
  id: number
  session_id: string
  from_agent: string
  to_agent: string
  space: string | null
  content: string
  priority: string
  created_at: string
  reply_to: number | null
}

const SYSTEM_PROMPT = 'You are a helpful AI assistant participating in multi-agent conversations. You communicate clearly and collaboratively with other agents and users.'

function windowToExample(window: Message[]): TrainingExample | null {
  if (window.length < 2) return null

  const messages: TrainingExample['messages'] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ]

  // Use alternating user/assistant mapping based on agent turns
  // The last message in the window becomes the assistant response
  for (let i = 0; i < window.length - 1; i++) {
    const msg = window[i]
    if (!msg) continue
    const role = i % 2 === 0 ? 'user' : 'assistant'
    messages.push({
      role,
      content: `[${msg.from_agent} → ${msg.to_agent ?? msg.space ?? 'all'}]: ${msg.content}`,
    })
  }

  const last = window[window.length - 1]
  if (!last) return null
  messages.push({
    role: 'assistant',
    content: `[${last.from_agent} → ${last.to_agent ?? last.space ?? 'all'}]: ${last.content}`,
  })

  return { messages }
}

export async function gatherFromConversations(options: GathererOptions = {}): Promise<GatherResult> {
  const dbPath = join(homedir(), '.conversations', 'messages.db')
  const db = new Database(dbPath, { readonly: true })

  try {
    let query = 'SELECT * FROM messages WHERE 1=1'
    const params: (string | number)[] = []

    if (options.since) {
      query += ' AND created_at >= ?'
      params.push(options.since.toISOString())
    }

    query += ' ORDER BY session_id, created_at ASC'

    const allMessages = db.prepare(query).all(...params) as Message[]

    // Group messages by session
    const sessions = new Map<string, Message[]>()
    for (const msg of allMessages) {
      const msgs = sessions.get(msg.session_id) ?? []
      msgs.push(msg)
      sessions.set(msg.session_id, msgs)
    }

    const examples: TrainingExample[] = []
    const windowSize = 4 // sliding window of 4 messages

    for (const [, sessionMsgs] of sessions) {
      if (sessionMsgs.length < 2) continue

      // Sliding window across the session
      for (let start = 0; start <= sessionMsgs.length - 2; start++) {
        const end = Math.min(start + windowSize, sessionMsgs.length)
        const window = sessionMsgs.slice(start, end)
        const example = windowToExample(window)
        if (example) examples.push(example)
      }
    }

    const finalExamples = options.limit ? examples.slice(0, options.limit) : examples

    return {
      source: 'conversations',
      examples: finalExamples,
      count: finalExamples.length,
    }
  } finally {
    db.close()
  }
}
