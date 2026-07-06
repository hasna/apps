import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EventEnvelope } from "@hasna/events";
import type {
  AgentProvider,
  AgentSandbox,
  AgentWorktreeMode,
  CreateLoopInput,
  CreateWorkflowInput,
  CreateWorkflowInvocationInput,
  UpsertWorkflowWorkItemInput,
  WorkflowSpec,
  WorkflowWorkItem,
  WorkflowWorkItemStatus,
} from "../../types.js";
import { Store } from "../store.js";
import { ValidationError } from "../errors.js";
import { publicLoop, publicWorkflow, publicWorkflowInvocation, publicWorkflowWorkItem } from "../format.js";
import {
  renderEventWorkerVerifierWorkflow,
  renderTaskLifecycleWorkflow,
  renderTodosTaskWorkerVerifierWorkflow,
  TASK_LIFECYCLE_TEMPLATE_ID,
  TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
} from "../templates.js";
import { eventData, eventMetadata, routeFieldValues, slugSegment, stableSuffix, stringField, taskEventField, taskEventRecords, taskRouteEligibility } from "./fields.js";
import { normalizeWorkflowForStorage, preflightStoredWorkflow, workflowSpecForPreflight } from "./gates.js";
import { idleTimeoutDuration, listFromRepeatedOpts, timeoutDuration } from "./parse.js";
import { prReviewRoutingDecision } from "./pr-review.js";
import {
  permissionModeFromOpts,
  providerAuthProfileFromOpts,
  providerRoutingPublic,
  resolveProviderRouting,
  roleAccountFromOpts,
  sandboxFromOpts,
} from "./provider.js";
import {
  hasThrottleLimits,
  normalizeRoutePath,
  routeProjectGroup,
  routeThrottleDecision,
  routeThrottleDryRunPreview,
  routeThrottleLimitsFromOpts,
  validateRequiredRouteWorktreeProjectPath,
  type RouteThrottleLimits,
} from "./throttle.js";
import type { TodosTaskRouteOptions, TodosTaskRoutePrint } from "./types.js";

/** Shared event-to-workflow route engine behind `routes create/preview` and the deprecated `events handle` aliases. */

interface RouteSandboxPreflight {
  stepId: string;
  provider: AgentProvider;
  sandbox?: AgentSandbox;
  worktreeEnabled?: boolean;
  method: "provider-native-sandbox" | "isolated-worktree" | "manual-break-glass";
}

export function generatedRouteSandboxPreflight(workflow: CreateWorkflowInput): RouteSandboxPreflight[] {
  const checks: RouteSandboxPreflight[] = [];
  for (const step of workflow.steps) {
    if (step.target.type !== "agent") continue;
    const target = step.target;
    const worktreeEnabled = Boolean(target.worktree?.enabled);
    if (target.sandbox === "danger-full-access") {
      const manual = target.allowlist?.commands?.includes("manual-break-glass");
      if (!manual) {
        throw new ValidationError(`route step ${step.id} uses danger-full-access without manual break-glass evidence`);
      }
      checks.push({ stepId: step.id, provider: target.provider, sandbox: target.sandbox, worktreeEnabled, method: "manual-break-glass" });
      continue;
    }
    if (
      (["codewith", "codex"].includes(target.provider) && (target.sandbox === "workspace-write" || target.sandbox === "read-only")) ||
      (target.provider === "cursor" && target.sandbox === "enabled")
    ) {
      checks.push({ stepId: step.id, provider: target.provider, sandbox: target.sandbox, worktreeEnabled, method: "provider-native-sandbox" });
      continue;
    }
    if (worktreeEnabled) {
      checks.push({ stepId: step.id, provider: target.provider, sandbox: target.sandbox, worktreeEnabled, method: "isolated-worktree" });
      continue;
    }
    throw new ValidationError(
      `route step ${step.id} has no verified unattended isolation; use provider sandbox workspace-write/read-only/enabled, worktreeMode=required, or explicit manual break-glass`,
    );
  }
  return checks;
}

