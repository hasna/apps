import { Database } from "bun:sqlite";
import { getDatabase } from "./database.js";
import type { Calendar, CreateCalendarInput, UpdateCalendarInput } from "../types/index.js";
import { NotFoundError, ConflictError } from "../types/index.js";

function rowToCalendar(row: any): Calendar {
  return {
    id: row.id,
    org_id: row.org_id,
    owner_id: row.owner_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    color: row.color,
    timezone: row.timezone,
    visibility: row.visibility as Calendar["visibility"],
    metadata: row.metadata ? JSON.parse(row.metadata as string) : {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createCalendar(input: CreateCalendarInput, db?: Database): Calendar {
  db = db || getDatabase();
  const id = crypto.randomUUID().slice(0, 8);
  const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  try {
    db.run(
      `INSERT INTO calendars (id, org_id, owner_id, slug, name, description, color, timezone, visibility, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.org_id, input.owner_id || null, slug, input.name, input.description || null, input.color || null, input.timezone || "UTC", input.visibility || "org", JSON.stringify(input.metadata || {})]
    );
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint failed")) {
      throw new ConflictError(`Calendar slug "${slug}" already exists in this org`);
    }
    throw e;
  }

  return getCalendar(id, db)!;
}

export function getCalendar(id: string, db?: Database): Calendar | null {
  db = db || getDatabase();
  const row = db.query("SELECT * FROM calendars WHERE id = ?").get(id);
  return row ? rowToCalendar(row) : null;
}

export function listCalendars(orgId?: string, db?: Database): Calendar[] {
  db = db || getDatabase();
  let rows: any[];
  if (orgId) {
    rows = db.query("SELECT * FROM calendars WHERE org_id = ? ORDER BY name").all(orgId);
  } else {
    rows = db.query("SELECT * FROM calendars ORDER BY org_id, name").all();
  }
  return rows.map(rowToCalendar);
}

export function updateCalendar(id: string, input: UpdateCalendarInput, db?: Database): Calendar {
  db = db || getDatabase();
  const existing = getCalendar(id, db);
  if (!existing) throw new NotFoundError("Calendar", id);

  db.run(
    `UPDATE calendars SET name = ?, description = ?, color = ?, timezone = ?, visibility = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?`,
    [input.name ?? existing.name, input.description !== undefined ? input.description : existing.description, input.color !== undefined ? input.color : existing.color, input.timezone ?? existing.timezone, input.visibility ?? existing.visibility, JSON.stringify(input.metadata ?? existing.metadata), id]
  );

  return getCalendar(id, db)!;
}

export function deleteCalendar(id: string, db?: Database): boolean {
  db = db || getDatabase();
  const result = db.run(`DELETE FROM calendars WHERE id = ?`, [id]);
  return result.changes > 0;
}
