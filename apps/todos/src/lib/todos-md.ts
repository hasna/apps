import type { Database } from "bun:sqlite";
import type { TaskPriority, TaskStatus } from "../types/index.js";
import { addComment } from "../db/comments.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { addDependency, createTask } from "../db/tasks.js";
import { startTaskRun } from "../db/task-runs.js";
import { getDatabase, now } from "../db/database.js";
import {
  createLocalBridgeBundle,
  importLocalBridgeBundle,
  type ExportLocalBridgeOptions,
  type ImportLocalBridgeOptions,
  type LocalBridgeImportResult,
  type TodosLocalBridgeBundle,
  type TodosLocalBridgeData,
} from "./local-bridge.js";

export const TODOS_MARKDOWN_SCHEMA = "hasna.todos.md/v1";
export const TODOS_MARKDOWN_BRIDGE_MARKER = "hasna.todos.bridge";

export interface ImportTodosMarkdownOptions {
  dryRun?: boolean;
  conflictStrategy?: ImportLocalBridgeOptions["conflictStrategy"];
}

export interface TodosMarkdownImportResult {
  ok: boolean;
  dry_run: boolean;
  mode: "embedded_bridge" | "plain_markdown";
  inserted: Record<keyof TodosLocalBridgeData, number>;
  merged: Record<keyof TodosLocalBridgeData, number>;
  skipped: Record<keyof TodosLocalBridgeData, number>;
  conflicts: LocalBridgeImportResult["conflicts"];
  issues: string[];
}

interface ParsedPlainTask {
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  assigned_to?: string;
  description: string[];
  comments: string[];
  depends_on_titles: string[];
  run_summaries: string[];
  planName: string | null;
}

function emptyCounts(): Record<keyof TodosLocalBridgeData, number> {
  return {
    projects: 0,
    task_lists: 0,
    plans: 0,
    tasks: 0,
    task_dependencies: 0,
    comments: 0,
    runs: 0,
    run_events: 0,
    run_commands: 0,
    run_artifacts: 0,
    task_files: 0,
    task_commits: 0,
    task_git_refs: 0,
    task_verifications: 0,
    saved_views: 0,
    task_boards: 0,
    local_calendar_items: 0,
  };
}

