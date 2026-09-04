import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type {
  TodosAiJsonObject,
  TodosAiJsonValue,
  TodosAiRunRequest,
  TodosAiRuntimeTool,
  TodosAiRuntimeToolSource,
} from "./ai.js";
import {
  TODOS_AI_UPDATE_TASK_FIELDS,
  TODOS_AI_UPDATE_TASK_LIMITS,
  TODOS_AI_UPDATE_TASK_RESULT_SCHEMA,
  TodosAiNeedsApprovalSignal,
  TodosAiNeedsInputSignal,
  isTodosAiUpdateTaskResult,
  isTodosAiJsonValue,
  type TodosAiUpdateTaskField,
} from "./ai.js";
export {
  TODOS_AI_UPDATE_TASK_FIELDS,
  TODOS_AI_UPDATE_TASK_LIMITS,
} from "./ai.js";
import {
  cloudGetTask,
  cloudListPlans,
  cloudListProjects,
  cloudListTasks,
  cloudUpdateTask,
  getTodosCloudClient,
} from "./cli/cloud-router.js";
import { getTask, listTasks, updateTask } from "./db/task-crud.js";
import { listProjects } from "./db/projects.js";
import { listPlans } from "./db/plans.js";
import {
  ACCESS_PROFILES,
  resolveAccessProfile,
  shouldRegisterToolForProfile,
  type AccessProfile,
} from "./lib/access-profiles.js";
import { checkApprovalGate } from "./lib/approval-gates.js";
import { redactEvidenceText, redactValue } from "./lib/redaction.js";
import { checkWorkspacePermission } from "./lib/workspace-trust.js";
import {
  PLAN_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Plan,
  type Project,
  type Task,
  type TaskFilter,
  type UpdateTaskInput,
} from "./types/index.js";
import { env } from "./lib/env.js";

export const TODOS_AI_READ_TOOL_NAMES = [
  "get_task",
  "list_tasks",
  "list_projects",
  "list_plans",
] as const;

export type TodosAiReadToolName = (typeof TODOS_AI_READ_TOOL_NAMES)[number];

export const TODOS_AI_CONTROL_TOOL_NAMES = ["request_input"] as const;
export const TODOS_AI_WRITE_TOOL_NAMES = ["update_task"] as const;

export type TodosAiControlToolName = (typeof TODOS_AI_CONTROL_TOOL_NAMES)[number];
export type TodosAiWriteToolName = (typeof TODOS_AI_WRITE_TOOL_NAMES)[number];
export type TodosAiToolName =
  | TodosAiReadToolName
  | TodosAiControlToolName
  | TodosAiWriteToolName;

export const TODOS_AI_READ_TOOL_LIMITS = {
  default_list_items: 20,
  max_list_items: 50,
  max_list_offset: 10_000,
  max_identifier_bytes: 256,
  max_filter_string_bytes: 256,
  max_tags: 16,
  max_output_tags: 16,
  max_output_string_bytes: 2_048,
  max_result_bytes: 65_536,
  max_tool_calls: 32,
  max_evidence_pointers: 32,
} as const;

export const TODOS_AI_CONTROL_TOOL_LIMITS = {
  max_prompt_bytes: 1_024,
  max_fields: 16,
  max_field_bytes: 128,
} as const;

type MaybePromise<T> = T | PromiseLike<T>;
type ToolPermission = "read" | "list" | "write";
type Env = Record<string, string | undefined>;

export interface TodosAiReadAdapter {
  readonly source: "sqlite" | "http";
  getTask(id: string): MaybePromise<Task | null>;
  listTasks(filter: TaskFilter): MaybePromise<Task[]>;
  listProjects(): MaybePromise<Project[]>;
  listPlans(projectId?: string): MaybePromise<Plan[]>;
  updateTask?(id: string, patch: UpdateTaskInput): MaybePromise<Task>;
  verifyApproval?(
    input: TodosAiApprovalVerificationRequest,
  ): MaybePromise<TodosAiApprovalVerification | null>;
}

export interface TodosAiApprovalVerificationRequest {
  ref: string;
  task_id: string;
  operation: "update_task";
  payload_digest: string;
}

export interface TodosAiApprovalVerification {
  ref: string;
  task_id: string;
  operation: "update_task";
  payload_digest: string;
  status: "approved" | "pending" | "rejected" | "expired";
  expires_at: string | null;
}

export interface CreateTodosAiReadToolSourceOptions {
  env?: Env;
  database?: Database;
  adapter?: TodosAiReadAdapter;
  accessProfile?: AccessProfile;
  workspacePath?: string;
  workspacePermission?: (permission: ToolPermission, tool: TodosAiToolName) => boolean;
  approvalVerifier?: (
    input: TodosAiApprovalVerificationRequest,
  ) => MaybePromise<TodosAiApprovalVerification | null>;
  now?: () => Date;
}

interface ReadToolState {
  calls: number;
  evidence: TodosAiJsonObject[];
  idempotency: Map<string, UpdateTaskClaim>;
  now: () => Date;
}

interface UpdateTaskClaim {
  payload_digest: string;
  mutation_started: boolean;
  promise: Promise<TodosAiJsonObject>;
}

const ENCODER = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type UpdateTaskField = TodosAiUpdateTaskField;

export function createLocalTodosAiReadAdapter(database?: Database): TodosAiReadAdapter {
  return {
    source: "sqlite",
    getTask: (id) => getTask(id, database),
    listTasks: (filter) => listTasks(filter, database),
    listProjects: () => listProjects(database),
    listPlans: (projectId) => listPlans(projectId, database),
    updateTask: (id, patch) => updateTask(id, patch, database),
    verifyApproval: (input) => {
      const result = checkApprovalGate(input.task_id, input.ref, database);
      if (!result.gate) return null;
      return {
        ref: result.gate.gate,
        task_id: result.gate.task_id,
        operation: input.operation,
        payload_digest: input.payload_digest,
        status: result.gate.status,
        expires_at: result.gate.expires_at,
      };
    },
  };
}

