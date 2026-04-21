import { Database } from "bun:sqlite";
import { getDatabase } from "./database.js";
import type { Availability, CreateAvailabilityInput } from "../types/index.js";
import { NotFoundError } from "../types/index.js";

function rowToAvailability(row: any): Availability {
  return {
    id: row.id,
    agent_id: row.agent_id,
    org_id: row.org_id,
    day_of_week: row.day_of_week,
    start_time: row.start_time,
    end_time: row.end_time,
    exceptions: row.exceptions ? JSON.parse(row.exceptions as string) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createAvailability(input: CreateAvailabilityInput, db?: Database): Availability {
  db = db || getDatabase();
  const id = crypto.randomUUID().slice(0, 8);

  db.run(
    `INSERT INTO availability (id, agent_id, org_id, day_of_week, start_time, end_time, exceptions) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.agent_id, input.org_id, input.day_of_week, input.start_time, input.end_time, input.exceptions ? JSON.stringify(input.exceptions) : null]
  );

  return getAvailability(id, db)!;
}

export function getAvailability(id: string, db?: Database): Availability | null {
  db = db || getDatabase();
  const row = db.query("SELECT * FROM availability WHERE id = ?").get(id);
  return row ? rowToAvailability(row) : null;
}

export function getAvailabilityForAgent(agentId: string, orgId?: string, db?: Database): Availability[] {
  db = db || getDatabase();
  let rows: any[];
  if (orgId) {
    rows = db.query("SELECT * FROM availability WHERE agent_id = ? AND org_id = ? ORDER BY day_of_week, start_time").all(agentId, orgId);
  } else {
    rows = db.query("SELECT * FROM availability WHERE agent_id = ? ORDER BY org_id, day_of_week, start_time").all(agentId);
  }
  return rows.map(rowToAvailability);
}

export function updateAvailability(id: string, updates: { start_time?: string; end_time?: string; exceptions?: string[] | null }, db?: Database): Availability {
  db = db || getDatabase();
  const existing = getAvailability(id, db);
  if (!existing) throw new NotFoundError("Availability", id);

  db.run(
    `UPDATE availability SET start_time = ?, end_time = ?, exceptions = ?, updated_at = datetime('now') WHERE id = ?`,
    [updates.start_time ?? existing.start_time, updates.end_time ?? existing.end_time, updates.exceptions !== undefined ? (updates.exceptions ? JSON.stringify(updates.exceptions) : null) : (existing.exceptions ? JSON.stringify(existing.exceptions) : null), id]
  );

  return getAvailability(id, db)!;
}

export function deleteAvailability(id: string, db?: Database): boolean {
  db = db || getDatabase();
  const result = db.run(`DELETE FROM availability WHERE id = ?`, [id]);
  return result.changes > 0;
}

/** Set all availability for an agent/org — replaces existing entries for the given day_of_week */
export function upsertAgentAvailability(agentId: string, orgId: string, dayOfWeek: number, startTime: string, endTime: string, db?: Database): Availability {
  db = db || getDatabase();

  // Delete existing for this agent/org/day
  const existing = db.query("SELECT * FROM availability WHERE agent_id = ? AND org_id = ? AND day_of_week = ?").all(agentId, orgId, dayOfWeek);
  for (const row of existing as any[]) {
    db.run(`DELETE FROM availability WHERE id = ?`, [row.id]);
  }

  return createAvailability({ agent_id: agentId, org_id: orgId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime }, db);
}
