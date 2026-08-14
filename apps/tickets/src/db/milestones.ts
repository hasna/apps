import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.ts";
import type { Milestone, MilestoneStatus } from "../types/index.ts";
import { NotFoundError, ValidationError } from "../types/index.ts";

interface RawMilestone { id: string; project_id: string; name: string; description: string | null; due_date: string | null; status: string; created_at: string; updated_at: string }

function rowToMilestone(r: RawMilestone): Milestone {
  return { id: r.id, project_id: r.project_id, name: r.name, description: r.description, due_date: r.due_date, status: r.status as MilestoneStatus, created_at: r.created_at, updated_at: r.updated_at };
}

export function createMilestone(projectId: string, name: string, description?: string, dueDate?: string, db?: Database): Milestone {
  const database = db ?? getDatabase();
  if (!name.trim()) throw new ValidationError("Milestone name is required");
  const id = uuid();
  const n = now();
  database.run(
    "INSERT INTO milestones (id, project_id, name, description, due_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
    [id, projectId, name.trim(), description ?? null, dueDate ?? null, n, n]
  );
  return { id, project_id: projectId, name: name.trim(), description: description ?? null, due_date: dueDate ?? null, status: "open", created_at: n, updated_at: n };
}

export function listMilestones(projectId: string, status?: MilestoneStatus, db?: Database): Milestone[] {
  const database = db ?? getDatabase();
  if (status) {
    return database.query<RawMilestone, [string, string]>(
      "SELECT * FROM milestones WHERE project_id = ? AND status = ? ORDER BY due_date ASC"
    ).all(projectId, status).map(rowToMilestone);
  }
  return database.query<RawMilestone, [string]>(
    "SELECT * FROM milestones WHERE project_id = ? ORDER BY due_date ASC"
  ).all(projectId).map(rowToMilestone);
}

export function getMilestoneById(id: string, db?: Database): Milestone {
  const database = db ?? getDatabase();
  const row = database.query<RawMilestone, [string]>("SELECT * FROM milestones WHERE id = ?").get(id);
  if (!row) throw new NotFoundError("Milestone", id);
  return rowToMilestone(row);
}

export function updateMilestone(id: string, updates: { name?: string; description?: string; due_date?: string }, db?: Database): Milestone {
  const database = db ?? getDatabase();
  const ms = getMilestoneById(id, database);
  const name = updates.name ?? ms.name;
  const description = updates.description !== undefined ? updates.description : ms.description;
  const due_date = updates.due_date !== undefined ? updates.due_date : ms.due_date;
  const n = now();
  database.run("UPDATE milestones SET name = ?, description = ?, due_date = ?, updated_at = ? WHERE id = ?", [name, description, due_date, n, id]);
  return { ...ms, name, description, due_date, updated_at: n };
}

export function closeMilestone(id: string, db?: Database): Milestone {
  const database = db ?? getDatabase();
  const ms = getMilestoneById(id, database);
  const n = now();
  database.run("UPDATE milestones SET status = 'closed', updated_at = ? WHERE id = ?", [n, id]);
  return { ...ms, status: "closed", updated_at: n };
}