function createHttpTodosAiReadAdapter(
  client: NonNullable<ReturnType<typeof getTodosCloudClient>>,
): TodosAiReadAdapter {
  return {
    source: "http",
    getTask: (id) => cloudGetTask(client, id),
    listTasks: (filter) => cloudListTasks(client, filter),
    listProjects: () => cloudListProjects(client),
    listPlans: (projectId) => cloudListPlans(client, projectId),
    updateTask: (id, patch) =>
      cloudUpdateTask(client, id, patch as unknown as Record<string, unknown>),
  };
}

function resolveAdapter(options: CreateTodosAiReadToolSourceOptions): TodosAiReadAdapter {
  if (options.adapter) return options.adapter;
  const client = getTodosCloudClient(options.env);
  return client
    ? createHttpTodosAiReadAdapter(client)
    : createLocalTodosAiReadAdapter(options.database);
}

function resolvePermission(
  options: CreateTodosAiReadToolSourceOptions,
  profile: AccessProfile,
): (permission: ToolPermission, tool: TodosAiToolName) => boolean {
  if (options.workspacePermission) return options.workspacePermission;
  const path = options.workspacePath ?? process.cwd();
  return (permission, tool) => {
    const check = checkWorkspacePermission({ path, tool: permission });
    return check.allowed ||
      (profile === "minimal" &&
        tool === "get_task" &&
        permission === "read" &&
        check.status.matched_root === null &&
        check.status.profile.preset === "restricted");
  };
}

function configuredProfileIsKnown(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return true;
  const normalized = value.trim().toLowerCase();
  return ACCESS_PROFILES.includes(normalized as AccessProfile) ||
    normalized === "readonly" ||
    normalized === "agent-safe";
}

export function createTodosAiToolSource(
  options: CreateTodosAiReadToolSourceOptions = {},
): TodosAiRuntimeToolSource {
  const adapter = resolveAdapter(options);
  const configuredProfile = options.env
    ? options.env["TODOS_PROFILE"] ?? env.profile()
    : env.profile();
  const profile = options.accessProfile ??
    resolveAccessProfile(configuredProfile ?? "minimal");
  const permission = resolvePermission(options, profile);
  const enabled = new Set<TodosAiReadToolName>(
    TODOS_AI_READ_TOOL_NAMES.filter((name) =>
      shouldRegisterToolForProfile(name, profile) &&
      permission(name === "get_task" ? "read" : "list", name)),
  );
  const hostAllowsUpdate = (options.accessProfile !== undefined ||
    configuredProfileIsKnown(configuredProfile)) &&
    shouldRegisterToolForProfile("update_task", profile) &&
    permission("write", "update_task");
  const approvalVerifier = options.approvalVerifier ?? adapter.verifyApproval;

  return ({ request }) => {
    const state: ReadToolState = {
      calls: 0,
      evidence: [],
      idempotency: new Map(),
      now: options.now ?? (() => new Date()),
    };
    return createTools(
      adapter,
      enabled,
      state,
      request,
      hostAllowsUpdate,
      approvalVerifier,
    );
  };
}

export const createTodosAiReadToolSource = createTodosAiToolSource;

function createTools(
  adapter: TodosAiReadAdapter,
  enabled: ReadonlySet<TodosAiReadToolName>,
  state: ReadToolState,
  request: TodosAiRunRequest,
  hostAllowsUpdate: boolean,
  approvalVerifier: CreateTodosAiReadToolSourceOptions["approvalVerifier"],
): TodosAiRuntimeTool[] {
  const tools: TodosAiRuntimeTool[] = [];
  if (enabled.has("get_task")) {
    tools.push({
      name: "get_task",
      description: "Read one Todos task by its stable identifier.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            minLength: 1,
            maxLength: TODOS_AI_READ_TOOL_LIMITS.max_identifier_bytes,
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      execute: (input) => executeGetTask(adapter, state, request, input),
    });
  }
  if (enabled.has("list_tasks")) {
    tools.push({
      name: "list_tasks",
      description: "List a bounded set of Todos tasks using read-only filters.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {
          project_id: boundedStringSchema(TODOS_AI_READ_TOOL_LIMITS.max_identifier_bytes),
          plan_id: boundedStringSchema(TODOS_AI_READ_TOOL_LIMITS.max_identifier_bytes),
          task_list_id: boundedStringSchema(TODOS_AI_READ_TOOL_LIMITS.max_identifier_bytes),
          assigned_to: boundedStringSchema(TODOS_AI_READ_TOOL_LIMITS.max_filter_string_bytes),
          status: { type: "string", enum: [...TASK_STATUSES] },
          priority: { type: "string", enum: [...TASK_PRIORITIES] },
          tags: {
            type: "array",
            maxItems: TODOS_AI_READ_TOOL_LIMITS.max_tags,
            items: boundedStringSchema(TODOS_AI_READ_TOOL_LIMITS.max_filter_string_bytes),
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: TODOS_AI_READ_TOOL_LIMITS.max_list_items,
            default: TODOS_AI_READ_TOOL_LIMITS.default_list_items,
          },
          offset: {
            type: "integer",
            minimum: 0,
            maximum: TODOS_AI_READ_TOOL_LIMITS.max_list_offset,
          },
        },
        additionalProperties: false,
      },
      execute: (input) => executeListTasks(adapter, state, request, input),
    });
  }
  if (enabled.has("list_projects")) {
    tools.push({
      name: "list_projects",
      description: "List a bounded set of Todos projects.",
      effect: "read",
      inputSchema: listOnlySchema(),
      execute: (input) => executeListProjects(adapter, state, request, input),
    });
  }
  if (enabled.has("list_plans")) {
    tools.push({
      name: "list_plans",
      description: "List a bounded set of Todos plans, optionally scoped to a project.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {
          project_id: boundedStringSchema(TODOS_AI_READ_TOOL_LIMITS.max_identifier_bytes),
          limit: {
            type: "integer",
            minimum: 1,
            maximum: TODOS_AI_READ_TOOL_LIMITS.max_list_items,
            default: TODOS_AI_READ_TOOL_LIMITS.default_list_items,
          },
          offset: {
            type: "integer",
            minimum: 0,
            maximum: TODOS_AI_READ_TOOL_LIMITS.max_list_offset,
          },
        },
        additionalProperties: false,
      },
      execute: (input) => executeListPlans(adapter, state, request, input),
    });
  }
  tools.push({
    name: "request_input",
    description: "Stop without mutation and request bounded clarification fields.",
    effect: "control",
    inputSchema: {
      type: "object",
      properties: {
        prompt: boundedStringSchema(TODOS_AI_CONTROL_TOOL_LIMITS.max_prompt_bytes),
        fields: {
          type: "array",
          minItems: 1,
          maxItems: TODOS_AI_CONTROL_TOOL_LIMITS.max_fields,
          items: boundedStringSchema(TODOS_AI_CONTROL_TOOL_LIMITS.max_field_bytes),
        },
      },
      required: ["prompt", "fields"],
      additionalProperties: false,
    },
    execute: (input) => executeRequestInput(state, input),
  });
  const authorityAllowsUpdate = request.authority.write_mode === "plan" ||
    (request.authority.write_mode === "execute" &&
      request.authority.approval_mode !== "deny");
  if (hostAllowsUpdate && authorityAllowsUpdate) {
    tools.push({
      name: "update_task",
      description: "Plan or execute one approved, version-checked update of one exact Todos task.",
      effect: "write",
      inputSchema: updateTaskInputSchema(),
      execute: (input, context) =>
        executeUpdateTask(
          adapter,
          approvalVerifier,
          state,
          request,
          input,
          context.signal,
        ),
    });
  }
  return tools;
}

