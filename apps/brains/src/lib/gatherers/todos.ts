import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join } from 'path'
import type { GatherResult, GathererOptions, TrainingExample } from './types.js'

interface Task {
  id: string
  short_id: string | null
  title: string
  description: string | null
  status: string
  priority: string
  tags: string
  assigned_to: string | null
  created_at: string
  completed_at: string | null
  task_list_id: string | null
  plan_id: string | null
}

const SYSTEM_PROMPT = 'You are a task management assistant that helps users create, update, search, and manage tasks and projects.'

function taskToCreateExample(task: Task): TrainingExample {
  const userMsg = `Create a task: ${task.title}${task.description ? `\n\nDescription: ${task.description}` : ''}`
  const taskDetails = {
    id: task.short_id ?? task.id,
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    tags: JSON.parse(task.tags ?? '[]'),
    created_at: task.created_at,
  }
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
      { role: 'assistant', content: `Created task: ${JSON.stringify(taskDetails, null, 2)}` },
    ],
  }
}

function taskToStatusUpdateExample(task: Task): TrainingExample | null {
  if (!task.completed_at && task.status === 'pending') return null
  const id = task.short_id ?? task.id
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Mark task ${id} as ${task.status}` },
      { role: 'assistant', content: `Task ${id} has been updated to status: ${task.status}. ${task.completed_at ? `Completed at: ${task.completed_at}` : ''}`.trim() },
    ],
  }
}

function taskToSearchExample(tasks: Task[], query: string): TrainingExample {
  const matched = tasks
    .filter(t => t.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 5)
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Search tasks for: "${query}"` },
      {
        role: 'assistant',
        content: matched.length > 0
          ? `Found ${matched.length} task(s):\n${matched.map(t => `- [${t.short_id ?? t.id}] ${t.title} (${t.status})`).join('\n')}`
          : `No tasks found matching "${query}".`,
      },
    ],
  }
}

export async function gatherFromTodos(options: GathererOptions = {}): Promise<GatherResult> {
  const dbPath = join(homedir(), '.todos', 'todos.db')
  const db = new Database(dbPath, { readonly: true })

  try {
    let query = 'SELECT * FROM tasks WHERE 1=1'
    const params: (string | number)[] = []

    if (options.since) {
      query += ' AND created_at >= ?'
      params.push(options.since.toISOString())
    }

    query += ' ORDER BY created_at DESC'

    if (options.limit) {
      query += ' LIMIT ?'
      params.push(options.limit * 2) // fetch more since we generate multiple examples per task
    }

    const tasks = db.prepare(query).all(...params) as Task[]
    const examples: TrainingExample[] = []

    // Create examples from each task
    for (const task of tasks) {
      examples.push(taskToCreateExample(task))

      const statusEx = taskToStatusUpdateExample(task)
      if (statusEx) examples.push(statusEx)
    }

    // Generate search examples from common status/priority terms
    const searchTerms = ['urgent', 'fix', 'implement', 'create', 'update', 'review']
    for (const term of searchTerms) {
      examples.push(taskToSearchExample(tasks, term))
    }

    const finalExamples = options.limit ? examples.slice(0, options.limit) : examples

    return {
      source: 'todos',
      examples: finalExamples,
      count: finalExamples.length,
    }
  } finally {
    db.close()
  }
}
