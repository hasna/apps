import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SecurityTaskSuggestion } from "./security.js";

export interface TodosCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export type TodosRunner = (args: string[], opts: { timeoutMs: number }) => TodosCommandResult;

export interface UpsertSecurityTasksOptions {
  project: string;
  taskList: string;
  taskListName: string;
  taskListDescription: string;
  maxActions?: number;
  timeoutMs?: number;
  runner?: TodosRunner;
}

export interface UpsertSecurityTasksResult {
  schema: "open-secrets.loop-task-upsert.v1";
  generated_at: string;
  project: string;
  task_list: string;
  summary: {
    suggestions: number;
    attempted: number;
    created: number;
    existing: number;
    skipped: number;
    errors: number;
  };
  actions: Array<{
    action: "created" | "exists" | "skipped" | "error";
    fingerprint: string;
    title: string;
    task_id?: string;
    reason?: string;
    error?: string;
  }>;
  errors: string[];
}

const TERMINAL_STATUSES = new Set(["done", "completed", "cancelled", "canceled", "failed", "archived"]);

export function defaultLoopsTodosProject(): string {
  return process.env["LOOPS_TODOS_PROJECT"]
    ?? process.env["HASNA_LOOPS_TODOS_PROJECT"]
    ?? join(homedir(), ".hasna", "loops");
}

export function upsertSecurityTaskSuggestions(
  suggestions: SecurityTaskSuggestion[],
  options: UpsertSecurityTasksOptions,
): UpsertSecurityTasksResult {
  const runner = options.runner ?? runTodos;
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, 15_000);
  const maxActions = normalizePositiveInteger(options.maxActions, 20);
  const result: UpsertSecurityTasksResult = {
    schema: "open-secrets.loop-task-upsert.v1",
    generated_at: new Date().toISOString(),
    project: options.project,
    task_list: options.taskList,
    summary: {
      suggestions: suggestions.length,
      attempted: 0,
      created: 0,
      existing: 0,
      skipped: 0,
      errors: 0,
    },
    actions: [],
    errors: [],
  };

  const ensure = ensureTaskList(options, runner, timeoutMs);
  if (!ensure.ok) {
    result.summary.errors = 1;
    result.errors.push(ensure.error);
    return result;
  }

  const seen = new Set<string>();
  for (const suggestion of suggestions) {
    if (seen.has(suggestion.fingerprint)) {
      result.summary.skipped += 1;
      result.actions.push({
        action: "skipped",
        fingerprint: suggestion.fingerprint,
        title: suggestion.title,
        reason: "duplicate fingerprint in this run",
      });
      continue;
    }
    seen.add(suggestion.fingerprint);
    result.summary.attempted += 1;

    const existing = findExistingTask(options, suggestion.fingerprint, runner, timeoutMs);
    if (existing.error) {
      result.summary.errors += 1;
      result.errors.push(existing.error);
      result.actions.push({
        action: "error",
        fingerprint: suggestion.fingerprint,
        title: suggestion.title,
        error: existing.error,
      });
      continue;
    }
    const active = existing.tasks?.find((task) => !TERMINAL_STATUSES.has(String(task.status ?? "")));
    if (active) {
      result.summary.existing += 1;
      result.actions.push({
        action: "exists",
        fingerprint: suggestion.fingerprint,
        title: suggestion.title,
        task_id: String(active.id ?? ""),
      });
      continue;
    }

    if (result.summary.created >= maxActions) {
      result.summary.skipped += 1;
      result.actions.push({
        action: "skipped",
        fingerprint: suggestion.fingerprint,
        title: suggestion.title,
        reason: `max task creations ${maxActions} reached`,
      });
      continue;
    }

    const added = addTaskSuggestion(options, suggestion, runner, timeoutMs);
    if (added.error) {
      result.summary.errors += 1;
      result.errors.push(added.error);
      result.actions.push({
        action: "error",
        fingerprint: suggestion.fingerprint,
        title: suggestion.title,
        error: added.error,
      });
      continue;
    }

    result.summary.created += 1;
    result.actions.push({
      action: "created",
      fingerprint: suggestion.fingerprint,
      title: suggestion.title,
      task_id: String(added.task?.id ?? ""),
    });
  }

  return result;
}

