import { resolve } from "node:path";
import type { EventEnvelope } from "@hasna/events";
import { ValidationError } from "../errors.js";
import { redact } from "../format.js";
import { scrubSecretsDeep } from "../redact.js";
import type { Loop, WorkflowSpec } from "../../types.js";
import { objectField, slugSegment, stableSuffix, stringField, tagsFromValue, taskEventField } from "./fields.js";
import { listFromRepeatedOpts, positiveInteger, splitList } from "./parse.js";
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

function booleanTaskField(task: TodosReadyTask, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = task[key];
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "1" || value === 1) return true;
    if (value === "false" || value === "0" || value === 0) return false;
  }
  return undefined;
}

function normalizedSourceRoots(opts: TodosDrainOptions): string[] {
  return listFromRepeatedOpts(opts.todosSourceRoot) ?? [];
}

function normalizedSourceStores(opts: TodosDrainOptions): string[] {
  return listFromRepeatedOpts(opts.todosSourceStore) ?? [];
}

function normalizedSourceIncludes(opts: TodosDrainOptions): string[] {
  return listFromRepeatedOpts(opts.todosSourceInclude) ?? [];
}

function normalizedSourceExcludes(opts: TodosDrainOptions): string[] {
  return listFromRepeatedOpts(opts.todosSourceExclude) ?? [];
}

function hasTodosSourceOptions(opts: TodosDrainOptions): boolean {
  return Boolean(
    normalizedSourceRoots(opts).length ||
      normalizedSourceStores(opts).length ||
      normalizedSourceIncludes(opts).length ||
      normalizedSourceExcludes(opts).length
  );
}

interface SourceTaskIdentity {
  sourceTaskKey?: string;
  sourceStoreId?: string;
  sourceRepoPath?: string;
  sourceDbPath?: string;
  sourceSelectedByInput?: boolean;
  idempotencyIdentity?: string;
}

function taskSourceIdentity(task: TodosReadyTask, taskId?: string): SourceTaskIdentity {
  const sourceTaskKey = taskField(task, ["source_task_key", "sourceTaskKey"]);
  const sourceStoreId = taskField(task, ["source_store_id", "sourceStoreId"]);
  const identity = sourceTaskKey ?? (sourceStoreId && taskId ? `${sourceStoreId}:${taskId}` : undefined);
  return {
    sourceTaskKey,
    sourceStoreId,
    sourceRepoPath: taskField(task, ["source_repo_path", "sourceRepoPath"]),
    sourceDbPath: taskField(task, ["source_db_path", "sourceDbPath"]),
    sourceSelectedByInput: booleanTaskField(task, ["source_selected_by_input", "sourceSelectedByInput"]),
    idempotencyIdentity: identity,
  };
}

function publicSourceTaskIdentity(source: SourceTaskIdentity): Record<string, unknown> | undefined {
  if (
    !source.sourceTaskKey &&
    !source.sourceStoreId &&
    !source.sourceRepoPath &&
    !source.sourceDbPath &&
    source.sourceSelectedByInput === undefined
  ) {
    return undefined;
  }
  return {
    source_task_key: source.sourceTaskKey,
    source_store_id: source.sourceStoreId,
    source_repo_path: source.sourceRepoPath,
    source_db_path: source.sourceDbPath,
    source_selected_by_input: source.sourceSelectedByInput,
  };
}

function taskListValues(task: TodosReadyTask): string[] {
  const values = [
    taskField(task, ["task_list_id", "taskListId", "task_list_slug", "taskListSlug", "task_list_name", "taskListName"]),
    stringField(task.task_list?.id),
    stringField(task.task_list?.slug),
    stringField(task.task_list?.name),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(values)];
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

function taskDrainEvent(task: TodosReadyTask, opts: { sourceRouteEligible?: boolean } = {}): EventEnvelope {
  const taskId = taskField(task, ["id", "task_id", "taskId"]);
  if (!taskId) throw new Error("todos ready returned a task without an id");
  const metadata = objectField(task.metadata) ?? {};
  const workingDir = taskProjectPath(task);
  const sourceIdentity = taskSourceIdentity(task, taskId);
  const sourceTask = publicSourceTaskIdentity(sourceIdentity);
  const data: Record<string, unknown> = {
    ...task,
    id: taskId,
    title: taskField(task, ["title"]),
    description: taskField(task, ["description", "body"]),
    status: taskField(task, ["status"]),
    tags: tagsFromValue(task.tags),
    metadata,
  };
  if (opts.sourceRouteEligible) {
    data.route_enabled = true;
    data.route_enabled_by = "source_route_state";
  }
  if (workingDir) {
    data.working_dir = workingDir;
    data.project_path = taskField(task, ["project_path", "projectPath"]) ?? workingDir;
    data.cwd = taskField(task, ["cwd"]) ?? workingDir;
  }
  if (sourceTask) data.source_task = sourceTask;
  const eventId = sourceIdentity.idempotencyIdentity
    ? `drain-todos-task-${slugSegment(taskId, "task")}-${stableSuffix(sourceIdentity.idempotencyIdentity)}`
    : `drain-todos-task-${taskId}`;
  const time = new Date().toISOString();
  return {
    id: eventId,
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
      ...sourceTask,
      ...(sourceTask ? { source_task: sourceTask } : {}),
      drained_by: "@hasna/loops",
      drained_from: "todos ready",
    },
  };
}

