import { resolve } from "node:path";
import type { EventEnvelope } from "@hasna/events";
import { redact } from "../format.js";
import { ValidationError } from "../errors.js";
import type { Loop, WorkflowSpec } from "../../types.js";
import { objectField, stringField, tagsFromValue, taskEventField, taskRouteDisallowedTag } from "./fields.js";
import { listFromRepeatedOpts, positiveInteger, splitList } from "./parse.js";
import { providerActiveCapFromOpts } from "./provider-admission.js";
import { routeTodosTaskEvent, todosTaskRouteTemplateId } from "./route-event.js";
import { routePolicyEvidenceFromOptions } from "./policies.js";
import { isExistingGitProjectPath, normalizeRoutePath } from "./throttle.js";
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

function taskRoutePathFromRegistry(sourceProjectPath: string): string {
  // Registry drains scan a source todos project; task-controlled path fields
  // must not redirect the resulting route into a different repository.
  return normalizeRoutePath(sourceProjectPath) ?? resolve(sourceProjectPath);
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

function taskSourceWorkingDir(task: TodosReadyTask): string | undefined {
  const metadata = objectField(task.metadata) ?? {};
  return taskField(task, ["working_dir", "workingDir", "cwd"]) ??
    taskEventField(metadata, ["working_dir", "workingDir", "cwd"]);
}

function canonicalRoutePath(path: string | undefined): string | undefined {
  return normalizeRoutePath(path) ?? (path?.trim() ? resolve(path) : undefined);
}

/**
 * The task's own route target: the first per-task path candidate (explicit
 * project_path field, metadata, the description's `Repository:` line, then
 * working_dir) that is an existing git repository.
 *
 * Multi-repo drains (the merge lane) pass `--project-path` as a GROUP ROOT for
 * concurrency scoping while each task names its real repository — commit
 * 8ab2664 made the router-level path win unconditionally, which sent every
 * merge task to the group root (a non-repo directory such as the operator's
 * home) and skipped it ("worktreeMode=required but projectPath is not an
 * existing git repository"), zeroing merge dispatch fleet-wide. A *usable*
 * per-task repo therefore wins over `--project-path`;
 * the router-level path remains the rescue fallback for tasks whose recorded
 * path is stale or broken (8ab2664's original intent, e.g. a working_dir copied
 * from the wrong project). `isRepo` is injected so a drain tick can memoize the
 * `git rev-parse` probe across tasks and candidates.
 */
function taskUsableRepoProjectPath(
  task: TodosReadyTask,
  isRepo: (path: string) => boolean,
): string | undefined {
  const metadata = objectField(task.metadata) ?? {};
  const candidates = [
    taskField(task, ["project_path", "projectPath"]),
    taskEventField(metadata, ["project_path", "projectPath", "project_canonical_path"]),
    taskDescriptionProjectPath(task),
    taskField(task, ["working_dir", "workingDir", "cwd"]),
    taskEventField(metadata, ["working_dir", "workingDir", "cwd"]),
  ];
  for (const candidate of candidates) {
    const canonical = canonicalRoutePath(candidate);
    if (canonical && isRepo(canonical)) return canonical;
  }
  return undefined;
}

/** Per-drain-tick memoized `git rev-parse` probe (group roots and repo paths repeat across the candidate window). */
function memoizedIsExistingGitProjectPath(): (path: string) => boolean {
  const cache = new Map<string, boolean>();
  return (path: string): boolean => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    const result = isExistingGitProjectPath(path);
    cache.set(path, result);
    return result;
  };
}

function taskListValues(task: TodosReadyTask): string[] {
  const taskList = objectField(task.task_list) as
    | {
        id?: string;
        slug?: string;
        name?: string;
      }
    | undefined;
  return [
    taskField(task, ["task_list_id", "taskListId"]),
    stringField(task.task_list?.id),
    stringField(task.task_list?.slug),
    stringField(taskList?.name),
    taskField(task, ["task_list", "taskList"]),
  ].filter((value): value is string => Boolean(value));
}

