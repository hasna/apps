import type { Database } from "bun:sqlite";
import type { TaskTemplate, CreateTemplateInput, CreateTaskInput, TemplateTask, TemplateTaskInput, TemplateWithTasks, TemplateVariable, TemplateVersion, Task } from "../types/index.js";
import { getDatabase, now, uuid, resolvePartialId } from "./database.js";
import { createTask, addDependency } from "./tasks.js";

export interface UpdateTemplateInput {
  name?: string;
  title_pattern?: string;
  description?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  tags?: string[];
  variables?: TemplateVariable[];
  project_id?: string | null;
  plan_id?: string | null;
  metadata?: Record<string, unknown>;
}

function rowToTemplate(row: any): TaskTemplate {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    variables: JSON.parse(row.variables || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
    priority: row.priority || "medium",
    version: row.version ?? 1,
  };
}

function rowToTemplateTask(row: any): TemplateTask {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]"),
    depends_on_positions: JSON.parse(row.depends_on_positions || "[]"),
    metadata: JSON.parse(row.metadata || "{}"),
    priority: row.priority || "medium",
    condition: row.condition ?? null,
    include_template_id: row.include_template_id ?? null,
  };
}

function resolveTemplateId(id: string, d: Database): string | null {
  return resolvePartialId(d, "task_templates", id);
}

export function createTemplate(input: CreateTemplateInput, db?: Database): TaskTemplate {
  const d = db || getDatabase();
  const id = uuid();
  d.run(
    `INSERT INTO task_templates (id, name, title_pattern, description, priority, tags, variables, project_id, plan_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.title_pattern, input.description || null, input.priority || "medium",
     JSON.stringify(input.tags || []), JSON.stringify(input.variables || []),
     input.project_id || null, input.plan_id || null,
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
  // CASCADE will delete associated template_tasks and template_versions
  return d.run("DELETE FROM task_templates WHERE id = ?", [resolved]).changes > 0;
}

export function updateTemplate(id: string, updates: UpdateTemplateInput, db?: Database): TaskTemplate | null {
  const d = db || getDatabase();
  const resolved = resolveTemplateId(id, d);
  if (!resolved) return null;

  // Save current state as a version snapshot before updating
  const current = getTemplateWithTasks(resolved, d);
  if (current) {
    const snapshot = JSON.stringify({
      name: current.name,
      title_pattern: current.title_pattern,
      description: current.description,
      priority: current.priority,
      tags: current.tags,
      variables: current.variables,
      project_id: current.project_id,
      plan_id: current.plan_id,
      metadata: current.metadata,
      tasks: current.tasks,
    });
    d.run(
      `INSERT INTO template_versions (id, template_id, version, snapshot, created_at) VALUES (?, ?, ?, ?, ?)`,
      [uuid(), resolved, current.version, snapshot, now()],
    );
  }

  const sets: string[] = ["version = version + 1"];
  const values: any[] = [];

  if (updates.name !== undefined) { sets.push("name = ?"); values.push(updates.name); }
  if (updates.title_pattern !== undefined) { sets.push("title_pattern = ?"); values.push(updates.title_pattern); }
  if (updates.description !== undefined) { sets.push("description = ?"); values.push(updates.description); }
  if (updates.priority !== undefined) { sets.push("priority = ?"); values.push(updates.priority); }
  if (updates.tags !== undefined) { sets.push("tags = ?"); values.push(JSON.stringify(updates.tags)); }
  if (updates.variables !== undefined) { sets.push("variables = ?"); values.push(JSON.stringify(updates.variables)); }
  if (updates.project_id !== undefined) { sets.push("project_id = ?"); values.push(updates.project_id); }
  if (updates.plan_id !== undefined) { sets.push("plan_id = ?"); values.push(updates.plan_id); }
  if (updates.metadata !== undefined) { sets.push("metadata = ?"); values.push(JSON.stringify(updates.metadata)); }

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
      `INSERT INTO template_tasks (id, template_id, position, title_pattern, description, priority, tags, task_type, condition, include_template_id, depends_on_positions, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        templateId,
        i,
        task.title_pattern,
        task.description || null,
        task.priority || "medium",
        JSON.stringify(task.tags || []),
        task.task_type || null,
        task.condition || null,
        task.include_template_id || null,
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

// === Feature 1: Conditional tasks ===

/**
 * Evaluate a condition string against a set of variables.
 * Supported syntax:
 *   - "{var} == value" -- equals
 *   - "{var} != value" -- not equals
 *   - "{var}" -- truthy (exists and not empty/false)
 *   - "!{var}" -- falsy (doesn't exist, empty, or "false")
 */
export function evaluateCondition(condition: string, variables: Record<string, string>): boolean {
  if (!condition || condition.trim() === "") return true;

  const trimmed = condition.trim();

  // Equality check: {var} == value
  const eqMatch = trimmed.match(/^\{([^}]+)\}\s*==\s*(.+)$/);
  if (eqMatch) {
    const varName = eqMatch[1]!;
    const expected = eqMatch[2]!.trim();
    return (variables[varName] ?? "") === expected;
  }

  // Inequality check: {var} != value
  const neqMatch = trimmed.match(/^\{([^}]+)\}\s*!=\s*(.+)$/);
  if (neqMatch) {
    const varName = neqMatch[1]!;
    const expected = neqMatch[2]!.trim();
    return (variables[varName] ?? "") !== expected;
  }

  // Falsy check: !{var}
  const falsyMatch = trimmed.match(/^!\{([^}]+)\}$/);
  if (falsyMatch) {
    const varName = falsyMatch[1]!;
    const val = variables[varName];
    return !val || val === "" || val === "false";
  }

  // Truthy check: {var}
  const truthyMatch = trimmed.match(/^\{([^}]+)\}$/);
  if (truthyMatch) {
    const varName = truthyMatch[1]!;
    const val = variables[varName];
    return !!val && val !== "" && val !== "false";
  }

  // Unknown condition format, default to true
  return true;
}