export function writeSecureLoopReport(
  report: unknown,
  options: { reportDir?: string; prefix: string; annotatePath?: boolean },
): string | undefined {
  if (!options.reportDir) return undefined;
  mkdirSync(options.reportDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(options.reportDir, `${options.prefix}-${stamp}.json`);
  const body = options.annotatePath ? reportWithPath(report, path) : report;
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}

function ensureTaskList(
  options: UpsertSecurityTasksOptions,
  runner: TodosRunner,
  timeoutMs: number,
): { ok: true } | { ok: false; error: string } {
  const existing = runner(["--project", options.project, "task-lists"], { timeoutMs });
  if (existing.status === 0 && existing.stdout.includes(options.taskList)) return { ok: true };

  const created = runner([
    "--project",
    options.project,
    "task-lists",
    "--add",
    options.taskListName,
    "--slug",
    options.taskList,
    "-d",
    options.taskListDescription,
  ], { timeoutMs });
  if (created.status === 0) return { ok: true };
  return { ok: false, error: compactError(created, `failed to ensure task list ${options.taskList}`) };
}

function findExistingTask(
  options: UpsertSecurityTasksOptions,
  fingerprint: string,
  runner: TodosRunner,
  timeoutMs: number,
): { tasks?: Array<Record<string, unknown>>; error?: string } {
  const result = runner([
    "--project",
    options.project,
    "-j",
    "search",
    fingerprint,
    "--task-list",
    options.taskList,
    "--limit",
    "10",
  ], { timeoutMs });
  if (result.status !== 0) return { error: compactError(result, `failed to search task ${fingerprint}`) };
  try {
    const parsed = JSON.parse(result.stdout || "[]") as unknown;
    if (Array.isArray(parsed)) return { tasks: parsed as Array<Record<string, unknown>> };
    return {};
  } catch (error) {
    return { error: `failed to parse todos search JSON for ${fingerprint}: ${(error as Error).message}` };
  }
}

function addTaskSuggestion(
  options: UpsertSecurityTasksOptions,
  suggestion: SecurityTaskSuggestion,
  runner: TodosRunner,
  timeoutMs: number,
): { task?: Record<string, unknown>; error?: string } {
  const body = suggestion.body.includes(suggestion.fingerprint)
    ? suggestion.body
    : `Fingerprint: ${suggestion.fingerprint}\n${suggestion.body}`;
  const result = runner([
    "--project",
    options.project,
    "-j",
    "add",
    suggestion.title,
    "-d",
    body,
    "--priority",
    suggestion.priority,
    "--task-list",
    options.taskList,
    "--tags",
    Array.from(new Set(suggestion.tags)).join(","),
    "--reason",
    `Deterministic OpenSecrets security producer generated ${suggestion.fingerprint}.`,
  ], { timeoutMs });
  if (result.status !== 0) return { error: compactError(result, `failed to add task ${suggestion.fingerprint}`) };
  try {
    return { task: JSON.parse(result.stdout || "{}") as Record<string, unknown> };
  } catch (error) {
    return { error: `failed to parse todos add JSON for ${suggestion.fingerprint}: ${(error as Error).message}` };
  }
}

function runTodos(args: string[], opts: { timeoutMs: number }): TodosCommandResult {
  const result = spawnSync("todos", args, {
    encoding: "utf8",
    timeout: opts.timeoutMs,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: (result.error as Error).message } : {}),
  };
}

function reportWithPath(report: unknown, path: string): unknown {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  const record = report as Record<string, unknown>;
  const loop = record["loop"] && typeof record["loop"] === "object" && !Array.isArray(record["loop"])
    ? record["loop"] as Record<string, unknown>
    : {};
  return { ...record, loop: { ...loop, report_path: path } };
}

function compactError(result: TodosCommandResult, fallback: string): string {
  const message = result.stderr || result.error || result.stdout || fallback;
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}