function boundedStringSchema(maxLength: number): TodosAiJsonObject {
  return {
    type: "string",
    minLength: 1,
    maxLength,
  };
}

function listOnlySchema(): TodosAiJsonObject {
  return {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        minimum: 1,
        maximum: TODOS_AI_READ_TOOL_LIMITS.max_list_items,
        default: TODOS_AI_READ_TOOL_LIMITS.default_list_items,
      },
      offset: {
        type: "integer",
        minimum: 0,
        maximum: TODOS_AI_READ_TOOL_LIMITS.max_list_offset,
      },
    },
    additionalProperties: false,
  };
}

function updateTaskInputSchema(): TodosAiJsonObject {
  return {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
      },
      expected_version: {
        type: "integer",
        minimum: 0,
      },
      patch: {
        type: "object",
        minProperties: 1,
        properties: {
          title: boundedStringSchema(TODOS_AI_UPDATE_TASK_LIMITS.max_title_bytes),
          description: {
            type: "string",
            maxLength: TODOS_AI_UPDATE_TASK_LIMITS.max_description_bytes,
          },
          status: { type: "string", enum: [...TASK_STATUSES] },
          priority: { type: "string", enum: [...TASK_PRIORITIES] },
          assigned_to: {
            type: ["string", "null"],
            maxLength: TODOS_AI_UPDATE_TASK_LIMITS.max_assignee_bytes,
          },
          tags: {
            type: "array",
            maxItems: TODOS_AI_UPDATE_TASK_LIMITS.max_tags,
            items: boundedStringSchema(TODOS_AI_UPDATE_TASK_LIMITS.max_tag_bytes),
          },
          due_at: {
            type: ["string", "null"],
            maxLength: TODOS_AI_UPDATE_TASK_LIMITS.max_due_at_bytes,
          },
        },
        additionalProperties: false,
      },
      idempotency_key: {
        type: "string",
        minLength: TODOS_AI_UPDATE_TASK_LIMITS.min_idempotency_key_bytes,
        maxLength: TODOS_AI_UPDATE_TASK_LIMITS.max_idempotency_key_bytes,
        pattern: "^[A-Za-z0-9._:-]+$",
      },
    },
    required: ["task_id", "expected_version", "patch", "idempotency_key"],
    additionalProperties: false,
  };
}

interface NormalizedUpdateTaskInput {
  task_id: string;
  expected_version: number;
  patch: TodosAiJsonObject;
  changed_fields: UpdateTaskField[];
  idempotency_key: string;
  payload_digest: string;
  approval_ref: string;
}

export interface TodosAiUpdateTaskApprovalIdentityInput {
  task_id: string;
  expected_version: number;
  patch: TodosAiJsonObject;
}

export interface TodosAiUpdateTaskApprovalIdentity {
  ref: string;
  payload_digest: string;
}

export function deriveTodosAiUpdateTaskApprovalIdentity(
  input: TodosAiUpdateTaskApprovalIdentityInput,
): TodosAiUpdateTaskApprovalIdentity {
  if (!UUID_RE.test(input.task_id) || !Number.isSafeInteger(input.expected_version) ||
    input.expected_version < 0) {
    throw new Error("update_task approval identity requires an exact task UUID and version");
  }
  const patch = normalizeUpdatePatch(input.patch);
  const canonical = JSON.stringify({
    operation: "update_task",
    task_id: input.task_id,
    expected_version: input.expected_version,
    patch,
  });
  const payloadDigest = createHash("sha256").update(canonical).digest("hex");
  return {
    ref: `todos-ai:update_task:${payloadDigest}`,
    payload_digest: payloadDigest,
  };
}

