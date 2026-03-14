import { Database } from 'bun:sqlite'
import { homedir } from 'os'
import { join } from 'path'
import type { GatherResult, GathererOptions, TrainingExample } from './types.js'

interface Memory {
  id: string
  key: string
  value: string
  category: string
  scope: string
  summary: string | null
  tags: string
  importance: number
  source: string
  status: string
  created_at: string
  accessed_at: string | null
}

const SYSTEM_PROMPT = 'You are an AI assistant with persistent memory. You can remember and recall information across sessions to provide better, more personalized assistance.'

function memoryToRecallExample(memory: Memory): TrainingExample {
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `What do you remember about "${memory.key}"?` },
      {
        role: 'assistant',
        content: memory.summary
          ? `${memory.value}\n\nSummary: ${memory.summary}`
          : memory.value,
      },
    ],
  }
}

function memoryToSaveExample(memory: Memory): TrainingExample {
  const tags = JSON.parse(memory.tags ?? '[]') as string[]
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Remember this for me: ${memory.key} = ${memory.value}${tags.length ? ` (tags: ${tags.join(', ')})` : ''}`,
      },
      {
        role: 'assistant',
        content: `Saved to memory: "${memory.key}" with ${memory.category} category, importance ${memory.importance}/10, scope: ${memory.scope}.`,
      },
    ],
  }
}

function memoryToSearchExample(memories: Memory[], category: string): TrainingExample {
  const matched = memories
    .filter(m => m.category === category && m.status === 'active')
    .slice(0, 5)
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `What ${category} memories do you have?` },
      {
        role: 'assistant',
        content: matched.length > 0
          ? `Here are my ${category} memories:\n${matched.map(m => `- ${m.key}: ${m.value.slice(0, 120)}${m.value.length > 120 ? '...' : ''}`).join('\n')}`
          : `I don't have any ${category} memories stored yet.`,
      },
    ],
  }
}

export async function gatherFromMementos(options: GathererOptions = {}): Promise<GatherResult> {
  const dbPath = join(homedir(), '.mementos', 'mementos.db')
  const db = new Database(dbPath, { readonly: true, create: false })

  try {
    let query = "SELECT * FROM memories WHERE status = 'active'"
    const params: (string | number)[] = []

    if (options.since) {
      query += ' AND created_at >= ?'
      params.push(options.since.toISOString())
    }

    query += ' ORDER BY importance DESC, created_at DESC'

    if (options.limit) {
      query += ' LIMIT ?'
      params.push(options.limit * 3)
    }

    const memories = db.query(query).all(...params) as Memory[]
    const examples: TrainingExample[] = []

    for (const memory of memories) {
      examples.push(memoryToRecallExample(memory))
      examples.push(memoryToSaveExample(memory))
    }

    // Add category search examples
    const categories = [...new Set(memories.map(m => m.category))]
    for (const category of categories) {
      examples.push(memoryToSearchExample(memories, category))
    }

    const finalExamples = options.limit ? examples.slice(0, options.limit) : examples

    return {
      source: 'mementos',
      examples: finalExamples,
      count: finalExamples.length,
    }
  } finally {
    db.close()
  }
}