function generatedRouteWorkflowSignature(workflow: Pick<WorkflowSpec, "version" | "goal" | "steps"> | CreateWorkflowInput): string {
  return JSON.stringify({
    version: workflow.version ?? 1,
    goal: workflow.goal ?? null,
    steps: workflow.steps,
  });
}

function canReuseGeneratedRouteWorkflow(existing: WorkflowSpec, generated: CreateWorkflowInput): boolean {
  if (generatedRouteWorkflowSignature(existing) !== generatedRouteWorkflowSignature(generated)) return false;
  try {
    generatedRouteSandboxPreflight(existing);
    return true;
  } catch {
    return false;
  }
}

function routeWorkflowForStorage(store: Store, workflowBody: CreateWorkflowInput): WorkflowSpec {
  const existingWorkflow = store.findWorkflowByName(workflowBody.name);
  if (existingWorkflow && canReuseGeneratedRouteWorkflow(existingWorkflow, workflowBody)) return existingWorkflow;
  if (existingWorkflow) store.archiveWorkflow(existingWorkflow.id);
  return store.createWorkflow(workflowBody);
}

const TODOS_TASK_ROUTE_TEMPLATE_IDS = new Set([
  TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
  TASK_LIFECYCLE_TEMPLATE_ID,
]);

const UNCLEARED_ROUTE_WORK_ITEM_STATUSES = new Set<WorkflowWorkItemStatus>([
  "queued",
  "deferred",
  "admitted",
  "running",
  "succeeded",
  "failed",
  "dead_letter",
  "cancelled",
]);

function isUnclearedRouteWorkItem(item: { loopId?: string; status: WorkflowWorkItemStatus }): boolean {
  return UNCLEARED_ROUTE_WORK_ITEM_STATUSES.has(item.status);
}

const TASK_FINGERPRINT_FIELDS = [
  "fingerprint",
  "dedupe_fingerprint",
  "dedupeFingerprint",
  "route_fingerprint",
  "routeFingerprint",
];

function findRouteWorkItemByKeys(store: Store, routeKey: "todos-task" | "generic-event", idempotencyKeys: string[]): WorkflowWorkItem | undefined {
  for (const key of idempotencyKeys) {
    const existingItem = store.findWorkflowWorkItem(routeKey, key);
    if (existingItem && isUnclearedRouteWorkItem(existingItem)) return existingItem;
  }
  return undefined;
}

function prIdempotencySubject(data: Record<string, unknown>, metadata: Record<string, unknown>, taskId: string): string {
  const records = taskEventRecords(data, metadata);
  const tags = new Set(records.flatMap((record) => routeFieldValues([record], "tags")).map((tag) => tag.toLowerCase()));
  const isPrBacklogTask = tags.has("github-pr") && tags.has("pr-merge-queue");
  if (!isPrBacklogTask) return taskId;
  const text = [
    ...TASK_FINGERPRINT_FIELDS.flatMap((field) => routeFieldValues(records, field)),
    taskEventField(data, ["title", "task_title", "taskTitle"]),
    taskEventField(data, ["description", "body"]),
  ].filter(Boolean).join("\n");
  const fingerprintMatch = /\bgithub-pr:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)\b/i.exec(text);
  if (fingerprintMatch?.[1]) return `pr:${fingerprintMatch[1].toLowerCase()}`;
  const urlMatch = /\bhttps:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)\b/i.exec(text);
  if (urlMatch?.[1] && urlMatch[2] && urlMatch[3]) {
    return `pr:${urlMatch[1].toLowerCase()}/${urlMatch[2].toLowerCase()}#${urlMatch[3]}`;
  }
  return taskId;
}

export function todosTaskRouteTemplateId(opts: { template?: string }): string {
  const id = (opts.template ?? TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID).trim();
  if (!TODOS_TASK_ROUTE_TEMPLATE_IDS.has(id)) {
    throw new ValidationError(
      `--template must be ${[...TODOS_TASK_ROUTE_TEMPLATE_IDS].join(" or ")} for todos-task routes`,
    );
  }
  return id;
}

