import type { Database } from "bun:sqlite";
import type { TaskTemplate, CreateTemplateInput, CreateTaskInput } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function rowToTemplate(row: any): TaskTemplate {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
    priority: row.priority || "medium",
  };
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
  const row = d.query("SELECT * FROM task_templates WHERE id = ?").get(id);
  return row ? rowToTemplate(row) : null;
}

export function listTemplates(db?: Database): TaskTemplate[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM task_templates ORDER BY name").all()).map(rowToTemplate);
}

export function deleteTemplate(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM task_templates WHERE id = ?", [id]).changes > 0;
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
