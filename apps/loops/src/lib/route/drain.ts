import { resolve } from "node:path";
import type { EventEnvelope } from "@hasna/events";
import { redact } from "../format.js";
import type { Loop, WorkflowSpec } from "../../types.js";
import { objectField, stringField, tagsFromValue, taskEventField } from "./fields.js";
import { positiveInteger, splitList } from "./parse.js";
import { routeTodosTaskEvent, todosTaskRouteTemplateId } from "./route-event.js";
import { normalizeRoutePath } from "./throttle.js";
import { defaultLoopsProject, runLocalCommand, runLocalCommandWithStdoutFile, todosMutationSummary } from "./todos-cli.js";
import { writeRouteEvidence } from "./cursors.js";
import type { TodosDrainOptions, TodosReadyTask, TodosTaskRoutePrint } from "./types.js";

/** Bounded `todos ready` drain into deduped one-shot route workflow loops. */

function taskField(task: TodosReadyTask, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringField(task[key]);
    if (value) return value;
  }
  return undefined;
}

function taskListId(task: TodosReadyTask): string | undefined {
  return taskField(task, ["task_list_id", "taskListId"]) ?? stringField(task.task_list?.id);
}

function taskProjectId(task: TodosReadyTask): string | undefined {
  return taskField(task, ["project_id", "projectId"]);
}

function taskDescriptionProjectPath(task: TodosReadyTask): string | undefined {
  const text = taskField(task, ["description", "body"]);
  const match = text?.match(/^\s*(?:Repository|Repo|Project path|Project|Working dir|Working directory):\s*(\/[^\r\n]+)/im);
  return match?.[1]?.trim();
}

function taskProjectPath(task: TodosReadyTask): string | undefined {
  const metadata = objectField(task.metadata) ?? {};
  return taskField(task, ["project_path", "projectPath"]) ??
    taskEventField(metadata, ["project_path", "projectPath", "project_canonical_path"]) ??
    taskDescriptionProjectPath(task) ??
    taskField(task, ["working_dir", "workingDir", "cwd"]) ??
    taskEventField(metadata, ["working_dir", "workingDir", "cwd"]);
}

function taskDrainEvent(task: TodosReadyTask): EventEnvelope {
  const taskId = taskField(task, ["id", "task_id", "taskId"]);
  if (!taskId) throw new Error("todos ready returned a task without an id");
  const metadata = objectField(task.metadata) ?? {};
  const workingDir = taskProjectPath(task);
  const data: Record<string, unknown> = {
    ...task,
    id: taskId,
    title: taskField(task, ["title"]),
    description: taskField(task, ["description", "body"]),
    status: taskField(task, ["status"]),
    tags: tagsFromValue(task.tags),
    metadata,
  };
  if (workingDir) {
    data.working_dir = workingDir;
    data.project_path = taskField(task, ["project_path", "projectPath"]) ?? workingDir;
    data.cwd = taskField(task, ["cwd"]) ?? workingDir;
  }
  const time = new Date().toISOString();
  return {
    id: `drain-todos-task-${taskId}`,
    type: "task.created",
    source: "@hasna/todos",
    subject: taskId,
    severity: "info",
    data,
    time,
    schemaVersion: "1.0",
    metadata: {
      ...metadata,
      ...(workingDir ? { working_dir: workingDir, project_path: data.project_path, cwd: data.cwd } : {}),
      drained_by: "@hasna/loops",
      drained_from: "todos ready",
    },
  };
}

function compactDrainResult(result: TodosTaskRoutePrint): Record<string, unknown> {
  const value = result.value;
  const event = objectField(value.event) as Partial<EventEnvelope> | undefined;
  const loop = objectField(value.loop) as Partial<Loop> | undefined;
  const workflow = objectField(value.workflow) as Partial<WorkflowSpec> | undefined;
  const throttle = objectField(value.throttle) as { reason?: string; allowed?: boolean } | undefined;
  const requeue = objectField(value.requeue);
  const providerRouting = objectField(value.providerRouting);
  return {
    kind: result.kind,
    taskId: event?.subject,
    eventId: event?.id,
    idempotencyKey: stringField(value.idempotencyKey),
    reason: stringField(value.reason) ?? throttle?.reason,
    loopId: stringField(loop?.id),
    loopName: stringField(loop?.name),
    workflowId: stringField(workflow?.id),
    workflowName: stringField(workflow?.name),
    providerRouting,
    requeue,
    queuedAtSource: value.queuedAtSource,
  };
}

