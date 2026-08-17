import type {
  ActionError,
  ActionManifest,
  JsonObject,
  JsonValue,
} from "@hasna/actions";
import type {
  TypedActionDeliveryReceipt,
  TypedActionExecutionResult,
} from "../types.js";
import type {
  TypedActionContext,
  TypedActionDefinition,
} from "../worker/index.js";
import {
  AUTOMATION_TEMPLATE_SCHEMA_VERSION,
  AutomationTemplateRegistry,
  type AutomationTemplateDefinition,
} from "./core.js";

export const FIRST_PARTY_TEMPLATE_VERSION = "1.0.0" as const;
export const FIRST_PARTY_ACTION_VERSION = "1.0.0" as const;

export const FIRST_PARTY_TEMPLATE_SLUGS = {
  workLifecycle: "work-lifecycle",
  projectSnapshot: "project-snapshot",
  sessionBootstrap: "session-bootstrap",
} as const;

export const FIRST_PARTY_ACTION_IDS = {
  workLifecycle: "templates.work-lifecycle",
  projectSnapshot: "templates.project-snapshot",
  sessionBootstrap: "templates.session-bootstrap",
  sessionBootstrapCompensate: "templates.session-bootstrap.compensate",
} as const;

export const WORK_LIFECYCLE_SINKS = [
  "todos",
  "mementos",
  "conversations",
] as const;

export const PROJECT_SNAPSHOT_SOURCES = [
  "projects",
  "todos",
  "conversations",
  "mementos",
  "repository",
] as const;

export const SESSION_BOOTSTRAP_BINDINGS = [
  "identity",
  "project",
  "monitoring",
  "policy",
] as const;

export type WorkLifecycleSink = (typeof WORK_LIFECYCLE_SINKS)[number];
export type ProjectSnapshotSource = (typeof PROJECT_SNAPSHOT_SOURCES)[number];
export type SessionBootstrapBinding = (typeof SESSION_BOOTSTRAP_BINDINGS)[number];

export interface FirstPartyAdapterContext {
  runId: string;
  actionId: string;
  actorId?: string;
  signal: AbortSignal;
}

export interface WorkLifecycleAdapter {
  updateTodos(input: JsonObject, context: FirstPartyAdapterContext): JsonObject | Promise<JsonObject>;
  updateMementos(input: JsonObject, context: FirstPartyAdapterContext): JsonObject | Promise<JsonObject>;
  updateConversations(input: JsonObject, context: FirstPartyAdapterContext): JsonObject | Promise<JsonObject>;
}

export interface ProjectSnapshotAdapter {
  readonly authority: "cloud";
  readProjects(projectId: string, limit: number, context: FirstPartyAdapterContext): ProjectSnapshotReadResult | Promise<ProjectSnapshotReadResult>;
  readTodos(projectId: string, limit: number, context: FirstPartyAdapterContext): ProjectSnapshotReadResult | Promise<ProjectSnapshotReadResult>;
  readConversations(projectId: string, limit: number, context: FirstPartyAdapterContext): ProjectSnapshotReadResult | Promise<ProjectSnapshotReadResult>;
  readMementos(projectId: string, limit: number, context: FirstPartyAdapterContext): ProjectSnapshotReadResult | Promise<ProjectSnapshotReadResult>;
  readRepository(projectId: string, limit: number, context: FirstPartyAdapterContext): ProjectSnapshotReadResult | Promise<ProjectSnapshotReadResult>;
}

export interface ProjectSnapshotReadResult {
  readonly authority: "cloud";
  readonly complete: boolean;
  readonly verified: boolean;
  readonly value: JsonValue;
  readonly receipt?: JsonObject;
}

export interface SessionBootstrapScope {
  identityId: string;
  projectId: string;
}

export interface SessionBootstrapBindingResult {
  bindingId: string;
  receipt: JsonObject;
}

export interface SessionBootstrapCompensationResult {
  receipt: JsonObject;
}