function executeRequestInput(
  state: ReadToolState,
  input: unknown,
): never {
  beginCall(state);
  const record = assertInputObject(input, "request_input", ["prompt", "fields"]);
  const prompt = boundedRequiredString(
    record,
    "prompt",
    TODOS_AI_CONTROL_TOOL_LIMITS.max_prompt_bytes,
  );
  const rawFields = record["fields"];
  if (
    !Array.isArray(rawFields) ||
    rawFields.length === 0 ||
    rawFields.length > TODOS_AI_CONTROL_TOOL_LIMITS.max_fields
  ) {
    throw new Error(
      `fields must contain 1 to ${TODOS_AI_CONTROL_TOOL_LIMITS.max_fields} strings`,
    );
  }
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const [index, field] of rawFields.entries()) {
    if (
      typeof field !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(field) ||
      ENCODER.encode(field).byteLength > TODOS_AI_CONTROL_TOOL_LIMITS.max_field_bytes ||
      seen.has(field)
    ) {
      throw new Error(`fields[${index}] must be a unique bounded field name`);
    }
    seen.add(field);
    fields.push(field);
  }
  const redactedPrompt = truncateUtf8(
    redactEvidenceText(prompt),
    TODOS_AI_CONTROL_TOOL_LIMITS.max_prompt_bytes,
  );
  throw new TodosAiNeedsInputSignal({
    prompt: redactedPrompt || "Additional input is required.",
    fields,
  });
}

async function executeUpdateTask(
  adapter: TodosAiReadAdapter,
  approvalVerifier: CreateTodosAiReadToolSourceOptions["approvalVerifier"],
  state: ReadToolState,
  request: TodosAiRunRequest,
  input: unknown,
  signal: AbortSignal,
): Promise<TodosAiJsonObject> {
  beginCall(state);
  const normalized = normalizeUpdateTaskInput(input);
  const existing = state.idempotency.get(normalized.idempotency_key);
  if (existing) {
    if (existing.payload_digest !== normalized.payload_digest) {
      throw new Error("update_task idempotency key was reused with a different payload");
    }
    return replayUpdateTaskResult(await existing.promise);
  }

  const claim: UpdateTaskClaim = {
    payload_digest: normalized.payload_digest,
    mutation_started: false,
    promise: Promise.resolve({}),
  };
  claim.promise = performUpdateTask(
    adapter,
    approvalVerifier,
    state,
    request,
    normalized,
    signal,
    claim,
  );
  state.idempotency.set(normalized.idempotency_key, claim);
  try {
    return await claim.promise;
  } catch (error) {
    if (!claim.mutation_started) {
      state.idempotency.delete(normalized.idempotency_key);
    }
    throw error;
  }
}

async function performUpdateTask(
  adapter: TodosAiReadAdapter,
  approvalVerifier: CreateTodosAiReadToolSourceOptions["approvalVerifier"],
  state: ReadToolState,
  request: TodosAiRunRequest,
  normalized: NormalizedUpdateTaskInput,
  signal: AbortSignal,
  claim: UpdateTaskClaim,
): Promise<TodosAiJsonObject> {
  throwIfToolAborted(signal);
  const before = await adapter.getTask(normalized.task_id);
  throwIfToolAborted(signal);
  assertExactTaskVersion(before, normalized.task_id, normalized.expected_version);
  if (taskMatchesPatch(before!, normalized.patch)) {
    throw new Error("update_task patch does not change the authoritative task");
  }

  if (request.authority.write_mode === "plan") {
    return updateTaskResult(normalized, {
      mode: "plan",
      applied: false,
      readback_verified: false,
      result_version: null,
      replay: false,
      source: adapter.source,
    });
  }
  if (request.authority.write_mode !== "execute") {
    throw new Error("update_task is unavailable without plan or execute authority");
  }

  if (
    request.authority.approval_mode === "required" ||
    request.authority.approval_mode === "prompt"
  ) {
    throw new TodosAiNeedsApprovalSignal({
      id: normalized.approval_ref,
      summary: "Approve one exact version-checked task update.",
      operations: [approvalOperation(normalized)],
    });
  }
  if (request.authority.approval_mode !== "existing") {
    throw new Error("update_task execution requires a verified existing approval");
  }
  await verifyExistingApproval(
    approvalVerifier,
    request,
    normalized,
    state.now(),
  );
  if (!adapter.updateTask) {
    throw new Error("update_task is unavailable for the selected authority");
  }

  throwIfToolAborted(signal);
  claim.mutation_started = true;
  let updateFailure: unknown = null;
  try {
    await adapter.updateTask(
      normalized.task_id,
      {
        ...(normalized.patch as unknown as Omit<UpdateTaskInput, "version">),
        version: normalized.expected_version,
      },
    );
  } catch (error) {
    updateFailure = error;
  }

  const after = await adapter.getTask(normalized.task_id);
  if (
    after &&
    after.id === normalized.task_id &&
    after.version === normalized.expected_version + 1 &&
    taskMatchesPatch(after, normalized.patch)
  ) {
    return updateTaskResult(normalized, {
      mode: "execute",
      applied: true,
      readback_verified: true,
      result_version: after.version,
      replay: false,
      source: adapter.source,
    });
  }
  if (updateFailure !== null) {
    throw new Error("update_task mutation could not be reconciled by authoritative readback");
  }
  throw new Error("update_task authoritative readback did not verify the applied patch");
}

async function verifyExistingApproval(
  approvalVerifier: CreateTodosAiReadToolSourceOptions["approvalVerifier"],
  request: TodosAiRunRequest,
  normalized: NormalizedUpdateTaskInput,
  at: Date,
): Promise<void> {
  if (
    request.authority.approval_refs.length !== 1 ||
    request.authority.approval_refs[0] !== normalized.approval_ref
  ) {
    throw new Error("update_task approval reference does not match the exact operation");
  }
  if (!approvalVerifier) {
    throw new Error("update_task approval cannot be verified for the selected authority");
  }
  const verification = await approvalVerifier({
    ref: normalized.approval_ref,
    task_id: normalized.task_id,
    operation: "update_task",
    payload_digest: normalized.payload_digest,
  });
  if (
    !verification ||
    verification.ref !== normalized.approval_ref ||
    verification.task_id !== normalized.task_id ||
    verification.operation !== "update_task" ||
    verification.payload_digest !== normalized.payload_digest ||
    verification.status !== "approved"
  ) {
    throw new Error("update_task approval is missing, rejected, expired, or unverifiable");
  }
  if (verification.expires_at !== null) {
    const expiry = Date.parse(verification.expires_at);
    if (!Number.isFinite(expiry) || expiry <= at.getTime()) {
      throw new Error("update_task approval is expired or unverifiable");
    }
  }
}