function compactDrainResult(result: TodosTaskRoutePrint): Record<string, unknown> {
  const value = result.value;
  const event = objectField(value.event) as Partial<EventEnvelope> | undefined;
  const sourceTask = objectField(value.sourceTask) ??
    objectField(objectField(event?.metadata)?.source_task) ??
    objectField(objectField(event?.data)?.source_task);
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
    sourceTask,
    requeue,
    queuedAtSource: value.queuedAtSource,
  };
}

interface TodosReadySourceDiscovery {
  schemaVersion: "todos.task_route_sources.v1";
  stores?: unknown[];
  errors?: unknown[];
  totalCandidateCount?: number;
  returnedCandidateCount?: number;
  truncated?: boolean;
}

interface LoadedReadyTodosTasks {
  tasks: TodosReadyTask[];
  sourceMode: boolean;
  sourceDiscovery?: TodosReadySourceDiscovery;
  sourceRoots: string[];
  sourceStores: string[];
  sourceIncludes: string[];
  sourceExcludes: string[];
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseTodosReadyJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout || "[]");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse todos ready --json output (${stdout.length} bytes): ${message}`);
  }
}

function loadReadyTodosTasks(opts: TodosDrainOptions, scanLimit: number, sourceMode: boolean): LoadedReadyTodosTasks {
  const sourceRoots = normalizedSourceRoots(opts);
  const sourceStores = normalizedSourceStores(opts);
  const sourceIncludes = normalizedSourceIncludes(opts);
  const sourceExcludes = normalizedSourceExcludes(opts);
  if (sourceMode && !sourceRoots.length && !sourceStores.length) {
    throw new ValidationError("source discovery requires at least one --todos-source-root or --todos-source-store");
  }
  const args = sourceMode
    ? ["--json", "ready"]
    : ["--project", opts.todosProject ?? defaultLoopsProject(), "--json", "ready"];
  if (sourceMode) {
    for (const root of sourceRoots) args.push("--source-root", root);
    for (const store of sourceStores) args.push("--source-store", store);
    for (const pattern of sourceIncludes) args.push("--include", pattern);
    for (const pattern of sourceExcludes) args.push("--exclude", pattern);
  }
  args.push("--limit", String(scanLimit));
  const result = runLocalCommandWithStdoutFile("todos", args, { timeoutMs: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (!result.ok) throw new Error(result.stderr || result.error || "todos ready failed");
  const parsed = parseTodosReadyJson(result.stdout);
  if (!sourceMode) {
    if (!Array.isArray(parsed)) throw new Error("todos ready --json returned a non-array value");
    return { tasks: parsed as TodosReadyTask[], sourceMode, sourceRoots, sourceStores, sourceIncludes, sourceExcludes };
  }
  const response = objectField(parsed);
  if (!response) throw new Error("todos ready --json source discovery returned a non-object value");
  if (response.schema_version !== "todos.task_route_sources.v1") {
    throw new Error(`todos ready source discovery returned unsupported schema_version: ${String(response.schema_version)}`);
  }
  if (!Array.isArray(response.candidates)) throw new Error("todos ready source discovery returned missing candidates array");
  return {
    tasks: response.candidates as TodosReadyTask[],
    sourceMode,
    sourceRoots,
    sourceStores,
    sourceIncludes,
    sourceExcludes,
    sourceDiscovery: {
      schemaVersion: "todos.task_route_sources.v1",
      stores: Array.isArray(response.stores) ? response.stores : undefined,
      errors: Array.isArray(response.errors) ? response.errors : undefined,
      totalCandidateCount: numberField(response.total_candidate_count),
      returnedCandidateCount: numberField(response.returned_candidate_count),
      truncated: typeof response.truncated === "boolean" ? response.truncated : undefined,
    },
  };
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

function taskMatchesDrainFilters(task: TodosReadyTask, filters: { projectId?: string; taskList?: string; projectPathPrefix?: string; tags: string[] }): boolean {
  if (filters.projectId && taskProjectId(task) !== filters.projectId) return false;
  if (filters.taskList && !taskListValues(task).includes(filters.taskList)) return false;
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

function sourceRouteState(task: TodosReadyTask): Record<string, unknown> | undefined {
  return objectField(task.route_state) ?? objectField(task.routeState);
}

function sourceRouteReason(routeState: Record<string, unknown> | undefined): string | undefined {
  const reasons = routeState?.reasons;
  const firstReason = Array.isArray(reasons) ? stringField(reasons[0]) : undefined;
  return stringField(routeState?.reason) ??
    stringField(routeState?.eligibility_reason) ??
    stringField(routeState?.eligibilityReason) ??
    firstReason;
}

function sourceRouteEligibility(task: TodosReadyTask): { eligible: boolean; reason?: string; routeState?: Record<string, unknown> } {
  const routeState = sourceRouteState(task);
  if (routeState?.eligible === true) return { eligible: true, routeState };
  const reason = sourceRouteReason(routeState) ?? "source route_state.eligible is not true";
  return { eligible: false, reason, routeState };
}

interface SourceTaskMutationTarget {
  argsPrefix: string[];
  env?: Record<string, string | undefined>;
  project?: string;
  sourceDbPath?: string;
  sourceRepoPath?: string;
  sourceStoreId?: string;
}

function sourceTaskMutationTarget(todosProject: string | undefined, task: TodosReadyTask, opts: { sourceMode?: boolean } = {}): SourceTaskMutationTarget | undefined {
  const source = taskSourceIdentity(task, taskField(task, ["id", "task_id", "taskId"]));
  if (source.sourceDbPath) {
    return {
      argsPrefix: source.sourceRepoPath ? ["--project", source.sourceRepoPath] : [],
      env: {
        TODOS_DB_PATH: source.sourceDbPath,
        HASNA_TODOS_DB_PATH: source.sourceDbPath,
      },
      project: source.sourceRepoPath,
      sourceDbPath: source.sourceDbPath,
      sourceRepoPath: source.sourceRepoPath,
      sourceStoreId: source.sourceStoreId,
    };
  }
  if (source.sourceRepoPath) {
    return {
      argsPrefix: ["--project", source.sourceRepoPath],
      project: source.sourceRepoPath,
      sourceRepoPath: source.sourceRepoPath,
      sourceStoreId: source.sourceStoreId,
    };
  }
  if (opts.sourceMode) return undefined;
  const project = todosProject ?? defaultLoopsProject();
  return { argsPrefix: ["--project", project], project };
}

function markInvalidDrainTaskNonRouteable(todosProject: string | undefined, task: TodosReadyTask, reason: string, opts: { sourceMode?: boolean } = {}): Record<string, unknown> {
  const taskId = taskField(task, ["id", "task_id", "taskId"]);
  if (!taskId) return { attempted: false, reason: "task id missing" };
  const comment = `OpenLoops route blocked for task ${taskId}: ${reason}. Added no-auto and removed auto:route so route drains do not repeatedly route this task until its project path is fixed.`;
  const target = sourceTaskMutationTarget(todosProject, task, { sourceMode: opts.sourceMode });
  if (!target) {
    return {
      attempted: false,
      taskId,
      reason: "source task missing source_db_path or source_repo_path; refusing to update router/default Todos store",
    };
  }
  const commentResult = runLocalCommand("todos", [...target.argsPrefix, "comment", taskId, comment], { timeoutMs: 30_000, env: target.env });
  const tagResult = runLocalCommand("todos", [...target.argsPrefix, "tag", taskId, "no-auto"], { timeoutMs: 30_000, env: target.env });
  const untagResult = runLocalCommand("todos", [...target.argsPrefix, "untag", taskId, "auto:route"], { timeoutMs: 30_000, env: target.env });
  const ok = commentResult.ok && tagResult.ok && untagResult.ok;
  return {
    ok,
    attempted: true,
    taskId,
    target: {
      project: target.project,
      source_db_path: target.sourceDbPath,
      source_repo_path: target.sourceRepoPath,
      source_store_id: target.sourceStoreId,
      used_db_env: Boolean(target.sourceDbPath),
    },
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
  const sourceMode = hasTodosSourceOptions(opts);
  const todosProject = sourceMode ? opts.todosProject : opts.todosProject ?? defaultLoopsProject();
  const requiredTags = splitList(opts.tags ?? opts.tag) ?? [];
  const taskListFilter = sourceMode ? opts.taskList?.trim() : resolveTaskListFilter(todosProject ?? defaultLoopsProject(), opts.taskList);
  const candidateLimit = positiveInteger(opts.limit ?? "50", "--limit") ?? 50;
  const hasPostFilters = Boolean(opts.todosProjectId || taskListFilter || opts.projectPathPrefix || requiredTags.length);
  const defaultScanLimit = hasPostFilters ? Math.max(candidateLimit, 500) : candidateLimit;
  const scanLimit = positiveInteger(opts.scanLimit ?? String(defaultScanLimit), "--scan-limit") ?? defaultScanLimit;
  const loaded = loadReadyTodosTasks(opts, scanLimit, sourceMode);
  const ready = loaded.tasks;
  const filteredCandidates = ready.filter((task) => taskMatchesDrainFilters(task, {
    projectId: opts.todosProjectId,
    taskList: taskListFilter,
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
      let sourceEligibility: ReturnType<typeof sourceRouteEligibility> | undefined;
      if (sourceMode) {
        sourceEligibility = sourceRouteEligibility(task);
        if (!sourceEligibility.eligible) {
          result = skippedDrainTask(task, undefined, sourceEligibility.reason ?? "source route_state.eligible is not true", {
            sourceRouteState: sourceEligibility.routeState,
            sourceTask: publicSourceTaskIdentity(taskSourceIdentity(task, taskField(task, ["id", "task_id", "taskId"]))),
          });
          results.push(result);
          continue;
        }
      }
      event = taskDrainEvent(task, { sourceRouteEligible: sourceEligibility?.eligible === true });
      result = routeTodosTaskEvent(event, opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isSkippableDrainRouteError(message)) throw error;
      const sourceTaskUpdate = opts.dryRun
        ? { attempted: false, reason: "dry-run" }
        : markInvalidDrainTaskNonRouteable(todosProject, task, message, { sourceMode });
      result = skippedDrainTask(task, event, redact(message, 640) ?? "route task failed", { sourceTaskUpdate });
    }
    results.push(result);
    if (result.kind === "created") created += 1;
  }
  const report = {
    drainedAt: new Date().toISOString(),
    todosProject,
    sourceMode,
    sourceRoots: loaded.sourceRoots,
    sourceStores: loaded.sourceStores,
    sourceIncludes: loaded.sourceIncludes,
    sourceExcludes: loaded.sourceExcludes,
    sourceDiscovery: loaded.sourceDiscovery,
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
    scanExhausted: sourceMode
      ? Boolean(loaded.sourceDiscovery?.truncated) || (ready.length >= scanLimit && filteredCandidates.length < candidateLimit)
      : ready.length >= scanLimit && filteredCandidates.length < candidateLimit,
    considered: results.length,
    created: results.filter((result) => result.kind === "created" && !result.value.deduped).length,
    deduped: results.filter((result) => result.kind === "deduped").length,
    throttled: results.filter((result) => result.kind === "throttled").length,
    skipped: results.filter((result) => result.kind === "skipped").length,
    maxDispatch,
    source: sourceMode ? "todos ready source discovery" : "todos ready",
    dryRun: Boolean(opts.dryRun),
    results: results.map((result) => ({ kind: result.kind, ...result.value })),
  };
  const evidencePath = writeRouteEvidence("todos-task-drain", report, opts.evidenceDir);
  const value = opts.compact
    ? {
        drainedAt: report.drainedAt,
        todosProject: report.todosProject,
        sourceMode: report.sourceMode,
        sourceRoots: report.sourceRoots,
        sourceStores: report.sourceStores,
        sourceIncludes: report.sourceIncludes,
        sourceExcludes: report.sourceExcludes,
        sourceDiscovery: report.sourceDiscovery,
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
    value: scrubSecretsDeep(value) as Record<string, unknown>,
    human: `drained todos ready queue: considered=${report.considered} created=${report.created} deduped=${report.deduped} throttled=${report.throttled} skipped=${report.skipped}`,
  };
}