export interface SessionBootstrapAdapter {
  verifyExactScope(
    scope: SessionBootstrapScope,
    context: FirstPartyAdapterContext,
  ): { exact: boolean; reason?: string } | Promise<{ exact: boolean; reason?: string }>;
  createBinding(
    binding: SessionBootstrapBinding,
    input: JsonObject,
    scope: SessionBootstrapScope,
    context: FirstPartyAdapterContext,
  ): SessionBootstrapBindingResult | Promise<SessionBootstrapBindingResult>;
  compensateBinding(
    binding: SessionBootstrapBinding,
    bindingId: string,
    context: FirstPartyAdapterContext,
  ): SessionBootstrapCompensationResult | Promise<SessionBootstrapCompensationResult>;
}

export const WORK_LIFECYCLE_TEMPLATE: AutomationTemplateDefinition = {
  schemaVersion: AUTOMATION_TEMPLATE_SCHEMA_VERSION,
  slug: FIRST_PARTY_TEMPLATE_SLUGS.workLifecycle,
  version: FIRST_PARTY_TEMPLATE_VERSION,
  name: "Work lifecycle",
  description: "Write one lifecycle transition independently to Todos, Mementos, and Conversations.",
  authority: {
    mode: "write",
    readPermissions: [],
    writePermissions: [
      "todos:write",
      "mementos:write",
      "conversations:write",
    ],
  },
  effects: WORK_LIFECYCLE_SINKS.map((sink) => ({
    id: `${sink}-write`,
    stepId: "execute",
    sink,
    kind: "write",
    operation: `${sink}.work-lifecycle.update`,
    compensation: {
      kind: "not-applicable",
      reason: "The lifecycle update targets an existing authoritative record and creates no binding.",
    },
  })),
  inputs: {
    todos: { type: "object", required: true },
    mementos: { type: "object", required: true },
    conversations: { type: "object", required: true },
  },
  outputs: {
    receipts: { source: "${{ steps.execute.outputs.receipts }}" },
  },
  automation: {
    triggers: [{ kind: "manual" }],
    actions: [{
      id: "execute",
      actionId: FIRST_PARTY_ACTION_IDS.workLifecycle,
      manifestVersion: FIRST_PARTY_ACTION_VERSION,
      input: {
        todos: "${{ inputs.todos }}",
        mementos: "${{ inputs.mementos }}",
        conversations: "${{ inputs.conversations }}",
      },
      outputs: {
        receipts: { path: "/receipts" },
      },
    }],
    audit: {
      eventSource: "hasna.automations.templates.work-lifecycle",
      evidenceRefs: ["deliveryReceipts"],
    },
  },
};

export const PROJECT_SNAPSHOT_TEMPLATE: AutomationTemplateDefinition = {
  schemaVersion: AUTOMATION_TEMPLATE_SCHEMA_VERSION,
  slug: FIRST_PARTY_TEMPLATE_SLUGS.projectSnapshot,
  version: FIRST_PARTY_TEMPLATE_VERSION,
  name: "Project snapshot",
  description: "Read a bounded cloud-authoritative project snapshot without writing.",
  authority: {
    mode: "read-only",
    readPermissions: [
      "projects:read",
      "todos:read",
      "conversations:read",
      "mementos:read",
      "repository:read",
    ],
    writePermissions: [],
  },
  effects: PROJECT_SNAPSHOT_SOURCES.map((source) => ({
    id: `${source}-read`,
    stepId: "execute",
    sink: source,
    kind: "read",
    operation: `${source}.snapshot.read`,
    compensation: {
      kind: "not-applicable",
      reason: "The source operation is read-only and creates no binding.",
    },
  })),
  inputs: {
    projectId: { type: "string", required: true },
    limit: { type: "number", default: 50 },
  },
  outputs: {
    snapshot: { source: "${{ steps.execute.outputs.snapshot }}" },
  },
  automation: {
    triggers: [{ kind: "manual" }],
    actions: [{
      id: "execute",
      actionId: FIRST_PARTY_ACTION_IDS.projectSnapshot,
      manifestVersion: FIRST_PARTY_ACTION_VERSION,
      input: {
        projectId: "${{ inputs.projectId }}",
        limit: "${{ inputs.limit }}",
      },
      outputs: {
        snapshot: { path: "/snapshot" },
      },
    }],
    audit: {
      eventSource: "hasna.automations.templates.project-snapshot",
      evidenceRefs: ["deliveryReceipts"],
    },
  },
};