function normalizeUpdateTaskInput(input: unknown): NormalizedUpdateTaskInput {
  const record = assertInputObject(input, "update_task", [
    "task_id",
    "expected_version",
    "patch",
    "idempotency_key",
  ]);
  const taskId = boundedRequiredString(
    record,
    "task_id",
    TODOS_AI_READ_TOOL_LIMITS.max_identifier_bytes,
  );
  if (!UUID_RE.test(taskId)) {
    throw new Error("task_id must be one exact task UUID");
  }
  const expectedVersion = boundedInteger(
    record,
    "expected_version",
    -1,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (!Object.hasOwn(record, "expected_version")) {
    throw new Error("expected_version is required");
  }
  const idempotencyKey = boundedRequiredString(
    record,
    "idempotency_key",
    TODOS_AI_UPDATE_TASK_LIMITS.max_idempotency_key_bytes,
  );
  const idempotencyBytes = ENCODER.encode(idempotencyKey).byteLength;
  if (
    idempotencyBytes < TODOS_AI_UPDATE_TASK_LIMITS.min_idempotency_key_bytes ||
    !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
  ) {
    throw new Error("idempotency_key must be a bounded stable identifier");
  }
  const patchValue = record["patch"];
  if (
    !isTodosAiJsonValue(patchValue) ||
    patchValue === null ||
    typeof patchValue !== "object" ||
    Array.isArray(patchValue)
  ) {
    throw new Error("patch must be a stable JSON object");
  }
  const patch = normalizeUpdatePatch(patchValue);
  const changedFields = Object.keys(patch) as UpdateTaskField[];
  const identity = deriveTodosAiUpdateTaskApprovalIdentity({
    task_id: taskId,
    expected_version: expectedVersion,
    patch,
  });
  return {
    task_id: taskId,
    expected_version: expectedVersion,
    patch,
    changed_fields: changedFields,
    idempotency_key: idempotencyKey,
    payload_digest: identity.payload_digest,
    approval_ref: identity.ref,
  };
}

function normalizeUpdatePatch(value: TodosAiJsonObject): TodosAiJsonObject {
  if (!isTodosAiJsonValue(value) || value === null || Array.isArray(value)) {
    throw new Error("patch must be a stable JSON object");
  }
  const allowed = new Set<string>(TODOS_AI_UPDATE_TASK_FIELDS);
  const supplied = Object.keys(value);
  if (supplied.length === 0) throw new Error("patch must contain at least one field");
  for (const key of supplied) {
    if (!allowed.has(key)) {
      throw new Error(`update_task patch contains unsupported field: ${key}`);
    }
  }

  const patch: TodosAiJsonObject = {};
  for (const field of TODOS_AI_UPDATE_TASK_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    const candidate = value[field];
    switch (field) {
      case "title":
        if (
          typeof candidate !== "string" ||
          candidate.trim().length === 0 ||
          ENCODER.encode(candidate).byteLength > TODOS_AI_UPDATE_TASK_LIMITS.max_title_bytes
        ) {
          throw new Error("patch.title must be a bounded non-empty string");
        }
        patch[field] = candidate;
        break;
      case "description":
        if (
          typeof candidate !== "string" ||
          ENCODER.encode(candidate).byteLength >
            TODOS_AI_UPDATE_TASK_LIMITS.max_description_bytes
        ) {
          throw new Error("patch.description must be a bounded string");
        }
        patch[field] = candidate;
        break;
      case "status":
        if (typeof candidate !== "string" || !TASK_STATUSES.includes(candidate as Task["status"])) {
          throw new Error(`patch.status must be one of: ${TASK_STATUSES.join(", ")}`);
        }
        patch[field] = candidate;
        break;
      case "priority":
        if (
          typeof candidate !== "string" ||
          !TASK_PRIORITIES.includes(candidate as Task["priority"])
        ) {
          throw new Error(`patch.priority must be one of: ${TASK_PRIORITIES.join(", ")}`);
        }
        patch[field] = candidate;
        break;
      case "assigned_to":
        if (
          candidate !== null &&
          (typeof candidate !== "string" ||
            ENCODER.encode(candidate).byteLength >
              TODOS_AI_UPDATE_TASK_LIMITS.max_assignee_bytes)
        ) {
          throw new Error("patch.assigned_to must be null or a bounded string");
        }
        patch[field] = candidate;
        break;
      case "tags": {
        if (!Array.isArray(candidate) || candidate.length > TODOS_AI_UPDATE_TASK_LIMITS.max_tags) {
          throw new Error(`patch.tags must contain at most ${TODOS_AI_UPDATE_TASK_LIMITS.max_tags} strings`);
        }
        const tags: string[] = [];
        const seen = new Set<string>();
        for (const [index, tag] of candidate.entries()) {
          if (
            typeof tag !== "string" ||
            tag.length === 0 ||
            ENCODER.encode(tag).byteLength > TODOS_AI_UPDATE_TASK_LIMITS.max_tag_bytes ||
            seen.has(tag)
          ) {
            throw new Error(`patch.tags[${index}] must be a unique bounded string`);
          }
          seen.add(tag);
          tags.push(tag);
        }
        patch[field] = tags;
        break;
      }
      case "due_at":
        if (
          candidate !== null &&
          (typeof candidate !== "string" ||
            ENCODER.encode(candidate).byteLength >
              TODOS_AI_UPDATE_TASK_LIMITS.max_due_at_bytes ||
            !Number.isFinite(Date.parse(candidate)))
        ) {
          throw new Error("patch.due_at must be null or a bounded ISO date-time");
        }
        patch[field] = candidate;
        break;
    }
  }
  return patch;
}

function assertExactTaskVersion(
  task: Task | null,
  taskId: string,
  expectedVersion: number,
): void {
  if (!task || task.id !== taskId) {
    throw new Error("update_task exact target was not found");
  }
  if (task.version !== expectedVersion) {
    throw new Error("update_task expected_version is stale");
  }
}

function taskMatchesPatch(task: Task, patch: TodosAiJsonObject): boolean {
  return Object.entries(patch).every(([field, expected]) => {
    const actual = task[field as keyof Task] as unknown;
    return Array.isArray(expected)
      ? Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected)
      : actual === expected;
  });
}

