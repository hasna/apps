import { getDatabase } from "./database.js"
import { getNextRunTime } from "../lib/cron.js"

export interface PromptSchedule {
  id: string
  prompt_id: string
  prompt_slug: string
  cron: string
  vars: Record<string, string>
  agent_id: string | null
  last_run_at: string | null
  next_run_at: string
  run_count: number
  created_at: string
}

interface ScheduleRow {
  id: string
  prompt_id: string
  prompt_slug: string
  cron: string
  vars: string
  agent_id: string | null
  last_run_at: string | null
  next_run_at: string
  run_count: number
  created_at: string
}

function rowToSchedule(row: ScheduleRow): PromptSchedule {
  return {
    ...row,
    vars: JSON.parse(row.vars) as Record<string, string>,
  }
}

export function createSchedule(input: {
  prompt_id: string
  prompt_slug: string
  cron: string
  vars?: Record<string, string>
  agent_id?: string
}): PromptSchedule {
  const db = getDatabase()
  const id = `SCH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const next_run_at = getNextRunTime(input.cron).toISOString()
  const vars = JSON.stringify(input.vars ?? {})

  db.run(
    `INSERT INTO prompt_schedules (id, prompt_id, prompt_slug, cron, vars, agent_id, next_run_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.prompt_id, input.prompt_slug, input.cron, vars, input.agent_id ?? null, next_run_at]
  )

  const row = db
    .query("SELECT * FROM prompt_schedules WHERE id = ?")
    .get(id) as ScheduleRow
  return rowToSchedule(row)
}

export function listSchedules(promptId?: string): PromptSchedule[] {
  const db = getDatabase()
  const rows = promptId
    ? (db.query("SELECT * FROM prompt_schedules WHERE prompt_id = ? ORDER BY next_run_at").all(promptId) as ScheduleRow[])
    : (db.query("SELECT * FROM prompt_schedules ORDER BY next_run_at").all() as ScheduleRow[])
  return rows.map(rowToSchedule)
}

export function getSchedule(id: string): PromptSchedule | null {
  const db = getDatabase()
  const row = db.query("SELECT * FROM prompt_schedules WHERE id = ?").get(id) as ScheduleRow | null
  return row ? rowToSchedule(row) : null
}

export function deleteSchedule(id: string): void {
  const db = getDatabase()
  db.run("DELETE FROM prompt_schedules WHERE id = ?", [id])
}

export interface DueSchedule extends PromptSchedule {
  rendered: string
  prompt_body: string
}

export function getDueSchedules(): DueSchedule[] {
  const db = getDatabase()
  const now = new Date().toISOString()

  const rows = db
    .query(
      `SELECT ps.*, p.body as prompt_body
       FROM prompt_schedules ps
       JOIN prompts p ON p.id = ps.prompt_id
       WHERE ps.next_run_at <= ?
       ORDER BY ps.next_run_at`
    )
    .all(now) as Array<ScheduleRow & { prompt_body: string }>

  const due: DueSchedule[] = []
  for (const row of rows) {
    const schedule = rowToSchedule(row)
    // Render template with vars
    let rendered = row.prompt_body
    for (const [k, v] of Object.entries(schedule.vars)) {
      rendered = rendered.replace(new RegExp(`\\{\\{\\s*${k}[^}]*\\}\\}`, "g"), v)
    }
    // Fill remaining unfilled vars with defaults from {{var|default}} pattern
    rendered = rendered.replace(/\{\{([^|}]+)\|([^}]*)\}\}/g, (_: string, _name: string, def: string) => def)

    // Update run state
    const newNext = getNextRunTime(schedule.cron).toISOString()
    db.run(
      `UPDATE prompt_schedules SET last_run_at = ?, next_run_at = ?, run_count = run_count + 1 WHERE id = ?`,
      [now, newNext, schedule.id]
    )

    due.push({ ...schedule, rendered, prompt_body: row.prompt_body })
  }

  return due
}

export function markScheduleRan(id: string): PromptSchedule | null {
  const db = getDatabase()
  const schedule = getSchedule(id)
  if (!schedule) return null
  const newNext = getNextRunTime(schedule.cron).toISOString()
  const now = new Date().toISOString()
  db.run(
    `UPDATE prompt_schedules SET last_run_at = ?, next_run_at = ?, run_count = run_count + 1 WHERE id = ?`,
    [now, newNext, id]
  )
  return getSchedule(id)
}