export async function readEventEnvelopeInput(opts: { eventJson?: string; eventFile?: string } = {}): Promise<EventEnvelope> {
  const raw = opts.eventJson ?? (opts.eventFile ? readFileSync(opts.eventFile, "utf8") : process.env.HASNA_EVENT_JSON || (await Bun.stdin.text()));
  const event = JSON.parse(raw);
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new ValidationError("event JSON must be an object");
  if (!stringField(event.id)) throw new ValidationError("event.id is required");
  if (!stringField(event.type)) throw new ValidationError("event.type is required");
  if (!stringField(event.source)) throw new ValidationError("event.source is required");
  return event as EventEnvelope;
}

/** Everything kind-specific a route needs before the shared engine takes over. */
interface RouteEventPlan {
  routeKey: "todos-task" | "generic-event";
  event: EventEnvelope;
  opts: TodosTaskRouteOptions;
  idempotencyKey: string;
  dedupeAliases?: string[];
  /** Rendered, named, and normalized workflow to store. */
  workflowBody: CreateWorkflowInput;
  /** Structured context reported when validation/preflight gates fail. */
  workflowContext: Record<string, unknown>;
  invocationInput: CreateWorkflowInvocationInput;
  routeProjectPath: string;
  projectGroup?: string;
  subjectRef: string;
  loopName: string;
  loopDescription: string;
  throttleLimits: RouteThrottleLimits;
  admitReason: string;
  /** Human-readable subject for skip messages, e.g. `task <id>` or `event <id>`. */
  humanSubject: string;
  /** Extra fields merged into dry-run/throttled/created outputs (providerRouting, prReviewRouting). */
  valueExtras: Record<string, unknown>;
  /** Extra fields merged into deduped outputs. */
  dedupeValueExtras: Record<string, unknown>;
}

function dedupedRoutePrint(
  plan: Pick<RouteEventPlan, "event" | "idempotencyKey" | "dedupeValueExtras">,
  outcome: { existingItem: WorkflowWorkItem; existingLoop?: ReturnType<Store["getLoop"]>; existingWorkflow?: WorkflowSpec; invocation?: Parameters<typeof publicWorkflowInvocation>[0] },
): TodosTaskRoutePrint {
  return {
    kind: "deduped",
    value: {
      deduped: true,
      idempotencyKey: plan.idempotencyKey,
      dedupedBy: "work-item",
      event: plan.event,
      ...plan.dedupeValueExtras,
      invocation: outcome.invocation ? publicWorkflowInvocation(outcome.invocation) : undefined,
      workItem: publicWorkflowWorkItem(outcome.existingItem),
      workflow: outcome.existingWorkflow ? publicWorkflow(outcome.existingWorkflow) : undefined,
      loop: outcome.existingLoop ? publicLoop(outcome.existingLoop) : undefined,
    },
    human: `deduped existing work item ${outcome.existingItem.id} for event=${plan.event.id} idempotency=${plan.idempotencyKey}`,
  };
}

/**
 * Shared transaction/dedupe/throttle/outcome half of every event route: dry-run
 * preview, work-item dedupe, admission throttling, workflow + loop creation.
 */
