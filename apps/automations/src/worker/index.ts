import { randomUUID } from "node:crypto";
import type {
  ActionDefinition,
  ActionError,
  ActionExecutor,
  ActionManifest,
  ActionRun,
  ActionResult,
  ActorRef,
  JsonObject,
  JsonValue,
} from "@hasna/actions";
import type {
  AutomationRecord,
  AutomationRun,
  QueuedAction,
  TypedActionDeliveryReceipt,
  TypedActionExecutionResult,
} from "../types.js";
import { AutomationsStore } from "../lib/store.js";
import type { ActionQueueApprovalGate } from "../lib/action-queue.js";

export interface TypedActionAuthority {
  actor?: ActorRef;
  permissions?: string[];
  policies?: string[];
}

export interface TypedActionContext {
  action: QueuedAction;
  automation: AutomationRecord;
  run: AutomationRun;
  manifest: ActionManifest;
  input: JsonValue;
  actor?: ActorRef;
  signal: AbortSignal;
}

export interface TypedActionDefinition {
  manifest: ActionManifest;
  execute: (context: TypedActionContext) => unknown | Promise<unknown>;
  authorize?: (context: TypedActionContext) => { allowed: boolean; reason?: string } | Promise<{ allowed: boolean; reason?: string }>;
}

export type TypedActionDefinitionInput = TypedActionDefinition | ActionDefinition<any, any>;

export interface TypedActionWorkerOptions {
  store: AutomationsStore;
  definitions?: TypedActionDefinitionInput[];
  authority?: TypedActionAuthority;
  runnerId?: string;
}

export interface TypedActionRunOptions {
  input?: JsonValue;
  detach?: boolean;
  timeoutMs?: number;
  actor?: ActorRef;
  signal?: AbortSignal;
  /** Called once after a non-detached execution reaches a terminal receipt. */
  onSettled?: () => void;
}

export type TypedActionWorkerRunStatus = "enqueued" | "running" | "succeeded" | "failed";

export interface TypedActionRunReceipt {
  status: TypedActionWorkerRunStatus;
  runId: string;
  automationId: string;
  version: string;
  actionIds: string[];
  actions?: QueuedAction[];
  run?: AutomationRun;
  partial?: TypedActionDeliveryReceipt[];
}

export class TypedActionWorker {
  readonly store: AutomationsStore;
  readonly runnerId: string;
  readonly #definitions = new Map<string, TypedActionDefinition>();
  readonly #authority: TypedActionAuthority;

  constructor(options: TypedActionWorkerOptions) {
    this.store = options.store;
    this.runnerId = options.runnerId ?? `automations:typed-worker:${process.pid}`;
    this.#authority = options.authority ?? {};
    for (const definition of options.definitions ?? []) this.register(definition);
  }

  register(definition: TypedActionDefinitionInput): ActionManifest {
    const normalized = normalizeDefinition(definition);
    assertTypedManifest(normalized.manifest);
    const key = actionKey(normalized.manifest.id, normalized.manifest.version);
    const existing = this.#definitions.get(key);
    if (existing && existing.execute !== normalized.execute) {
      throw new Error(`typed action already registered with a different executor: ${key}`);
    }
    this.#definitions.set(key, normalized);
    return normalized.manifest;
  }

