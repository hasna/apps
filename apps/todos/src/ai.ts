export const TODOS_AI_SCHEMA_VERSION = 1 as const;
export const TODOS_AI_RUNTIME_PROTOCOL_VERSION = 1 as const;
export const TODOS_AI_RUNTIME_SPECIFIER = "@hasna/todos-ai/runtime" as const;
export const TODOS_AI_UPDATE_TASK_RESULT_SCHEMA = "todos.ai.update_task.v1" as const;

export const TODOS_AI_FORMATS = ["text", "json", "stream-json"] as const;
export const TODOS_AI_WRITE_MODES = ["read-only", "plan", "execute"] as const;
export const TODOS_AI_APPROVAL_MODES = ["deny", "required", "prompt", "existing"] as const;
export const TODOS_AI_RUN_STATUSES = [
  "answered",
  "needs_input",
  "needs_approval",
  "completed",
  "failed",
] as const;
export const TODOS_AI_RUNTIME_EVENT_TYPES = [
  "run.started",
  "run.progress",
  "text.delta",
  "tool.started",
  "tool.completed",
  "input.required",
  "approval.required",
] as const;
export const TODOS_AI_TOOL_EFFECTS = ["read", "control", "write"] as const;
export const TODOS_AI_UPDATE_TASK_FIELDS = [
  "title",
  "description",
  "status",
  "priority",
  "assigned_to",
  "tags",
  "due_at",
] as const;
export const TODOS_AI_UPDATE_TASK_LIMITS = {
  max_title_bytes: 1_024,
  max_description_bytes: 8_192,
  max_assignee_bytes: 256,
  max_tags: 16,
  max_tag_bytes: 128,
  max_due_at_bytes: 128,
  min_idempotency_key_bytes: 8,
  max_idempotency_key_bytes: 128,
  max_result_bytes: 65_536,
} as const;

export type TodosAiFormat = (typeof TODOS_AI_FORMATS)[number];
export type TodosAiWriteMode = (typeof TODOS_AI_WRITE_MODES)[number];
export type TodosAiApprovalMode = (typeof TODOS_AI_APPROVAL_MODES)[number];
export type TodosAiRunStatus = (typeof TODOS_AI_RUN_STATUSES)[number];
export type TodosAiRuntimeEventType = (typeof TODOS_AI_RUNTIME_EVENT_TYPES)[number];
export type TodosAiToolEffect = (typeof TODOS_AI_TOOL_EFFECTS)[number];
export type TodosAiUpdateTaskField = (typeof TODOS_AI_UPDATE_TASK_FIELDS)[number];

export type TodosAiJsonValue =
  | null
  | boolean
  | number
  | string
  | TodosAiJsonValue[]
  | { [key: string]: TodosAiJsonValue };
export type TodosAiJsonObject = { [key: string]: TodosAiJsonValue };

export const TODOS_AI_DEFAULTS = {
  format: "text" as TodosAiFormat,
  max_steps: 8,
  timeout_ms: 60_000,
  write_mode: "read-only" as TodosAiWriteMode,
} as const;

export const TODOS_AI_LIMITS = {
  max_prompt_bytes: 1_048_576,
  max_json_bytes: 1_048_576,
  max_result_bytes: 4_194_304,
  max_variable_count: 100,
  max_variable_value_bytes: 65_536,
  max_approval_refs: 32,
  max_approval_ref_bytes: 1_024,
  max_resume_run_id_bytes: 1_024,
  max_pending_input_prompt_bytes: 1_024,
  max_pending_input_fields: 16,
  max_pending_input_field_bytes: 128,
  max_pending_approval_id_bytes: 256,
  max_pending_approval_summary_bytes: 1_024,
  max_pending_approval_operations: 4,
  max_pending_approval_bytes: 8_192,
  max_stream_events: 1_000,
  max_stream_record_bytes: 262_144,
  max_stream_bytes: 8_388_608,
  min_steps: 1,
  max_steps: 20,
  min_timeout_ms: 1_000,
  max_timeout_ms: 600_000,
} as const;

export const TODOS_AI_EXIT_CODES = {
  success: 0,
  usage: 2,
  needs_input: 3,
  needs_approval: 4,
  runtime_unavailable: 5,
  failed: 6,
  timeout: 124,
  interrupted: 130,
} as const;

export type TodosAiExitCode = (typeof TODOS_AI_EXIT_CODES)[keyof typeof TODOS_AI_EXIT_CODES];