function taskDrainEvent(task: TodosReadyTask, sourceProjectPath?: string, explicitRouteProjectPath?: string): EventEnvelope {
  const taskId = taskField(task, ["id", "task_id", "taskId"]);
  if (!taskId) throw new Error("todos ready returned a task without an id");
  const metadata = { ...(objectField(task.metadata) ?? {}) };
  const workingDir = taskProjectPath(task);
  const sourceWorkingDir = taskSourceWorkingDir(task);
  const routeWorkingDir = taskField(task, ["project_path", "projectPath"]) ?? workingDir;
  const routeProjectPath = canonicalRoutePath(explicitRouteProjectPath) ?? routeWorkingDir;
  const sourceProject = sourceProjectPath?.trim();
  if (!sourceProject) {
    delete metadata.source_project_path;
    delete metadata.sourceProjectPath;
  }
  const data: Record<string, unknown> = {
    ...task,
    id: taskId,
    title: taskField(task, ["title"]),
    description: taskField(task, ["description", "body"]),
    status: taskField(task, ["status"]),
    tags: tagsFromValue(task.tags),
    metadata,
  };
  if (!sourceProject) {
    delete data.source_project_path;
    delete data.sourceProjectPath;
  }
  if (routeProjectPath) {
    data.working_dir = routeProjectPath;
    data.project_path = routeProjectPath;
    data.cwd = routeProjectPath;
    data.route_project_path = routeProjectPath;
    data.routeProjectPath = routeProjectPath;
    metadata.route_project_path = routeProjectPath;
    metadata.routeProjectPath = routeProjectPath;
  }
  if (workingDir && routeProjectPath && canonicalRoutePath(workingDir) !== canonicalRoutePath(routeProjectPath)) {
    data.source_task_project_path = workingDir;
    metadata.source_task_project_path = workingDir;
  }
  if (sourceWorkingDir && routeProjectPath && canonicalRoutePath(sourceWorkingDir) !== canonicalRoutePath(routeProjectPath)) {
    data.source_task_working_dir = sourceWorkingDir;
    metadata.source_task_working_dir = sourceWorkingDir;
  }
  if (sourceProject) {
    data.source_project_path = sourceProject;
    if (!data.project_path) data.project_path = sourceProject;
    if (!data.route_project_path) data.route_project_path = data.project_path;
    if (!data.routeProjectPath) data.routeProjectPath = data.project_path;
    if (!metadata.route_project_path) metadata.route_project_path = data.project_path;
    if (!metadata.routeProjectPath) metadata.routeProjectPath = data.project_path;
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
      ...(sourceProject ? { source_project_path: sourceProject } : {}),
      ...(routeProjectPath ? { working_dir: routeProjectPath, project_path: data.project_path, cwd: data.cwd } : {}),
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
  const workItem = objectField(value.workItem);
  const throttle = objectField(value.throttle) as { reason?: string; allowed?: boolean } | undefined;
  const requeue = objectField(value.requeue);
  const providerRouting = objectField(value.providerRouting);
  const providerAdmission = objectField(value.providerAdmission);
  return {
    kind: result.kind,
    taskId: event?.subject,
    eventId: event?.id,
    idempotencyKey: stringField(value.idempotencyKey),
    workItemId: stringField(workItem?.id),
    workItemStatus: stringField(workItem?.status),
    machineId: stringField(workItem?.machineId),
    reason: stringField(value.reason) ?? throttle?.reason,
    loopId: stringField(loop?.id),
    loopName: stringField(loop?.name),
    workflowId: stringField(workflow?.id),
    workflowName: stringField(workflow?.name),
    providerRouting,
    providerAdmission,
    // Per-role codewith account attribution + the route scope that gates
    // --max-active, so drain reports show which account each step ran on and the
    // least-loaded spread is auditable.
    accountProfiles: objectField(value.accountProfiles),
    routeScope: stringField(value.routeScope),
    requeue,
    queuedAtSource: value.queuedAtSource,
    // Surface a redispatch-cap dead-letter in compact/cron output too, so a
    // capped task is visible and not mistaken for an ordinary dedupe.
    deadLettered: value.deadLettered === true ? true : undefined,
    // Preserve the non-skippable-error marker so compact/cron output still
    // exposes it; otherwise a fully-fatal drain looks identical to a no-op.
    fatal: value.fatal === true ? true : undefined,
  };
}

interface TodosProjectDescriptor {
  path: string;
}

interface LaunchGateBlockerRef {
  projectPath: string;
  taskId: string;
  raw: string;
}

interface LaunchGateBlockerStatus extends LaunchGateBlockerRef {
  status?: string;
  title?: string;
  resolved: boolean;
  error?: string;
}

interface LaunchGateEvaluation {
  configured: true;
  name?: string;
  blocked: boolean;
  reason: string;
  blockers: LaunchGateBlockerStatus[];
}

const LAUNCH_GATE_RESOLVED_STATUSES = new Set(["completed", "done"]);

function parseLaunchGateBlocker(raw: string): LaunchGateBlockerRef {
  const value = raw.trim();
  if (!value) throw new ValidationError("--launch-gate-blocker entries cannot be empty");
  const delimiter = value.includes("::") ? "::" : value.includes("#") ? "#" : ":";
  const index = value.lastIndexOf(delimiter);
  if (index <= 0 || index + delimiter.length >= value.length) {
    throw new ValidationError("--launch-gate-blocker must use <todos-project-path>::<task-id>");
  }
  const projectPath = value.slice(0, index).trim();
  const taskId = value.slice(index + delimiter.length).trim();
  if (!projectPath || !taskId) throw new ValidationError("--launch-gate-blocker must include both project path and task id");
  return { projectPath, taskId, raw };
}

function parseTodosTaskJson(stdout: string): Record<string, unknown> {
  const parsed = JSON.parse(stdout || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("todos inspect returned a non-object value");
  return parsed as Record<string, unknown>;
}

function inspectLaunchGateBlocker(ref: LaunchGateBlockerRef): LaunchGateBlockerStatus {
  const result = runLocalCommand("todos", ["--project", ref.projectPath, "--json", "inspect", ref.taskId], {
    timeoutMs: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!result.ok) {
    return {
      ...ref,
      resolved: false,
      error: redact(result.stderr || result.error || `todos inspect failed with status ${result.status}`, 320),
    };
  }
  try {
    const task = parseTodosTaskJson(result.stdout);
    const status = stringField(task.status)?.trim().toLowerCase();
    const title = stringField(task.title);
    return {
      ...ref,
      status,
      title: title ? redact(title, 160) : undefined,
      resolved: Boolean(status && LAUNCH_GATE_RESOLVED_STATUSES.has(status)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...ref,
      resolved: false,
      error: redact(`failed to parse todos inspect JSON: ${message}`, 320),
    };
  }
}

function evaluateLaunchGate(opts: TodosDrainOptions): LaunchGateEvaluation | undefined {
  const blockerRefs = listFromRepeatedOpts(opts.launchGateBlocker) ?? [];
  if (blockerRefs.length === 0 && !opts.launchGate?.trim()) return undefined;
  if (blockerRefs.length === 0) {
    throw new ValidationError("--launch-gate requires at least one --launch-gate-blocker");
  }
  const blockers = blockerRefs.map((entry) => inspectLaunchGateBlocker(parseLaunchGateBlocker(entry)));
  const unresolved = blockers.filter((blocker) => !blocker.resolved);
  const name = opts.launchGate?.trim() || undefined;
  const blocked = unresolved.length > 0;
  const label = name ? `launch gate ${name}` : "launch gate";
  const reason = blocked
    ? `${label} blocked by unresolved task(s): ${unresolved.map((blocker) =>
        `${blocker.taskId} status=${blocker.status ?? "unknown"}${blocker.error ? " error=inspect-failed" : ""}`,
      ).join(", ")}`
    : `${label} open; all blocker tasks are completed`;
  return {
    configured: true,
    name,
    blocked,
    reason,
    blockers,
  };
}

function parseTodosReadyJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout || "[]");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse todos ready --json output (${stdout.length} bytes): ${message}`);
  }
}

function parseTodoProjectsJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout || "[]");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse todos projects --json output (${stdout.length} bytes): ${message}`);
  }
}