  listRegistered(): ActionManifest[] {
    return [...this.#definitions.values()].map((definition) => definition.manifest);
  }

  async run(reference: string, options: TypedActionRunOptions = {}): Promise<TypedActionRunReceipt> {
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)) {
      throw new Error("typed worker timeout must be a non-negative number");
    }
    const { slug, version } = parseAutomationReference(reference);
    const automation = this.store.requireAutomation(slug);
    if (automation.spec.version !== version) {
      throw new Error(`automation version not found: ${slug}@${version}`);
    }
    const eventTime = new Date().toISOString();
    const run = this.store.createRun({
      automationId: automation.id,
      trigger: { kind: "manual", source: "automations", type: "automation.run" },
      metadata: {
        execution: "typed-worker",
        requestedVersion: version,
      },
    });
    const actions = automation.spec.actions.map((step) => this.store.enqueueAction({
      automationRunId: run.id,
      stepId: step.id,
      actionId: step.actionId,
      maxAttempts: 1,
      invocation: {
        id: randomUUID(),
        actionId: step.actionId,
        manifestVersion: step.manifestVersion ?? "1.0.0",
        input: mergeInputs(step.input, options.input),
        actor: options.actor ?? this.#authority.actor,
        automationId: automation.id,
        runId: run.id,
        requestedAt: eventTime,
        idempotencyKey: `${run.id}:${step.id}`,
      },
      availableAt: eventTime,
      approvalGate: approvalGateForStep(step, eventTime),
    }));
    const baseReceipt = {
      runId: run.id,
      automationId: automation.id,
      version,
      actionIds: actions.map((action) => action.id),
    };
    if (options.detach) return { status: "enqueued", ...baseReceipt, actions };
    if (options.timeoutMs === 0) {
      return { status: "running", ...baseReceipt, run: this.store.startRun(run.id) };
    }
    const execution = this.executeRun(run.id, automation, options);
    if (options.timeoutMs === undefined) {
      try {
        return await execution;
      } finally {
        options.onSettled?.();
      }
    }
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), options.timeoutMs));
    const completed = await Promise.race([execution, timeout]);
    if (completed) {
      options.onSettled?.();
      return completed;
    }
    void execution.then(() => options.onSettled?.(), () => options.onSettled?.());
    return { status: "running", ...baseReceipt, run: this.store.requireRun(run.id) };
  }

  private async executeRun(
    runId: string,
    automation: AutomationRecord,
    options: TypedActionRunOptions,
  ): Promise<TypedActionRunReceipt> {
    const signal = options.signal ?? new AbortController().signal;
    this.store.startRun(runId);
    while (true) {
      const action = this.store.claimNextActionForRun(runId, { runnerId: this.runnerId });
      if (!action) break;
      const definition = this.#definitions.get(actionKey(action.actionId, action.invocation.manifestVersion ?? "1.0.0"));
      try {
        if (!definition) throw typedActionError("TYPED_ACTION_NOT_REGISTERED", `typed action is not registered: ${action.actionId}@${action.invocation.manifestVersion ?? "1.0.0"}`);
        const context: TypedActionContext = {
          action,
          automation,
          run: this.store.requireRun(runId),
          manifest: definition.manifest,
          input: action.invocation.input,
          actor: options.actor ?? this.#authority.actor ?? action.invocation.actor,
          signal,
        };
        assertAuthority(definition.manifest, context.actor, this.#authority);
        if (definition.authorize) {
          const decision = await definition.authorize(context);
          if (!decision.allowed) throw typedActionError("ACTION_POLICY_DENIED", decision.reason ?? "typed action policy denied execution", false);
        }
        const raw = await definition.execute(context);
        const normalized = normalizeResult(raw);
        const settled = normalized.status === "failed" && normalized.receipts?.length
          ? { ...normalized, status: "partial" as const }
          : normalized;
        const result = resultForQueue(settled);
        if (settled.status === "failed" && !settled.receipts?.length) {
          await this.store.failAction({ actionId: action.id, runnerId: this.runnerId, error: settled.error ?? typedActionError("TYPED_ACTION_FAILED", settled.summary ?? "typed action failed", false) });
        } else {
          await this.store.completeAction({ actionId: action.id, runnerId: this.runnerId, result });
        }
      } catch (error) {
        const actionError = isActionError(error)
          ? error
          : typedActionError("TYPED_ACTION_FAILED", error instanceof Error ? error.message : String(error), false);
        try {
          await this.store.failAction({ actionId: action.id, runnerId: this.runnerId, error: actionError });
        } catch (settlementError) {
          throw settlementError;
        }
      }
    }
    const run = this.store.settleRun(runId);
    const actions = this.store.listQueuedActions().filter((action) => action.automationRunId === runId);
    const partial = actions.flatMap((action) => {
      const receipts = action.result?.metadata?.deliveryReceipts;
      return Array.isArray(receipts) ? receipts as unknown as TypedActionDeliveryReceipt[] : [];
    });
    return {
      status: run.status === "succeeded"
        ? "succeeded"
        : run.status === "failed" || run.status === "dead" || run.status === "cancelled"
          ? "failed"
          : "running",
      runId,
      automationId: automation.id,
      version: automation.spec.version,
      actionIds: actions.map((action) => action.id),
      actions,
      run,
      partial: partial.length ? partial : undefined,
    };
  }
}

function approvalGateForStep(
  step: AutomationRecord["spec"]["actions"][number],
  requestedAt: string,
): ActionQueueApprovalGate | undefined {
  const requirement = step.approval ?? step.approvalGate?.requirement;
  if (!requirement?.requiresApproval) return undefined;
  return {
    requirement,
    blockedUntilApproved: true,
    decision: {
      id: randomUUID(),
      status: "pending",
      requestedAt,
    },
  };
}

export function createTypedActionWorker(options: TypedActionWorkerOptions): TypedActionWorker {
  return new TypedActionWorker(options);
}

