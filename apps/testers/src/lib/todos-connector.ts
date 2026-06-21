import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
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

export function connectToTodos(options: { readonly?: boolean } = {}): Database {
  const dbPath = resolveTodosDbPath();
  if (!existsSync(dbPath)) {
    throw new TodosConnectionError(
      `Todos database not found at ${dbPath}. Install @hasna/todos or set TODOS_DB_PATH.`
    );
  }

  const db = new Database(dbPath, { readonly: options.readonly ?? true });
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
  const db = connectToTodos({ readonly: true });

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

export function createTodoTask(input: {
  title: string;
  description?: string;
  projectId?: string;
  priority?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}): { created: boolean; taskId?: string; skippedReason?: string } {
  const projectId = input.projectId ?? process.env["TESTERS_TODOS_PROJECT_ID"];
  if (!projectId) return { created: false, skippedReason: "TESTERS_TODOS_PROJECT_ID is not set" };

  let db: Database;
  try {
    db = connectToTodos({ readonly: false });
  } catch (error) {
    return { created: false, skippedReason: error instanceof Error ? error.message : String(error) };
  }

  try {
    const existing = db
      .query("SELECT id FROM tasks WHERE title = ? AND status NOT IN ('completed', 'cancelled') LIMIT 1")
      .get(input.title) as { id: string } | null;
    if (existing) return { created: false, taskId: existing.id, skippedReason: "matching open task already exists" };

    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    db.query(`
      INSERT INTO tasks (id, short_id, title, description, status, priority, tags, project_id, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      `TST-${id.slice(0, 6)}`,
      input.title,
      input.description ?? null,
      input.priority ?? "medium",
      JSON.stringify(input.tags ?? ["testers", "workflow"]),
      projectId,
      timestamp,
      timestamp,
    );
    return { created: true, taskId: id };
  } catch (error) {
    return { created: false, skippedReason: error instanceof Error ? error.message : String(error) };
  } finally {
    db.close();
  }
}

export const TESTERS_ISSUE_REPORT_SCHEMA_VERSION = "testers.issue_report.v1";

export type TesterIssueSeverity = "low" | "medium" | "high" | "critical";
export type TesterIssueKind =
  | "assertion_failure"
  | "runtime_error"
  | "console_error"
  | "network_error"
  | "visual_regression"
  | "accessibility"
  | "performance"
  | "broken_link"
  | "security"
  | "unknown";

export interface TesterIssueReportV1 {
  schema_version: typeof TESTERS_ISSUE_REPORT_SCHEMA_VERSION;
  id?: string;
  fingerprint?: string;
  title: string;
  summary?: string | null;
  kind?: TesterIssueKind | string;
  severity?: TesterIssueSeverity | string;
  source?: {
    tool?: string;
    run_id?: string;
    result_id?: string;
    scenario_id?: string;
    scenario_name?: string;
    project_id?: string;
    url?: string;
    page_url?: string;
    artifact_url?: string;
    screenshot_url?: string;
    commit?: string;
    branch?: string;
  };
  target?: {
    url?: string;
    route?: string;
    selector?: string;
    component?: string;
    browser?: string;
    viewport?: string;
  };
  failure?: {
    message?: string;
    expected?: string;
    actual?: string;
    stack?: string;
    reasoning?: string;
    steps?: string[];
  };
  evidence?: {
    logs?: string[];
    screenshots?: Array<{ kind?: string; label?: string; path?: string; url?: string }>;
    artifacts?: Array<{ kind?: string; label?: string; path?: string; url?: string }>;
  };
  labels?: string[];
  metadata?: Record<string, unknown>;
  occurred_at?: string;
}

export interface TodosIssueReportCliItem {
  action?: "preview" | "matched" | "created" | "updated" | "regressed" | string;
  fingerprint?: string;
  report?: TesterIssueReportV1;
  task?: { id?: string; short_id?: string | null; title?: string } | null;
  warnings?: string[];
}

export interface ReportTesterIssueReportsResult {
  total: number;
  preview: number;
  matched: number;
  created: number;
  updated: number;
  regressed: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  taskIds: string[];
  items: TodosIssueReportCliItem[];
  error?: string;
  stdout?: string;
  stderr?: string;
}

export interface TodosCliRunInput {
  command: string;
  args: string[];
  stdin: string;
  env: NodeJS.ProcessEnv;
}

export interface TodosCliRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type TodosCliRunner = (input: TodosCliRunInput) => TodosCliRunResult;

export interface ReportTesterIssueReportsOptions {
  reports: TesterIssueReportV1[];
  projectId?: string;
  taskListId?: string;
  assign?: string;
  defaultPriority?: ScenarioPriority;
  apply?: boolean;
  updateExisting?: boolean;
  todosCli?: string;
  runner?: TodosCliRunner;
  env?: NodeJS.ProcessEnv;
}

function emptyReportResult(total = 0, overrides: Partial<ReportTesterIssueReportsResult> = {}): ReportTesterIssueReportsResult {
  return {
    total,
    preview: 0,
    matched: 0,
    created: 0,
    updated: 0,
    regressed: 0,
    failed: 0,
    skipped: 0,
    dryRun: false,
    taskIds: [],
    items: [],
    ...overrides,
  };
}

function defaultTodosCliRunner(input: TodosCliRunInput): TodosCliRunResult {
  const result = spawnSync(input.command, input.args, {
    input: input.stdin,
    encoding: "utf8",
    env: input.env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function parseActionSummary(items: TodosIssueReportCliItem[]): Pick<
  ReportTesterIssueReportsResult,
  "preview" | "matched" | "created" | "updated" | "regressed"
> {
  const summary = { preview: 0, matched: 0, created: 0, updated: 0, regressed: 0 };
  for (const item of items) {
    if (item.action === "preview") summary.preview++;
    else if (item.action === "matched") summary.matched++;
    else if (item.action === "created") summary.created++;
    else if (item.action === "updated") summary.updated++;
    else if (item.action === "regressed") summary.regressed++;
  }
  return summary;
}

export function reportTesterIssueReportsToTodos(
  options: ReportTesterIssueReportsOptions,
): ReportTesterIssueReportsResult {
  const reports = options.reports.filter(Boolean);
  if (reports.length === 0) return emptyReportResult(0);

  const projectId = options.projectId ?? process.env["TESTERS_TODOS_PROJECT_ID"];
  if (!projectId) {
    return emptyReportResult(reports.length, {
      skipped: reports.length,
      error: "TESTERS_TODOS_PROJECT_ID is not set",
    });
  }

  const args = [
    "issues",
    "report",
    "--project",
    projectId,
    "--priority",
    options.defaultPriority ?? "medium",
    "--json",
  ];
  if (options.apply !== false) args.push("--apply");
  if (options.taskListId) args.push("--list", options.taskListId);
  if (options.assign) args.push("--assign", options.assign);
  if (options.updateExisting === false) args.push("--no-update-existing");

  const runner = options.runner ?? defaultTodosCliRunner;
  const cliResult = runner({
    command: options.todosCli ?? process.env["TESTERS_TODOS_CLI"] ?? "todos",
    args,
    stdin: JSON.stringify({ reports }),
    env: options.env ?? process.env,
  });

  if (cliResult.error || cliResult.status !== 0) {
    return emptyReportResult(reports.length, {
      failed: reports.length,
      error: cliResult.error?.message || cliResult.stderr || `todos exited with status ${cliResult.status}`,
      stdout: cliResult.stdout,
      stderr: cliResult.stderr,
    });
  }

  try {
    const parsed = JSON.parse(cliResult.stdout) as {
      dry_run?: boolean;
      results?: TodosIssueReportCliItem[];
    };
    const items = Array.isArray(parsed.results) ? parsed.results : [];
    const counts = parseActionSummary(items);
    return {
      total: reports.length,
      ...counts,
      failed: 0,
      skipped: Math.max(0, reports.length - items.length),
      dryRun: Boolean(parsed.dry_run),
      taskIds: items.map((item) => item.task?.id).filter((id): id is string => Boolean(id)),
      items,
      stdout: cliResult.stdout,
      stderr: cliResult.stderr,
    };
  } catch (error) {
    return emptyReportResult(reports.length, {
      failed: reports.length,
      error: error instanceof Error ? error.message : String(error),
      stdout: cliResult.stdout,
      stderr: cliResult.stderr,
    });
  }
}