export const TODOS_AI_PROTOCOL = {
  schema_version: TODOS_AI_SCHEMA_VERSION,
  runtime_protocol_version: TODOS_AI_RUNTIME_PROTOCOL_VERSION,
  runtime_specifier: TODOS_AI_RUNTIME_SPECIFIER,
  formats: TODOS_AI_FORMATS,
  write_modes: TODOS_AI_WRITE_MODES,
  approval_modes: TODOS_AI_APPROVAL_MODES,
  statuses: TODOS_AI_RUN_STATUSES,
  event_types: TODOS_AI_RUNTIME_EVENT_TYPES,
  tool_effects: TODOS_AI_TOOL_EFFECTS,
  defaults: TODOS_AI_DEFAULTS,
  limits: TODOS_AI_LIMITS,
  exit_codes: TODOS_AI_EXIT_CODES,
} as const;

export type TodosAiProtocol = typeof TODOS_AI_PROTOCOL;

export type TodosAiErrorCode =
  | "invalid_input"
  | "invalid_configuration"
  | "runtime_unavailable"
  | "runtime_incompatible"
  | "runtime_invalid_result"
  | "needs_input"
  | "needs_approval"
  | "timeout"
  | "interrupted"
  | "provider_error"
  | "tool_error"
  | "schema_error"
  | "internal_error";

export interface TodosAiStoredConfig {
  provider?: string;
  model?: string;
  profile?: string;
  format?: TodosAiFormat;
  max_steps?: number;
  timeout_ms?: number;
  write_mode?: TodosAiWriteMode;
  approval_mode?: TodosAiApprovalMode;
}

export interface TodosAiCommandOverrides {
  provider?: string;
  model?: string;
  profile?: string;
  format?: string;
  maxSteps?: string | number;
  timeoutMs?: string | number;
  writeMode?: string;
  approvalMode?: string;
  approvalRefs?: string[];
  dryRun?: boolean;
}

export interface ResolveTodosAiCommandOptionsInput {
  cli?: TodosAiCommandOverrides;
  config?: TodosAiStoredConfig;
  env?: Record<string, string | undefined>;
  interactive: boolean;
}

export interface ResolvedTodosAiCommandOptions {
  provider: string | null;
  model: string | null;
  profile: string | null;
  format: TodosAiFormat;
  max_steps: number;
  timeout_ms: number;
  write_mode: TodosAiWriteMode;
  approval_mode: TodosAiApprovalMode;
  approval_refs: string[];
  dry_run: boolean;
  interactive: boolean;
}

export interface TodosAiRunRequest {
  schema_version: typeof TODOS_AI_SCHEMA_VERSION;
  prompt: string;
  input: TodosAiJsonValue;
  variables: Record<string, string>;
  output_schema: TodosAiJsonObject | null;
  provider: string | null;
  model: string | null;
  profile: string | null;
  format: TodosAiFormat;
  interactive: boolean;
  context: {
    project: string | null;
    agent: string | null;
    session: string | null;
  };
  authority: {
    write_mode: TodosAiWriteMode;
    approval_mode: TodosAiApprovalMode;
    approval_refs: string[];
    dry_run: boolean;
  };
  limits: {
    max_steps: number;
    timeout_ms: number;
  };
  resume_run_id: string | null;
}

export interface TodosAiUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface TodosAiPendingInput {
  prompt: string;
  fields: string[];
}

export interface TodosAiPendingApproval {
  id: string;
  summary: string;
  operations: TodosAiJsonObject[];
}

export interface TodosAiError {
  code: TodosAiErrorCode;
  message: string;
  retryable: boolean;
  details: TodosAiJsonObject | null;
}

export interface TodosAiRunResult {
  schema_version: typeof TODOS_AI_SCHEMA_VERSION;
  run_id: string;
  status: TodosAiRunStatus;
  answer: string | null;
  data: TodosAiJsonValue;
  steps: number;
  usage: TodosAiUsage | null;
  pending_input: TodosAiPendingInput | null;
  pending_approval: TodosAiPendingApproval | null;
  error: TodosAiError | null;
}

export interface TodosAiRuntimeEvent {
  schema_version: typeof TODOS_AI_SCHEMA_VERSION;
  run_id: string;
  sequence: number;
  type: TodosAiRuntimeEventType;
  timestamp: string;
  data: TodosAiJsonObject;
}

export type TodosAiStreamRecord =
  | {
      schema_version: typeof TODOS_AI_SCHEMA_VERSION;
      kind: "event";
      event: TodosAiRuntimeEvent;
    }
  | {
      schema_version: typeof TODOS_AI_SCHEMA_VERSION;
      kind: "result";
      result: TodosAiRunResult;
    };

