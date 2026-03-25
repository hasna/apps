import type { Database } from "bun:sqlite";
import type { TaskTemplate, CreateTemplateInput, CreateTaskInput } from "../types/index.js";
import { getDatabase, now, uuid, resolvePartialId } from "./database.js";

export interface UpdateTemplateInput {
  name?: string;
  title_pattern?: string;
  description?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  tags?: string[];
  project_id?: string | null;
  plan_id?: string | null;
  metadata?: Record<string, unknown>;
}

function rowToTemplate(row: any): TaskTemplate {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
    priority: row.priority || "medium",
  };
}

function resolveTemplateId(id: string, d: Database): string | null {
  return resolvePartialId(d, "task_templates", id);
}

export function createTemplate(input: CreateTemplateInput, db?: Database): TaskTemplate {
  const d = db || getDatabase();
  const id = uuid();
  d.run(
    `INSERT INTO task_templates (id, name, title_pattern, description, priority, tags, project_id, plan_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.title_pattern, input.description || null, input.priority || "medium",
     JSON.stringify(input.tags || []), input.project_id || null, input.plan_id || null,
     JSON.stringify(input.metadata || {}), now()],
  );
  return getTemplate(id, d)!;
}

export function getTemplate(id: string, db?: Database): TaskTemplate | null {
  const d = db || getDatabase();
  const resolved = resolveTemplateId(id, d);
  if (!resolved) return null;
  const row = d.query("SELECT * FROM task_templates WHERE id = ?").get(resolved);
  return row ? rowToTemplate(row) : null;
}

export function listTemplates(db?: Database): TaskTemplate[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM task_templates ORDER BY name").all()).map(rowToTemplate);
}

export function deleteTemplate(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const resolved = resolveTemplateId(id, d);
  if (!resolved) return false;
  return d.run("DELETE FROM task_templates WHERE id = ?", [resolved]).changes > 0;
}

export function updateTemplate(id: string, updates: UpdateTemplateInput, db?: Database): TaskTemplate | null {
  const d = db || getDatabase();
  const resolved = resolveTemplateId(id, d);
  if (!resolved) return null;

  const sets: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) { sets.push("name = ?"); values.push(updates.name); }
  if (updates.title_pattern !== undefined) { sets.push("title_pattern = ?"); values.push(updates.title_pattern); }
  if (updates.description !== undefined) { sets.push("description = ?"); values.push(updates.description); }
  if (updates.priority !== undefined) { sets.push("priority = ?"); values.push(updates.priority); }
  if (updates.tags !== undefined) { sets.push("tags = ?"); values.push(JSON.stringify(updates.tags)); }
  if (updates.project_id !== undefined) { sets.push("project_id = ?"); values.push(updates.project_id); }
  if (updates.plan_id !== undefined) { sets.push("plan_id = ?"); values.push(updates.plan_id); }
  if (updates.metadata !== undefined) { sets.push("metadata = ?"); values.push(JSON.stringify(updates.metadata)); }

  if (sets.length === 0) return getTemplate(resolved, d);

  values.push(resolved);
  d.run(`UPDATE task_templates SET ${sets.join(", ")} WHERE id = ?`, values);
  return getTemplate(resolved, d);
}

export function taskFromTemplate(templateId: string, overrides: Partial<CreateTaskInput> = {}, db?: Database): CreateTaskInput {
  const t = getTemplate(templateId, db);
  if (!t) throw new Error(`Template not found: ${templateId}`);
  return {
    title: overrides.title || t.title_pattern,
    description: overrides.description ?? t.description ?? undefined,
    priority: overrides.priority ?? t.priority,
    tags: overrides.tags ?? t.tags,
    project_id: overrides.project_id ?? t.project_id ?? undefined,
    plan_id: overrides.plan_id ?? t.plan_id ?? undefined,
    metadata: overrides.metadata ?? t.metadata,
    ...overrides,
  };
}
