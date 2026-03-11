import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CreateScenarioInput, ScenarioPriority } from "../types/index.js";
import { createScenario, listScenarios } from "../db/scenarios.js";
import { TodosConnectionError } from "../types/index.js";

interface TodosTask {
  id: string;
  short_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  tags: string; // JSON array
  project_id: string | null;
}

interface TodosProject {
  id: string;
  name: string;
  path: string | null;
}

function resolveTodosDbPath(): string {
  const envPath = process.env["TODOS_DB_PATH"];
  if (envPath) return envPath;
  return join(homedir(), ".todos", "todos.db");
}

export function connectToTodos(): Database {
  const dbPath = resolveTodosDbPath();
  if (!existsSync(dbPath)) {
    throw new TodosConnectionError(
      `Todos database not found at ${dbPath}. Install @hasna/todos or set TODOS_DB_PATH.`
    );
  }

  const db = new Database(dbPath, { readonly: true });
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function pullTasks(
  options: {
    projectName?: string;
    tags?: string[];
    priority?: string;
    status?: string;
  } = {}
): TodosTask[] {
  const db = connectToTodos();

  try {
    let query = "SELECT id, short_id, title, description, status, priority, tags, project_id FROM tasks WHERE 1=1";
    const params: unknown[] = [];

    if (options.status) {
      query += " AND status = ?";
      params.push(options.status);
    } else {
      query += " AND status IN ('pending', 'in_progress')";
    }

    if (options.priority) {
      query += " AND priority = ?";
      params.push(options.priority);
    }

    if (options.projectName) {
      const project = db
        .query("SELECT id FROM projects WHERE name = ?")
        .get(options.projectName) as TodosProject | null;
      if (project) {
        query += " AND project_id = ?";
        params.push(project.id);
      }
    }

    query += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END";

    const tasks = db.query(query).all(...(params as [string])) as TodosTask[];

    // Filter by tags if specified
    if (options.tags && options.tags.length > 0) {
      return tasks.filter((task) => {
        const taskTags: string[] = JSON.parse(task.tags || "[]");
        return options.tags!.some((tag) => taskTags.includes(tag));
      });
    }

    return tasks;
  } finally {
    db.close();
  }
}

export function taskToScenarioInput(task: TodosTask, projectId?: string): CreateScenarioInput {
  const tags: string[] = JSON.parse(task.tags || "[]");
  const priority = (["low", "medium", "high", "critical"].includes(task.priority)
    ? task.priority
    : "medium") as ScenarioPriority;

  // Parse steps from description if it has numbered lines
  const steps: string[] = [];
  if (task.description) {
    const lines = task.description.split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*\d+[\.\)]\s*(.+)/);
      if (match?.[1]) {
        steps.push(match[1].trim());
      }
    }
  }

  return {
    name: task.title.replace(/^(OPE\d+-\d+|[A-Z]+-\d+):\s*/, ""), // Strip task prefix
    description: task.description || task.title,
    steps,
    tags,
    priority,
    projectId,
    metadata: { todosTaskId: task.id, todosShortId: task.short_id },
  };
}

export function importFromTodos(
  options: {
    projectName?: string;
    tags?: string[];
    priority?: string;
    projectId?: string;
  } = {}
): { imported: number; skipped: number } {
  const tasks = pullTasks({
    projectName: options.projectName,
    tags: options.tags ?? ["qa", "test", "testing"],
    priority: options.priority,
  });

  // Check existing scenarios to avoid duplicates
  const existing = listScenarios({ projectId: options.projectId });
  const existingTodoIds = new Set(
    existing
      .filter((s) => s.metadata?.todosTaskId)
      .map((s) => (s.metadata as Record<string, unknown>).todosTaskId as string)
  );

  let imported = 0;
  let skipped = 0;

  for (const task of tasks) {
    if (existingTodoIds.has(task.id)) {
      skipped++;
      continue;
    }

    const input = taskToScenarioInput(task, options.projectId);
    createScenario(input);
    imported++;
  }

  return { imported, skipped };
}

export function markTodoDone(taskId: string): boolean {
  const dbPath = resolveTodosDbPath();
  if (!existsSync(dbPath)) return false;

  const db = new Database(dbPath);
  try {
    const task = db
      .query("SELECT id, version FROM tasks WHERE id LIKE ? || '%'")
      .get(taskId) as { id: string; version: number } | null;

    if (!task) return false;

    db.query(
      "UPDATE tasks SET status = 'completed', completed_at = datetime('now'), version = version + 1, updated_at = datetime('now') WHERE id = ? AND version = ?"
    ).run(task.id, task.version);

    return true;
  } finally {
    db.close();
  }
}