export interface TodosAiRuntimeRunOptions {
  signal: AbortSignal;
  emit(event: TodosAiRuntimeEvent): void;
}

export interface TodosAiRuntime {
  run(request: TodosAiRunRequest, options: TodosAiRuntimeRunOptions): Promise<TodosAiRunResult>;
}

export interface TodosAiRuntimeToolExecutionContext {
  signal: AbortSignal;
  request: TodosAiRunRequest;
  toolCallId: string;
}

export interface TodosAiRuntimeTool {
  name: string;
  description: string;
  inputSchema: TodosAiJsonObject;
  effect?: TodosAiToolEffect;
  execute(
    input: unknown,
    context: TodosAiRuntimeToolExecutionContext,
  ): TodosAiJsonValue | PromiseLike<TodosAiJsonValue>;
}

export interface TodosAiRuntimeToolSourceContext {
  request: TodosAiRunRequest;
  signal: AbortSignal;
  context: TodosAiRuntimeHostContext;
}

export type TodosAiRuntimeToolSource = (
  context: TodosAiRuntimeToolSourceContext,
) => readonly TodosAiRuntimeTool[] | PromiseLike<readonly TodosAiRuntimeTool[]>;

export interface TodosAiRuntimeHostContext {
  package_name: "@hasna/todos";
  package_version: string;
  protocol_version: typeof TODOS_AI_RUNTIME_PROTOCOL_VERSION;
  tool_source?: TodosAiRuntimeToolSource;
}

export interface TodosAiRuntimeModule {
  TODOS_AI_RUNTIME_PROTOCOL_VERSION: typeof TODOS_AI_RUNTIME_PROTOCOL_VERSION;
  createTodosAiRuntime(context: TodosAiRuntimeHostContext): TodosAiRuntime | Promise<TodosAiRuntime>;
}

export type TodosAiRuntimeImporter = (specifier: string) => Promise<unknown>;

export class TodosAiContractError extends Error {
  constructor(
    readonly code: TodosAiErrorCode,
    message: string,
    readonly exitCode: TodosAiExitCode = TODOS_AI_EXIT_CODES.usage,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TodosAiContractError";
  }
}

export class TodosAiNeedsInputSignal extends Error {
  readonly pending_input: TodosAiPendingInput;

  constructor(pendingInput: TodosAiPendingInput) {
    if (!isTodosAiJsonValue(pendingInput) || !isPendingInput(pendingInput)) {
      throw new TodosAiContractError(
        "invalid_input",
        "Todos AI pending input must be bounded stable control data",
      );
    }
    super("Todos AI input required");
    this.name = "TodosAiNeedsInputSignal";
    this.pending_input = {
      prompt: pendingInput.prompt,
      fields: [...pendingInput.fields],
    };
  }
}

export class TodosAiNeedsApprovalSignal extends Error {
  readonly pending_approval: TodosAiPendingApproval;

