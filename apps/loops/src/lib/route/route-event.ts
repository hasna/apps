import { readFileSync } from "node:fs";
import { hostname } from "node:os";
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
import { listOpenMachines } from "../machines.js";
import {
  renderEventWorkerVerifierWorkflow,
  renderTaskLifecycleWorkflow,
  renderTodosTaskWorkerVerifierWorkflow,
  TASK_LIFECYCLE_TEMPLATE_ID,
  TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
} from "../templates.js";
import type { AgentWorkflowRole } from "../template-kit.js";
import { eventData, eventMetadata, slugSegment, stableSuffix, stringField, taskEventField, taskEventRecords, taskEventTags, taskRouteEligibility } from "./fields.js";
import { routePolicyEvidenceFromOptions } from "./policies.js";
import { normalizeWorkflowForStorage, preflightStoredWorkflow, workflowSpecForPreflight } from "./gates.js";
import { idleTimeoutDuration, listFromRepeatedOpts, nonNegativeInteger, timeoutDuration } from "./parse.js";
import { assignPoolAuthProfiles, type PoolAuthProfileAssignment } from "./profile-pool.js";
import { prFingerprintFromTask, prReviewRoutingDecision } from "./pr-review.js";
import {
  permissionModeFromOpts,
  providerAuthProfileFromOpts,
  providerRoutingPublic,
  resolveProviderRouting,
  roleAccountFromOpts,
  sandboxFromOpts,
} from "./provider.js";
import {
  checkProviderAdmission,
  providerAdmissionDryRunPreview,
  providerAdmissionPlanFromOpts,
  providerAdmissionPlanWithAuthProfiles,
  type ProviderAdmissionPlan,
} from "./provider-admission.js";
import {
  hasThrottleLimits,
  normalizeRoutePath,
  routeProjectGroup,
  routeThrottleDecision,
  routeThrottleDryRunPreview,
  routeThrottleLimitsFromInputs,
  validateRequiredRouteWorktreeProjectPath,
  type RouteThrottleDecision,
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

/**
 * Terminal statuses a todos-task work item may be re-admitted from when its task
 * is still actionable. Mirrors `Store.requeueWorkflowWorkItem`'s requeueable set:
 * a run that finished (`succeeded`/`failed`/`dead_letter`) or was `cancelled`
 * while its todos task is still pending + route-opted-in was left permanently
 * uncleared, which is the wedge. Re-admission is bounded (cap + backoff below) so
 * this cannot fight an operator forever — the durable way to stop routing a task
 * is to untag it, which the drain does automatically for non-routable tasks.
 */
const REACTIVATABLE_TERMINAL_STATUSES = new Set<WorkflowWorkItemStatus>([
  "succeeded",
  "failed",
  "dead_letter",
  "cancelled",
]);

/** Max times a todos-task work item is re-admitted after finishing without closing its task before it stays terminal. */
const MAX_TODOS_TASK_ROUTE_REDISPATCHES = 8;

/** Exponential backoff (2m base, 30m cap) before re-admitting a stale terminal todos-task work item so an un-completable task cannot spin a worker every tick. */
function todosTaskRouteRedispatchBackoffMs(attempts: number): number {
  const base = 2 * 60_000;
  const cap = 30 * 60_000;
  const exp = Math.max(0, Math.min(attempts - 1, 10));
  return Math.min(cap, base * 2 ** exp);
}

/**
 * Decision returned by {@link reactivateStaleTodosTaskWorkItem}:
 * - `readmit`  → the terminal item was requeued; dispatch a fresh run.
 * - `dead-letter` → the redispatch cap was reached; the item was transitioned
 *   to `dead_letter` (visible + counted) and the route dedupes this tick.
 * - `dedupe`   → keep deduping (in-flight, inside backoff, or already
 *   dead-lettered) without re-dispatching or re-escalating.
 */
type StaleTodosTaskReactivation =
  | { kind: "readmit"; item: WorkflowWorkItem }
  | { kind: "dead-letter"; item: WorkflowWorkItem }
  | { kind: "dedupe" };

/**
 * The todos-task drain only ever presents tasks that are still actionable
 * (pending + route opt-in). So when a *terminal* work item's task keeps
 * reappearing, the prior run finished (workflow `succeeded`/`failed`/`dead_letter`)
 * without actually closing the todos task. Deduping it away forever is the wedge
 * that reports `considered=N created=0` and dispatches zero real workers.
 * Re-admit it instead — bounded by a redispatch cap and a per-attempt backoff so
 * a task that can never complete does not spin a worker on every drain tick.
 * In-flight items (`admitted`/`running`) and items still inside their backoff
 * window keep deduping.
 *
 * When the cap is hit we do NOT silently keep deduping forever (the "black
 * hole": `considered=N created=0` with no signal). Instead the item is
 * dead-lettered once — a visible terminal state the drain report counts — so an
 * operator sees it and can `loops routes requeue` (which resets attempts) to
 * retry. Non-productive finishes (gate deaths / tempfails) never reach the cap
 * because {@link Store.finalizeWorkflowRun} refunds their attempt.
 */
function reactivateStaleTodosTaskWorkItem(
  store: Store,
  routeKey: string,
  item: WorkflowWorkItem,
  now: number = Date.now(),
): StaleTodosTaskReactivation {
  if (routeKey !== "todos-task") return { kind: "dedupe" };
  if (!REACTIVATABLE_TERMINAL_STATUSES.has(item.status)) return { kind: "dedupe" };
  if (item.attempts >= MAX_TODOS_TASK_ROUTE_REDISPATCHES) {
    if (item.status === "dead_letter") return { kind: "dedupe" };
    const deadLettered = store.deadLetterWorkflowWorkItem(item.id, {
      reason:
        `redispatch cap reached (${item.attempts}/${MAX_TODOS_TASK_ROUTE_REDISPATCHES}): todos task still actionable but ` +
        `${item.attempts} runs finished without closing it; dead-lettered. Fix the task or 'loops routes requeue' to retry (resets attempts).`,
    });
    return { kind: "dead-letter", item: deadLettered };
  }
  const finishedAt = Date.parse(item.updatedAt);
  if (Number.isFinite(finishedAt) && now - finishedAt < todosTaskRouteRedispatchBackoffMs(item.attempts)) {
    return { kind: "dedupe" };
  }
  const requeued = store.requeueWorkflowWorkItem(item.id, {
    reason: `re-admitted from ${item.status}: todos task still actionable after prior run (attempt ${item.attempts + 1}/${MAX_TODOS_TASK_ROUTE_REDISPATCHES})`,
  });
  return { kind: "readmit", item: requeued };
}

function findRouteWorkItemByKeys(store: Store, routeKey: "todos-task" | "generic-event", idempotencyKeys: string[]): WorkflowWorkItem | undefined {
  const [primaryKey, ...aliasKeys] = idempotencyKeys;
  if (primaryKey) {
    const existingItem = store.findWorkflowWorkItem(routeKey, primaryKey);
    if (existingItem && isUnclearedRouteWorkItem(existingItem)) return existingItem;
  }
  for (const key of aliasKeys) {
    const existingItem = store.findWorkflowWorkItem(routeKey, key);
    if (existingItem && (isUnclearedRouteWorkItem(existingItem) || existingItem.status === "queued" || existingItem.status === "deferred")) return existingItem;
  }
  return undefined;
}

function isPrBacklogTask(data: Record<string, unknown>, metadata: Record<string, unknown>): boolean {
  const explicitFingerprint = taskEventField(data, [
    "pr_fingerprint",
    "prFingerprint",
    "github_pr",
    "githubPr",
    "github_pr_fingerprint",
    "githubPrFingerprint",
    "pull_request_fingerprint",
    "pullRequestFingerprint",
  ]);
  if (explicitFingerprint) return true;
  const tags = new Set(taskEventTags(taskEventRecords(data, metadata)).map((tag) => tag.toLowerCase()));
  return tags.has("github-pr") && tags.has("pr-merge-queue");
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
  /** Route/drain identity that scopes the --max-active global count (loop name,
   *  explicit --max-active-scope, or the route key). */
  routeScope?: string;
  /** codewith auth-profile pool context for least-loaded selection + the
   *  --max-per-profile guard, resolved once the store is live. */
  poolRouting?: PoolRoutingPlan;
  providerAdmission?: ProviderAdmissionPlan;
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

interface PoolRoutingPlan {
  /** Ordered pool of codewith auth profiles. */
  pool: string[];
  /** Deterministic tie-break seed (matches the template's render seed). */
  seed: string;
  /** Defer when every pool member has >= this many running steps; undefined disables. */
  maxPerProfile?: number;
  /** Codewith agent step id -> lifecycle role, for the steps to reassign. */
  rolesByStepId: Record<string, AgentWorkflowRole>;
}

/**
 * The identity that scopes the `--max-active` global admission count. Each loop
 * (router/drain) that the daemon runs exports `LOOPS_LOOP_NAME`, so distinct
 * routers get distinct scopes with zero config change; an explicit
 * `--max-active-scope` overrides, and a bare/manual invocation falls back to the
 * route key. Undefined only when nothing identifies the route (keeps the old
 * store-wide count).
 */
function resolveRouteScope(opts: TodosTaskRouteOptions, routeKey: string): string | undefined {
  return opts.maxActiveScope?.trim() || process.env.LOOPS_LOOP_NAME?.trim() || routeKey || undefined;
}

function currentRouteMachineId(): string {
  const explicit = stringField(process.env.LOOPS_MACHINE_ID) ??
    stringField(process.env.HASNA_MACHINE_ID) ??
    stringField(process.env.MACHINE_ID);
  if (explicit) return explicit;
  try {
    const local = listOpenMachines().find((machine) => machine.local)?.id;
    if (local) return local;
  } catch {
    // OpenMachines is optional in local development; hostname still gives
    // deterministic reservation evidence without making routing depend on it.
  }
  return hostname();
}

/**
 * Build the least-loaded pool context for a rendered workflow. Active only for
 * codewith with a pool of 2+ and NO per-role auth-profile pins (explicit pins
 * are honoured verbatim — the deterministic render already baked them). The
 * max-per-profile guard defaults to 2 (the provider-safe ceiling from the
 * 429-cluster lesson) and can be overridden or disabled with `--max-per-profile 0`.
 */
function buildPoolRoutingPlan(
  opts: TodosTaskRouteOptions,
  provider: AgentProvider,
  authProfilePool: string[] | undefined,
  workflowBody: CreateWorkflowInput,
  seed: string,
): PoolRoutingPlan | undefined {
  if (provider !== "codewith") return undefined;
  const pool = (authProfilePool ?? []).filter((entry) => entry.trim().length > 0);
  if (pool.length < 2) return undefined;
  const pinned = Boolean(
    opts.triageAuthProfile || opts.plannerAuthProfile || opts.workerAuthProfile || opts.verifierAuthProfile,
  );
  if (pinned) return undefined;
  const rolesByStepId: Record<string, AgentWorkflowRole> = {};
  for (const step of workflowBody.steps) {
    const target = step.target;
    if (target.type !== "agent" || target.provider !== "codewith") continue;
    const role = target.routing?.role;
    if (role) rolesByStepId[step.id] = role;
  }
  if (Object.keys(rolesByStepId).length === 0) return undefined;
  const explicitMax = nonNegativeInteger(opts.maxPerProfile, "--max-per-profile");
  const maxPerProfile = explicitMax ?? 2;
  return { pool, seed, maxPerProfile: maxPerProfile > 0 ? maxPerProfile : undefined, rolesByStepId };
}

function nonEmptyStrings(values: Array<string | undefined>): string[] | undefined {
  const entries = values.map((entry) => entry?.trim()).filter((entry): entry is string => Boolean(entry));
  return entries.length ? entries : undefined;
}

function codewithAuthProfilesFromWorkflow(workflow: CreateWorkflowInput): Array<string | undefined> | undefined {
  const profiles: Array<string | undefined> = [];
  for (const step of workflow.steps) {
    const target = step.target;
    if (target.type !== "agent" || target.provider !== "codewith") continue;
    profiles.push(target.authProfile);
  }
  return profiles.length ? profiles : undefined;
}

function dedupedRoutePrint(
  plan: Pick<RouteEventPlan, "event" | "idempotencyKey" | "dedupeValueExtras">,
  outcome: { existingItem: WorkflowWorkItem; existingLoop?: ReturnType<Store["getLoop"]>; existingWorkflow?: WorkflowSpec; invocation?: Parameters<typeof publicWorkflowInvocation>[0] },
): TodosTaskRoutePrint {
  // A dedupe against a dead_letter item is the redispatch-cap black hole made
  // visible: surface it explicitly so drain reports can count it and stop the
  // "created=0, no signal" silence. (Terminal-but-under-cap items still just
  // dedupe until their backoff elapses and they re-admit.)
  const deadLettered = outcome.existingItem.status === "dead_letter";
  return {
    kind: "deduped",
    value: {
      deduped: true,
      idempotencyKey: plan.idempotencyKey,
      dedupedBy: "work-item",
      ...(deadLettered ? { deadLettered: true, reason: outcome.existingItem.lastReason } : {}),
      event: plan.event,
      ...plan.dedupeValueExtras,
      invocation: outcome.invocation ? publicWorkflowInvocation(outcome.invocation) : undefined,
      workItem: publicWorkflowWorkItem(outcome.existingItem),
      workflow: outcome.existingWorkflow ? publicWorkflow(outcome.existingWorkflow) : undefined,
      loop: outcome.existingLoop ? publicLoop(outcome.existingLoop) : undefined,
    },
    human: deadLettered
      ? `dead-lettered work item ${outcome.existingItem.id} (redispatch cap reached) for event=${plan.event.id} idempotency=${plan.idempotencyKey}`
      : `deduped existing work item ${outcome.existingItem.id} for event=${plan.event.id} idempotency=${plan.idempotencyKey}`,
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
    machineId: currentRouteMachineId(),
    routeScope: plan.routeScope,
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
      ? routeThrottleDryRunPreview({
          projectPath: plan.routeProjectPath,
          projectGroup: plan.projectGroup,
          limits: plan.throttleLimits,
        })
      : undefined;
    const providerAdmission = providerAdmissionDryRunPreview(
      providerAdmissionPlanWithAuthProfiles(plan.providerAdmission, codewithAuthProfilesFromWorkflow(workflowBody) ?? []),
    );
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
        providerAdmission,
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
    let poolAssignment: PoolAuthProfileAssignment | undefined;
    if (plan.poolRouting) {
      const loadCounts = store.countRunningWorkflowStepsByAuthProfile();
      poolAssignment = assignPoolAuthProfiles({
        pool: plan.poolRouting.pool,
        seed: plan.poolRouting.seed,
        loadCounts,
        maxPerProfile: plan.poolRouting.maxPerProfile,
        roles: Object.values(plan.poolRouting.rolesByStepId),
      });
    }
    if (poolAssignment && !poolAssignment.deferred) {
      for (const step of workflowBody.steps) {
        const role = plan.poolRouting?.rolesByStepId[step.id];
        const chosen = role ? poolAssignment.profiles[role] : undefined;
        if (chosen && step.target.type === "agent") step.target.authProfile = chosen;
      }
    }
    const workflowProfiles = codewithAuthProfilesFromWorkflow(workflowBody);
    const providerAdmissionPlan = workflowProfiles
      ? providerAdmissionPlanWithAuthProfiles(plan.providerAdmission, workflowProfiles)
      : plan.providerAdmission;
    const providerAdmission = poolAssignment?.deferred ? undefined : checkProviderAdmission(providerAdmissionPlan);
    const outcome = store.writeTransaction(() => {
      const invocation = store.createWorkflowInvocation(plan.invocationInput);
      const existingItem = findRouteWorkItemByKeys(store, plan.routeKey, dedupeKeys);
      if (existingItem) {
        // A terminal work item whose todos task is still actionable is re-admitted
        // (bounded) rather than deduped forever; the requeue drops it back to
        // `queued` so the upsert/admit path below re-dispatches a fresh run. At
        // the cap it is dead-lettered (visible) instead of silently deduped.
        const reactivation = reactivateStaleTodosTaskWorkItem(store, plan.routeKey, existingItem);
        if (reactivation.kind !== "readmit") {
          const dedupeItem = reactivation.kind === "dead-letter" ? reactivation.item : existingItem;
          const existingLoop = dedupeItem.loopId ? store.getLoop(dedupeItem.loopId) : undefined;
          const existingWorkflow = dedupeItem.workflowId ? store.getWorkflow(dedupeItem.workflowId) : undefined;
          return { kind: "deduped" as const, existingItem: dedupeItem, existingLoop, existingWorkflow, invocation };
        }
      }
      const throttle = hasThrottleLimits(plan.throttleLimits)
          ? routeThrottleDecision(store, {
            projectPath: plan.routeProjectPath,
            projectGroup: plan.projectGroup,
            routeScope: plan.routeScope,
            limits: plan.throttleLimits,
          })
        : undefined;
      const activeThrottled = Boolean(throttle && !throttle.allowed);
      const poolDeferred = Boolean(poolAssignment?.deferred);
      const providerDeferred = Boolean(providerAdmission && !providerAdmission.allowed);
      const deferred = activeThrottled || poolDeferred || providerDeferred;
      const deferReason = activeThrottled ? throttle!.reason : poolDeferred ? poolAssignment?.reason : providerAdmission?.reason;
      const effectiveThrottle: RouteThrottleDecision | undefined = activeThrottled
        ? throttle
        : poolDeferred
          ? {
              allowed: false,
              reason: deferReason,
              projectPath: plan.routeProjectPath,
              ...(plan.projectGroup ? { projectGroup: plan.projectGroup } : {}),
              limits: plan.throttleLimits,
              counts: throttle?.counts ?? { global: 0, project: 0 },
            }
          : throttle;
      const workItem = store.upsertWorkflowWorkItem({
        ...workItemInput,
        invocationId: invocation.id,
        status: deferred ? "deferred" : "queued",
        lastReason: deferred ? deferReason : undefined,
      });
      const requeue = workItem.attempts > 0 && workItem.status === "queued"
        ? {
            previousWorkItemId: workItem.id,
            previousAttempts: workItem.attempts,
            reason: workItem.lastReason,
          }
        : undefined;
      const refreshedInvocation = store.refreshWorkflowInvocationForWorkItem(workItem.id, plan.invocationInput);
      if (deferred) {
        return {
          kind: "throttled" as const,
          invocation: refreshedInvocation,
          workItem,
          reason: deferReason,
          throttle: effectiveThrottle,
        };
      }
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
          reason: outcome.reason,
          idempotencyKey,
          event,
          ...plan.valueExtras,
          invocation: publicWorkflowInvocation(outcome.invocation),
          workItem: publicWorkflowWorkItem(outcome.workItem),
          throttle: outcome.throttle,
          workflow: workflowBody,
          loop: loopInput,
          providerAdmission,
          fatal: providerAdmission?.fatal === true ? true : undefined,
        },
        human: `skipped ${plan.humanSubject}: ${outcome.reason}`,
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
        providerAdmission,
        // Per-role codewith account attribution: which subscription account each
        // pooled step was spread to (least-loaded selection). Surfaced so drain
        // reports show account_profile populated and the spread is auditable.
        ...(poolAssignment && !poolAssignment.deferred && Object.keys(poolAssignment.profiles).length
          ? { accountProfiles: poolAssignment.profiles, routeScope: plan.routeScope }
          : {}),
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
  const sourceTodosProjectPath = opts.sourceTodosProjectPath?.trim();
  const explicitProjectPath = opts.projectPath?.trim();
  const dataProjectPath = taskEventField(data, [
    "route_project_path",
    "routeProjectPath",
    "project_path",
    "projectPath",
    "working_dir",
    "workingDir",
    "cwd",
  ]);
  const metadataProjectPath = taskEventField(metadata, [
    "working_dir",
    "workingDir",
    "project_path",
    "projectPath",
    "project_canonical_path",
    "cwd",
  ]);
  const projectPath =
    explicitProjectPath ??
    dataProjectPath ??
    metadataProjectPath ??
    process.cwd();
  const routeProjectPath = normalizeRoutePath(projectPath) ?? resolve(projectPath);
  const projectGroup = routeProjectGroup(opts.projectGroup, data, metadata);
  const throttleLimits = routeThrottleLimitsFromInputs(opts, data, metadata);
  const routeScope = resolveRouteScope(opts, "todos-task");
  const sourceProjectIdempotencyPrefix = sourceTodosProjectPath
    ? normalizeRoutePath(sourceTodosProjectPath) ?? resolve(sourceTodosProjectPath)
    : undefined;
  // PR-subject tasks dedupe by GitHub owner/repo#number so the duplicate tasks
  // the repos registry mints (one per local checkout of the same repo) collapse
  // to a single work item instead of spawning a worker per checkout. Non-PR
  // tasks keep the (source-path, task-id) key so unrelated tasks never collide.
  const prFingerprint = isPrBacklogTask(data, metadata) ? prFingerprintFromTask(data, metadata) : undefined;
  const idempotencyKey = prFingerprint
    ? `todos-task:pr:${prFingerprint}`
    : sourceProjectIdempotencyPrefix
      ? `todos-task:${sourceProjectIdempotencyPrefix}:${taskId}`
      : `todos-task:${taskId}`;
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
        // Re-admit a terminal work item whose task is still actionable instead of
        // deduping it away forever; requeue drops it to `queued` so the full
        // creation path below dispatches a fresh run. At the cap it is
        // dead-lettered (visible) rather than silently deduped forever.
        const reactivation = reactivateStaleTodosTaskWorkItem(store, "todos-task", existingItem);
        if (reactivation.kind !== "readmit") {
          const dedupeItem = reactivation.kind === "dead-letter" ? reactivation.item : existingItem;
          const existingLoop = dedupeItem.loopId ? store.getLoop(dedupeItem.loopId) : undefined;
          const existingWorkflow = dedupeItem.workflowId ? store.getWorkflow(dedupeItem.workflowId) : undefined;
          const existingInvocation = store.getWorkflowInvocation(dedupeItem.invocationId);
          return dedupedRoutePrint(
            { event, idempotencyKey, dedupeValueExtras: {} },
            { existingItem: dedupeItem, existingLoop, existingWorkflow, invocation: existingInvocation },
          );
        }
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
        // Explicit marker: the drain closes the source todos task on a definitive
        // MERGED/CLOSED freshness skip so it stops re-skipping every tick.
        ...(prReviewRouting.freshnessSkip
          ? { freshnessSkip: true, prState: prReviewRouting.prState }
          : {}),
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
    routeScope,
    routeThrottleLimits: throttleLimits,
    prHandoff: templateId === TASK_LIFECYCLE_TEMPLATE_ID ? Boolean(opts.prHandoff) : false,
    prReviewRouting: prReviewRouting.required ? prReviewRouting : undefined,
    eventId: event.id,
    eventType: event.type,
    todosProjectPath: sourceTodosProjectPath || opts.todosProject,
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
  const routePolicy = routePolicyEvidenceFromOptions(opts);
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
      routePolicy,
      concurrencyGroup: projectGroup ?? routeProjectPath,
      routeScope,
      routeThrottle: {
        maxActiveScope: throttleLimits.maxActiveScope,
        maxPerProfile: throttleLimits.maxPerProfile,
        ...(hasThrottleLimits(throttleLimits)
          ? {
              limits: throttleLimits,
              ...(projectGroup ? { projectGroup } : {}),
              ...(routeScope ? { routeScope } : {}),
            }
          : {}),
      },
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
    routeScope,
    poolRouting: buildPoolRoutingPlan(opts, provider, providerRouting.authProfilePool, workflowBody, taskId),
    providerAdmission: providerAdmissionPlanFromOpts(opts, {
      provider,
      authProfile,
      authProfiles: nonEmptyStrings([
        opts.triageAuthProfile,
        opts.plannerAuthProfile,
        opts.workerAuthProfile,
        opts.verifierAuthProfile,
      ]) ?? providerRouting.authProfilePool,
    }),
    subjectRef: taskId,
    loopName,
    loopDescription: `Run ${workflowBody.name} once for task ${taskId}; idempotency=${idempotencyKey}; event=${event.id}`,
    throttleLimits,
    admitReason: "admitted by todos-task route",
    humanSubject: `task ${taskId}`,
    valueExtras: {
      providerRouting: providerRoutingPublic(providerRouting),
      prReviewRouting: prReviewRouting.required ? prReviewRouting : undefined,
      routePolicy,
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
  const throttleLimits = routeThrottleLimitsFromInputs(opts, data, metadata);
  const routeScope = resolveRouteScope(opts, "generic-event");
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
    routeScope,
    routeThrottleLimits: throttleLimits,
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
      routeScope,
      routeThrottle: {
        maxActiveScope: throttleLimits.maxActiveScope,
        maxPerProfile: throttleLimits.maxPerProfile,
        ...(hasThrottleLimits(throttleLimits)
          ? {
              limits: throttleLimits,
              ...(projectGroup ? { projectGroup } : {}),
              ...(routeScope ? { routeScope } : {}),
            }
          : {}),
      },
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
    routeScope,
    poolRouting: buildPoolRoutingPlan(opts, provider, providerRouting.authProfilePool, workflowBody, `${event.source}:${event.type}:${event.id}`),
    providerAdmission: providerAdmissionPlanFromOpts(opts, {
      provider,
      authProfile,
      authProfiles: nonEmptyStrings([opts.workerAuthProfile, opts.verifierAuthProfile]) ?? providerRouting.authProfilePool,
    }),
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