function routeEvent(plan: RouteEventPlan): TodosTaskRoutePrint {
  const { event, opts, idempotencyKey, workflowBody } = plan;
  const sandboxPreflight = generatedRouteSandboxPreflight(workflowBody);
  const dedupeKeys = [idempotencyKey, ...(plan.dedupeAliases ?? [])];
  const workItemInput: UpsertWorkflowWorkItemInput = {
    routeKey: plan.routeKey,
    idempotencyKey,
    invocationId: "<created-invocation-id>",
    sourceType: event.type,
    sourceRef: event.id,
    subjectRef: plan.subjectRef,
    projectKey: plan.routeProjectPath,
    projectGroup: plan.projectGroup,
    priority: 0,
    status: "queued" as const,
  };
  const loopInput: CreateLoopInput = {
    name: plan.loopName,
    description: plan.loopDescription,
    schedule: { type: "once" as const, at: new Date(Date.now() + 1_000).toISOString() },
    target: { type: "workflow" as const, workflowId: "<created-workflow-id>", input: {} },
    overlap: "skip" as const,
    maxAttempts: 1,
    retryDelayMs: 60_000,
    leaseMs: 90 * 60_000,
  };
  if (opts.dryRun) {
    const throttle = hasThrottleLimits(plan.throttleLimits)
      ? routeThrottleDryRunPreview({ projectPath: plan.routeProjectPath, projectGroup: plan.projectGroup, limits: plan.throttleLimits })
      : undefined;
    const preflight = opts.preflight
      ? preflightStoredWorkflow(workflowSpecForPreflight(workflowBody, "event-preflight"), plan.workflowContext, {})
      : undefined;
    return {
      kind: "created",
      value: {
        deduped: false,
        idempotencyKey,
        event,
        ...plan.valueExtras,
        invocation: plan.invocationInput,
        workItem: workItemInput,
        workflow: workflowBody,
        loop: loopInput,
        throttle,
        sandboxPreflight,
        preflight,
      },
      human: `dry-run ${plan.loopName}`,
    };
  }
  const store = new Store();
  try {
    const workflowPreflightSpec = workflowSpecForPreflight(workflowBody, "event-preflight");
    generatedRouteSandboxPreflight(workflowPreflightSpec);
    const preflight = opts.preflight
      ? preflightStoredWorkflow(workflowPreflightSpec, plan.workflowContext, {})
      : undefined;
    const outcome = store.writeTransaction(() => {
      const invocation = store.createWorkflowInvocation(plan.invocationInput);
      const existingItem = findRouteWorkItemByKeys(store, plan.routeKey, dedupeKeys);
      if (existingItem) {
        const existingLoop = existingItem.loopId ? store.getLoop(existingItem.loopId) : undefined;
        const existingWorkflow = existingItem.workflowId ? store.getWorkflow(existingItem.workflowId) : undefined;
        return { kind: "deduped" as const, existingItem, existingLoop, existingWorkflow, invocation };
      }
      const throttle = hasThrottleLimits(plan.throttleLimits)
        ? routeThrottleDecision(store, { projectPath: plan.routeProjectPath, projectGroup: plan.projectGroup, limits: plan.throttleLimits })
        : undefined;
      const workItem = store.upsertWorkflowWorkItem({
        ...workItemInput,
        invocationId: invocation.id,
        status: throttle && !throttle.allowed ? "deferred" : "queued",
        lastReason: throttle && !throttle.allowed ? throttle.reason : undefined,
      });
      const requeue = workItem.attempts > 0 && workItem.status === "queued"
        ? {
            previousWorkItemId: workItem.id,
            previousAttempts: workItem.attempts,
            reason: workItem.lastReason,
          }
        : undefined;
      const refreshedInvocation = store.refreshWorkflowInvocationForWorkItem(workItem.id, plan.invocationInput);
      if (throttle && !throttle.allowed) return { kind: "throttled" as const, invocation: refreshedInvocation, workItem, throttle };
      const workflow = routeWorkflowForStorage(store, workflowBody);
      const loop = store.createLoop({
        ...loopInput,
        target: {
          type: "workflow",
          workflowId: workflow.id,
          input: {
            workflowInvocationId: refreshedInvocation.id,
            workflowWorkItemId: workItem.id,
          },
        },
      });
      const admitted = store.admitWorkflowWorkItem(workItem.id, { workflowId: workflow.id, loopId: loop.id, reason: plan.admitReason });
      return {
        kind: "created" as const,
        invocation: refreshedInvocation,
        workItem: admitted,
        workflow,
        loop,
        throttle,
        requeue: requeue
          ? { ...requeue, attempt: admitted.attempts, newWorkflowId: workflow.id, newLoopId: loop.id }
          : undefined,
      };
    });
    if (outcome.kind === "deduped") return dedupedRoutePrint(plan, outcome);
    if (outcome.kind === "throttled") {
      return {
        kind: "throttled",
        value: {
          skipped: true,
          queuedAtSource: true,
          reason: outcome.throttle.reason,
          idempotencyKey,
          event,
          ...plan.valueExtras,
          invocation: publicWorkflowInvocation(outcome.invocation),
          workItem: publicWorkflowWorkItem(outcome.workItem),
          throttle: outcome.throttle,
          workflow: workflowBody,
          loop: loopInput,
        },
        human: `skipped ${plan.humanSubject}: ${outcome.throttle.reason}`,
      };
    }
    return {
      kind: "created",
      value: {
        deduped: false,
        idempotencyKey,
        event,
        ...plan.valueExtras,
        invocation: publicWorkflowInvocation(outcome.invocation),
        workItem: publicWorkflowWorkItem(outcome.workItem),
        workflow: publicWorkflow(outcome.workflow),
        loop: publicLoop(outcome.loop),
        requeue: outcome.requeue,
        throttle: outcome.throttle,
        sandboxPreflight,
        preflight,
      },
      human: `created ${outcome.loop.id} (${outcome.loop.name}) workflow=${outcome.workflow.name} event=${event.id} idempotency=${idempotencyKey}`,
    };
  } finally {
    store.close();
  }
}