function approvalOperation(normalized: NormalizedUpdateTaskInput): TodosAiJsonObject {
  return {
    operation: "update_task",
    task_id: normalized.task_id,
    expected_version: normalized.expected_version,
    fields: normalized.changed_fields,
    payload_digest: normalized.payload_digest,
  };
}

function updateTaskResult(
  normalized: NormalizedUpdateTaskInput,
  result: {
    mode: "plan" | "execute";
    applied: boolean;
    readback_verified: boolean;
    result_version: number | null;
    replay: boolean;
    source: TodosAiReadAdapter["source"];
  },
): TodosAiJsonObject {
  const value: TodosAiJsonObject = {
    schema: TODOS_AI_UPDATE_TASK_RESULT_SCHEMA,
    operation: "update_task",
    mode: result.mode,
    applied: result.applied,
    readback_verified: result.readback_verified,
    source: result.source,
    target: {
      task_id: normalized.task_id,
      expected_version: normalized.expected_version,
      result_version: result.result_version,
    },
    changed_fields: normalized.changed_fields,
    approval_ref: normalized.approval_ref,
    payload_digest: normalized.payload_digest,
    idempotency: {
      key: normalized.idempotency_key,
      scope: "run",
      replay: result.replay,
    },
  };
  if (!isTodosAiUpdateTaskResult(value)) {
    throw new Error("update_task result does not satisfy its stable receipt contract");
  }
  return value;
}

function replayUpdateTaskResult(value: TodosAiJsonObject): TodosAiJsonObject {
  const idempotency = value["idempotency"];
  if (!idempotency || typeof idempotency !== "object" || Array.isArray(idempotency)) {
    throw new Error("update_task cached result is invalid");
  }
  const replayed: TodosAiJsonObject = {
    ...value,
    idempotency: {
      ...(idempotency as TodosAiJsonObject),
      replay: true,
    },
  };
  if (!isTodosAiUpdateTaskResult(replayed)) {
    throw new Error("update_task cached result is invalid");
  }
  return replayed;
}

function throwIfToolAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

function beginCall(state: ReadToolState): void {
  if (state.calls >= TODOS_AI_READ_TOOL_LIMITS.max_tool_calls) {
    throw new Error(
      `Todos AI tool-call limit of ${TODOS_AI_READ_TOOL_LIMITS.max_tool_calls} exceeded`,
    );
  }
  state.calls += 1;
}

function assertInputObject(
  input: unknown,
  tool: TodosAiToolName,
  allowed: readonly string[],
): Record<string, TodosAiJsonValue> {
  if (!isTodosAiJsonValue(input) || input === null || Array.isArray(input)) {
    throw new Error(`${tool} input must be a stable JSON object`);
  }
  const record = input as Record<string, TodosAiJsonValue>;
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) throw new Error(`${tool} input contains unsupported field: ${key}`);
  }
  return record;
}

function boundedRequiredString(
  record: Record<string, TodosAiJsonValue>,
  key: string,
  maximum: number,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  if (ENCODER.encode(value).byteLength > maximum) {
    throw new Error(`${key} exceeds ${maximum} bytes`);
  }
  return value;
}

function boundedOptionalString(
  record: Record<string, TodosAiJsonValue>,
  key: string,
  maximum: number,
): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  return boundedRequiredString(record, key, maximum);
}

function boundedInteger(
  record: Record<string, TodosAiJsonValue>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Object.hasOwn(record, key)) return fallback;
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

function boundedEnum<T extends readonly string[]>(
  record: Record<string, TodosAiJsonValue>,
  key: string,
  values: T,
): T[number] | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  if (typeof value !== "string" || !values.includes(value as T[number])) {
    throw new Error(`${key} must be one of: ${values.join(", ")}`);
  }
  return value as T[number];
}

function boundedTags(record: Record<string, TodosAiJsonValue>): string[] | undefined {
  if (!Object.hasOwn(record, "tags")) return undefined;
  const value = record["tags"];
  if (!Array.isArray(value) || value.length > TODOS_AI_READ_TOOL_LIMITS.max_tags) {
    throw new Error(`tags must contain at most ${TODOS_AI_READ_TOOL_LIMITS.max_tags} strings`);
  }
  return value.map((tag, index) => {
    if (typeof tag !== "string" || tag.length === 0) {
      throw new Error(`tags[${index}] must be a non-empty string`);
    }
    if (ENCODER.encode(tag).byteLength > TODOS_AI_READ_TOOL_LIMITS.max_filter_string_bytes) {
      throw new Error(
        `tags[${index}] exceeds ${TODOS_AI_READ_TOOL_LIMITS.max_filter_string_bytes} bytes`,
      );
    }
    return tag;
  });
}

async function executeGetTask(
  adapter: TodosAiReadAdapter,
  state: ReadToolState,
  request: TodosAiRunRequest,
  input: unknown,
): Promise<TodosAiJsonValue> {
  beginCall(state);
  const record = assertInputObject(input, "get_task", ["id"]);
  const id = boundedRequiredString(
    record,
    "id",
    TODOS_AI_READ_TOOL_LIMITS.max_identifier_bytes,
  );
  const task = await adapter.getTask(id);
  const item = task ? compactTask(task) : null;
  const evidence = task ? [taskEvidence(task)] : [];
  return boundedSingleResult(adapter.source, "get_task", item, evidence, state, request);
}