export function parseAutomationReference(reference: string): { slug: string; version: string } {
  const separator = reference.lastIndexOf("@");
  if (separator <= 0 || separator === reference.length - 1) {
    throw new Error(`automation reference must use <slug>@<version>: ${reference}`);
  }
  return { slug: reference.slice(0, separator), version: reference.slice(separator + 1) };
}

export function assertTypedManifest(manifest: ActionManifest): void {
  if (!manifest.id || !manifest.version) throw new Error("typed action manifest requires id and version");
  if (!manifest.executorBindings.length || manifest.executorBindings.some((binding) => binding.kind !== "typescript")) {
    throw new Error(`generic shell or non-TypeScript executor is not allowed for typed action: ${manifest.id}@${manifest.version}`);
  }
}

function normalizeDefinition(definition: TypedActionDefinitionInput): TypedActionDefinition {
  if (isActionDefinition(definition)) {
    const executor = definition.executor as ActionExecutor<any, any>;
    const manifest = definition.manifest;
    return {
      manifest,
      execute: (context) => executor.execute({
        run: actionRunFor(context, manifest),
        manifest,
        input: context.input,
        actor: context.actor,
        idempotencyKey: context.action.invocation.idempotencyKey,
        dryRun: false,
      }),
    };
  }
  return definition;
}

function isActionDefinition(value: TypedActionDefinitionInput): value is ActionDefinition<any, any> {
  return isObject(value)
    && "executor" in value
    && isObject(value.executor)
    && typeof value.executor.execute === "function";
}

function actionRunFor(context: TypedActionContext, manifest: ActionManifest): ActionRun {
  return {
    id: context.run.id,
    actionId: context.action.actionId,
    actionVersion: manifest.version,
    status: "executing",
    actor: context.actor,
    input: context.input,
    plan: [],
    riskLevel: manifest.riskLevel,
    requiredApprovals: manifest.requiredApprovals,
    approvals: [],
    guardrailResults: [],
    evidence: [],
    idempotencyKey: context.action.invocation.idempotencyKey,
    dryRun: false,
    confirmationSummary: manifest.confirmation.title,
    rollback: manifest.rollback,
    events: [],
    metadata: {},
    createdAt: context.run.createdAt,
    updatedAt: context.run.updatedAt,
  };
}

function assertAuthority(manifest: ActionManifest, actor: ActorRef | undefined, authority: TypedActionAuthority): void {
  if (manifest.actor.required && !actor) throw typedActionError("ACTION_ACTOR_REQUIRED", `typed action requires an actor: ${manifest.id}`, false);
  if (actor && manifest.actor.types.length && !manifest.actor.types.includes(actor.type)) {
    throw typedActionError("ACTION_ACTOR_FORBIDDEN", `actor type is not authorized for ${manifest.id}: ${actor.type}`, false);
  }
  const permissions = new Set(authority.permissions ?? []);
  for (const permission of manifest.scope.permissions ?? []) {
    if (!permissions.has(permission)) throw typedActionError("ACTION_AUTHORITY_DENIED", `authority lacks permission: ${permission}`, false);
  }
}

function normalizeResult(value: unknown): TypedActionExecutionResult {
  if (isObject(value) && (value.status === "succeeded" || value.status === "partial" || value.status === "failed")) {
    return value as TypedActionExecutionResult;
  }
  if (isObject(value) && ("output" in value || "summary" in value || "metadata" in value || "evidence" in value)) {
    return { status: "succeeded", ...(value as ActionResult) };
  }
  return { status: "succeeded", output: value as JsonValue };
}

function resultForQueue(result: TypedActionExecutionResult): ActionResult {
  const metadata: JsonObject = {
    ...(result.metadata ?? {}),
    deliveryStatus: result.status ?? "succeeded",
  };
  if (result.receipts) metadata.deliveryReceipts = result.receipts as unknown as JsonValue;
  if (result.error) metadata.error = result.error as unknown as JsonValue;
  return {
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.output !== undefined ? { output: result.output as JsonValue } : {}),
    metadata,
  };
}

function mergeInputs(stepInput: JsonValue | undefined, callerInput: JsonValue | undefined): JsonValue {
  if (callerInput === undefined) return stepInput ?? {};
  if (isObject(stepInput) && isObject(callerInput)) return { ...stepInput, ...callerInput };
  return callerInput;
}

function actionKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function typedActionError(code: string, message: string, retryable = false): ActionError {
  return { code, message, retryable };
}

function isActionError(value: unknown): value is ActionError {
  return isObject(value)
    && typeof value.code === "string"
    && typeof value.message === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
