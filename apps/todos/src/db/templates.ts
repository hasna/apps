import type { Database } from "bun:sqlite";
import type { TaskTemplate, CreateTemplateInput, CreateTaskInput, TemplateTask, TemplateTaskInput, TemplateWithTasks, Task } from "../types/index.js";
import { getDatabase, now, uuid, resolvePartialId } from "./database.js";
import { createTask, addDependency } from "./tasks.js";

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

function rowToTemplateTask(row: any): TemplateTask {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    depends_on_positions: JSON.parse(row.depends_on_positions || "[]"),
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

  // If tasks array is provided, add them as template tasks
  if (input.tasks && input.tasks.length > 0) {
    addTemplateTasks(id, input.tasks, d);
  }

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
  // CASCADE will delete associated template_tasks
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

// === Multi-task template functions ===

/** Add tasks to a template, replacing any existing template tasks */
export function addTemplateTasks(templateId: string, tasks: TemplateTaskInput[], db?: Database): TemplateTask[] {
  const d = db || getDatabase();

  // Verify template exists
  const template = getTemplate(templateId, d);
  if (!template) throw new Error(`Template not found: ${templateId}`);

  // Clear existing template tasks
  d.run("DELETE FROM template_tasks WHERE template_id = ?", [templateId]);

  const results: TemplateTask[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    const id = uuid();
    d.run(
      `INSERT INTO template_tasks (id, template_id, position, title_pattern, description, priority, tags, task_type, depends_on_positions, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        templateId,
        i,
        task.title_pattern,
        task.description || null,
        task.priority || "medium",
        JSON.stringify(task.tags || []),
        task.task_type || null,
        JSON.stringify(task.depends_on || []),
        JSON.stringify(task.metadata || {}),
        now(),
      ],
    );
    const row = d.query("SELECT * FROM template_tasks WHERE id = ?").get(id);
    if (row) results.push(rowToTemplateTask(row));
  }

  return results;
}

/** Get a template with all its associated tasks, ordered by position */
export function getTemplateWithTasks(id: string, db?: Database): TemplateWithTasks | null {
  const d = db || getDatabase();
  const template = getTemplate(id, d);
  if (!template) return null;

  const rows = d.query("SELECT * FROM template_tasks WHERE template_id = ? ORDER BY position").all(template.id) as any[];
  const tasks = rows.map(rowToTemplateTask);

  return { ...template, tasks };
}

/** Get just the template tasks for a given template ID */
export function getTemplateTasks(templateId: string, db?: Database): TemplateTask[] {
  const d = db || getDatabase();
  const resolved = resolveTemplateId(templateId, d);
  if (!resolved) return [];
  const rows = d.query("SELECT * FROM template_tasks WHERE template_id = ? ORDER BY position").all(resolved) as any[];
  return rows.map(rowToTemplateTask);
}

/**
 * Create all tasks from a multi-task template.
 * For single-task templates (no template_tasks rows), falls back to taskFromTemplate.
 * Supports {variable} substitution in title and description.
 * Wires task dependencies based on depends_on_positions.
 */
export function tasksFromTemplate(
  templateId: string,
  projectId: string,
  variables?: Record<string, string>,
  taskListId?: string,
  db?: Database,
): Task[] {
  const d = db || getDatabase();
  const template = getTemplateWithTasks(templateId, d);
  if (!template) throw new Error(`Template not found: ${templateId}`);

  // Single-task template (backward compat) — use existing taskFromTemplate
  if (template.tasks.length === 0) {
    const input = taskFromTemplate(templateId, { project_id: projectId, task_list_id: taskListId }, d);
    const task = createTask(input, d);
    return [task];
  }

  // Multi-task: create all tasks, then wire dependencies
  const createdTasks: Task[] = [];
  const positionToId = new Map<number, string>();

  for (const tt of template.tasks) {
    let title = tt.title_pattern;
    let desc = tt.description;

    // Variable substitution
    if (variables) {
      for (const [key, val] of Object.entries(variables)) {
        title = title.replace(new RegExp(`\\{${key}\\}`, "g"), val);
        if (desc) desc = desc.replace(new RegExp(`\\{${key}\\}`, "g"), val);
      }
    }

    const task = createTask({
      title,
      description: desc ?? undefined,
      priority: tt.priority,
      tags: tt.tags,
      task_type: tt.task_type ?? undefined,
      project_id: projectId,
      task_list_id: taskListId,
      metadata: tt.metadata,
    }, d);
    createdTasks.push(task);
    positionToId.set(tt.position, task.id);
  }

  // Wire dependencies
  for (const tt of template.tasks) {
    const deps = tt.depends_on_positions;
    for (const depPos of deps) {
      const taskId = positionToId.get(tt.position);
      const depId = positionToId.get(depPos);
      if (taskId && depId) {
        addDependency(taskId, depId, d);
      }
    }
  }

  return createdTasks;
}