async function executeListTasks(
  adapter: TodosAiReadAdapter,
  state: ReadToolState,
  request: TodosAiRunRequest,
  input: unknown,
): Promise<TodosAiJsonValue> {
  beginCall(state);
  const record = assertInputObject(input, "list_tasks", [
    "project_id",
    "plan_id",
    "task_list_id",
    "assigned_to",
    "status",
    "priority",
    "tags",
    "limit",
    "offset",
  ]);
  const { limit, offset } = listWindow(record);
  const filter: TaskFilter = {
    limit: limit + 1,
    offset,
  };
  const projectId = boundedOptionalString(
    record,
    "project_id",
    TODOS_AI_READ_TOOL_LIMITS.max_identifier_bytes,
  );
  const planId = boundedOptionalString(
    record,
    "plan_id",
    TODOS_AI_READ_TOOL_LIMITS.max_identifier_bytes,
  );
  const taskListId = boundedOptionalString(
    record,
    "task_list_id",
    TODOS_AI_READ_TOOL_LIMITS.max_identifier_bytes,
  );
  const assignedTo = boundedOptionalString(
    record,
    "assigned_to",
    TODOS_AI_READ_TOOL_LIMITS.max_filter_string_bytes,
  );
  const status = boundedEnum(record, "status", TASK_STATUSES);
  const priority = boundedEnum(record, "priority", TASK_PRIORITIES);
  const tags = boundedTags(record);
  if (projectId !== undefined) filter.project_id = projectId;
  if (planId !== undefined) filter.plan_id = planId;
  if (taskListId !== undefined) filter.task_list_id = taskListId;
  if (assignedTo !== undefined) filter.assigned_to = assignedTo;
  if (status !== undefined) filter.status = status;
  if (priority !== undefined) filter.priority = priority;
  if (tags !== undefined) filter.tags = tags;

  const rows = await adapter.listTasks(filter);
  return boundedListResult(
    adapter.source,
    "list_tasks",
    rows.map(compactTask),
    rows.map(taskEvidence),
    limit,
    offset,
    state,
    request,
  );
}

async function executeListProjects(
  adapter: TodosAiReadAdapter,
  state: ReadToolState,
  request: TodosAiRunRequest,
  input: unknown,
): Promise<TodosAiJsonValue> {
  beginCall(state);
  const record = assertInputObject(input, "list_projects", ["limit", "offset"]);
  const { limit, offset } = listWindow(record);
  const rows = await adapter.listProjects();
  const window = rows.slice(offset, offset + limit + 1);
  return boundedListResult(
    adapter.source,
    "list_projects",
    window.map(compactProject),
    window.map(projectEvidence),
    limit,
    offset,
    state,
    request,
  );
}

async function executeListPlans(
  adapter: TodosAiReadAdapter,
  state: ReadToolState,
  request: TodosAiRunRequest,
  input: unknown,
): Promise<TodosAiJsonValue> {
  beginCall(state);
  const record = assertInputObject(input, "list_plans", [
    "project_id",
    "limit",
    "offset",
  ]);
  const { limit, offset } = listWindow(record);
  const projectId = boundedOptionalString(
    record,
    "project_id",
    TODOS_AI_READ_TOOL_LIMITS.max_identifier_bytes,
  );
  const rows = await adapter.listPlans(projectId);
  const window = rows.slice(offset, offset + limit + 1);
  return boundedListResult(
    adapter.source,
    "list_plans",
    window.map(compactPlan),
    window.map(planEvidence),
    limit,
    offset,
    state,
    request,
  );
}

function listWindow(
  record: Record<string, TodosAiJsonValue>,
): { limit: number; offset: number } {
  return {
    limit: boundedInteger(
      record,
      "limit",
      TODOS_AI_READ_TOOL_LIMITS.default_list_items,
      1,
      TODOS_AI_READ_TOOL_LIMITS.max_list_items,
    ),
    offset: boundedInteger(
      record,
      "offset",
      0,
      0,
      TODOS_AI_READ_TOOL_LIMITS.max_list_offset,
    ),
  };
}

function compactTask(task: Task): TodosAiJsonObject {
  if (!TASK_STATUSES.includes(task.status)) {
    throw new Error("Todos AI task result has an invalid status");
  }
  if (!TASK_PRIORITIES.includes(task.priority)) {
    throw new Error("Todos AI task result has an invalid priority");
  }
  return {
    id: boundedOutputText(task.id),
    short_id: boundedNullableOutputText(task.short_id),
    version: requiredNonNegativeInteger(task.version, "task version"),
    project_id: boundedNullableOutputText(task.project_id),
    parent_id: boundedNullableOutputText(task.parent_id),
    plan_id: boundedNullableOutputText(task.plan_id),
    task_list_id: boundedNullableOutputText(task.task_list_id),
    title: boundedOutputText(task.title),
    description: boundedNullableOutputText(task.description),
    status: task.status,
    priority: task.priority,
    assigned_to: boundedNullableOutputText(task.assigned_to),
    agent_id: boundedNullableOutputText(task.agent_id),
    tags: boundedOutputTags(task.tags),
    task_type: boundedNullableOutputText(task.task_type),
    created_by: boundedNullableOutputText(task.created_by),
    assigned_by: boundedNullableOutputText(task.assigned_by),
    created_at: boundedOutputText(task.created_at),
    updated_at: boundedOutputText(task.updated_at),
    started_at: boundedNullableOutputText(task.started_at),
    completed_at: boundedNullableOutputText(task.completed_at),
    due_at: boundedNullableOutputText(task.due_at),
  };
}

