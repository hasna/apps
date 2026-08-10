import type {
  TodosAiErrorCode,
  TodosAiJsonObject,
  TodosAiJsonValue,
  TodosAiRunRequest,
  TodosAiRunStatus,
  TodosAiRuntime,
  TodosAiRuntimeHostContext,
  TodosAiRuntimeTool,
  TodosAiRuntimeToolExecutionContext,
  TodosAiRuntimeToolSource,
  TodosAiRuntimeToolSourceContext,
} from "@hasna/todos";

export const DEFAULT_TODOS_AI_PROVIDER = "groq" as const;
export const DEFAULT_TODOS_AI_MODEL = "openai/gpt-oss-120b" as const;
export const TODOS_AI_TRACE_SCHEMA_VERSION = 1 as const;

export const TODOS_AI_TRACE_PHASES = [
  "work.started",
  "tool.started",
  "tool.completed",
  "work.completed",
  "finalize.started",
  "finalize.completed",
  "terminal",
] as const;

export const TODOS_AI_TRACE_FIELDS = [
  "schema_version",
  "run_id",
  "provider",
  "model",
  "phase",
  "tool_name",
  "terminal_status",
  "error_code",
  "retryable",
  "elapsed_ms",
  "steps",
  "input_tokens",
  "output_tokens",
  "total_tokens",
] as const;

export const TODOS_AI_RUNTIME_LIMITS = {
  max_answer_bytes: 1_048_576,
  max_structured_bytes: 1_048_576,
  max_provider_prompt_bytes: 1_048_576,
  max_route_bytes: 128,
  max_events: 512,
  max_event_delta_bytes: 65_536,
  max_event_stream_bytes: 1_048_576,
  max_output_tokens: 2_048,
} as const;

export const TODOS_AI_TRACE_LIMITS = {
  max_elapsed_ms: 86_400_000,
  max_identifier_bytes: TODOS_AI_RUNTIME_LIMITS.max_route_bytes,
  max_token_count: Number.MAX_SAFE_INTEGER,
} as const;

export type TodosAiTracePhase = (typeof TODOS_AI_TRACE_PHASES)[number];

export interface TodosAiTraceRecord {
  schema_version: typeof TODOS_AI_TRACE_SCHEMA_VERSION;
  run_id: string;
  provider: string;
  model: string;
  phase: TodosAiTracePhase;
  tool_name: string | null;
  terminal_status: TodosAiRunStatus | null;
  error_code: TodosAiErrorCode | null;
  retryable: boolean | null;
  elapsed_ms: number;
  steps: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export type TodosAiTraceSink = (record: TodosAiTraceRecord) => void;

export type TodosAiTimeoutScheduler = (
  callback: () => void,
  timeoutMs: number,
) => () => void;

export interface TodosAiProviderUsage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
}

export type TodosAiToolExecutionContext = TodosAiRuntimeToolExecutionContext;
export type TodosAiTool = TodosAiRuntimeTool;

export interface TodosAiProviderWorkRequest {
  request: TodosAiRunRequest;
  prompt: string;
  signal: AbortSignal;
  maxSteps: number;
  stream: boolean;
  tools: TodosAiTool[];
  onTextDelta(delta: string): void;
}

export interface TodosAiProviderWorkResult {
  text: string;
  usage: TodosAiProviderUsage | null;
  steps: number;
}

export interface TodosAiProviderFinalizeRequest {
  request: TodosAiRunRequest;
  sourceText: string;
  schema: TodosAiJsonObject;
  signal: AbortSignal;
}

export interface TodosAiProviderFinalizeResult {
  data: TodosAiJsonValue;
  usage: TodosAiProviderUsage | null;
  steps: number;
}

export interface TodosAiProviderAdapter {
  runWork(request: TodosAiProviderWorkRequest): Promise<TodosAiProviderWorkResult>;
  finalize(request: TodosAiProviderFinalizeRequest): Promise<TodosAiProviderFinalizeResult>;
}

export interface TodosAiProviderSelection {
  provider: string;
  model: string;
  profile: string | null;
  signal: AbortSignal;
  context: TodosAiRuntimeHostContext;
}

export type TodosAiProviderLoader = (
  selection: TodosAiProviderSelection,
) => TodosAiProviderAdapter | PromiseLike<TodosAiProviderAdapter>;

export type TodosAiToolSourceContext = TodosAiRuntimeToolSourceContext;
export type TodosAiToolSource = TodosAiRuntimeToolSource;

export interface TodosAiRuntimeDependencies {
  providers: Record<string, TodosAiProviderLoader>;
  toolSource?: TodosAiToolSource;
  createRunId?: () => string;
  now?: () => Date;
  monotonicNow?: () => number;
  trace?: TodosAiTraceSink;
  scheduleTimeout?: TodosAiTimeoutScheduler;
}

export type TodosAiRuntimeFactory = (
  context: TodosAiRuntimeHostContext,
  dependencies: TodosAiRuntimeDependencies,
) => TodosAiRuntime;

export type TodosAiProviderErrorKind =
  | "missing_credentials"
  | "rate_limit"
  | "provider";

export class TodosAiProviderError extends Error {
  constructor(
    readonly kind: TodosAiProviderErrorKind,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(
      kind === "rate_limit"
        ? "AI provider rate limit"
        : kind === "missing_credentials"
          ? "AI provider credentials unavailable"
          : "AI provider failure",
      options,
    );
    this.name = "TodosAiProviderError";
  }
}

export class TodosAiToolError extends Error {
  constructor(options?: ErrorOptions) {
    super("Todos AI tool failure", options);
    this.name = "TodosAiToolError";
  }
}

export class TodosAiSchemaError extends Error {
  constructor(options?: ErrorOptions) {
    super("Todos AI structured output failure", options);
    this.name = "TodosAiSchemaError";
  }
}

export class TodosAiConfigurationError extends Error {
  constructor(
    readonly resultMessage: string,
    readonly detail: TodosAiJsonObject | null,
    options?: ErrorOptions,
  ) {
    super("Todos AI configuration failure", options);
    this.name = "TodosAiConfigurationError";
  }
}

export class TodosAiInternalError extends Error {
  constructor(options?: ErrorOptions) {
    super("Todos AI internal failure", options);
    this.name = "TodosAiInternalError";
  }
}
