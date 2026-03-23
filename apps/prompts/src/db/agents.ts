import { getDatabase } from "./database.js"
import type { Agent } from "../types/index.js"
import { generateId } from "../lib/ids.js"

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    description: (row["description"] as string | null) ?? null,
    created_at: row["created_at"] as string,
    last_seen_at: row["last_seen_at"] as string,
  }
}

export function registerAgent(name: string, description?: string): Agent {
  const db = getDatabase()
  const existing = db.query("SELECT * FROM agents WHERE name = ?").get(name) as Record<string, unknown> | null
  if (existing) {
    db.run("UPDATE agents SET last_seen_at = datetime('now'), description = COALESCE(?, description) WHERE name = ?", [
      description ?? null,
      name,
    ])
    return rowToAgent(db.query("SELECT * FROM agents WHERE name = ?").get(name) as Record<string, unknown>)
  }
  const id = generateId("AGT")
  db.run("INSERT INTO agents (id, name, description) VALUES (?, ?, ?)", [id, name, description ?? null])
  return rowToAgent(db.query("SELECT * FROM agents WHERE id = ?").get(id) as Record<string, unknown>)
}

export function listAgents(): Agent[] {
  const db = getDatabase()
  const rows = db.query("SELECT * FROM agents ORDER BY last_seen_at DESC").all() as Array<Record<string, unknown>>
  return rows.map(rowToAgent)
}

export function getAgent(idOrName: string): Agent | null {
  const db = getDatabase()
  const row = db.query("SELECT * FROM agents WHERE id = ? OR name = ?").get(idOrName, idOrName) as Record<string, unknown> | null
  return row ? rowToAgent(row) : null
}

export function heartbeatAgent(idOrName: string): Agent | null {
  const db = getDatabase()
  const agent = getAgent(idOrName)
  if (!agent) return null
  db.run("UPDATE agents SET last_seen_at = datetime('now') WHERE id = ?", [agent.id])
  return getAgent(agent.id)
}

export function setAgentFocus(idOrName: string, projectId: string | null): Agent | null {
  const db = getDatabase()
  const agent = getAgent(idOrName)
  if (!agent) return null
  db.run("UPDATE agents SET active_project_id = ? WHERE id = ?", [projectId, agent.id])
  return getAgent(agent.id)
}