function compactProject(project: Project): TodosAiJsonObject {
  return {
    id: boundedOutputText(project.id),
    name: boundedOutputText(project.name),
    description: boundedNullableOutputText(project.description),
    task_list_id: boundedNullableOutputText(project.task_list_id),
    task_prefix: boundedNullableOutputText(project.task_prefix),
    created_at: boundedOutputText(project.created_at),
    updated_at: boundedOutputText(project.updated_at),
  };
}

function compactPlan(plan: Plan): TodosAiJsonObject {
  if (!PLAN_STATUSES.includes(plan.status)) {
    throw new Error("Todos AI plan result has an invalid status");
  }
  return {
    id: boundedOutputText(plan.id),
    slug: boundedNullableOutputText(plan.slug),
    project_id: boundedNullableOutputText(plan.project_id),
    task_list_id: boundedNullableOutputText(plan.task_list_id),
    agent_id: boundedNullableOutputText(plan.agent_id),
    name: boundedOutputText(plan.name),
    description: boundedNullableOutputText(plan.description),
    status: plan.status,
    created_at: boundedOutputText(plan.created_at),
    updated_at: boundedOutputText(plan.updated_at),
  };
}

function taskEvidence(task: Task): TodosAiJsonObject {
  return {
    resource: "task",
    id: boundedOutputText(task.id),
    version: requiredNonNegativeInteger(task.version, "task version"),
  };
}

function projectEvidence(project: Project): TodosAiJsonObject {
  return {
    resource: "project",
    id: boundedOutputText(project.id),
    version: boundedOutputText(project.updated_at),
  };
}

function planEvidence(plan: Plan): TodosAiJsonObject {
  return {
    resource: "plan",
    id: boundedOutputText(plan.id),
    version: boundedOutputText(plan.updated_at),
  };
}

function boundedOutputTags(tags: unknown): TodosAiJsonValue[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag): tag is string => typeof tag === "string")
    .slice(0, TODOS_AI_READ_TOOL_LIMITS.max_output_tags)
    .map(boundedOutputText);
}

function boundedNullableOutputText(value: unknown): string | null {
  return typeof value === "string" ? boundedOutputText(value) : null;
}

function boundedOutputText(value: string): string {
  return truncateUtf8(
    redactEvidenceText(value),
    TODOS_AI_READ_TOOL_LIMITS.max_output_string_bytes,
  );
}

function requiredNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Todos AI result has an invalid ${field}`);
  }
  return value as number;
}

function truncateUtf8(value: string, maximum: number): string {
  if (ENCODER.encode(value).byteLength <= maximum) return value;
  const suffix = "...";
  const suffixBytes = ENCODER.encode(suffix).byteLength;
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = ENCODER.encode(character).byteLength;
    if (bytes + characterBytes + suffixBytes > maximum) break;
    output += character;
    bytes += characterBytes;
  }
  return `${output}${suffix}`;
}

function boundedSingleResult(
  source: TodosAiReadAdapter["source"],
  tool: TodosAiReadToolName,
  item: TodosAiJsonObject | null,
  evidence: TodosAiJsonObject[],
  state: ReadToolState,
  request: TodosAiRunRequest,
): TodosAiJsonValue {
  const mergedEvidence = mergeEvidence(state.evidence, evidence);
  const result = redactValue({
    source,
    tool,
    item,
    evidence,
    context: runContext(request, state.calls, mergedEvidence),
  }) as TodosAiJsonObject;
  assertResultBound(result);
  state.evidence = mergedEvidence;
  return result;
}

function boundedListResult(
  source: TodosAiReadAdapter["source"],
  tool: TodosAiReadToolName,
  sourceItems: TodosAiJsonObject[],
  sourceEvidence: TodosAiJsonObject[],
  limit: number,
  offset: number,
  state: ReadToolState,
  request: TodosAiRunRequest,
): TodosAiJsonValue {
  const available = Math.min(sourceItems.length, sourceEvidence.length);
  let count = Math.min(limit, available);
  let truncated = available > count;
  while (count >= 0) {
    const items = sourceItems.slice(0, count);
    const evidence = sourceEvidence.slice(0, count);
    const mergedEvidence = mergeEvidence(state.evidence, evidence);
    const result = redactValue({
      source,
      tool,
      items,
      returned: items.length,
      offset,
      truncated,
      evidence,
      context: runContext(request, state.calls, mergedEvidence),
    }) as TodosAiJsonObject;
    if (serializedBytes(result) <= TODOS_AI_READ_TOOL_LIMITS.max_result_bytes) {
      state.evidence = mergedEvidence;
      return result;
    }
    count -= 1;
    truncated = true;
  }
  throw new Error("Todos AI read result could not be bounded");
}

function runContext(
  request: TodosAiRunRequest,
  calls: number,
  evidence: TodosAiJsonObject[],
): TodosAiJsonObject {
  return {
    project: boundedNullableOutputText(request.context.project),
    agent: boundedNullableOutputText(request.context.agent),
    session: boundedNullableOutputText(request.context.session),
    tool_calls: calls,
    evidence,
  };
}

function mergeEvidence(
  existing: readonly TodosAiJsonObject[],
  incoming: readonly TodosAiJsonObject[],
): TodosAiJsonObject[] {
  const merged: TodosAiJsonObject[] = [];
  const seen = new Set<string>();
  for (const pointer of [...existing, ...incoming]) {
    const key = JSON.stringify(pointer);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(pointer);
    if (merged.length >= TODOS_AI_READ_TOOL_LIMITS.max_evidence_pointers) break;
  }
  return merged;
}

function assertResultBound(value: TodosAiJsonValue): void {
  if (serializedBytes(value) > TODOS_AI_READ_TOOL_LIMITS.max_result_bytes) {
    throw new Error(
      `Todos AI read result exceeds ${TODOS_AI_READ_TOOL_LIMITS.max_result_bytes} bytes`,
    );
  }
}

function serializedBytes(value: TodosAiJsonValue): number {
  return ENCODER.encode(JSON.stringify(value)).byteLength;
}