export const SESSION_BOOTSTRAP_TEMPLATE: AutomationTemplateDefinition = {
  schemaVersion: AUTOMATION_TEMPLATE_SCHEMA_VERSION,
  slug: FIRST_PARTY_TEMPLATE_SLUGS.sessionBootstrap,
  version: FIRST_PARTY_TEMPLATE_VERSION,
  name: "Session bootstrap",
  description: "Create exact session identity, project, monitoring, and policy bindings with compensation evidence.",
  authority: {
    mode: "write",
    readPermissions: ["identity:read", "projects:read"],
    writePermissions: [
      "identity:write",
      "projects:write",
      "monitoring:write",
      "policy:write",
    ],
  },
  effects: SESSION_BOOTSTRAP_BINDINGS.map((binding) => ({
    id: `${binding}-binding`,
    stepId: "execute",
    sink: binding,
    kind: "write",
    operation: `session.${binding}.bind`,
    compensation: {
      kind: "per-created-binding",
      actionId: FIRST_PARTY_ACTION_IDS.sessionBootstrapCompensate,
    },
  })),
  inputs: {
    identityId: { type: "string", required: true },
    projectId: { type: "string", required: true },
    identity: { type: "object", required: true },
    project: { type: "object", required: true },
    monitoring: { type: "object", required: true },
    policy: { type: "object", required: true },
  },
  outputs: {
    bindings: { source: "${{ steps.execute.outputs.bindings }}" },
  },
  automation: {
    triggers: [{ kind: "manual" }],
    actions: [{
      id: "execute",
      actionId: FIRST_PARTY_ACTION_IDS.sessionBootstrap,
      manifestVersion: FIRST_PARTY_ACTION_VERSION,
      input: {
        identityId: "${{ inputs.identityId }}",
        projectId: "${{ inputs.projectId }}",
        identity: "${{ inputs.identity }}",
        project: "${{ inputs.project }}",
        monitoring: "${{ inputs.monitoring }}",
        policy: "${{ inputs.policy }}",
      },
      outputs: {
        bindings: { path: "/bindings" },
      },
    }],
    audit: {
      eventSource: "hasna.automations.templates.session-bootstrap",
      evidenceRefs: ["deliveryReceipts"],
    },
  },
};

export const FIRST_PARTY_TEMPLATES = [
  WORK_LIFECYCLE_TEMPLATE,
  PROJECT_SNAPSHOT_TEMPLATE,
  SESSION_BOOTSTRAP_TEMPLATE,
] as const;

export function createFirstPartyTemplateRegistry(): AutomationTemplateRegistry {
  const registry = new AutomationTemplateRegistry();
  for (const template of FIRST_PARTY_TEMPLATES) registry.register(template);
  return registry;
}

export function createWorkLifecycleAction(
  adapter: WorkLifecycleAdapter,
): TypedActionDefinition {
  return {
    manifest: manifest({
      id: FIRST_PARTY_ACTION_IDS.workLifecycle,
      name: "Work lifecycle writer",
      description: "Write one lifecycle transition to three independent authoritative sinks.",
      permissions: WORK_LIFECYCLE_TEMPLATE.authority.writePermissions,
      readOnly: false,
      rollback: {
        strategy: "none",
        notes: "No binding is created; compensation is explicitly not applicable.",
      },
    }),
    execute: async (context) => executeIndependentSinks(
      context,
      WORK_LIFECYCLE_SINKS,
      async (sink) => {
        const input = requireObject(requireObject(context.input, "work-lifecycle input")[sink], `${sink} input`);
        const adapterContext = firstPartyContext(context);
        if (sink === "todos") return adapter.updateTodos(input, adapterContext);
        if (sink === "mementos") return adapter.updateMementos(input, adapterContext);
        return adapter.updateConversations(input, adapterContext);
      },
      "work lifecycle",
    ),
  };
}