  constructor(pendingApproval: TodosAiPendingApproval) {
    if (!isTodosAiJsonValue(pendingApproval) || !isPendingApproval(pendingApproval)) {
      throw new TodosAiContractError(
        "invalid_input",
        "Todos AI pending approval must be bounded stable control data",
      );
    }
    super("Todos AI approval required");
    this.name = "TodosAiNeedsApprovalSignal";
    this.pending_approval = {
      id: pendingApproval.id,
      summary: pendingApproval.summary,
      operations: pendingApproval.operations.map((operation) =>
        JSON.parse(JSON.stringify(operation)) as TodosAiJsonObject
      ),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function prototypeDefinesToJson(value: object): boolean {
  let prototype = Object.getPrototypeOf(value);
  while (prototype !== null) {
    if (Object.getOwnPropertyDescriptor(prototype, "toJSON") !== undefined) return true;
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

function isStableJsonArray(
  value: unknown[],
  ancestors: Set<object>,
  depth: number,
): value is TodosAiJsonValue[] {
  if (Object.getPrototypeOf(value) !== Array.prototype || prototypeDefinesToJson(value)) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) return false;
  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) return false;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
    if (!isTodosAiJsonValueInternal(descriptor.value, ancestors, depth + 1)) return false;
  }
  return true;
}

function isStableJsonObject(
  value: Record<string, unknown>,
  ancestors: Set<object>,
  depth: number,
): value is TodosAiJsonObject {
  if (!isJsonObject(value) || prototypeDefinesToJson(value)) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
    if (!isTodosAiJsonValueInternal(descriptor.value, ancestors, depth + 1)) return false;
  }
  return true;
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function selectedString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function parseEnum<T extends readonly string[]>(
  value: string | null,
  values: T,
  field: string,
  fallback: T[number],
): T[number] {
  if (value === null) return fallback;
  if (isOneOf(value, values)) return value;
  throw new TodosAiContractError(
    "invalid_configuration",
    `${field} must be one of: ${values.join(", ")}`,
  );
}

function parseBoundedInteger(
  value: string | number | null | undefined,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new TodosAiContractError(
      "invalid_configuration",
      `${field} must be an integer between ${min} and ${max}`,
    );
  }
  return parsed;
}

function normalizeApprovalRefs(values: readonly string[] | undefined): string[] {
  const refs = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  if (refs.length > TODOS_AI_LIMITS.max_approval_refs) {
    throw new TodosAiContractError(
      "invalid_configuration",
      `--approval may be repeated at most ${TODOS_AI_LIMITS.max_approval_refs} times`,
    );
  }
  for (const ref of refs) {
    if (new TextEncoder().encode(ref).byteLength > TODOS_AI_LIMITS.max_approval_ref_bytes) {
      throw new TodosAiContractError(
        "invalid_configuration",
        `--approval references may not exceed ${TODOS_AI_LIMITS.max_approval_ref_bytes} bytes`,
      );
    }
  }
  return refs;
}

export function resolveTodosAiCommandOptions(
  input: ResolveTodosAiCommandOptionsInput,
): ResolvedTodosAiCommandOptions {
  const cli = input.cli ?? {};
  const config = input.config ?? {};
  const env = input.env ?? {};
  // HASNA_TODOS_AI_FORMAT is canonical; legacy TODOS_AI_FORMAT is the alias.
  const envFormat = env["HASNA_TODOS_AI_FORMAT"] ?? env["TODOS_AI_FORMAT"];
  const format = parseEnum(
    selectedString(cli.format, envFormat, config.format),
    TODOS_AI_FORMATS,
    "format",
    TODOS_AI_DEFAULTS.format,
  );
  const configuredWriteMode = parseEnum(
    selectedString(cli.writeMode, env["TODOS_AI_WRITE_MODE"], config.write_mode),
    TODOS_AI_WRITE_MODES,
    "write mode",
    TODOS_AI_DEFAULTS.write_mode,
  );
  if (cli.dryRun && cli.writeMode === "execute") {
    throw new TodosAiContractError(
      "invalid_configuration",
      "--dry-run cannot be combined with --write-mode execute",
    );
  }
  const writeMode: TodosAiWriteMode = cli.dryRun ? "plan" : configuredWriteMode;
  const explicitApproval = cli.dryRun
    ? selectedString(cli.approvalMode)
    : selectedString(
        cli.approvalMode,
        env["TODOS_AI_APPROVAL_MODE"],
        config.approval_mode,
      );
  const defaultApproval: TodosAiApprovalMode = writeMode === "execute"
    ? input.interactive ? "prompt" : "required"
    : "deny";
  const approvalMode = cli.dryRun
    ? parseEnum(explicitApproval, TODOS_AI_APPROVAL_MODES, "approval mode", "deny")
    : parseEnum(
        explicitApproval,
        TODOS_AI_APPROVAL_MODES,
        "approval mode",
        defaultApproval,
      );
  const approvalRefs = normalizeApprovalRefs(cli.approvalRefs);

  if (cli.dryRun && approvalMode !== "deny") {
    throw new TodosAiContractError(
      "invalid_configuration",
      "--dry-run requires approval mode deny",
    );
  }
  if (writeMode !== "execute" && approvalMode !== "deny") {
    throw new TodosAiContractError(
      "invalid_configuration",
      "approval modes other than deny require --write-mode execute",
    );
  }
  if (writeMode === "execute" && approvalMode === "deny") {
    throw new TodosAiContractError(
      "invalid_configuration",
      "--write-mode execute requires approval mode required, prompt, or existing",
    );
  }
  if (!input.interactive && approvalMode === "prompt") {
    throw new TodosAiContractError(
      "invalid_configuration",
      "approval mode prompt is unavailable in non-interactive mode",
    );
  }
  if (approvalMode === "existing" && approvalRefs.length === 0) {
    throw new TodosAiContractError(
      "invalid_configuration",
      "approval mode existing requires at least one --approval reference",
    );
  }
  if (approvalMode !== "existing" && approvalRefs.length > 0) {
    throw new TodosAiContractError(
      "invalid_configuration",
      "--approval references require --approval-mode existing",
    );
  }

  return {
    provider: selectedString(cli.provider, env["TODOS_AI_PROVIDER"], config.provider),
    model: selectedString(cli.model, env["TODOS_AI_MODEL"], config.model),
    profile: selectedString(cli.profile, env["TODOS_AI_PROFILE"], config.profile),
    format,
    max_steps: parseBoundedInteger(
      cli.maxSteps ?? env["TODOS_AI_MAX_STEPS"] ?? config.max_steps,
      "max steps",
      TODOS_AI_DEFAULTS.max_steps,
      TODOS_AI_LIMITS.min_steps,
      TODOS_AI_LIMITS.max_steps,
    ),
    timeout_ms: parseBoundedInteger(
      cli.timeoutMs ?? env["TODOS_AI_TIMEOUT_MS"] ?? config.timeout_ms,
      "timeout",
      TODOS_AI_DEFAULTS.timeout_ms,
      TODOS_AI_LIMITS.min_timeout_ms,
      TODOS_AI_LIMITS.max_timeout_ms,
    ),
    write_mode: writeMode,
    approval_mode: approvalMode,
    approval_refs: approvalRefs,
    dry_run: cli.dryRun === true,
    interactive: input.interactive,
  };
}

export function normalizeTodosAiPrompt(value: string): string {
  const prompt = value.trim();
  if (new TextEncoder().encode(prompt).byteLength > TODOS_AI_LIMITS.max_prompt_bytes) {
    throw new TodosAiContractError(
      "invalid_input",
      `prompt exceeds ${TODOS_AI_LIMITS.max_prompt_bytes} bytes`,
    );
  }
  return prompt;
}

export function parseTodosAiJson(value: string, field: string): TodosAiJsonValue {
  if (new TextEncoder().encode(value).byteLength > TODOS_AI_LIMITS.max_json_bytes) {
    throw new TodosAiContractError(
      "invalid_input",
      `${field} exceeds ${TODOS_AI_LIMITS.max_json_bytes} bytes`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TodosAiContractError("invalid_input", `${field} must be valid JSON: ${detail}`);
  }
  if (!isTodosAiJsonValue(parsed)) {
    throw new TodosAiContractError(
      "invalid_input",
      `${field} must contain only stable JSON values`,
    );
  }
  return parsed;
}

export function parseTodosAiOutputSchema(value: string): TodosAiJsonObject {
  const parsed = parseTodosAiJson(value, "output schema");
  if (!isRecord(parsed)) {
    throw new TodosAiContractError("invalid_input", "output schema must be a JSON object");
  }
  return parsed as TodosAiJsonObject;
}

const SENSITIVE_VARIABLE_KEY = /(?:^|[_.-])(api[_-]?key|credential|password|secret|token)(?:$|[_.-])/i;

export function parseTodosAiVariables(values: readonly string[]): Record<string, string> {
  if (values.length > TODOS_AI_LIMITS.max_variable_count) {
    throw new TodosAiContractError(
      "invalid_input",
      `--var may be repeated at most ${TODOS_AI_LIMITS.max_variable_count} times`,
    );
  }
  const variables: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const entry of values) {
    const separator = entry.indexOf("=");
    const key = separator >= 0 ? entry.slice(0, separator).trim() : "";
    const value = separator >= 0 ? entry.slice(separator + 1) : "";
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key)) {
      throw new TodosAiContractError(
        "invalid_input",
        `invalid --var entry ${JSON.stringify(entry)}; expected non-secret key=value`,
      );
    }
    if (SENSITIVE_VARIABLE_KEY.test(key)) {
      throw new TodosAiContractError(
        "invalid_input",
        `--var ${key} is credential-shaped; provide credentials through the runtime's secret configuration`,
      );
    }
    if (Object.hasOwn(variables, key)) {
      throw new TodosAiContractError("invalid_input", `duplicate --var key: ${key}`);
    }
    if (new TextEncoder().encode(value).byteLength > TODOS_AI_LIMITS.max_variable_value_bytes) {
      throw new TodosAiContractError(
        "invalid_input",
        `--var ${key} exceeds ${TODOS_AI_LIMITS.max_variable_value_bytes} bytes`,
      );
    }
    variables[key] = value;
  }
  return variables;
}