// === Feature 2: Export/Import ===

export interface TemplateExport {
  name: string;
  title_pattern: string;
  description: string | null;
  priority: string;
  tags: string[];
  variables: TemplateVariable[];
  project_id: string | null;
  plan_id: string | null;
  metadata: Record<string, unknown>;
  tasks: Array<{
    position: number;
    title_pattern: string;
    description: string | null;
    priority: string;
    tags: string[];
    task_type: string | null;
    condition: string | null;
    include_template_id: string | null;
    depends_on_positions: number[];
    metadata: Record<string, unknown>;
  }>;
}

/** Export a template as a full JSON-serializable object */
export function exportTemplate(id: string, db?: Database): TemplateExport {
  const d = db || getDatabase();
  const template = getTemplateWithTasks(id, d);
  if (!template) throw new Error(`Template not found: ${id}`);

  return {
    name: template.name,
    title_pattern: template.title_pattern,
    description: template.description,
    priority: template.priority,
    tags: template.tags,
    variables: template.variables,
    project_id: template.project_id,
    plan_id: template.plan_id,
    metadata: template.metadata,
    tasks: template.tasks.map(t => ({
      position: t.position,
      title_pattern: t.title_pattern,
      description: t.description,
      priority: t.priority,
      tags: t.tags,
      task_type: t.task_type,
      condition: t.condition,
      include_template_id: t.include_template_id,
      depends_on_positions: t.depends_on_positions,
      metadata: t.metadata,
    })),
  };
}

/** Import a template from a JSON object, generating new IDs */
export function importTemplate(json: TemplateExport, db?: Database): TaskTemplate {
  const d = db || getDatabase();

  const taskInputs: TemplateTaskInput[] = (json.tasks || []).map(t => ({
    title_pattern: t.title_pattern,
    description: t.description ?? undefined,
    priority: t.priority as any,
    tags: t.tags,
    task_type: t.task_type ?? undefined,
    condition: t.condition ?? undefined,
    include_template_id: t.include_template_id ?? undefined,
    depends_on: t.depends_on_positions,
    metadata: t.metadata,
  }));

  return createTemplate({
    name: json.name,
    title_pattern: json.title_pattern,
    description: json.description ?? undefined,
    priority: json.priority as any,
    tags: json.tags,
    variables: json.variables,
    project_id: json.project_id ?? undefined,
    plan_id: json.plan_id ?? undefined,
    metadata: json.metadata,
    tasks: taskInputs,
  }, d);
}

// === Feature 4: Versioning ===

/** Get a specific version of a template */
export function getTemplateVersion(id: string, version: number, db?: Database): TemplateVersion | null {
  const d = db || getDatabase();
  const resolved = resolveTemplateId(id, d);
  if (!resolved) return null;
  const row = d.query(
    "SELECT * FROM template_versions WHERE template_id = ? AND version = ?",
  ).get(resolved, version) as any;
  return row || null;
}

/** List all versions of a template */
export function listTemplateVersions(id: string, db?: Database): TemplateVersion[] {
  const d = db || getDatabase();
  const resolved = resolveTemplateId(id, d);
  if (!resolved) return [];
  return d.query(
    "SELECT * FROM template_versions WHERE template_id = ? ORDER BY version DESC",
  ).all(resolved) as TemplateVersion[];
}

// === Variable resolution ===

/**
 * Validate required variables are provided and fill in defaults.
 * Returns the merged variables map ready for substitution.
 * Throws if required variables are missing.
 */