export function routeTodosTaskEvent(event: EventEnvelope, opts: TodosTaskRouteOptions): TodosTaskRoutePrint {
  const data = eventData(event);
  const metadata = eventMetadata(event);
  const taskId = taskEventField(data, ["id", "task_id", "taskId"]);
  if (!taskId) throw new ValidationError("todos task event is missing task id in data.id, data.task_id, data.task.id, or data.payload.id");
  const eligibility = taskRouteEligibility(data, metadata);
  if (!eligibility.eligible) {
    return {
      kind: "skipped",
      value: { skipped: true, reason: eligibility.reason, event, taskId, eligibility },
      human: `skipped task ${taskId}: ${eligibility.reason}`,
    };
  }
  const taskTitle = taskEventField(data, ["title", "task_title", "taskTitle"]);
  const taskDescription = taskEventField(data, ["description", "body"]);
  const dataProjectPath = taskEventField(data, ["working_dir", "workingDir", "project_path", "projectPath", "cwd"]);
  const metadataProjectPath = taskEventField(metadata, [
    "working_dir",
    "workingDir",
    "project_path",
    "projectPath",
    "project_canonical_path",
    "cwd",
  ]);
  const projectPath =
    dataProjectPath ??
    metadataProjectPath ??
    opts.projectPath ??
    process.cwd();
  const routeProjectPath = normalizeRoutePath(projectPath) ?? resolve(projectPath);
  const projectGroup = routeProjectGroup(opts.projectGroup, data, metadata);
  const throttleLimits = routeThrottleLimitsFromOpts(opts);
  const idempotencySubject = prIdempotencySubject(data, metadata, taskId);
  const idempotencyKey = `todos-task:${idempotencySubject}`;
  const legacyTaskIdempotencyKey = `todos-task:${taskId}`;
  const dedupeAliases = legacyTaskIdempotencyKey === idempotencyKey ? [] : [legacyTaskIdempotencyKey];
  const idempotencySuffix = stableSuffix(idempotencyKey);
  const namePrefix = opts.namePrefix ?? "event:todos-task";
  const workflowName = `${namePrefix}:${taskId.slice(0, 8)}:${idempotencySuffix}:workflow`;
  const loopName = `${namePrefix}:${taskId.slice(0, 8)}:${idempotencySuffix}:run`;
  if (!opts.dryRun) {
    // Dedupe before worktree validation and provider checks so replayed task
    // events never fail on since-broken project paths or provider options.
    const store = new Store();
    try {
      const existingItem = findRouteWorkItemByKeys(store, "todos-task", [idempotencyKey, ...dedupeAliases]);
      if (existingItem) {
        const existingLoop = existingItem.loopId ? store.getLoop(existingItem.loopId) : undefined;
        const existingWorkflow = existingItem.workflowId ? store.getWorkflow(existingItem.workflowId) : undefined;
        const existingInvocation = store.getWorkflowInvocation(existingItem.invocationId);
        return dedupedRoutePrint(
          { event, idempotencyKey, dedupeValueExtras: {} },
          { existingItem, existingLoop, existingWorkflow, invocation: existingInvocation },
        );
      }
    } finally {
      store.close();
    }
  }
  validateRequiredRouteWorktreeProjectPath(opts, projectPath);
  const prReviewRouting = prReviewRoutingDecision(data, metadata, opts);
  if (prReviewRouting.required && !prReviewRouting.allowed) {
    return {
      kind: "skipped",
      value: {
        skipped: true,
        reason: prReviewRouting.reason,
        event,
        taskId,
        routeError: true,
        prReviewRouting,
      },
      human: `skipped task ${taskId}: ${prReviewRouting.reason}`,
    };
  }
  const providerRouting = resolveProviderRouting(data, metadata, opts);
  const provider = providerRouting.provider;
  const permissionMode = permissionModeFromOpts({ permissionMode: opts.permissionMode ?? "bypass" }, provider);
  const sandbox = sandboxFromOpts({ sandbox: opts.sandbox }, provider);
  const authProfile = providerAuthProfileFromOpts({ authProfile: providerRouting.authProfile }, provider);
  const templateId = todosTaskRouteTemplateId(opts);
  const workflowInput = {
    taskId,
    taskTitle,
    taskDescription,
    projectPath,
    routeProjectPath,
    projectGroup,
    provider,
    authProfile,
    authProfilePool: providerRouting.authProfilePool,
    triageAuthProfile: opts.triageAuthProfile,
    plannerAuthProfile: opts.plannerAuthProfile,
    workerAuthProfile: opts.workerAuthProfile,
    verifierAuthProfile: opts.verifierAuthProfile,
    account: providerRouting.account,
    accountPool: providerRouting.accountPool,
    triageAccount: roleAccountFromOpts(opts, opts.triageAccount),
    plannerAccount: roleAccountFromOpts(opts, opts.plannerAccount),
    workerAccount: roleAccountFromOpts(opts, opts.workerAccount),
    verifierAccount: roleAccountFromOpts(opts, opts.verifierAccount),
    model: opts.model,
    variant: opts.variant,
    agent: opts.agent,
    addDirs: listFromRepeatedOpts(opts.addDir),
    timeoutMs: timeoutDuration(opts.timeout, "--timeout"),
    verifierIdleTimeoutMs: idleTimeoutDuration(opts.verifierIdleTimeout, "--verifier-idle-timeout"),
    permissionMode,
    sandbox,
    manualBreakGlass: Boolean(opts.manualBreakGlass),
    worktreeMode: (opts.worktreeMode ?? "auto") as AgentWorktreeMode,
    worktreeRoot: opts.worktreeRoot,
    worktreeBranchPrefix: opts.worktreeBranchPrefix ?? "openloops",
    prHandoff: templateId === TASK_LIFECYCLE_TEMPLATE_ID ? Boolean(opts.prHandoff) : false,
    eventId: event.id,
    eventType: event.type,
    todosProjectPath: opts.todosProject,
  };
  const workflowContext = {
    name: workflowName,
    type: "todos-task-event-workflow",
    event: event.id,
  };
  let workflowBody = templateId === TASK_LIFECYCLE_TEMPLATE_ID
    ? renderTaskLifecycleWorkflow(workflowInput)
    : renderTodosTaskWorkerVerifierWorkflow(workflowInput);
  workflowBody.name = workflowName;
  workflowBody.description =
    `Task-triggered ${templateId} workflow for ${taskTitle ?? taskId} from ${event.source}/${event.type}; ` +
    `idempotency=${idempotencyKey}; event=${event.id}; project=${projectPath}; projectGroup=${projectGroup ?? "-"}`;
  workflowBody = normalizeWorkflowForStorage(workflowBody, workflowContext);
  const hasExplicitRoleAccount =
    Boolean(opts.triageAuthProfile || opts.plannerAuthProfile || opts.workerAuthProfile || opts.verifierAuthProfile) ||
    Boolean(opts.triageAccount || opts.plannerAccount || opts.workerAccount || opts.verifierAccount);
  const invocationInput: CreateWorkflowInvocationInput = {
    templateId,
    sourceRef: {
      kind: "event",
      id: event.id,
      dedupeKey: idempotencyKey,
      raw: { type: event.type, source: event.source, subject: event.subject },
    },
    subjectRef: {
      kind: "task",
      id: taskId,
      path: routeProjectPath,
      raw: { title: taskTitle, description: taskDescription },
    },
    intent: "route" as const,
    scope: {
      projectPath: routeProjectPath,
      projectGroup,
      worktreePolicy: (opts.worktreeMode ?? "auto") as AgentWorktreeMode,
      permissions: permissionMode,
      manualBreakGlass: Boolean(opts.manualBreakGlass),
      prHandoff: templateId === TASK_LIFECYCLE_TEMPLATE_ID ? Boolean(opts.prHandoff) : false,
      accountPolicy: providerRouting.authProfilePool?.length || providerRouting.accountPool?.length ? "pool" : hasExplicitRoleAccount ? "role-explicit" : "single",
      providerRouting: providerRoutingPublic(providerRouting),
      prReviewRouting: prReviewRouting.required ? prReviewRouting : undefined,
      concurrencyGroup: projectGroup ?? routeProjectPath,
    },
    outputPolicy: {
      report: "always" as const,
      createTask: "on_failure" as const,
    },
  };
  return routeEvent({
    routeKey: "todos-task",
    event,
    opts,
    idempotencyKey,
    dedupeAliases,
    workflowBody,
    workflowContext,
    invocationInput,
    routeProjectPath,
    projectGroup,
    subjectRef: taskId,
    loopName,
    loopDescription: `Run ${workflowBody.name} once for task ${taskId}; idempotency=${idempotencyKey}; event=${event.id}`,
    throttleLimits,
    admitReason: "admitted by todos-task route",
    humanSubject: `task ${taskId}`,
    valueExtras: {
      providerRouting: providerRoutingPublic(providerRouting),
      prReviewRouting: prReviewRouting.required ? prReviewRouting : undefined,
    },
    dedupeValueExtras: {},
  });
}