export function isTodosAiJsonValue(value: unknown): value is TodosAiJsonValue {
  return isTodosAiJsonValueInternal(value, new Set<object>(), 0);
}

export function isTodosAiUpdateTaskResult(
  value: unknown,
): value is TodosAiJsonObject {
  if (
    !isTodosAiJsonValue(value) ||
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schema",
      "operation",
      "mode",
      "applied",
      "readback_verified",
      "source",
      "target",
      "changed_fields",
      "approval_ref",
      "payload_digest",
      "idempotency",
    ]) ||
    value["schema"] !== TODOS_AI_UPDATE_TASK_RESULT_SCHEMA ||
    value["operation"] !== "update_task" ||
    (value["mode"] !== "plan" && value["mode"] !== "execute") ||
    (value["source"] !== "sqlite" && value["source"] !== "http")
  ) {
    return false;
  }

  const changedFields = value["changed_fields"];
  const target = value["target"];
  const idempotency = value["idempotency"];
  const payloadDigest = value["payload_digest"];
  const approvalRef = value["approval_ref"];
  if (
    !Array.isArray(changedFields) ||
    changedFields.length === 0 ||
    changedFields.length > TODOS_AI_UPDATE_TASK_FIELDS.length ||
    !changedFields.every((field) =>
      typeof field === "string" &&
      TODOS_AI_UPDATE_TASK_FIELDS.includes(field as TodosAiUpdateTaskField)
    ) ||
    new Set(changedFields).size !== changedFields.length ||
    !TODOS_AI_UPDATE_TASK_FIELDS
      .filter((field) => changedFields.includes(field))
      .every((field, index) => changedFields[index] === field) ||
    !isRecord(target) ||
    !hasOnlyKeys(target, ["task_id", "expected_version", "result_version"]) ||
    typeof target["task_id"] !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      target["task_id"],
    ) ||
    !Number.isSafeInteger(target["expected_version"]) ||
    (target["expected_version"] as number) < 0 ||
    typeof payloadDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(payloadDigest) ||
    approvalRef !== `todos-ai:update_task:${payloadDigest}` ||
    !isRecord(idempotency) ||
    !hasOnlyKeys(idempotency, ["key", "scope", "replay"]) ||
    !boundedUtf8String(
      idempotency["key"],
      TODOS_AI_UPDATE_TASK_LIMITS.max_idempotency_key_bytes,
    ) ||
    new TextEncoder().encode(idempotency["key"]).byteLength <
      TODOS_AI_UPDATE_TASK_LIMITS.min_idempotency_key_bytes ||
    !/^[A-Za-z0-9._:-]+$/.test(idempotency["key"]) ||
    idempotency["scope"] !== "run" ||
    typeof idempotency["replay"] !== "boolean" ||
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
      TODOS_AI_UPDATE_TASK_LIMITS.max_result_bytes
  ) {
    return false;
  }

  if (value["mode"] === "plan") {
    return value["applied"] === false &&
      value["readback_verified"] === false &&
      target["result_version"] === null;
  }
  return value["applied"] === true &&
    value["readback_verified"] === true &&
    Number.isSafeInteger(target["result_version"]) &&
    target["result_version"] === (target["expected_version"] as number) + 1;
}