function loadTodoProjectPathsFromRegistry(opts: TodosDrainOptions): string[] {
  const result = runLocalCommand("todos", ["projects", "--json"], { timeoutMs: 60_000 });
  if (!result.ok) throw new Error(result.stderr || result.error || "todos projects failed");
  const payload = parseTodoProjectsJson(result.stdout);
  const projectsPayload = Array.isArray(payload) ? payload : objectField(payload)?.projects;
  if (!Array.isArray(projectsPayload)) throw new Error("todos projects --json returned a non-array value");
  const includeFilters = listFromRepeatedOpts(opts.todosProjectInclude)?.map(
    (entry) => normalizeRoutePath(entry) ?? resolve(entry),
  ) ?? [];
  const includesPrefix = normalizeRoutePath(opts.projectPathPrefix) ?? (opts.projectPathPrefix ? resolve(opts.projectPathPrefix) : undefined);
  const fromProjects: TodosProjectDescriptor[] = projectsPayload
    .map((entry) => objectField(entry))
    .filter((project): project is Record<string, unknown> => Boolean(project))
    .map((project): TodosProjectDescriptor | undefined => {
      const path = stringField(project.path)
        ?? stringField(project.projectPath)
        ?? stringField(project.project_path)
        ?? stringField(project.dir)
        ?? stringField(project.root)
        ?? stringField(project.cwd);
      if (!path) return undefined;
      return { path };
    })
    .filter((project): project is TodosProjectDescriptor => Boolean(project));
  const paths = fromProjects
    .map((project) => project.path)
    .filter(Boolean)
    .filter((path) => {
      const normalizedPath = normalizeRoutePath(path) ?? resolve(path);
      if (includesPrefix && !(normalizedPath === includesPrefix || normalizedPath.startsWith(`${includesPrefix}/`))) return false;
      if (includeFilters.length === 0) return true;
      return includeFilters.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`));
    });
  return [...new Set(paths)];
}

function loadReadyTodosTasksForProject(projectPath: string, scanLimit: number): TodosReadyTask[] {
  const args = ["--project", projectPath, "--json", "ready", "--limit", String(scanLimit)];
  const result = runLocalCommandWithStdoutFile("todos", args, { timeoutMs: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (!result.ok) throw new Error(result.stderr || result.error || "todos ready failed");
  const parsed = parseTodosReadyJson(result.stdout);
  if (!Array.isArray(parsed)) throw new Error("todos ready --json returned a non-array value");
  return parsed as TodosReadyTask[];
}

function loadReadyTodosTasks(opts: TodosDrainOptions, scanLimit: number): TodosReadyTask[] {
  if (!opts.todosProjectsFromRegistry) {
    const todosProject = opts.todosProject ?? defaultLoopsProject();
    return loadReadyTodosTasksForProject(todosProject, scanLimit);
  }
  const projectPaths = loadTodoProjectPathsFromRegistry(opts);
  const ready = projectPaths.flatMap((projectPath) =>
    loadReadyTodosTasksForProject(projectPath, scanLimit).map((task) => {
      const sourceProject = projectPath;
      return {
        ...task,
        source_project_path: sourceProject,
        project_path: taskRoutePathFromRegistry(sourceProject),
      };
    }),
  );
  return ready;
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
  const eventData = objectField(event?.data);
  const eventMetadata = objectField((event as { metadata?: unknown } | undefined)?.metadata);
  const routeProjectPath = taskEventField(eventData ?? {}, ["route_project_path", "routeProjectPath", "project_path", "projectPath", "working_dir", "workingDir", "cwd"]);
  const sourceTaskProjectPath =
    taskEventField(eventData ?? {}, ["source_task_project_path", "sourceTaskProjectPath"]) ??
    taskEventField(eventMetadata ?? {}, ["source_task_project_path", "sourceTaskProjectPath"]) ??
    taskProjectPath(task);
  const sourceTaskWorkingDir =
    taskEventField(eventData ?? {}, ["source_task_working_dir", "sourceTaskWorkingDir"]) ??
    taskEventField(eventMetadata ?? {}, ["source_task_working_dir", "sourceTaskWorkingDir"]) ??
    taskSourceWorkingDir(task);
  return {
    kind: "skipped",
    value: {
      skipped: true,
      reason,
      taskId,
      event,
      routeError: true,
      routeProjectPath,
      sourceTaskProjectPath,
      sourceTaskWorkingDir,
      ...extra,
    },
    human: `skipped task ${taskId}: ${reason}`,
  };
}

function isSkippableDrainRouteError(message: string): boolean {
  return message.startsWith("worktreeMode=required but projectPath is not an existing git repository:");
}

function markInvalidDrainTaskNonRouteable(sourceTodosProject: string, task: TodosReadyTask, reason: string): Record<string, unknown> {
  const taskId = taskField(task, ["id", "task_id", "taskId"]);
  if (!taskId) return { attempted: false, reason: "task id missing" };
  const comment = `Loops route blocked for task ${taskId}: ${reason}. Added no-auto and removed auto:route so route drains do not repeatedly route this task until its project path is fixed.`;
  const commentResult = runLocalCommand("todos", ["--project", sourceTodosProject, "comment", taskId, comment], { timeoutMs: 30_000 });
  const tagResult = runLocalCommand("todos", ["--project", sourceTodosProject, "tag", taskId, "no-auto"], { timeoutMs: 30_000 });
  const untagResult = runLocalCommand("todos", ["--project", sourceTodosProject, "untag", taskId, "auto:route"], { timeoutMs: 30_000 });
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

/** A route skip caused by the definitive MERGED/CLOSED PR freshness gate. */
function isFreshnessSkip(result: TodosTaskRoutePrint): boolean {
  return result.kind === "skipped" && result.value.freshnessSkip === true;
}

/**
 * Close a todos task whose PR route was freshness-skipped because the PR is
 * definitively MERGED/CLOSED. 0.4.10's freshness gate stopped dispatching the
 * merge/review worker but left the task pending + route-opted-in, so every drain
 * tick re-skipped it forever. Mark it done (the canonical close; `done` sets
 * status=completed which route eligibility rejects) and strip the auto:route /
 * route:enabled opt-in tags as belt-and-suspenders so the task leaves the
 * routable queue even if a todos build does not honor `done`. Best-effort: each
 * mutation result is recorded for the drain evidence report.
 */
function closeFreshnessSkippedTask(sourceTodosProject: string, task: TodosReadyTask, reason: string): Record<string, unknown> {
  const taskId = taskField(task, ["id", "task_id", "taskId"]);
  if (!taskId) return { attempted: false, reason: "task id missing" };
  const comment =
    `Loops freshness gate closed this task: ${reason}. The referenced PR is already merged/closed, so the ` +
    `merge/review route will not dispatch a worker. Marked done and removed auto:route/route:enabled so drains stop re-skipping it.`;
  const commentResult = runLocalCommand("todos", ["--project", sourceTodosProject, "comment", taskId, comment], { timeoutMs: 30_000 });
  const doneResult = runLocalCommand(
    "todos",
    ["--project", sourceTodosProject, "done", taskId, "--notes", "PR already merged/closed; closed by Loops freshness gate"],
    { timeoutMs: 30_000 },
  );
  const untagAutoRoute = runLocalCommand("todos", ["--project", sourceTodosProject, "untag", taskId, "auto:route"], { timeoutMs: 30_000 });
  const untagRouteEnabled = runLocalCommand("todos", ["--project", sourceTodosProject, "untag", taskId, "route:enabled"], { timeoutMs: 30_000 });
  const leftQueue = doneResult.ok || untagAutoRoute.ok || untagRouteEnabled.ok;
  return {
    ok: leftQueue,
    attempted: true,
    taskId,
    action: "freshness-close",
    error: leftQueue ? undefined : "task could not be closed or untagged; inspect per-command results",
    comment: todosMutationSummary(commentResult),
    done: todosMutationSummary(doneResult),
    untagAutoRoute: todosMutationSummary(untagAutoRoute),
    untagRouteEnabled: todosMutationSummary(untagRouteEnabled),
  };
}

export interface DrainResult {
  value: Record<string, unknown>;
  human: string;
}

export function drainTodosTaskRoutes(opts: TodosDrainOptions): DrainResult {
  providerActiveCapFromOpts(opts);
  const maxDispatch = positiveInteger(opts.maxDispatch ?? "1", "--max-dispatch") ?? 1;
  const todosProject = opts.todosProject ?? defaultLoopsProject();
  const requiredTags = splitList(opts.tags ?? opts.tag) ?? [];
  const candidateLimit = positiveInteger(opts.limit ?? "50", "--limit") ?? 50;
  const hasPostFilters = Boolean(opts.todosProjectId || opts.taskList || opts.projectPathPrefix || requiredTags.length);
  const defaultScanLimit = hasPostFilters ? Math.max(candidateLimit, 500) : candidateLimit;
  const scanLimit = positiveInteger(opts.scanLimit ?? String(defaultScanLimit), "--scan-limit") ?? defaultScanLimit;
  const templateId = todosTaskRouteTemplateId(opts);
  const routePolicy = routePolicyEvidenceFromOptions(opts);
  const launchGate = evaluateLaunchGate(opts);
  if (launchGate?.blocked) {
    const report = {
      drainedAt: new Date().toISOString(),
      todosProject,
      routePolicy,
      templateId,
      todosProjectId: opts.todosProjectId,
      taskList: opts.taskList,
      taskListId: undefined,
      projectPathPrefix: opts.projectPathPrefix,
      tags: requiredTags,
      limit: candidateLimit,
      scanLimit,
      filtersApplied: hasPostFilters,
      scanned: 0,
      candidates: 0,
      filteredCandidates: 0,
      excludedDisallowedTag: 0,
      scanExhausted: false,
      considered: 0,
      created: 0,
      deduped: 0,
      deadLettered: 0,
      throttled: 0,
      skipped: 0,
      freshnessClosed: 0,
      fatal: 0,
      blocked: 1,
      maxDispatch,
      source: "todos ready",
      dryRun: Boolean(opts.dryRun),
      launchGate,
      results: [],
    };
    const evidencePath = writeRouteEvidence("todos-task-drain", report, opts.evidenceDir);
    const value = opts.compact
      ? {
          drainedAt: report.drainedAt,
          todosProject: report.todosProject,
          routePolicy: report.routePolicy,
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
          excludedDisallowedTag: report.excludedDisallowedTag,
          scanExhausted: report.scanExhausted,
          considered: report.considered,
          created: report.created,
          deduped: report.deduped,
          deadLettered: report.deadLettered,
          throttled: report.throttled,
          skipped: report.skipped,
          freshnessClosed: report.freshnessClosed,
          fatal: report.fatal,
          blocked: report.blocked,
          maxDispatch: report.maxDispatch,
          source: report.source,
          dryRun: report.dryRun,
          launchGate,
          evidencePath,
          results: [],
        }
      : { ...report, evidencePath };
    return {
      value,
      human: `blocked todos ready drain: ${launchGate.reason}`,
    };
  }
  const taskListFilter = opts.todosProjectsFromRegistry ? opts.taskList?.trim() : resolveTaskListFilter(todosProject, opts.taskList);
  const ready = loadReadyTodosTasks(opts, scanLimit);
  const filteredCandidates = ready.filter((task) => taskMatchesDrainFilters(task, {
    projectId: opts.todosProjectId,
    taskList: taskListFilter,
    projectPathPrefix: opts.projectPathPrefix,
    tags: requiredTags,
  }));
  // Route-disallowed tasks (no-auto/blocked/manual/…) can never route; letting
  // them occupy candidate rows burns the bounded window every tick only to be
  // rejected by eligibility — with enough marked tasks a drain reports
  // considered=N created=0 forever while routable work waits outside the
  // window. Exclude them before slicing (unless the drain explicitly selects
  // that tag). The exclusion count is reported so the memory is auditable.
  const requiredTagSet = new Set(requiredTags.map((tag) => tag.toLowerCase()));
  const windowCandidates = filteredCandidates.filter((task) => {
    const disallowed = taskRouteDisallowedTag(tagsFromValue(task.tags));
    return !disallowed || requiredTagSet.has(disallowed.toLowerCase());
  });
  const excludedDisallowedTag = filteredCandidates.length - windowCandidates.length;
  const candidates = windowCandidates.slice(0, candidateLimit);
  const isRepo = memoizedIsExistingGitProjectPath();
  const results: TodosTaskRoutePrint[] = [];
  let created = 0;
  for (const task of candidates) {
    if (created >= maxDispatch) break;
    let event: EventEnvelope | undefined;
    let result: TodosTaskRoutePrint;
    try {
      const sourceProject = opts.todosProjectsFromRegistry ? taskField(task, ["source_project_path", "sourceProjectPath"]) : undefined;
      // Non-registry drains: the task's own USABLE repo path (project_path,
      // metadata, description `Repository:` line, working_dir — first that is a
      // real git repo) wins over the router-level --project-path, which
      // multi-repo drains pass as a group root; the router path remains the
      // rescue fallback for tasks whose recorded path is stale or broken.
      // Registry drains keep the scanned source project path unconditionally
      // (task-controlled fields must not redirect the route).
      const explicitRouteProjectPath = sourceProject
        ? taskRoutePathFromRegistry(sourceProject)
        : taskUsableRepoProjectPath(task, isRepo) ?? opts.projectPath;
      event = taskDrainEvent(task, sourceProject, explicitRouteProjectPath);
      result = routeTodosTaskEvent(event, {
        ...opts,
        ...(explicitRouteProjectPath ? { projectPath: explicitRouteProjectPath } : {}),
        ...(sourceProject ? { sourceTodosProjectPath: sourceProject } : {}),
        sourceTaskResolved: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isSkippableDrainRouteError(message)) {
        const sourceTaskProject = opts.todosProjectsFromRegistry
          ? (taskField(task, ["source_project_path", "sourceProjectPath"]) ?? todosProject)
          : todosProject;
        const sourceTaskUpdate = opts.dryRun
          ? { attempted: false, reason: "dry-run" }
          : markInvalidDrainTaskNonRouteable(sourceTaskProject, task, message);
        result = skippedDrainTask(task, event, redact(message, 640) ?? "route task failed", { sourceTaskUpdate });
      } else {
        // Previously any non-skippable route error threw and aborted the whole
        // drain mid-batch: already-created loops were kept, the remaining
        // candidates went unprocessed, and no evidence file was written. Capture
        // the error per-task and continue so the batch completes and the
        // evidence report records the failure (flagged fatal for visibility).
        result = skippedDrainTask(task, event, redact(message, 640) ?? "route task failed", { fatal: true });
      }
    }
    // A definitive MERGED/CLOSED freshness skip would otherwise re-skip the same
    // task every tick; close it out of the source queue (never on dry-run).
    if (!opts.dryRun && isFreshnessSkip(result)) {
      const sourceTaskProject = opts.todosProjectsFromRegistry
        ? (taskField(task, ["source_project_path", "sourceProjectPath"]) ?? todosProject)
        : todosProject;
      const reason = stringField(result.value.reason) ?? "PR already merged/closed (freshness gate)";
      const sourceTaskUpdate = closeFreshnessSkippedTask(sourceTaskProject, task, reason);
      result = { ...result, value: { ...result.value, sourceTaskUpdate } };
    }
    results.push(result);
    if (result.kind === "created") created += 1;
  }
  const report = {
    drainedAt: new Date().toISOString(),
    todosProject,
    routePolicy,
    templateId,
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
    // Never-routable tasks (route-disallowed tags) held out of the candidate
    // window so they stop burning scan slots every tick.
    excludedDisallowedTag,
    scanExhausted: ready.length >= scanLimit && windowCandidates.length < candidateLimit,
    considered: results.length,
    created: results.filter((result) => result.kind === "created" && !result.value.deduped).length,
    deduped: results.filter((result) => result.kind === "deduped").length,
    // Terminal work items the route dead-lettered because they hit the
    // redispatch cap: the black hole made visible. Surfaced + counted so a
    // capped, still-actionable task no longer silently reports created=0.
    deadLettered: results.filter((result) => result.kind === "deduped" && result.value.deadLettered === true).length,
    throttled: results.filter((result) => result.kind === "throttled").length,
    skipped: results.filter((result) => result.kind === "skipped").length,
    // Tasks closed out of the queue because their PR is definitively
    // merged/closed (freshness gate) — evidence that they stop re-skipping.
    freshnessClosed: results.filter(
      (result) => isFreshnessSkip(result) && (result.value.sourceTaskUpdate as { attempted?: boolean } | undefined)?.attempted === true,
    ).length,
    // Non-skippable route errors captured per-task (batch continued). A drain
    // where every candidate is fatal would otherwise report created=0 skipped=N
    // and exit 0; callers use this count to fail the run instead.
    fatal: results.filter((result) => result.value.fatal === true).length,
    blocked: 0,
    maxDispatch,
    source: "todos ready",
    dryRun: Boolean(opts.dryRun),
    launchGate,
    results: results.map((result) => ({ kind: result.kind, ...result.value })),
  };
  const evidencePath = writeRouteEvidence("todos-task-drain", report, opts.evidenceDir);
  const value = opts.compact
    ? {
        drainedAt: report.drainedAt,
        todosProject: report.todosProject,
        routePolicy: report.routePolicy,
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
        excludedDisallowedTag: report.excludedDisallowedTag,
        scanExhausted: report.scanExhausted,
        considered: report.considered,
        created: report.created,
        deduped: report.deduped,
        deadLettered: report.deadLettered,
        throttled: report.throttled,
        skipped: report.skipped,
        freshnessClosed: report.freshnessClosed,
        fatal: report.fatal,
        blocked: report.blocked,
        maxDispatch: report.maxDispatch,
        source: report.source,
        dryRun: report.dryRun,
        launchGate: report.launchGate,
        evidencePath,
        results: results.map(compactDrainResult),
      }
    : { ...report, evidencePath };
  return {
    value,
    human: `drained todos ready queue: considered=${report.considered} created=${report.created} deduped=${report.deduped} deadLettered=${report.deadLettered} throttled=${report.throttled} skipped=${report.skipped} freshnessClosed=${report.freshnessClosed} fatal=${report.fatal} excludedDisallowedTag=${report.excludedDisallowedTag}`,
  };
}