function loadReadyTodosTasks(opts: TodosDrainOptions, scanLimit: number): TodosReadyTask[] {
  const todosProject = opts.todosProject ?? defaultLoopsProject();
  const args = ["--project", todosProject, "--json", "ready", "--limit", String(scanLimit)];
  const result = runLocalCommandWithStdoutFile("todos", args, { timeoutMs: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (!result.ok) throw new Error(result.stderr || result.error || "todos ready failed");
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout || "[]");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse todos ready --json output (${result.stdout.length} bytes): ${message}`);
  }
  if (!Array.isArray(parsed)) throw new Error("todos ready --json returned a non-array value");
  return parsed as TodosReadyTask[];
}

function resolveTaskListFilter(todosProject: string, filter: string | undefined): string | undefined {
  const wanted = filter?.trim();
  if (!wanted) return undefined;
  const result = runLocalCommand("todos", ["--project", todosProject, "--json", "task-lists"], { timeoutMs: 30_000 });
  if (!result.ok) throw new Error(result.stderr || result.error || "failed to list todos task lists");
  const values = JSON.parse(result.stdout || "[]") as Array<{ id?: string; slug?: string; name?: string }>;
  const match = values.find((entry) => entry.id === wanted || entry.slug === wanted || entry.name === wanted);
  return match?.id ?? wanted;
}

function taskMatchesDrainFilters(task: TodosReadyTask, filters: { projectId?: string; taskListId?: string; projectPathPrefix?: string; tags: string[] }): boolean {
  if (filters.projectId && taskProjectId(task) !== filters.projectId) return false;
  if (filters.taskListId && taskListId(task) !== filters.taskListId) return false;
  if (filters.projectPathPrefix) {
    const path = taskProjectPath(task);
    if (!path) return false;
    const normalizedPath = normalizeRoutePath(path) ?? resolve(path);
    const normalizedPrefix = normalizeRoutePath(filters.projectPathPrefix) ?? resolve(filters.projectPathPrefix);
    if (normalizedPath !== normalizedPrefix && !normalizedPath.startsWith(`${normalizedPrefix}/`)) return false;
  }
  if (filters.tags.length) {
    const taskTags = new Set(tagsFromValue(task.tags));
    for (const tag of filters.tags) {
      if (!taskTags.has(tag)) return false;
    }
  }
  return true;
}

function skippedDrainTask(
  task: TodosReadyTask,
  event: EventEnvelope | undefined,
  reason: string,
  extra: Record<string, unknown> = {},
): TodosTaskRoutePrint {
  const taskId = taskField(task, ["id", "task_id", "taskId"]) ?? event?.subject ?? "unknown";
  return {
    kind: "skipped",
    value: {
      skipped: true,
      reason,
      taskId,
      event,
      routeError: true,
      ...extra,
    },
    human: `skipped task ${taskId}: ${reason}`,
  };
}

function isSkippableDrainRouteError(message: string): boolean {
  return message.startsWith("worktreeMode=required but projectPath is not an existing git repository:");
}

function markInvalidDrainTaskNonRouteable(todosProject: string, task: TodosReadyTask, reason: string): Record<string, unknown> {
  const taskId = taskField(task, ["id", "task_id", "taskId"]);
  if (!taskId) return { attempted: false, reason: "task id missing" };
  const comment = `OpenLoops route blocked for task ${taskId}: ${reason}. Added no-auto and removed auto:route so route drains do not repeatedly route this task until its project path is fixed.`;
  const commentResult = runLocalCommand("todos", ["--project", todosProject, "comment", taskId, comment], { timeoutMs: 30_000 });
  const tagResult = runLocalCommand("todos", ["--project", todosProject, "tag", taskId, "no-auto"], { timeoutMs: 30_000 });
  const untagResult = runLocalCommand("todos", ["--project", todosProject, "untag", taskId, "auto:route"], { timeoutMs: 30_000 });
  const ok = commentResult.ok && tagResult.ok && untagResult.ok;
  return {
    ok,
    attempted: true,
    taskId,
    error: ok ? undefined : "one or more source task updates failed; inspect per-command results",
    comment: todosMutationSummary(commentResult),
    tagNoAuto: todosMutationSummary(tagResult),
    untagAutoRoute: todosMutationSummary(untagResult),
  };
}

export interface DrainResult {
  value: Record<string, unknown>;
  human: string;
}

export function drainTodosTaskRoutes(opts: TodosDrainOptions): DrainResult {
  const maxDispatch = positiveInteger(opts.maxDispatch ?? "1", "--max-dispatch") ?? 1;
  const todosProject = opts.todosProject ?? defaultLoopsProject();
  const requiredTags = splitList(opts.tags ?? opts.tag) ?? [];
  const taskListFilter = resolveTaskListFilter(todosProject, opts.taskList);
  const candidateLimit = positiveInteger(opts.limit ?? "50", "--limit") ?? 50;
  const hasPostFilters = Boolean(opts.todosProjectId || taskListFilter || opts.projectPathPrefix || requiredTags.length);
  const defaultScanLimit = hasPostFilters ? Math.max(candidateLimit, 500) : candidateLimit;
  const scanLimit = positiveInteger(opts.scanLimit ?? String(defaultScanLimit), "--scan-limit") ?? defaultScanLimit;
  const ready = loadReadyTodosTasks(opts, scanLimit);
  const filteredCandidates = ready.filter((task) => taskMatchesDrainFilters(task, {
    projectId: opts.todosProjectId,
    taskListId: taskListFilter,
    projectPathPrefix: opts.projectPathPrefix,
    tags: requiredTags,
  }));
  const candidates = filteredCandidates.slice(0, candidateLimit);
  const results: TodosTaskRoutePrint[] = [];
  let created = 0;
  for (const task of candidates) {
    if (created >= maxDispatch) break;
    let event: EventEnvelope | undefined;
    let result: TodosTaskRoutePrint;
    try {
      event = taskDrainEvent(task);
      result = routeTodosTaskEvent(event, opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isSkippableDrainRouteError(message)) throw error;
      const sourceTaskUpdate = opts.dryRun
        ? { attempted: false, reason: "dry-run" }
        : markInvalidDrainTaskNonRouteable(todosProject, task, message);
      result = skippedDrainTask(task, event, redact(message, 640) ?? "route task failed", { sourceTaskUpdate });
    }
    results.push(result);
    if (result.kind === "created") created += 1;
  }
  const report = {
    drainedAt: new Date().toISOString(),
    todosProject,
    templateId: todosTaskRouteTemplateId(opts),
    todosProjectId: opts.todosProjectId,
    taskList: opts.taskList,
    taskListId: taskListFilter,
    projectPathPrefix: opts.projectPathPrefix,
    tags: requiredTags,
    limit: candidateLimit,
    scanLimit,
    filtersApplied: hasPostFilters,
    scanned: ready.length,
    candidates: candidates.length,
    filteredCandidates: filteredCandidates.length,
    scanExhausted: ready.length >= scanLimit && filteredCandidates.length < candidateLimit,
    considered: results.length,
    created: results.filter((result) => result.kind === "created" && !result.value.deduped).length,
    deduped: results.filter((result) => result.kind === "deduped").length,
    throttled: results.filter((result) => result.kind === "throttled").length,
    skipped: results.filter((result) => result.kind === "skipped").length,
    maxDispatch,
    source: "todos ready",
    dryRun: Boolean(opts.dryRun),
    results: results.map((result) => ({ kind: result.kind, ...result.value })),
  };
  const evidencePath = writeRouteEvidence("todos-task-drain", report, opts.evidenceDir);
  const value = opts.compact
    ? {
        drainedAt: report.drainedAt,
        todosProject: report.todosProject,
        templateId: report.templateId,
        todosProjectId: report.todosProjectId,
        taskList: report.taskList,
        taskListId: report.taskListId,
        projectPathPrefix: report.projectPathPrefix,
        tags: report.tags,
        limit: report.limit,
        scanLimit: report.scanLimit,
        filtersApplied: report.filtersApplied,
        scanned: report.scanned,
        candidates: report.candidates,
        filteredCandidates: report.filteredCandidates,
        scanExhausted: report.scanExhausted,
        considered: report.considered,
        created: report.created,
        deduped: report.deduped,
        throttled: report.throttled,
        skipped: report.skipped,
        maxDispatch: report.maxDispatch,
        source: report.source,
        dryRun: report.dryRun,
        evidencePath,
        results: results.map(compactDrainResult),
      }
    : { ...report, evidencePath };
  return {
    value,
    human: `drained todos ready queue: considered=${report.considered} created=${report.created} deduped=${report.deduped} throttled=${report.throttled} skipped=${report.skipped}`,
  };
}