function isTodosAiJsonValueInternal(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
): value is TodosAiJsonValue {
  if (depth > 64) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? isStableJsonArray(value, ancestors, depth)
      : isStableJsonObject(value as Record<string, unknown>, ancestors, depth);
  } catch {
    return false;
  } finally {
    ancestors.delete(value);
  }
}

function isUsage(value: unknown): value is TodosAiUsage {
  if (!isRecord(value)) return false;
  return ["input_tokens", "output_tokens", "total_tokens"].every(
    (key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0,
  );
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && allowed.has(key),
  );
}

function boundedUtf8String(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    new TextEncoder().encode(value).byteLength <= maximum;
}

function isPendingInput(value: unknown): value is TodosAiPendingInput {
  if (!isRecord(value) || !hasOnlyKeys(value, ["prompt", "fields"])) return false;
  if (!boundedUtf8String(value["prompt"], TODOS_AI_LIMITS.max_pending_input_prompt_bytes)) {
    return false;
  }
  if (
    !Array.isArray(value["fields"]) ||
    value["fields"].length === 0 ||
    value["fields"].length > TODOS_AI_LIMITS.max_pending_input_fields
  ) {
    return false;
  }
  const fields = value["fields"];
  const unique = new Set<string>();
  for (const field of fields) {
    if (
      !boundedUtf8String(field, TODOS_AI_LIMITS.max_pending_input_field_bytes) ||
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(field) ||
      unique.has(field)
    ) {
      return false;
    }
    unique.add(field);
  }
  return true;
}

