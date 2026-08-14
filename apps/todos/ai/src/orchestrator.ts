import type {
  TodosAiErrorCode,
  TodosAiError,
  TodosAiJsonObject,
  TodosAiJsonValue,
  TodosAiRunRequest,
  TodosAiRunResult,
  TodosAiRuntime,
  TodosAiRuntimeEvent,
  TodosAiRuntimeEventType,
  TodosAiRuntimeHostContext,
  TodosAiUsage,
} from "@hasna/todos";
import {
  TODOS_AI_LIMITS,
  TodosAiNeedsApprovalSignal,
  TodosAiNeedsInputSignal,
  isTodosAiUpdateTaskResult,
  isTodosAiJsonValue,
} from "@hasna/todos";
import {
  DEFAULT_TODOS_AI_MODEL,
  DEFAULT_TODOS_AI_PROVIDER,
  TODOS_AI_RUNTIME_LIMITS,
  TODOS_AI_TRACE_LIMITS,
  TODOS_AI_TRACE_SCHEMA_VERSION,
  TodosAiConfigurationError,
  TodosAiInternalError,
  TodosAiProviderError,
  TodosAiSchemaError,
  TodosAiToolError,
  type TodosAiProviderUsage,
  type TodosAiRuntimeDependencies,
  type TodosAiTimeoutScheduler,
  type TodosAiTool,
  type TodosAiTracePhase,
  type TodosAiTraceRecord,
} from "./types";
import { normalizeTodosAiControlSignal } from "./control-signals";
import { compileTodosAiOutputSchema } from "./schema-validation";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TRUNCATED_SUFFIX = "\n[truncated]";

interface RunAbortScope {
  signal: AbortSignal;
  didTimeout(): boolean;
  dispose(): void;
}

type RunAbortCause = "parent" | "timeout";

interface EventWriter {
  emit(type: TodosAiRuntimeEventType, data?: TodosAiJsonObject): void;
  emitTextDelta(delta: string): void;
}

interface TraceWriter {
  setRoute(provider: string, model: string): void;
  emit(
    phase: Exclude<TodosAiTracePhase, "terminal">,
    toolName: string | null,
    steps: number,
    usage: TodosAiUsage | null,
  ): void;
  terminal(result: TodosAiRunResult): void;
}

interface ToolExecutionState {
  plan: TodosAiJsonObject | null;
  verifiedWrite: TodosAiJsonObject | null;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function utf8Prefix(value: string, maxBytes: number): string {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maxBytes) return value;
  let end = Math.max(0, maxBytes);
  while (end > 0 && (bytes[end] ?? 0) >> 6 === 0b10) {
    end -= 1;
  }
  return decoder.decode(bytes.subarray(0, end));
}

function boundText(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  const suffixBytes = byteLength(TRUNCATED_SUFFIX);
  return `${utf8Prefix(value, Math.max(0, maxBytes - suffixBytes))}${TRUNCATED_SUFFIX}`;
}

function selectedRoute(value: string, field: "provider" | "model"): string {
  const selected = value.trim();
  if (!selected || byteLength(selected) > TODOS_AI_RUNTIME_LIMITS.max_route_bytes) {
    throw new TodosAiConfigurationError(
      `The AI ${field} route is invalid.`,
      { field },
    );
  }
  return selected;
}

function boundedIdentifier(value: string, fallback: string): string {
  const selected = value.trim();
  if (!selected) return fallback;
  return boundText(selected, TODOS_AI_RUNTIME_LIMITS.max_route_bytes);
}

const defaultTimeoutScheduler: TodosAiTimeoutScheduler = (
  callback,
  timeoutMs,
) => {
  const timeout = setTimeout(callback, timeoutMs);
  return () => clearTimeout(timeout);
};