export function createProjectSnapshotAction(
  adapter: ProjectSnapshotAdapter,
  options: { maxItems?: number; maxBytes?: number } = {},
): TypedActionDefinition {
  const maxItems = positiveInteger(options.maxItems ?? 100, "project snapshot maxItems");
  const maxBytes = positiveInteger(options.maxBytes ?? 65_536, "project snapshot maxBytes");
  if (adapter.authority !== "cloud") {
    throw new Error("project snapshot requires a cloud-authoritative adapter");
  }
  return {
    manifest: manifest({
      id: FIRST_PARTY_ACTION_IDS.projectSnapshot,
      name: "Project snapshot reader",
      description: "Read bounded project state from injected cloud-authoritative sources.",
      permissions: PROJECT_SNAPSHOT_TEMPLATE.authority.readPermissions,
      readOnly: true,
      rollback: {
        strategy: "none",
        notes: "Every source operation is read-only.",
      },
    }),
    execute: async (context) => {
      const input = requireObject(context.input, "project-snapshot input");
      const projectId = requireNonEmptyString(input.projectId, "projectId");
      const requestedLimit = input.limit === undefined ? 50 : requirePositiveNumber(input.limit, "limit");
      const limit = Math.min(requestedLimit, maxItems);
      const snapshot: JsonObject = priorSnapshot(context);
      return executeIndependentSinks(
        context,
        PROJECT_SNAPSHOT_SOURCES,
        async (source) => {
          const adapterContext = firstPartyContext(context);
          const rawResult = source === "projects"
            ? await adapter.readProjects(projectId, limit, adapterContext)
            : source === "todos"
              ? await adapter.readTodos(projectId, limit, adapterContext)
              : source === "conversations"
                ? await adapter.readConversations(projectId, limit, adapterContext)
                : source === "mementos"
                ? await adapter.readMementos(projectId, limit, adapterContext)
                : await adapter.readRepository(projectId, limit, adapterContext);
          const readResult = requireProjectSnapshotReadResult(rawResult, source);
          if (readResult.authority !== "cloud" || !readResult.complete || !readResult.verified) {
            throw actionError(
              "SOURCE_UNVERIFIED",
              `${source} source must be cloud-authoritative, complete, and verified`,
            );
          }
          const bounded = boundedSnapshotValue(readResult.value, limit, maxBytes, source);
          snapshot[source] = bounded;
          return {
            verified: true,
            complete: true,
            count: snapshotCount(bounded),
            bytes: new TextEncoder().encode(JSON.stringify(bounded)).byteLength,
            authority: readResult.authority,
            sourceReceipt: readResult.receipt ?? null,
          };
        },
        "project snapshot",
        () => ({ snapshot }),
      );
    },
  };
}