function isPendingApproval(value: unknown): value is TodosAiPendingApproval {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "summary", "operations"])) {
    return false;
  }
  if (
    !boundedUtf8String(value["id"], TODOS_AI_LIMITS.max_pending_approval_id_bytes) ||
    !boundedUtf8String(
      value["summary"],
      TODOS_AI_LIMITS.max_pending_approval_summary_bytes,
    ) ||
    !Array.isArray(value["operations"]) ||
    value["operations"].length === 0 ||
    value["operations"].length > TODOS_AI_LIMITS.max_pending_approval_operations ||
    !value["operations"].every(isRecord) ||
    !value["operations"].every(isTodosAiJsonValue)
  ) {
    return false;
  }
  return new TextEncoder().encode(JSON.stringify(value)).byteLength <=
    TODOS_AI_LIMITS.max_pending_approval_bytes;
}

function isAiError(value: unknown): value is TodosAiError {
  if (!isRecord(value)) return false;
  const code = value["code"];
  const validCode: TodosAiErrorCode[] = [
    "invalid_input",
    "invalid_configuration",
    "runtime_unavailable",
    "runtime_incompatible",
    "runtime_invalid_result",
    "needs_input",
    "needs_approval",
    "timeout",
    "interrupted",
    "provider_error",
    "tool_error",
    "schema_error",
    "internal_error",
  ];
  return typeof code === "string" &&
    validCode.includes(code as TodosAiErrorCode) &&
    typeof value["message"] === "string" &&
    typeof value["retryable"] === "boolean" &&
    (value["details"] === null || (isRecord(value["details"]) && isTodosAiJsonValue(value["details"])));
}

export function isTodosAiRunResult(value: unknown): value is TodosAiRunResult {
  if (!isRecord(value) || !isTodosAiJsonValue(value)) return false;
  const structurallyValid = value["schema_version"] === TODOS_AI_SCHEMA_VERSION &&
    typeof value["run_id"] === "string" &&
    Boolean(value["run_id"]) &&
    isOneOf(value["status"], TODOS_AI_RUN_STATUSES) &&
    (value["answer"] === null || typeof value["answer"] === "string") &&
    isTodosAiJsonValue(value["data"]) &&
    Number.isSafeInteger(value["steps"]) &&
    (value["steps"] as number) >= 0 &&
    (value["usage"] === null || isUsage(value["usage"])) &&
    (value["pending_input"] === null || isPendingInput(value["pending_input"])) &&
    (value["pending_approval"] === null || isPendingApproval(value["pending_approval"])) &&
    (value["error"] === null || isAiError(value["error"]));
  if (!structurallyValid) return false;

  switch (value["status"]) {
    case "answered":
      return typeof value["answer"] === "string" &&
        value["pending_input"] === null &&
        value["pending_approval"] === null &&
        value["error"] === null;
    case "completed":
      return isTodosAiUpdateTaskResult(value["data"]) &&
        value["data"]["mode"] === "execute" &&
        value["data"]["applied"] === true &&
        value["data"]["readback_verified"] === true &&
        value["pending_input"] === null &&
        value["pending_approval"] === null &&
        value["error"] === null;
    case "needs_input":
      return value["pending_input"] !== null &&
        value["pending_approval"] === null &&
        value["error"] === null;
    case "needs_approval":
      return value["pending_input"] === null &&
        value["pending_approval"] !== null &&
        value["error"] === null;
    case "failed":
      return value["pending_input"] === null &&
        value["pending_approval"] === null &&
        value["error"] !== null;
  }
  return false;
}

export function assertTodosAiRunResult(value: unknown): TodosAiRunResult {
  if (!isTodosAiRunResult(value)) {
    throw new TodosAiContractError(
      "runtime_invalid_result",
      "optional AI runtime returned a result that does not satisfy the Todos AI protocol",
      TODOS_AI_EXIT_CODES.failed,
    );
  }
  return value;
}

export function isTodosAiRuntimeEvent(value: unknown): value is TodosAiRuntimeEvent {
  if (!isRecord(value) || !isTodosAiJsonValue(value)) return false;
  return value["schema_version"] === TODOS_AI_SCHEMA_VERSION &&
    typeof value["run_id"] === "string" &&
    Boolean(value["run_id"]) &&
    Number.isSafeInteger(value["sequence"]) &&
    (value["sequence"] as number) >= 0 &&
    isOneOf(value["type"], TODOS_AI_RUNTIME_EVENT_TYPES) &&
    typeof value["timestamp"] === "string" &&
    isRecord(value["data"]) &&
    isTodosAiJsonValue(value["data"]);
}