function createAbortScope(
  parent: AbortSignal,
  timeoutMs: number,
  scheduleTimeout: TodosAiTimeoutScheduler,
): RunAbortScope {
  const controller = new AbortController();
  let abortCause: RunAbortCause | null = null;
  const abort = (cause: RunAbortCause, reason: unknown) => {
    if (abortCause !== null) return;
    abortCause = cause;
    controller.abort(reason);
  };
  const abortFromParent = () => {
    abort("parent", parent.reason);
  };

  if (parent.aborted) {
    abortFromParent();
  } else {
    parent.addEventListener("abort", abortFromParent, { once: true });
  }

  const cancelTimeout = scheduleTimeout(() => {
    abort("timeout", new DOMException("Timed out", "TimeoutError"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => abortCause === "timeout",
    dispose() {
      cancelTimeout();
      parent.removeEventListener("abort", abortFromParent);
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function defaultRunId(): string {
  return `todos-ai-${crypto.randomUUID()}`;
}

function selectRunId(
  request: TodosAiRunRequest,
  createRunId: () => string,
): string {
  if (request.resume_run_id !== null) {
    if (
      request.resume_run_id.length === 0 ||
      byteLength(request.resume_run_id) > TODOS_AI_LIMITS.max_resume_run_id_bytes
    ) {
      throw new TodosAiConfigurationError(
        "The resume run identifier is invalid.",
        { field: "resume_run_id" },
      );
    }
    return request.resume_run_id;
  }
  return boundedIdentifier(createRunId(), "todos-ai-run");
}

function createEventWriter(
  runId: string,
  emit: (event: TodosAiRuntimeEvent) => void,
  now: () => Date,
): EventWriter {
  let sequence = 0;
  let eventBytes = 0;

  const write = (
    type: TodosAiRuntimeEventType,
    data: TodosAiJsonObject = {},
  ): void => {
    if (sequence >= TODOS_AI_RUNTIME_LIMITS.max_events) return;
    const event: TodosAiRuntimeEvent = {
      schema_version: 1,
      run_id: runId,
      sequence,
      type,
      timestamp: now().toISOString(),
      data,
    };
    try {
      emit(event);
    } catch (error) {
      throw new TodosAiInternalError({ cause: error });
    }
    sequence += 1;
  };

  return {
    emit: write,
    emitTextDelta(delta) {
      let remaining = delta;
      while (
        remaining.length > 0 &&
        sequence < TODOS_AI_RUNTIME_LIMITS.max_events &&
        eventBytes < TODOS_AI_RUNTIME_LIMITS.max_event_stream_bytes
      ) {
        const available = Math.min(
          TODOS_AI_RUNTIME_LIMITS.max_event_delta_bytes,
          TODOS_AI_RUNTIME_LIMITS.max_event_stream_bytes - eventBytes,
        );
        if (available <= 0) return;
        const chunk = utf8Prefix(remaining, available);
        if (!chunk) return;
        eventBytes += byteLength(chunk);
        write("text.delta", { delta: chunk });
        remaining = remaining.slice(chunk.length);
      }
    },
  };
}

const TRACE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const TRACE_SENSITIVE_IDENTIFIER =
  /(?:bearer|api[_-]?key|credential|password|private|secret|token)|^(?:sk[-_]|gh[pousr]_)/i;

function traceIdentifier(value: string, fallback: string): string {
  const selected = value.trim();
  if (
    !selected ||
    byteLength(selected) > TODOS_AI_TRACE_LIMITS.max_identifier_bytes ||
    !TRACE_IDENTIFIER.test(selected) ||
    TRACE_SENSITIVE_IDENTIFIER.test(selected)
  ) {
    return fallback;
  }
  return selected;
}

function monotonicValue(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);
}

function createTraceWriter(
  runId: string,
  initialProvider: string,
  initialModel: string,
  sink: TodosAiRuntimeDependencies["trace"],
  monotonicNow: () => number,
): TraceWriter {
  let provider = traceIdentifier(initialProvider, "unknown-provider");
  let model = traceIdentifier(initialModel, "unknown-model");
  const safeRunId = traceIdentifier(runId, "redacted-run");
  const start = sink === undefined ? 0 : monotonicValue(monotonicNow());
  let lastElapsed = 0;

  const elapsed = (): number => {
    if (sink === undefined) return 0;
    const current = monotonicValue(monotonicNow());
    const next = Math.min(
      Math.max(0, current - start),
      TODOS_AI_TRACE_LIMITS.max_elapsed_ms,
    );
    lastElapsed = Math.max(lastElapsed, next);
    return lastElapsed;
  };

  const write = (
    phase: TodosAiTracePhase,
    toolName: string | null,
    status: TodosAiRunResult["status"] | null,
    errorCode: TodosAiErrorCode | null,
    retryable: boolean | null,
    steps: number,
    usage: TodosAiUsage | null,
  ): void => {
    if (sink === undefined) return;
    const normalizedUsage = usage ?? {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };
    const record: TodosAiTraceRecord = {
      schema_version: TODOS_AI_TRACE_SCHEMA_VERSION,
      run_id: safeRunId,
      provider,
      model,
      phase,
      tool_name: toolName === null
        ? null
        : traceIdentifier(toolName, "unknown-tool"),
      terminal_status: status,
      error_code: errorCode,
      retryable,
      elapsed_ms: elapsed(),
      steps: normalizedCount(steps),
      input_tokens: normalizedCount(normalizedUsage.input_tokens),
      output_tokens: normalizedCount(normalizedUsage.output_tokens),
      total_tokens: normalizedCount(normalizedUsage.total_tokens),
    };
    try {
      sink(Object.freeze(record));
    } catch {
      // Observability consumers cannot change runtime authority or terminal state.
    }
  };

  return {
    setRoute(nextProvider, nextModel) {
      provider = traceIdentifier(nextProvider, "unknown-provider");
      model = traceIdentifier(nextModel, "unknown-model");
    },
    emit(phase, toolName, steps, usage) {
      write(phase, toolName, null, null, null, steps, usage);
    },
    terminal(result) {
      write(
        "terminal",
        null,
        result.status,
        result.error?.code ?? null,
        result.error?.retryable ?? null,
        result.steps,
        result.usage,
      );
    },
  };
}

function jsonClone(value: TodosAiJsonValue): TodosAiJsonValue {
  if (!isTodosAiJsonValue(value)) {
    throw new TodosAiInternalError();
  }
  const serialized = JSON.stringify(value);
  const parsed = JSON.parse(serialized) as TodosAiJsonValue;
  return parsed;
}

function serializeStructuredData(value: TodosAiJsonValue): string {
  if (!isTodosAiJsonValue(value)) {
    throw new TodosAiSchemaError();
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new TodosAiSchemaError({ cause: error });
  }
  if (serialized === undefined) {
    throw new TodosAiSchemaError();
  }
  if (byteLength(serialized) > TODOS_AI_RUNTIME_LIMITS.max_structured_bytes) {
    throw new TodosAiSchemaError();
  }
  return serialized;
}

function buildProviderPrompt(request: TodosAiRunRequest): string {
  const sections = [request.prompt];
  if (request.input !== null) {
    sections.push(`Input:\n${JSON.stringify(request.input)}`);
  }
  if (Object.keys(request.variables).length > 0) {
    sections.push(`Variables:\n${JSON.stringify(request.variables)}`);
  }
  if (request.context.project || request.context.agent || request.context.session) {
    sections.push(`Context:\n${JSON.stringify(request.context)}`);
  }
  return boundText(
    sections.join("\n\n"),
    TODOS_AI_RUNTIME_LIMITS.max_provider_prompt_bytes,
  );
}

function normalizeSteps(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new TodosAiInternalError();
  }
  return value;
}

function normalizedCount(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || (value ?? -1) < 0) return 0;
  return Math.min(value as number, TODOS_AI_TRACE_LIMITS.max_token_count);
}

function addCounts(left: number, right: number): number {
  if (
    left >= TODOS_AI_TRACE_LIMITS.max_token_count - right
  ) {
    return TODOS_AI_TRACE_LIMITS.max_token_count;
  }
  return left + right;
}

function normalizeUsage(value: TodosAiProviderUsage | null): TodosAiUsage | null {
  if (value === null) return null;
  const input = normalizedCount(value.inputTokens);
  const output = normalizedCount(value.outputTokens);
  const suppliedTotal = normalizedCount(value.totalTokens);
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: Math.max(suppliedTotal, addCounts(input, output)),
  };
}

function addUsage(
  left: TodosAiUsage | null,
  right: TodosAiUsage | null,
): TodosAiUsage | null {
  if (left === null) return right;
  if (right === null) return left;
  const input = addCounts(left.input_tokens, right.input_tokens);
  const output = addCounts(left.output_tokens, right.output_tokens);
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: Math.max(
      addCounts(left.total_tokens, right.total_tokens),
      addCounts(input, output),
    ),
  };
}

function emptyResult(runId: string): Omit<TodosAiRunResult, "status" | "error"> {
  return {
    schema_version: 1,
    run_id: runId,
    answer: null,
    data: null,
    steps: 0,
    usage: null,
    pending_input: null,
    pending_approval: null,
  };
}

function failedResult(
  runId: string,
  error: TodosAiError,
  steps = 0,
  usage: TodosAiUsage | null = null,
): TodosAiRunResult {
  return {
    ...emptyResult(runId),
    status: "failed",
    steps,
    usage,
    error,
  };
}

function pendingInputResult(
  runId: string,
  signal: TodosAiNeedsInputSignal,
  steps: number,
  usage: TodosAiUsage | null,
): TodosAiRunResult {
  return {
    ...emptyResult(runId),
    status: "needs_input",
    steps,
    usage,
    pending_input: signal.pending_input,
    error: null,
  };
}

function pendingApprovalResult(
  runId: string,
  signal: TodosAiNeedsApprovalSignal,
  steps: number,
  usage: TodosAiUsage | null,
): TodosAiRunResult {
  return {
    ...emptyResult(runId),
    status: "needs_approval",
    steps,
    usage,
    pending_approval: signal.pending_approval,
    error: null,
  };
}

function completedWriteResult(
  runId: string,
  receipt: TodosAiJsonObject,
  steps: number,
  usage: TodosAiUsage | null,
): TodosAiRunResult {
  const target = receipt["target"] as TodosAiJsonObject;
  return {
    ...emptyResult(runId),
    status: "completed",
    answer: `Updated task ${target["task_id"] as string}.`,
    data: receipt,
    steps,
    usage,
    error: null,
  };
}

function mapFailure(
  runId: string,
  error: unknown,
  abortScope: RunAbortScope,
  parentSignal: AbortSignal,
  provider: string,
  steps: number,
  usage: TodosAiUsage | null,
): TodosAiRunResult {
  if (abortScope.didTimeout()) {
    return failedResult(runId, {
      code: "timeout",
      message: "The Todos AI run timed out.",
      retryable: true,
      details: null,
    }, steps, usage);
  }
  if (parentSignal.aborted || abortScope.signal.aborted) {
    return failedResult(runId, {
      code: "interrupted",
      message: "The Todos AI run was interrupted.",
      retryable: false,
      details: null,
    }, steps, usage);
  }
  if (error instanceof TodosAiConfigurationError) {
    return failedResult(runId, {
      code: "invalid_configuration",
      message: error.resultMessage,
      retryable: false,
      details: error.detail,
    }, steps, usage);
  }
  if (error instanceof TodosAiProviderError) {
    if (error.kind === "missing_credentials") {
      return failedResult(runId, {
        code: "provider_error",
        message: "The AI provider is unavailable because credentials are not configured.",
        retryable: false,
        details: {
          kind: "missing_credentials",
          provider,
        },
        }, steps, usage);
    }
    if (error.kind === "credentials_rejected") {
      return failedResult(runId, {
        code: "provider_error",
        message: "The AI provider rejected the configured credentials.",
        retryable: false,
        details: {
          kind: "credentials_rejected",
          provider,
        },
      }, steps, usage);
    }
    return failedResult(runId, {
      code: "provider_error",
      message: error.kind === "rate_limit"
        ? "The AI provider rate-limited the request."
        : "The AI provider request failed.",
      retryable: error.retryable,
      details: { kind: error.kind },
    }, steps, usage);
  }
  if (error instanceof TodosAiToolError) {
    return failedResult(runId, {
      code: "tool_error",
      message: "A Todos AI tool failed.",
      retryable: false,
      details: null,
    }, steps, usage);
  }
  if (error instanceof TodosAiSchemaError) {
    return failedResult(runId, {
      code: "schema_error",
      message: "The AI provider could not produce output matching the requested schema.",
      retryable: false,
      details: null,
    }, steps, usage);
  }
  if (error instanceof TodosAiInternalError) {
    return failedResult(runId, {
      code: "internal_error",
      message: "The Todos AI runtime failed safely.",
      retryable: false,
      details: null,
    }, steps, usage);
  }
  return failedResult(runId, {
    code: "provider_error",
    message: "The AI provider request failed.",
    retryable: false,
    details: { kind: "provider" },
  }, steps, usage);
}

function wrapTools(
  tools: readonly TodosAiTool[],
  request: TodosAiRunRequest,
  signal: AbortSignal,
  events: EventWriter,
  traces: TraceWriter,
  state: ToolExecutionState,
): TodosAiTool[] {
  const names = new Set<string>();
  return tools.map((definition) => {
    if (!definition.name || names.has(definition.name)) {
      throw new TodosAiInternalError();
    }
    names.add(definition.name);
    const toolName = boundedIdentifier(definition.name, "tool");
    if (toolName !== definition.name) {
      throw new TodosAiInternalError();
    }
    return {
      ...definition,
      name: toolName,
      async execute(input, context) {
        throwIfAborted(signal);
        const callId = boundedIdentifier(context.toolCallId, "tool-call");
        let completionEmitted = false;
        events.emit("tool.started", {
          tool: toolName,
          call_id: callId,
        });
        traces.emit("tool.started", toolName, 0, null);
        try {
          const result = await definition.execute(input, {
            request,
            signal,
            toolCallId: callId,
          });
          const normalized = jsonClone(result);
          recordToolEffect(definition, normalized, request, state);
          events.emit("tool.completed", {
            tool: toolName,
            call_id: callId,
            ok: true,
          });
          traces.emit("tool.completed", toolName, 0, null);
          completionEmitted = true;
          throwIfAborted(signal);
          return normalized;
        } catch (error) {
          if (!completionEmitted) {
            events.emit("tool.completed", {
              tool: toolName,
              call_id: callId,
              ok: false,
            });
            traces.emit("tool.completed", toolName, 0, null);
          }
          if (signal.aborted) throw error;
          const controlSignal = normalizeTodosAiControlSignal(error);
          if (controlSignal !== null) throw controlSignal;
          if (error instanceof TodosAiToolError) throw error;
          throw new TodosAiToolError({ cause: error });
        }
      },
    };
  });
}

function recordToolEffect(
  definition: TodosAiTool,
  result: TodosAiJsonValue,
  request: TodosAiRunRequest,
  state: ToolExecutionState,
): void {
  if (definition.effect !== "write") return;
  if (
    definition.name !== "update_task" ||
    !isTodosAiUpdateTaskResult(result)
  ) {
    throw new TodosAiInternalError();
  }
  if (result["mode"] === "plan") {
    if (
      request.authority.write_mode !== "plan" ||
      request.authority.approval_mode !== "deny" ||
      result["applied"] !== false ||
      result["readback_verified"] !== false
    ) {
      throw new TodosAiInternalError();
    }
    state.plan = result;
    return;
  }
  if (
    request.authority.write_mode !== "execute" ||
    request.authority.approval_mode !== "existing" ||
    request.authority.approval_refs.length !== 1 ||
    request.authority.approval_refs[0] !== result["approval_ref"] ||
    result["applied"] !== true ||
    result["readback_verified"] !== true
  ) {
    throw new TodosAiInternalError();
  }
  state.verifiedWrite = result;
}

export function createTodosAiOrchestrator(
  context: TodosAiRuntimeHostContext,
  dependencies: TodosAiRuntimeDependencies,
): TodosAiRuntime {
  const createRunId = dependencies.createRunId ?? defaultRunId;
  const now = dependencies.now ?? (() => new Date());
  const monotonicNow = dependencies.monotonicNow ??
    (() => globalThis.performance.now());
  const scheduleTimeout = dependencies.scheduleTimeout ??
    defaultTimeoutScheduler;
  const toolSource = dependencies.toolSource ?? (() => []);

  return {
    async run(request, options) {
      let runId = "todos-ai-run";
      let runIdFailure: unknown = null;
      try {
        runId = selectRunId(request, createRunId);
      } catch (error) {
        runIdFailure = error;
      }
      const abortScope = createAbortScope(
        options.signal,
        request.limits.timeout_ms,
        scheduleTimeout,
      );
      const events = createEventWriter(runId, options.emit, now);
      let completedSteps = 0;
      let usage: TodosAiUsage | null = null;
      let provider: string = request.provider ?? DEFAULT_TODOS_AI_PROVIDER;
      let model: string = request.model ?? DEFAULT_TODOS_AI_MODEL;
      const traces = createTraceWriter(
        runId,
        provider,
        model,
        dependencies.trace,
        monotonicNow,
      );
      const finish = (result: TodosAiRunResult): TodosAiRunResult => {
        traces.terminal(result);
        return result;
      };
      const toolState: ToolExecutionState = {
        plan: null,
        verifiedWrite: null,
      };

      try {
        events.emit("run.started");
        if (runIdFailure !== null) throw runIdFailure;
        throwIfAborted(abortScope.signal);

        provider = selectedRoute(
          request.provider ?? DEFAULT_TODOS_AI_PROVIDER,
          "provider",
        );
        model = selectedRoute(
          request.model ?? DEFAULT_TODOS_AI_MODEL,
          "model",
        );
        traces.setRoute(provider, model);
        const loader = Object.hasOwn(dependencies.providers, provider)
          ? dependencies.providers[provider]
          : undefined;
        if (typeof loader !== "function") {
          throw new TodosAiConfigurationError(
            "Unsupported AI provider.",
            { provider },
          );
        }
        if (request.output_schema !== null && request.limits.max_steps < 2) {
          throw new TodosAiConfigurationError(
            "Structured output requires at least two AI steps.",
            { requirement: "schema_finalizer_step" },
          );
        }
        const validateStructuredData = request.output_schema === null
          ? null
          : compileTodosAiOutputSchema(request.output_schema);

        const providerAdapter = await loader({
          provider,
          model,
          profile: request.profile,
          signal: abortScope.signal,
          context,
        });
        throwIfAborted(abortScope.signal);

        const tools = wrapTools(
          await toolSource({
            request,
            signal: abortScope.signal,
            context,
          }),
          request,
          abortScope.signal,
          events,
          traces,
          toolState,
        );
        throwIfAborted(abortScope.signal);

        events.emit("run.progress", { phase: "work" });
        traces.emit("work.started", null, completedSteps, usage);
        const workStepLimit = request.output_schema === null
          ? request.limits.max_steps
          : request.limits.max_steps - 1;
        const work = await providerAdapter.runWork({
          request,
          prompt: buildProviderPrompt(request),
          signal: abortScope.signal,
          maxSteps: workStepLimit,
          stream: request.format === "stream-json",
          tools,
          onTextDelta(delta) {
            if (request.format === "stream-json") {
              events.emitTextDelta(delta);
            }
          },
        });
        throwIfAborted(abortScope.signal);
        completedSteps = normalizeSteps(work.steps, workStepLimit);
        usage = normalizeUsage(work.usage);
        traces.emit("work.completed", null, completedSteps, usage);

        if (toolState.verifiedWrite !== null) {
          return finish(completedWriteResult(
            runId,
            toolState.verifiedWrite,
            completedSteps,
            usage,
          ));
        }

        let answer = boundText(
          work.text,
          TODOS_AI_RUNTIME_LIMITS.max_answer_bytes,
        );
        let data: TodosAiJsonValue = toolState.plan;

        if (request.output_schema !== null) {
          events.emit("run.progress", { phase: "finalize" });
          traces.emit("finalize.started", null, completedSteps, usage);
          const finalized = await providerAdapter.finalize({
            request,
            sourceText: answer,
            schema: request.output_schema,
            signal: abortScope.signal,
          });
          throwIfAborted(abortScope.signal);
          const finalizerSteps = normalizeSteps(finalized.steps, 1);
          completedSteps += finalizerSteps;
          usage = addUsage(usage, normalizeUsage(finalized.usage));
          answer = serializeStructuredData(finalized.data);
          validateStructuredData?.(finalized.data);
          data = finalized.data;
          traces.emit("finalize.completed", null, completedSteps, usage);
        }

        return finish({
          schema_version: 1,
          run_id: runId,
          status: "answered",
          answer,
          data,
          steps: completedSteps,
          usage,
          pending_input: null,
          pending_approval: null,
          error: null,
        });
      } catch (error) {
        if (toolState.verifiedWrite !== null) {
          return finish(completedWriteResult(
            runId,
            toolState.verifiedWrite,
            completedSteps,
            usage,
          ));
        }
        const controlSignal = normalizeTodosAiControlSignal(error);
        if (
          !abortScope.didTimeout() &&
          !options.signal.aborted &&
          controlSignal instanceof TodosAiNeedsInputSignal
        ) {
          events.emit("input.required", {
            prompt: controlSignal.pending_input.prompt,
            fields: controlSignal.pending_input.fields,
          });
          return finish(
            pendingInputResult(runId, controlSignal, completedSteps, usage),
          );
        }
        if (
          !abortScope.didTimeout() &&
          !options.signal.aborted &&
          controlSignal instanceof TodosAiNeedsApprovalSignal
        ) {
          events.emit("approval.required", {
            id: controlSignal.pending_approval.id,
            summary: controlSignal.pending_approval.summary,
            operations: controlSignal.pending_approval.operations,
          });
          return finish(
            pendingApprovalResult(runId, controlSignal, completedSteps, usage),
          );
        }
        return finish(mapFailure(
          runId,
          error,
          abortScope,
          options.signal,
          provider,
          completedSteps,
          usage,
        ));
      } finally {
        abortScope.dispose();
      }
    },
  };
}