export function resolveVariables(
  templateVars: TemplateVariable[],
  provided?: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...provided };

  for (const v of templateVars) {
    if (merged[v.name] === undefined && v.default !== undefined) {
      merged[v.name] = v.default;
    }
  }

  const missing: string[] = [];
  for (const v of templateVars) {
    if (v.required && merged[v.name] === undefined) {
      missing.push(v.name);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required template variable(s): ${missing.join(", ")}`);
  }

  return merged;
}

/**
 * Apply variable substitution to a string, replacing {key} placeholders.
 */
function substituteVars(text: string, variables: Record<string, string>): string {
  let result = text;
  for (const [key, val] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), val);
  }
  return result;
}

/**
 * Create all tasks from a multi-task template.
 * Supports conditional tasks, template composition, and variable substitution.
 */
export function tasksFromTemplate(
  templateId: string,
  projectId?: string,
  variables?: Record<string, string>,
  taskListId?: string,
  db?: Database,
  _visitedTemplateIds?: Set<string>,
): Task[] {
  const d = db || getDatabase();
  const template = getTemplateWithTasks(templateId, d);
  if (!template) throw new Error(`Template not found: ${templateId}`);

  // Circular reference detection for composition
  const visited = _visitedTemplateIds || new Set<string>();
  if (visited.has(template.id)) {
    throw new Error(`Circular template reference detected: ${template.id}`);
  }
  visited.add(template.id);

  // Resolve variables: validate required, fill defaults
  const resolved = resolveVariables(template.variables, variables);

  // Single-task template (backward compat)
  if (template.tasks.length === 0) {
    const input = taskFromTemplate(templateId, { project_id: projectId, task_list_id: taskListId }, d);
    const task = createTask(input, d);
    return [task];
  }

  const createdTasks: Task[] = [];
  const positionToId = new Map<number, string>();
  const skippedPositions = new Set<number>();

  for (const tt of template.tasks) {
    // Feature 3: Composition -- include tasks from another template
    if (tt.include_template_id) {
      const includedTasks = tasksFromTemplate(
        tt.include_template_id,
        projectId,
        resolved,
        taskListId,
        d,
        visited,
      );
      createdTasks.push(...includedTasks);
      if (includedTasks.length > 0) {
        positionToId.set(tt.position, includedTasks[0]!.id);
      } else {
        skippedPositions.add(tt.position);
      }
      continue;
    }

    // Feature 1: Conditional tasks -- evaluate condition
    if (tt.condition && !evaluateCondition(tt.condition, resolved)) {
      skippedPositions.add(tt.position);
      continue;
    }

    let title = tt.title_pattern;
    let desc = tt.description;

    title = substituteVars(title, resolved);
    if (desc) desc = substituteVars(desc, resolved);

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

  // Wire dependencies, filtering out skipped positions
  for (const tt of template.tasks) {
    if (skippedPositions.has(tt.position)) continue;
    if (tt.include_template_id) continue;
    const deps = tt.depends_on_positions;
    for (const depPos of deps) {
      if (skippedPositions.has(depPos)) continue;
      const taskId = positionToId.get(tt.position);
      const depId = positionToId.get(depPos);
      if (taskId && depId) {
        addDependency(taskId, depId, d);
      }
    }
  }

  return createdTasks;
}

/**
 * Preview a template -- returns the resolved task list WITHOUT creating anything.
 */
export interface TemplatePreviewTask {
  position: number;
  title: string;
  description: string | null;
  priority: string;
  tags: string[];
  task_type: string | null;
  depends_on_positions: number[];
}

export interface TemplatePreview {
  template_id: string;
  template_name: string;
  description: string | null;
  variables: TemplateVariable[];
  resolved_variables: Record<string, string>;
  tasks: TemplatePreviewTask[];
}

export function previewTemplate(
  templateId: string,
  variables?: Record<string, string>,
  db?: Database,
): TemplatePreview {
  const d = db || getDatabase();
  const template = getTemplateWithTasks(templateId, d);
  if (!template) throw new Error(`Template not found: ${templateId}`);

  const resolved = resolveVariables(template.variables, variables);

  const tasks: TemplatePreviewTask[] = [];

  if (template.tasks.length === 0) {
    tasks.push({
      position: 0,
      title: substituteVars(template.title_pattern, resolved),
      description: template.description ? substituteVars(template.description, resolved) : null,
      priority: template.priority,
      tags: template.tags,
      task_type: null,
      depends_on_positions: [],
    });
  } else {
    for (const tt of template.tasks) {
      if (tt.condition && !evaluateCondition(tt.condition, resolved)) continue;

      tasks.push({
        position: tt.position,
        title: substituteVars(tt.title_pattern, resolved),
        description: tt.description ? substituteVars(tt.description, resolved) : null,
        priority: tt.priority,
        tags: tt.tags,
        task_type: tt.task_type,
        depends_on_positions: tt.depends_on_positions,
      });
    }
  }

  return {
    template_id: template.id,
    template_name: template.name,
    description: template.description,
    variables: template.variables,
    resolved_variables: resolved,
    tasks,
  };
}