export function createSessionBootstrapAction(
  adapter: SessionBootstrapAdapter,
): TypedActionDefinition {
  return {
    manifest: manifest({
      id: FIRST_PARTY_ACTION_IDS.sessionBootstrap,
      name: "Session bootstrap binder",
      description: "Create exact scoped session bindings and record per-binding compensation evidence.",
      permissions: [
        ...SESSION_BOOTSTRAP_TEMPLATE.authority.readPermissions,
        ...SESSION_BOOTSTRAP_TEMPLATE.authority.writePermissions,
      ],
      readOnly: false,
      rollback: {
        strategy: "compensating-action",
        actionId: FIRST_PARTY_ACTION_IDS.sessionBootstrapCompensate,
        notes: "Every created binding records its binding id and compensation receipt.",
      },
    }),
    execute: async (context) => {
      const input = requireObject(context.input, "session-bootstrap input");
      const scope = {
        identityId: requireNonEmptyString(input.identityId, "identityId"),
        projectId: requireNonEmptyString(input.projectId, "projectId"),
      };
      const adapterContext = firstPartyContext(context);
      const scopeDecision = await adapter.verifyExactScope(scope, adapterContext);
      if (!scopeDecision.exact) {
        return {
          status: "failed",
          summary: "session bootstrap scope is ambiguous; no bindings were created",
          error: actionError(
            "SESSION_SCOPE_AMBIGUOUS",
            scopeDecision.reason ?? "session bootstrap requires one exact identity and project",
          ),
          metadata: {
            compensation: {
              kind: "not-applicable",
              reason: "No binding was created.",
            },
          },
        };
      }

      const created: Array<{
        binding: SessionBootstrapBinding;
        bindingId: string;
        receipt: JsonObject;
      }> = [];
      const selected = selectedSinks(context, SESSION_BOOTSTRAP_BINDINGS);
      const receipts: TypedActionDeliveryReceipt[] = [];
      for (const binding of selected) {
        const prior = context.priorReceipts.find((receipt) => receipt.sink === binding);
        const priorCompensation = isObject(prior?.receipt)
          && isObject(prior.receipt.compensation)
          && prior.receipt.compensation.kind === "failed"
          ? prior.receipt.compensation
          : undefined;
        let compensationRetry: JsonObject | undefined;
        if (priorCompensation) {
          const priorBindingId = prior?.receipt?.bindingId;
          if (typeof priorBindingId !== "string" || priorBindingId.trim() === "") {
            receipts.push({
              sink: binding,
              status: "failed",
              receipt: {
                ...(prior?.receipt ?? {}),
                compensation: {
                  ...priorCompensation,
                  retry: {
                    attempted: false,
                    error: "prior compensation receipt has no exact binding id",
                  },
                },
              },
              error: {
                code: "SESSION_COMPENSATION_BINDING_ID_MISSING",
                message: `${binding} compensation cannot retry without the exact prior binding id`,
                retryable: false,
              },
            });
            continue;
          }
          try {
            const compensation = await adapter.compensateBinding(
              binding,
              priorBindingId,
              adapterContext,
            );
            compensationRetry = {
              bindingId: priorBindingId,
              receipt: compensation.receipt,
            };
          } catch (error) {
            const compensationError = toActionError(error, "SESSION_COMPENSATION_FAILED");
            receipts.push({
              sink: binding,
              status: "failed",
              receipt: {
                ...(prior?.receipt ?? {}),
                compensation: {
                  ...priorCompensation,
                  retry: {
                    attempted: true,
                    error: compensationError as unknown as JsonValue,
                  },
                },
              },
              error: {
                code: "SESSION_COMPENSATION_FAILED",
                message: `compensation failed for ${binding}; no replacement binding was created`,
                retryable: true,
                details: compensationError as unknown as JsonValue,
              },
            });
            continue;
          }
        }
        try {
          const bindingInput = requireObject(input[binding], `${binding} binding input`);
          const result = await adapter.createBinding(binding, bindingInput, scope, adapterContext);
          const bindingId = requireNonEmptyString(result.bindingId, `${binding} bindingId`);
          created.push({ binding, bindingId, receipt: result.receipt });
          receipts.push({
            sink: binding,
            status: "succeeded",
            receipt: {
              ...result.receipt,
              bindingId,
              ...(compensationRetry ? {
                compensationRetry: {
                  bindingId: compensationRetry.bindingId,
                  receipt: compensationRetry.receipt,
                },
              } : {}),
              compensation: {
                kind: "available",
                actionId: FIRST_PARTY_ACTION_IDS.sessionBootstrapCompensate,
              },
            },
          });
        } catch (error) {
          receipts.push({
            sink: binding,
            status: "failed",
            error: toActionError(error, "SESSION_BINDING_FAILED"),
          });
        }
      }

      if (receipts.some((receipt) => receipt.status === "failed")) {
        for (const entry of created) {
          try {
            const compensation = await adapter.compensateBinding(
              entry.binding,
              entry.bindingId,
              adapterContext,
            );
            const receipt = receipts.find((candidate) => candidate.sink === entry.binding);
            if (receipt?.status === "succeeded") {
              receipt.receipt = {
                ...(receipt.receipt ?? {}),
                compensation: {
                  kind: "executed",
                  actionId: FIRST_PARTY_ACTION_IDS.sessionBootstrapCompensate,
                  receipt: compensation.receipt,
                },
              };
              receipt.status = "failed";
              receipt.error = {
                code: "SESSION_BINDING_COMPENSATED",
                message: `${entry.binding} binding was compensated and must be recreated on replay`,
                retryable: true,
              };
            }
          } catch (error) {
            const receipt = receipts.find((candidate) => candidate.sink === entry.binding);
            if (receipt?.status === "succeeded") {
              receipt.receipt = {
                ...(receipt.receipt ?? {}),
                compensation: {
                  kind: "failed",
                  actionId: FIRST_PARTY_ACTION_IDS.sessionBootstrapCompensate,
                  error: toActionError(error, "SESSION_COMPENSATION_FAILED") as unknown as JsonValue,
                },
              };
              receipt.status = "failed";
              receipt.error = {
                code: "SESSION_COMPENSATION_FAILED",
                message: `compensation failed for ${entry.binding}; replay is required`,
                retryable: true,
                details: toActionError(error, "SESSION_COMPENSATION_FAILED") as unknown as JsonValue,
              };
            }
          }
        }
      }

      return resultFromReceipts(
        context,
        receipts,
        "session bootstrap",
        {
          bindings: Object.fromEntries(receipts
            .filter((receipt) => receipt.status === "succeeded")
            .map((receipt) => [receipt.sink, receipt.receipt ?? {}])),
        },
      );
    },
  };
}