export function assertTodosAiRuntimeModule(value: unknown): TodosAiRuntimeModule {
  if (!isRecord(value) ||
    value["TODOS_AI_RUNTIME_PROTOCOL_VERSION"] !== TODOS_AI_RUNTIME_PROTOCOL_VERSION ||
    typeof value["createTodosAiRuntime"] !== "function") {
    throw new TodosAiContractError(
      "runtime_incompatible",
      `optional AI runtime must implement protocol ${TODOS_AI_RUNTIME_PROTOCOL_VERSION}`,
      TODOS_AI_EXIT_CODES.runtime_unavailable,
    );
  }
  return value as unknown as TodosAiRuntimeModule;
}

function assertTodosAiRuntime(value: unknown): TodosAiRuntime {
  if (!isRecord(value) || typeof value["run"] !== "function") {
    throw new TodosAiContractError(
      "runtime_incompatible",
      `optional AI runtime must implement protocol ${TODOS_AI_RUNTIME_PROTOCOL_VERSION}`,
      TODOS_AI_EXIT_CODES.runtime_unavailable,
    );
  }
  return value as unknown as TodosAiRuntime;
}

const defaultTodosAiRuntimeImporter: TodosAiRuntimeImporter = async (specifier) => import(specifier);

export async function loadTodosAiRuntime(
  context: TodosAiRuntimeHostContext,
  importer: TodosAiRuntimeImporter = defaultTodosAiRuntimeImporter,
): Promise<TodosAiRuntime> {
  let imported: unknown;
  try {
    imported = await importer(TODOS_AI_RUNTIME_SPECIFIER);
  } catch (cause) {
    throw new TodosAiContractError(
      "runtime_unavailable",
      `optional AI runtime is unavailable; install a compatible ${TODOS_AI_RUNTIME_SPECIFIER}`,
      TODOS_AI_EXIT_CODES.runtime_unavailable,
      { cause },
    );
  }
  const runtimeModule = assertTodosAiRuntimeModule(imported);
  return assertTodosAiRuntime(await runtimeModule.createTodosAiRuntime(context));
}

export function createTodosAiFailureResult(
  runId: string,
  code: TodosAiErrorCode,
  message: string,
  retryable = false,
  details: TodosAiJsonObject | null = null,
): TodosAiRunResult {
  return {
    schema_version: TODOS_AI_SCHEMA_VERSION,
    run_id: runId,
    status: "failed",
    answer: null,
    data: null,
    steps: 0,
    usage: null,
    pending_input: null,
    pending_approval: null,
    error: { code, message, retryable, details },
  };
}

export function createTodosAiNeedsInputResult(runId: string, message: string): TodosAiRunResult {
  return {
    schema_version: TODOS_AI_SCHEMA_VERSION,
    run_id: runId,
    status: "needs_input",
    answer: null,
    data: null,
    steps: 0,
    usage: null,
    pending_input: { prompt: message, fields: ["prompt"] },
    pending_approval: null,
    error: null,
  };
}

export function createTodosAiNeedsApprovalResult(
  runId: string,
  pendingApproval: TodosAiPendingApproval,
): TodosAiRunResult {
  const signal = new TodosAiNeedsApprovalSignal(pendingApproval);
  return {
    schema_version: TODOS_AI_SCHEMA_VERSION,
    run_id: runId,
    status: "needs_approval",
    answer: null,
    data: null,
    steps: 0,
    usage: null,
    pending_input: null,
    pending_approval: signal.pending_approval,
    error: null,
  };
}

export function todosAiExitCodeForResult(result: TodosAiRunResult): TodosAiExitCode {
  if (result.status === "answered" || result.status === "completed") return TODOS_AI_EXIT_CODES.success;
  if (result.status === "needs_input") return TODOS_AI_EXIT_CODES.needs_input;
  if (result.status === "needs_approval") return TODOS_AI_EXIT_CODES.needs_approval;
  switch (result.error?.code) {
    case "invalid_input":
    case "invalid_configuration":
      return TODOS_AI_EXIT_CODES.usage;
    case "runtime_unavailable":
    case "runtime_incompatible":
      return TODOS_AI_EXIT_CODES.runtime_unavailable;
    case "timeout":
      return TODOS_AI_EXIT_CODES.timeout;
    case "interrupted":
      return TODOS_AI_EXIT_CODES.interrupted;
    default:
      return TODOS_AI_EXIT_CODES.failed;
  }
}