function bridgeToMarkdownPayload(bundle: TodosLocalBridgeBundle): string {
  return JSON.stringify(bundle, null, 2)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function extractEmbeddedBridge(markdown: string): TodosLocalBridgeBundle | null {
  const match = markdown.match(/<!--\s*hasna\.todos\.bridge\s*\n([\s\S]*?)\n\s*-->/);
  if (!match) return null;
  const json = match[1]!.split("\n").map((line) => line.replace(/^  /, "")).join("\n");
  return JSON.parse(json) as TodosLocalBridgeBundle;
}

function frontmatterValue(markdown: string, key: string): string | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  for (const line of match[1]!.split("\n")) {
    const [candidate, ...rest] = line.split(":");
    if (candidate?.trim() === key) return rest.join(":").trim().replace(/^["']|["']$/g, "") || null;
  }
  return null;
}

function stripInlineMetadata(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function parseTaskLine(line: string, currentPlan: string | null): ParsedPlainTask | null {
  const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
  if (!match) return null;
  const status: TaskStatus = match[1]!.toLowerCase() === "x" ? "completed" : "pending";
  const rawTitle = stripInlineMetadata(match[2]!).replace(/^\*\*(.*?)\*\*$/, "$1");
  const tags = [...rawTitle.matchAll(/(^|\s)#([A-Za-z0-9_-]+)/g)].map((tag) => tag[2]!);
  const assignee = rawTitle.match(/(^|\s)@([A-Za-z0-9_-]+)/)?.[2];
  const title = rawTitle
    .replace(/(^|\s)#[A-Za-z0-9_-]+/g, "")
    .replace(/(^|\s)@[A-Za-z0-9_-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title,
    status,
    priority: "medium",
    tags,
    assigned_to: assignee,
    description: [],
    comments: [],
    depends_on_titles: [],
    run_summaries: [],
    planName: currentPlan,
  };
}

function parsePlainMarkdown(markdown: string): { projectName: string | null; tasks: ParsedPlainTask[]; plans: string[] } {
  const tasks: ParsedPlainTask[] = [];
  const plans: string[] = [];
  let projectName = frontmatterValue(markdown, "project");
  let currentPlan: string | null = null;
  let currentTask: ParsedPlainTask | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const projectMatch = line.match(/^#\s+Project:\s+(.+)$/i);
    if (projectMatch) {
      projectName = stripInlineMetadata(projectMatch[1]!);
      continue;
    }
    const planMatch = line.match(/^##\s+Plan:\s+(.+)$/i);
    if (planMatch) {
      currentPlan = stripInlineMetadata(planMatch[1]!);
      if (currentPlan && !plans.includes(currentPlan)) plans.push(currentPlan);
      continue;
    }
    const parsedTask = parseTaskLine(line, currentPlan);
    if (parsedTask) {
      tasks.push(parsedTask);
      currentTask = parsedTask;
      continue;
    }
    if (!currentTask) continue;
    const detail = line.trim();
    if (!detail) continue;
    const priority = detail.match(/^priority:\s+(low|medium|high|critical)$/i)?.[1]?.toLowerCase() as TaskPriority | undefined;
    if (priority) {
      currentTask.priority = priority;
    } else if (/^comment:\s+/i.test(detail)) {
      currentTask.comments.push(detail.replace(/^comment:\s+/i, ""));
    } else if (/^depends_on:\s+/i.test(detail)) {
      currentTask.depends_on_titles.push(detail.replace(/^depends_on:\s+/i, "").trim());
    } else if (/^run:\s+/i.test(detail)) {
      currentTask.run_summaries.push(detail.replace(/^run:\s+/i, "").trim());
    } else if (!detail.startsWith("<!--")) {
      currentTask.description.push(detail.replace(/^\s*[-*]\s+/, ""));
    }
  }
  return { projectName, tasks, plans };
}

export function exportTodosMarkdown(
  options: ExportLocalBridgeOptions = {},
  db?: Database,
): string {
  const bundle = createLocalBridgeBundle(options, db);
  const lines = [
    "---",
    `schema: ${TODOS_MARKDOWN_SCHEMA}`,
    "package: @hasna/todos",
    `exported_at: ${bundle.exportedAt}`,
    `project_id: ${bundle.source.project_id ?? ""}`,
    "---",
    "",
    "# todos.md",
    "",
    `<!-- ${TODOS_MARKDOWN_BRIDGE_MARKER}`,
    bridgeToMarkdownPayload(bundle),
    "-->",
    "",
  ];

  const planById = new Map(bundle.data.plans.map((plan) => [plan.id, plan]));
  const projectById = new Map(bundle.data.projects.map((project) => [project.id, project]));
  const commentsByTask = new Map<string, number>();
  for (const comment of bundle.data.comments) {
    commentsByTask.set(comment.task_id, (commentsByTask.get(comment.task_id) ?? 0) + 1);
  }
  const runsByTask = new Map<string, number>();
  for (const run of bundle.data.runs) {
    runsByTask.set(run.task_id, (runsByTask.get(run.task_id) ?? 0) + 1);
  }

  const projectIds = bundle.data.projects.length
    ? bundle.data.projects.map((project) => project.id)
    : [null];
  for (const projectId of projectIds) {
    const project = projectId ? projectById.get(projectId) : null;
    lines.push(`## Project: ${project?.name ?? "Unscoped"}`, "");
    const projectTasks = bundle.data.tasks.filter((task) => (task.project_id ?? null) === projectId);
    const planIds = [...new Set(projectTasks.map((task) => task.plan_id).filter((id): id is string => Boolean(id)))];
    const sections = planIds.length ? planIds : [null];
    for (const planId of sections) {
      if (planId) lines.push(`### Plan: ${planById.get(planId)?.name ?? planId}`, "");
      for (const task of projectTasks.filter((candidate) => (candidate.plan_id ?? null) === planId)) {
        const check = task.status === "completed" ? "x" : " ";
        lines.push(`- [${check}] ${task.title}`);
        lines.push(`  <!-- todos: id=${task.id} priority=${task.priority} status=${task.status}${task.plan_id ? ` plan_id=${task.plan_id}` : ""} -->`);
        if (task.description) lines.push(`  ${task.description.replace(/\n/g, "\n  ")}`);
        if (task.tags?.length) lines.push(`  tags: ${task.tags.map((tag) => `#${tag}`).join(" ")}`);
        if (commentsByTask.get(task.id)) lines.push(`  comments: ${commentsByTask.get(task.id)}`);
        if (runsByTask.get(task.id)) lines.push(`  runs: ${runsByTask.get(task.id)}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function importTodosMarkdown(
  markdown: string,
  options: ImportTodosMarkdownOptions = {},
  db?: Database,
): TodosMarkdownImportResult {
  const d = getDatabase(db);
  const dryRun = options.dryRun !== false;
  const embedded = extractEmbeddedBridge(markdown);
  if (embedded) {
    const result = importLocalBridgeBundle(embedded, { dryRun, conflictStrategy: options.conflictStrategy }, d);
    return { ...result, mode: "embedded_bridge" };
  }

  const parsed = parsePlainMarkdown(markdown);
  const inserted = emptyCounts();
  const skipped = emptyCounts();
  const issues: string[] = [];
  if (parsed.tasks.length === 0) issues.push("no markdown checkbox tasks found");
  if (dryRun || issues.length > 0) {
    inserted.projects = parsed.projectName ? 1 : 0;
    inserted.plans = parsed.plans.length;
    inserted.tasks = parsed.tasks.length;
    inserted.comments = parsed.tasks.reduce((count, task) => count + task.comments.length, 0);
    inserted.runs = parsed.tasks.reduce((count, task) => count + task.run_summaries.length, 0);
    inserted.task_dependencies = parsed.tasks.reduce((count, task) => count + task.depends_on_titles.length, 0);
    return { ok: issues.length === 0, dry_run: true, mode: "plain_markdown", inserted, merged: emptyCounts(), skipped, conflicts: [], issues };
  }

  const project = parsed.projectName
    ? createProject({ name: parsed.projectName, path: `todos-md://${parsed.projectName}` }, d)
    : null;
  if (project) inserted.projects++;
  const planByName = new Map<string, string>();
  for (const name of parsed.plans) {
    const plan = createPlan({ name, project_id: project?.id }, d);
    planByName.set(name, plan.id);
    inserted.plans++;
  }

  const taskByTitle = new Map<string, string>();
  for (const item of parsed.tasks) {
    const task = createTask({
      title: item.title,
      description: item.description.join("\n") || undefined,
      status: item.status,
      priority: item.priority,
      tags: item.tags,
      assigned_to: item.assigned_to,
      project_id: project?.id,
      plan_id: item.planName ? planByName.get(item.planName) : undefined,
      metadata: { imported_from: TODOS_MARKDOWN_SCHEMA, imported_at: now() },
    }, d);
    taskByTitle.set(item.title, task.id);
    inserted.tasks++;
    for (const comment of item.comments) {
      addComment({ task_id: task.id, content: comment, type: "comment" }, d);
      inserted.comments++;
    }
    for (const summary of item.run_summaries) {
      startTaskRun({ task_id: task.id, title: summary }, d);
      inserted.runs++;
    }
  }

  for (const item of parsed.tasks) {
    const taskId = taskByTitle.get(item.title);
    if (!taskId) continue;
    for (const dependencyTitle of item.depends_on_titles) {
      const dependencyId = taskByTitle.get(dependencyTitle);
      if (!dependencyId) {
        skipped.task_dependencies++;
        issues.push(`missing dependency task: ${dependencyTitle}`);
        continue;
      }
      addDependency(taskId, dependencyId, d);
      inserted.task_dependencies++;
    }
  }

  return { ok: issues.length === 0, dry_run: false, mode: "plain_markdown", inserted, merged: emptyCounts(), skipped, conflicts: [], issues };
}