export function routeGenericEvent(event: EventEnvelope, opts: TodosTaskRouteOptions): TodosTaskRoutePrint {
  const data = eventData(event);
  const metadata = eventMetadata(event);
  const projectPath =
    opts.projectPath ??
    taskEventField(data, ["working_dir", "workingDir", "project_path", "projectPath", "cwd", "repo_path", "repoPath"]) ??
    taskEventField(metadata, ["working_dir", "workingDir", "project_path", "projectPath", "project_canonical_path", "cwd", "repo_path", "repoPath"]) ??
    process.cwd();
  const routeProjectPath = normalizeRoutePath(projectPath) ?? resolve(projectPath);
  const projectGroup = routeProjectGroup(opts.projectGroup, data, metadata);
  const throttleLimits = routeThrottleLimitsFromOpts(opts);
  const eventSuffix = event.id.slice(0, 8);
  const source = slugSegment(event.source, "source");
  const type = slugSegment(event.type, "type");
  const workflowName = `${opts.namePrefix ?? "event:generic"}:${source}:${type}:${eventSuffix}:workflow`;
  const loopName = `${opts.namePrefix ?? "event:generic"}:${source}:${type}:${eventSuffix}:run`;
  const idempotencyKey = `generic-event:${event.source}:${event.type}:${event.id}`;
  const providerRouting = resolveProviderRouting(data, metadata, opts);
  const provider = providerRouting.provider;
  const permissionMode = permissionModeFromOpts({ permissionMode: opts.permissionMode ?? "bypass" }, provider);
  const sandbox = sandboxFromOpts({ sandbox: opts.sandbox }, provider);
  const authProfile = providerAuthProfileFromOpts({ authProfile: providerRouting.authProfile }, provider);
  const workflowContext = {
    name: workflowName,
    type: "generic-event-workflow",
    event: event.id,
  };
  let workflowBody = renderEventWorkerVerifierWorkflow({
    eventId: event.id,
    eventType: event.type,
    eventSource: event.source,
    eventSubject: stringField(event.subject),
    eventMessage: stringField(event.message),
    eventJson: JSON.stringify(event),
    projectPath,
    routeProjectPath,
    projectGroup,
    provider,
    authProfile,
    authProfilePool: providerRouting.authProfilePool,
    workerAuthProfile: opts.workerAuthProfile,
    verifierAuthProfile: opts.verifierAuthProfile,
    account: providerRouting.account,
    accountPool: providerRouting.accountPool,
    workerAccount: roleAccountFromOpts(opts, opts.workerAccount),
    verifierAccount: roleAccountFromOpts(opts, opts.verifierAccount),
    model: opts.model,
    variant: opts.variant,
    agent: opts.agent,
    addDirs: listFromRepeatedOpts(opts.addDir),
    timeoutMs: timeoutDuration(opts.timeout, "--timeout"),
    verifierIdleTimeoutMs: idleTimeoutDuration(opts.verifierIdleTimeout, "--verifier-idle-timeout"),
    permissionMode,
    sandbox,
    manualBreakGlass: Boolean(opts.manualBreakGlass),
    worktreeMode: (opts.worktreeMode ?? "auto") as AgentWorktreeMode,
    worktreeRoot: opts.worktreeRoot,
    worktreeBranchPrefix: opts.worktreeBranchPrefix ?? "openloops",
  });
  workflowBody.name = workflowName;
  workflowBody.description = `Event-triggered worker/verifier workflow for ${event.source}/${event.type}; project=${projectPath}; projectGroup=${projectGroup ?? "-"}`;
  workflowBody = normalizeWorkflowForStorage(workflowBody, workflowContext);
  const hasExplicitRoleAccount = Boolean(opts.workerAuthProfile || opts.verifierAuthProfile || opts.workerAccount || opts.verifierAccount);
  const invocationInput: CreateWorkflowInvocationInput = {
    templateId: "event-worker-verifier",
    sourceRef: {
      kind: "event",
      id: event.id,
      dedupeKey: idempotencyKey,
      raw: { source: event.source, type: event.type },
    },
    subjectRef: {
      kind: "event",
      id: stringField(event.subject) ?? event.id,
      path: routeProjectPath,
      raw: { message: stringField(event.message) },
    },
    intent: "route" as const,
    scope: {
      projectPath: routeProjectPath,
      projectGroup,
      worktreePolicy: (opts.worktreeMode ?? "auto") as AgentWorktreeMode,
      permissions: permissionMode,
      manualBreakGlass: Boolean(opts.manualBreakGlass),
      accountPolicy: providerRouting.authProfilePool?.length || providerRouting.accountPool?.length ? "pool" : hasExplicitRoleAccount ? "role-explicit" : "single",
      providerRouting: providerRoutingPublic(providerRouting),
      concurrencyGroup: projectGroup ?? routeProjectPath,
    },
    outputPolicy: {
      report: "always" as const,
      createTask: "on_failure" as const,
    },
  };
  const providerRoutingValue = providerRoutingPublic(providerRouting);
  return routeEvent({
    routeKey: "generic-event",
    event,
    opts,
    idempotencyKey,
    workflowBody,
    workflowContext,
    invocationInput,
    routeProjectPath,
    projectGroup,
    subjectRef: stringField(event.subject) ?? event.id,
    loopName,
    loopDescription: `Run ${workflowBody.name} once for event ${event.id}; idempotency=${idempotencyKey}`,
    throttleLimits,
    admitReason: "admitted by generic-event route",
    humanSubject: `event ${event.id}`,
    valueExtras: { providerRouting: providerRoutingValue },
    dedupeValueExtras: { providerRouting: providerRoutingValue },
  });
}

export function routeEventByKind(kind: string, event: EventEnvelope, opts: TodosTaskRouteOptions): TodosTaskRoutePrint {
  if (kind === "todos-task") return routeTodosTaskEvent(event, opts);
  if (kind === "generic") return routeGenericEvent(event, opts);
  throw new ValidationError("route kind must be todos-task or generic");
}