export function createFirstPartyActionDefinitions(options: {
  workLifecycle: WorkLifecycleAdapter;
  projectSnapshot: ProjectSnapshotAdapter;
  sessionBootstrap: SessionBootstrapAdapter;
}): TypedActionDefinition[] {
  return [
    createWorkLifecycleAction(options.workLifecycle),
    createProjectSnapshotAction(options.projectSnapshot),
    createSessionBootstrapAction(options.sessionBootstrap),
    createSessionBootstrapCompensateAction(options.sessionBootstrap),
  ];
}

export function createSessionBootstrapCompensateAction(
  adapter: SessionBootstrapAdapter,
): TypedActionDefinition {
  return {
    manifest: manifest({
      id: FIRST_PARTY_ACTION_IDS.sessionBootstrapCompensate,
      name: "Session bootstrap compensator",
      description: "Compensate one previously created session binding by exact binding id.",
      permissions: SESSION_BOOTSTRAP_TEMPLATE.authority.writePermissions,
      readOnly: false,
      rollback: {
        strategy: "none",
        notes: "Compensation is terminal for the named binding.",
      },
    }),
    execute: async (context) => {
      const input = requireObject(context.input, "session-bootstrap compensation input");
      const binding = requireNonEmptyString(input.binding, "binding") as SessionBootstrapBinding;
      if (!(SESSION_BOOTSTRAP_BINDINGS as readonly string[]).includes(binding)) {
        throw actionError("SESSION_BINDING_UNKNOWN", `unknown session binding: ${binding}`);
      }
      const bindingId = requireNonEmptyString(input.bindingId, "bindingId");
      const result = await adapter.compensateBinding(binding, bindingId, firstPartyContext(context));
      return {
        status: "succeeded",
        summary: `compensated ${binding} binding`,
        output: {
          binding,
          bindingId,
          receipt: result.receipt,
        },
      };
    },
  };
}

async function executeIndependentSinks<TSink extends string>(
  context: TypedActionContext,
  sinks: readonly TSink[],
  execute: (sink: TSink) => JsonObject | Promise<JsonObject>,
  label: string,
  output: () => JsonObject = () => ({}),
): Promise<TypedActionExecutionResult> {
  const receipts: TypedActionDeliveryReceipt[] = [];
  for (const sink of selectedSinks(context, sinks)) {
    try {
      receipts.push({
        sink,
        status: "succeeded",
        receipt: await execute(sink),
      });
    } catch (error) {
      receipts.push({
        sink,
        status: "failed",
        error: toActionError(error, "TEMPLATE_SINK_FAILED"),
      });
    }
  }
  return resultFromReceipts(context, receipts, label, output());
}

function resultFromReceipts(
  context: TypedActionContext,
  receipts: TypedActionDeliveryReceipt[],
  label: string,
  output: JsonObject,
): TypedActionExecutionResult {
  const merged = new Map(context.priorReceipts.map((receipt) => [receipt.sink, receipt]));
  for (const receipt of receipts) merged.set(receipt.sink, receipt);
  const allReceipts = [...merged.values()];
  const failed = allReceipts.filter((receipt) => receipt.status === "failed");
  return {
    status: failed.length > 0 ? "partial" : "succeeded",
    summary: failed.length > 0
      ? `${label} completed with ${failed.length} failed sink${failed.length === 1 ? "" : "s"}`
      : `${label} completed`,
    output: {
      ...output,
      receipts: Object.fromEntries(allReceipts.map((receipt) => [receipt.sink, receipt.receipt ?? {
        error: (receipt.error ?? actionError("TEMPLATE_SINK_FAILED", "sink failed")) as unknown as JsonValue,
      }])),
      replay: context.replayLineage ?? null,
    } as unknown as JsonValue,
    receipts,
    metadata: {
      replayOnlySinks: context.replayOnlySinks,
      replayLineage: context.replayLineage ?? null,
    },
  };
}

function selectedSinks<TSink extends string>(
  context: TypedActionContext,
  sinks: readonly TSink[],
): TSink[] {
  if (context.replayOnlySinks.length === 0) return [...sinks];
  const allowed = new Set<string>(sinks);
  for (const sink of context.replayOnlySinks) {
    if (!allowed.has(sink)) {
      throw new Error(`partial replay requested unknown sink: ${sink}`);
    }
  }
  return context.replayOnlySinks as TSink[];
}

function firstPartyContext(context: TypedActionContext): FirstPartyAdapterContext {
  return {
    runId: context.run.id,
    actionId: context.replayLineage?.rootActionId ?? context.action.id,
    actorId: context.actor?.id,
    signal: context.signal,
  };
}

function manifest(options: {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  readOnly: boolean;
  rollback: ActionManifest["rollback"];
}): ActionManifest {
  return {
    id: options.id,
    name: options.name,
    version: FIRST_PARTY_ACTION_VERSION,
    description: options.description,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    actor: { types: ["agent"], required: true },
    resource: { type: "automation-template" },
    scope: {
      level: "cloud",
      permissions: options.permissions,
      boundaries: ["exact-template-input", "injected-authoritative-adapter"],
    },
    riskLevel: options.readOnly ? "low" : "medium",
    requiredApprovals: [],
    idempotency: {
      supported: true,
      required: true,
      keyHint: "automation run and action id",
    },
    dryRun: {
      supported: true,
      default: false,
      notes: "Use previewAutomationTemplateExecution; runtime preview invokes no adapter.",
    },
    confirmation: { title: options.name },
    audit: {
      eventTypes: ["template.started", "template.sink.receipt", "template.completed"],
      includeInput: false,
      includeOutput: true,
      redactedFields: ["input"],
    },
    evidence: {
      required: true,
      fields: ["deliveryReceipts"],
    },
    rollback: options.rollback,
    executorBindings: [{
      kind: "typescript",
      ref: `@hasna/automations/templates#${options.id}`,
    }],
  };
}

function requireObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requirePositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function boundedSnapshotValue(
  value: JsonValue,
  limit: number,
  maxBytes: number,
  source: string,
): JsonValue {
  const bounded = Array.isArray(value) ? value.slice(0, limit) : value;
  if (bounded === null
    || bounded === ""
    || (Array.isArray(bounded) && bounded.length === 0)
    || (bounded !== null && typeof bounded === "object" && !Array.isArray(bounded) && Object.keys(bounded).length === 0)) {
    throw actionError("SOURCE_UNVERIFIED", `${source} source returned no verifiable records`);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(bounded)).byteLength;
  if (bytes > maxBytes) {
    throw actionError("SOURCE_TOO_LARGE", `${source} source exceeded bounded snapshot size`);
  }
  return structuredClone(bounded);
}

function requireProjectSnapshotReadResult(
  value: unknown,
  source: string,
): ProjectSnapshotReadResult {
  if (!isObject(value)
    || value.authority !== "cloud"
    || typeof value.complete !== "boolean"
    || typeof value.verified !== "boolean"
    || !("value" in value)) {
    throw actionError(
      "SOURCE_UNVERIFIED",
      `${source} source must return a cloud-authoritative completeness envelope`,
    );
  }
  return value as unknown as ProjectSnapshotReadResult;
}

function priorSnapshot(context: TypedActionContext): JsonObject {
  const output = context.action.result?.output;
  if (!isObject(output) || !isObject(output.snapshot)) return {};
  const successfulSources = new Set(
    context.priorReceipts
      .filter((receipt) => receipt.status === "succeeded")
      .map((receipt) => receipt.sink),
  );
  return Object.fromEntries(
    Object.entries(output.snapshot)
      .filter(([source]) => successfulSources.has(source))
      .map(([source, value]) => [source, structuredClone(value as JsonValue)]),
  );
}

function snapshotCount(value: JsonValue): number {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") return Object.keys(value).length;
  return 1;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function actionError(code: string, message: string): ActionError {
  return { code, message, retryable: false };
}

function toActionError(error: unknown, fallbackCode: string): ActionError {
  if (error !== null
    && typeof error === "object"
    && typeof (error as { code?: unknown }).code === "string"
    && typeof (error as { message?: unknown }).message === "string") {
    return error as ActionError;
  }
  return actionError(fallbackCode, error instanceof Error ? error.message : String(error));
}
