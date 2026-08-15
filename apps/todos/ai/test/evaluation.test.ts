import { describe, expect, test } from "bun:test";
import {
  TodosAiNeedsApprovalSignal,
  TodosAiNeedsInputSignal,
  type TodosAiJsonObject,
  type TodosAiRunRequest,
  type TodosAiRunResult,
  type TodosAiRuntimeHostContext,
} from "@hasna/todos";
import {
  TODOS_AI_EVALUATION_CORPUS,
  TODOS_AI_EVALUATION_LANES,
  TODOS_AI_EVALUATION_PRIVATE_MARKERS,
  TODOS_AI_TRACE_FIELDS,
  TODOS_AI_TRACE_LIMITS,
  TODOS_AI_TRACE_SCHEMA_VERSION,
  TodosAiInternalError,
  TodosAiProviderError,
  TodosAiSchemaError,
  evaluateTodosAiEvaluationObservation,
  runTodosAiEvaluationCorpus,
  runTodosAiEvaluationFixture,
  type TodosAiEvaluationObservation,
  type TodosAiProviderAdapter,
  type TodosAiTraceRecord,
} from "../src/index";
import { createTodosAiRuntimeWithDependencies } from "../src/runtime";

const EXPECTED_LANES = [
  "read",
  "plan",
  "clarification",
  "approval",
  "denial",
  "write",
  "structured_output",
  "injection",
  "provider_error",
  "cancellation",
  "redaction",
] as const;

const HOST_CONTEXT: TodosAiRuntimeHostContext = {
  package_name: "@hasna/todos",
  package_version: "0.15.21",
  protocol_version: 1,
};

function request(overrides: Partial<TodosAiRunRequest> = {}): TodosAiRunRequest {
  return {
    schema_version: 1,
    prompt: "Evaluate the Todos AI runtime.",
    input: null,
    variables: {},
    output_schema: null,
    provider: "fixture",
    model: "fixture/model-v1",
    profile: null,
    format: "text",
    interactive: false,
    context: {
      project: null,
      agent: null,
      session: null,
    },
    authority: {
      write_mode: "read-only",
      approval_mode: "deny",
      approval_refs: [],
      dry_run: false,
    },
    limits: {
      max_steps: 4,
      timeout_ms: 60_000,
    },
    resume_run_id: null,
    ...overrides,
  };
}

function adapter(
  overrides: Partial<TodosAiProviderAdapter> = {},
): TodosAiProviderAdapter {
  return {
    async runWork() {
      return {
        text: "Done.",
        usage: {
          inputTokens: 2,
          outputTokens: 1,
          totalTokens: 3,
        },
        steps: 1,
      };
    },
    async finalize() {
      return {
        data: { ok: true },
        usage: {
          inputTokens: 2,
          outputTokens: 1,
          totalTokens: 3,
        },
        steps: 1,
      };
    },
    ...overrides,
  };
}

async function runRuntime(
  runtime: ReturnType<typeof createTodosAiRuntimeWithDependencies>,
  runRequest: TodosAiRunRequest,
  signal: AbortSignal = new AbortController().signal,
): Promise<TodosAiRunResult> {
  return await runtime.run(runRequest, {
    signal,
    emit() {},
  });
}

describe("deterministic evaluation corpus", () => {
  test("exports all eleven exact named lanes with stable explicit invariants", () => {
    expect([...TODOS_AI_EVALUATION_LANES]).toEqual([...EXPECTED_LANES]);
    expect(TODOS_AI_EVALUATION_CORPUS.map((fixture) => fixture.lane))
      .toEqual([...EXPECTED_LANES]);
    expect(new Set(TODOS_AI_EVALUATION_CORPUS.map((fixture) => fixture.id)).size)
      .toBe(EXPECTED_LANES.length);
    expect(new Set(TODOS_AI_EVALUATION_CORPUS.map((fixture) => fixture.name)).size)
      .toBe(EXPECTED_LANES.length);
    expect(new Set(TODOS_AI_EVALUATION_PRIVATE_MARKERS).size)
      .toBe(TODOS_AI_EVALUATION_PRIVATE_MARKERS.length);
    expect(TODOS_AI_EVALUATION_PRIVATE_MARKERS.some(
      (marker) => /^Bearer\s+\S+$/.test(marker),
    )).toBe(true);
    expect(TODOS_AI_EVALUATION_PRIVATE_MARKERS.some(
      (marker) => /^api_key=\S+$/.test(marker),
    )).toBe(true);

    for (const fixture of TODOS_AI_EVALUATION_CORPUS) {
      expect(fixture.id).toMatch(/^todos-ai-eval-[a-z0-9-]+-v1$/);
      expect(fixture.name.length).toBeGreaterThan(0);
      expect(fixture.expected.terminal.status).toEqual(expect.any(String));
      expect(fixture.expected.terminal).toHaveProperty("error_code");
      expect(fixture.expected.terminal).toHaveProperty("retryable");
      expect(fixture.expected.terminal).toHaveProperty("answer");
      expect(fixture.expected.terminal).toHaveProperty("data");
      expect(fixture.expected.terminal).toHaveProperty("pending_input");
      expect(fixture.expected.terminal).toHaveProperty("pending_approval");
      expect(fixture.expected.safety).toEqual({
        mutations: expect.any(Number),
        provider_calls: expect.any(Number),
        tool_calls: expect.any(Number),
        exposed_tools: expect.any(Array),
      });
      expect(fixture.expected.usage).toEqual({
        steps: expect.any(Number),
        result: fixture.expected.usage.result,
        terminal_trace: {
          input_tokens: expect.any(Number),
          output_tokens: expect.any(Number),
          total_tokens: expect.any(Number),
        },
      });
      expect(fixture.expected.trace).toEqual({
        run_id: fixture.id,
        provider: "fixture",
        model: "fixture/model-v1",
        phases: expect.any(Array),
        tool_names: expect.any(Array),
        elapsed_ms: expect.any(Array),
        terminal_records: 1,
        forbidden_markers: expect.any(Array),
      });
      expect(fixture.expected.trace.phases.length)
        .toBe(fixture.expected.trace.elapsed_ms.length);
      expect(fixture.expected.trace.phases.length)
        .toBe(fixture.expected.trace.tool_names.length);
    }
  });

  test("runs the corpus through the public runtime with deterministic fakes", async () => {
    const report = await runTodosAiEvaluationCorpus();

    expect(report.schema_version).toBe(1);
    expect(report.passed).toBe(true);
    expect(report.results.map((entry) => entry.fixture.lane))
      .toEqual([...EXPECTED_LANES]);
    for (const entry of report.results) {
      expect(entry.passed).toBe(true);
      expect(entry.violations).toEqual([]);
      expect(entry.observation.result.status)
        .toBe(entry.fixture.expected.terminal.status);
      expect(entry.observation.result.error?.code ?? null)
        .toBe(entry.fixture.expected.terminal.error_code);
      expect(entry.observation.result.error?.retryable ?? null)
        .toBe(entry.fixture.expected.terminal.retryable);
      expect(entry.observation.mutations)
        .toBe(entry.fixture.expected.safety.mutations);
      expect(entry.observation.provider_calls)
        .toBe(entry.fixture.expected.safety.provider_calls);
      expect(entry.observation.tool_calls)
        .toBe(entry.fixture.expected.safety.tool_calls);
      expect(entry.observation.exposed_tools)
        .toEqual([...entry.fixture.expected.safety.exposed_tools]);
      expect(entry.observation.traces.map((trace) => trace.phase))
        .toEqual([...entry.fixture.expected.trace.phases]);
      expect(entry.observation.traces.map((trace) => trace.elapsed_ms))
        .toEqual([...entry.fixture.expected.trace.elapsed_ms]);
    }
  });

  test("keeps serialized traces structurally narrow and payload-free", async () => {
    const report = await runTodosAiEvaluationCorpus();
    const payloadCarrierText = JSON.stringify(
      TODOS_AI_EVALUATION_CORPUS.map((fixture) => ({
        request: fixture.request,
        scenario: fixture.scenario,
      })),
    );
    const traceText = JSON.stringify(
      report.results.flatMap((entry) => entry.observation.traces),
    );

    expect(TODOS_AI_TRACE_FIELDS).toEqual([
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
    ]);
    for (const entry of report.results) {
      for (const trace of entry.observation.traces) {
        expect(Object.keys(trace)).toEqual([...TODOS_AI_TRACE_FIELDS]);
      }
    }

    for (const marker of TODOS_AI_EVALUATION_PRIVATE_MARKERS) {
      expect(payloadCarrierText).toContain(marker);
      expect(traceText).not.toContain(marker);
    }
    for (const forbiddenField of [
      "prompt",
      "answer",
      "data",
      "input",
      "variables",
      "arguments",
      "result",
      "pending_input",
      "pending_approval",
      "operations",
      "headers",
      "message",
      "details",
      "credential",
    ]) {
      expect(TODOS_AI_TRACE_FIELDS).not.toContain(forbiddenField);
    }

    const read = report.results.find((entry) => entry.fixture.lane === "read");
    expect(read?.observation.traces.at(-1)).toEqual({
      schema_version: TODOS_AI_TRACE_SCHEMA_VERSION,
      run_id: "todos-ai-eval-read-v1",
      provider: "fixture",
      model: "fixture/model-v1",
      phase: "terminal",
      tool_name: null,
      terminal_status: "answered",
      error_code: null,
      retryable: null,
      elapsed_ms: 50,
      steps: 2,
      input_tokens: 8,
      output_tokens: 3,
      total_tokens: 11,
    });
  });

  test("replaces private values placed in trace identifier slots", async () => {
    const traces: TodosAiTraceRecord[] = [];
    const privateRunId = TODOS_AI_EVALUATION_PRIVATE_MARKERS.find(
      (marker) => marker.includes("private-prompt"),
    )!;
    const privateModel = TODOS_AI_EVALUATION_PRIVATE_MARKERS.find(
      (marker) => marker.startsWith("Bearer "),
    )!;
    const runtime = createTodosAiRuntimeWithDependencies(HOST_CONTEXT, {
      providers: {
        fixture: async () => adapter(),
      },
      createRunId: () => privateRunId,
      trace(record) {
        traces.push(record);
      },
    });

    const result = await runRuntime(runtime, request({ model: privateModel }));
    const serialized = JSON.stringify(traces);

    expect(result.status).toBe("answered");
    expect(serialized).not.toContain(privateRunId);
    expect(serialized).not.toContain(privateModel);
    expect(traces.at(-1)).toMatchObject({
      run_id: "redacted-run",
      provider: "fixture",
      model: "unknown-model",
      terminal_status: "answered",
    });
  });

  test("trace consumer failures cannot change results or trigger retries", async () => {
    let providerCalls = 0;
    let traceCalls = 0;
    const runtime = createTodosAiRuntimeWithDependencies(HOST_CONTEXT, {
      providers: {
        fixture: async () => adapter({
          async runWork() {
            providerCalls += 1;
            return {
              text: "Answered despite trace consumer failure.",
              usage: null,
              steps: 1,
            };
          },
        }),
      },
      createRunId: () => "trace-consumer-failure",
      trace() {
        traceCalls += 1;
        throw new Error("private trace consumer failure");
      },
    });

    const result = await runRuntime(runtime, request());

    expect(providerCalls).toBe(1);
    expect(traceCalls).toBe(3);
    expect(result).toMatchObject({
      status: "answered",
      answer: "Answered despite trace consumer failure.",
      error: null,
    });
  });

  test("proves injection and denial cannot add write authority or mutate", async () => {
    for (const lane of ["denial", "injection"] as const) {
      const fixture = TODOS_AI_EVALUATION_CORPUS.find(
        (candidate) => candidate.lane === lane,
      );
      expect(fixture).toBeDefined();
      const result = await runTodosAiEvaluationFixture(fixture!);

      expect(result.passed).toBe(true);
      expect(result.observation.result.status).toBe("answered");
      expect(result.observation.mutations).toBe(0);
      expect(result.observation.exposed_tools).not.toContain("update_task");
      expect(JSON.stringify(result.observation.traces))
        .not.toContain("update_task");
    }
  });

  test("aggregates structured finalization usage into the terminal trace", async () => {
    const fixture = TODOS_AI_EVALUATION_CORPUS.find(
      (candidate) => candidate.lane === "structured_output",
    );
    expect(fixture).toBeDefined();
    const result = await runTodosAiEvaluationFixture(fixture!);

    expect(result.observation.result).toMatchObject({
      status: "answered",
      steps: 3,
      usage: {
        input_tokens: 9,
        output_tokens: 5,
        total_tokens: 14,
      },
    });
    expect(result.observation.provider_calls).toBe(2);
    expect(result.observation.traces.at(-1)).toMatchObject({
      phase: "terminal",
      steps: 3,
      input_tokens: 9,
      output_tokens: 5,
      total_tokens: 14,
    });
  });

  test("fails its own control on an intentionally wrong and leaky observation", async () => {
    const fixture = TODOS_AI_EVALUATION_CORPUS.find(
      (candidate) => candidate.lane === "read",
    );
    expect(fixture).toBeDefined();
    const correct = await runTodosAiEvaluationFixture(fixture!);
    const marker = TODOS_AI_EVALUATION_PRIVATE_MARKERS[0]!;
    const leakyTrace = {
      ...correct.observation.traces[0]!,
      prompt: marker,
    } as unknown as TodosAiTraceRecord;
    const wrong: TodosAiEvaluationObservation = {
      ...correct.observation,
      result: {
        schema_version: 1,
        run_id: correct.observation.result.run_id,
        status: "failed",
        answer: null,
        data: null,
        steps: 0,
        usage: null,
        pending_input: null,
        pending_approval: null,
        error: {
          code: "internal_error",
          message: "Intentional evaluator control.",
          retryable: false,
          details: null,
        },
      },
      traces: [leakyTrace, ...correct.observation.traces.slice(1)],
    };

    const violations = evaluateTodosAiEvaluationObservation(fixture!, wrong);

    expect(violations.some((violation) =>
      violation.includes("terminal status")
    )).toBe(true);
    expect(violations.some((violation) =>
      violation.includes("unexpected trace field")
    )).toBe(true);
    expect(violations.some((violation) =>
      violation.includes("forbidden trace marker")
    )).toBe(true);
  });
});

describe("trace timing, usage, and finite failure recovery", () => {
  test("normalizes hostile usage counts and deterministic monotonic timing", async () => {
    const traces: TodosAiTraceRecord[] = [];
    const clockValues = [1_000, 1_007, 1_019, 1_035, 1_058, 1_090];
    let clockIndex = 0;
    const runtime = createTodosAiRuntimeWithDependencies(HOST_CONTEXT, {
      providers: {
        fixture: async () => adapter({
          async runWork() {
            return {
              text: "Draft.",
              usage: {
                inputTokens: Number.MAX_SAFE_INTEGER,
                outputTokens: -4,
                totalTokens: Number.POSITIVE_INFINITY,
              },
              steps: 2,
            };
          },
          async finalize() {
            return {
              data: { answer: "Final." },
              usage: {
                inputTokens: 1,
                outputTokens: Number.MAX_SAFE_INTEGER,
                totalTokens: Number.NaN,
              },
              steps: 1,
            };
          },
        }),
      },
      createRunId: () => "trace-usage-run",
      monotonicNow: () => clockValues[clockIndex++] ?? 1_090,
      trace(record) {
        traces.push(record);
      },
    });

    const result = await runRuntime(runtime, request({
      output_schema: {
        type: "object",
        properties: {
          answer: { type: "string" },
        },
        required: ["answer"],
        additionalProperties: false,
      },
    }));

    expect(result.usage).toEqual({
      input_tokens: Number.MAX_SAFE_INTEGER,
      output_tokens: Number.MAX_SAFE_INTEGER,
      total_tokens: Number.MAX_SAFE_INTEGER,
    });
    expect(traces.map((trace) => trace.elapsed_ms))
      .toEqual([7, 19, 35, 58, 90]);
    for (const trace of traces) {
      expect(Number.isSafeInteger(trace.elapsed_ms)).toBe(true);
      expect(trace.elapsed_ms).toBeGreaterThanOrEqual(0);
      expect(trace.elapsed_ms).toBeLessThanOrEqual(
        TODOS_AI_TRACE_LIMITS.max_elapsed_ms,
      );
      for (const count of [
        trace.steps,
        trace.input_tokens,
        trace.output_tokens,
        trace.total_tokens,
      ]) {
        expect(Number.isSafeInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("clamps oversized and backward monotonic samples", async () => {
    const traces: TodosAiTraceRecord[] = [];
    const clockValues = [
      100,
      Number.MAX_SAFE_INTEGER,
      Number.NaN,
      -1,
    ];
    let clockIndex = 0;
    const runtime = createTodosAiRuntimeWithDependencies(HOST_CONTEXT, {
      providers: {
        fixture: async () => adapter(),
      },
      createRunId: () => "trace-bounded-clock",
      monotonicNow: () => clockValues[clockIndex++] ?? -1,
      trace(record) {
        traces.push(record);
      },
    });

    const result = await runRuntime(runtime, request());

    expect(result.status).toBe("answered");
    expect(traces.map((trace) => trace.elapsed_ms)).toEqual([
      TODOS_AI_TRACE_LIMITS.max_elapsed_ms,
      TODOS_AI_TRACE_LIMITS.max_elapsed_ms,
      TODOS_AI_TRACE_LIMITS.max_elapsed_ms,
    ]);
  });

  test("maps every failure class once with explicit retryability", async () => {
    const cases = [
      {
        name: "provider",
        expectedCode: "provider_error",
        expectedRetryable: false,
        error: new TodosAiProviderError("provider", false),
      },
      {
        name: "rate",
        expectedCode: "provider_error",
        expectedRetryable: true,
        error: new TodosAiProviderError("rate_limit", true),
      },
      {
        name: "schema",
        expectedCode: "schema_error",
        expectedRetryable: false,
        error: new TodosAiSchemaError(),
      },
    ] as const;

    for (const item of cases) {
      let providerCalls = 0;
      const runtime = createTodosAiRuntimeWithDependencies(HOST_CONTEXT, {
        providers: {
          fixture: async () => adapter({
            async runWork() {
              providerCalls += 1;
              if (item.name === "schema") {
                return {
                  text: "Draft.",
                  usage: null,
                  steps: 1,
                };
              }
              throw item.error;
            },
            async finalize() {
              providerCalls += 1;
              throw item.error;
            },
          }),
        },
        createRunId: () => `failure-${item.name}`,
      });
      const result = await runRuntime(runtime, request({
        output_schema: item.name === "schema"
          ? {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
              additionalProperties: false,
            }
          : null,
      }));

      expect(providerCalls).toBe(item.name === "schema" ? 2 : 1);
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe(item.expectedCode);
      expect(result.error?.retryable).toBe(item.expectedRetryable);
    }

    let toolProviderCalls = 0;
    const toolRuntime = createTodosAiRuntimeWithDependencies(HOST_CONTEXT, {
      providers: {
        fixture: async () => adapter({
          async runWork(work) {
            toolProviderCalls += 1;
            await work.tools[0]!.execute({}, {
              signal: work.signal,
              request: work.request,
              toolCallId: "tool-failure",
            });
            throw new Error("unreachable");
          },
        }),
      },
      toolSource: async () => [{
        name: "failing_tool",
        description: "Fail deterministically.",
        inputSchema: { type: "object" },
        execute() {
          throw new Error("private tool failure");
        },
      }],
      createRunId: () => "failure-tool",
    });
    const toolResult = await runRuntime(toolRuntime, request());
    expect(toolProviderCalls).toBe(1);
    expect(toolResult.error).toMatchObject({
      code: "tool_error",
      retryable: false,
    });

    let configProviderCalls = 0;
    const configRuntime = createTodosAiRuntimeWithDependencies(HOST_CONTEXT, {
      providers: {
        fixture: async () => {
          configProviderCalls += 1;
          return adapter();
        },
      },
      createRunId: () => "failure-config",
    });
    const configResult = await runRuntime(
      configRuntime,
      request({ provider: "unsupported" }),
    );
    expect(configProviderCalls).toBe(0);
    expect(configResult.error).toMatchObject({
      code: "invalid_configuration",
      retryable: false,
    });

    let internalProviderCalls = 0;
    const internalRuntime = createTodosAiRuntimeWithDependencies(HOST_CONTEXT, {
      providers: {
        fixture: async () => adapter({
          async runWork() {
            internalProviderCalls += 1;
            throw new TodosAiInternalError();
          },
        }),
      },
      createRunId: () => "failure-internal",
    });
    const internalResult = await runRuntime(internalRuntime, request());
    expect(internalProviderCalls).toBe(1);
    expect(internalResult.error).toMatchObject({
      code: "internal_error",
      retryable: false,
    });

    const cancelledController = new AbortController();
    cancelledController.abort();
    let cancelledProviderCalls = 0;
    const cancelledRuntime = createTodosAiRuntimeWithDependencies(HOST_CONTEXT, {
      providers: {
        fixture: async () => {
          cancelledProviderCalls += 1;
          return adapter();
        },
      },
      createRunId: () => "failure-cancelled",
    });
    const cancelledResult = await runRuntime(
      cancelledRuntime,
      request(),
      cancelledController.signal,
    );
    expect(cancelledProviderCalls).toBe(0);
    expect(cancelledResult.error).toMatchObject({
      code: "interrupted",
      retryable: false,
    });
  });

  test("maps timeout without sleeping or retrying", async () => {
    let fireTimeout = () => {};
    let providerCalls = 0;
    let notifyStarted = () => {};
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const runtime = createTodosAiRuntimeWithDependencies(HOST_CONTEXT, {
      providers: {
        fixture: async () => adapter({
          async runWork(work) {
            providerCalls += 1;
            notifyStarted();
            return await new Promise((_, reject) => {
              work.signal.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              );
            });
          },
        }),
      },
      createRunId: () => "failure-timeout",
      scheduleTimeout(callback) {
        fireTimeout = callback;
        return () => {};
      },
    });

    const running = runRuntime(runtime, request());
    await started;
    fireTimeout();
    const result = await running;

    expect(providerCalls).toBe(1);
    expect(result.error).toEqual({
      code: "timeout",
      message: "The Todos AI run timed out.",
      retryable: true,
      details: null,
    });
  });

  test("keeps verified-write precedence in the terminal trace", async () => {
    const traces: TodosAiTraceRecord[] = [];
    const digest = "a".repeat(64);
    const approvalRef = `todos-ai:update_task:${digest}`;
    const receipt: TodosAiJsonObject = {
      schema: "todos.ai.update_task.v1",
      operation: "update_task",
      mode: "execute",
      applied: true,
      readback_verified: true,
      source: "sqlite",
      target: {
        task_id: "10000000-0000-4000-8000-000000000001",
        expected_version: 3,
        result_version: 4,
      },
      changed_fields: ["title"],
      approval_ref: approvalRef,
      payload_digest: digest,
      idempotency: {
        key: "trace-write-precedence",
        scope: "run",
        replay: false,
      },
    };
    const runtime = createTodosAiRuntimeWithDependencies(HOST_CONTEXT, {
      providers: {
        fixture: async () => adapter({
          async runWork(work) {
            await work.tools[0]!.execute({}, {
              signal: work.signal,
              request: work.request,
              toolCallId: "write-then-provider-fails",
            });
            throw new TodosAiProviderError("provider", true);
          },
        }),
      },
      toolSource: async () => [{
        name: "update_task",
        description: "Execute one verified update.",
        effect: "write",
        inputSchema: { type: "object" },
        execute: async () => receipt,
      }],
      createRunId: () => "verified-write-precedence",
      monotonicNow: (() => {
        let value = 0;
        return () => value += 10;
      })(),
      trace(record) {
        traces.push(record);
      },
    });

    const result = await runRuntime(runtime, request({
      authority: {
        write_mode: "execute",
        approval_mode: "existing",
        approval_refs: [approvalRef],
        dry_run: false,
      },
    }));

    expect(result.status).toBe("completed");
    expect(result.error).toBeNull();
    expect(traces.at(-1)).toMatchObject({
      phase: "terminal",
      terminal_status: "completed",
      error_code: null,
      retryable: null,
    });
  });

  test("does not serialize clarification or approval payloads into traces", async () => {
    const privateInput = "private-clarification-field";
    const privateApproval = "private-approval-operation";
    for (const signal of [
      new TodosAiNeedsInputSignal({
        prompt: privateInput,
        fields: ["private_field"],
      }),
      new TodosAiNeedsApprovalSignal({
        id: "private-approval-id",
        summary: privateApproval,
        operations: [{
          operation: privateApproval,
        }],
      }),
    ]) {
      const traces: TodosAiTraceRecord[] = [];
      const runtime = createTodosAiRuntimeWithDependencies(HOST_CONTEXT, {
        providers: {
          fixture: async () => adapter({
            async runWork(work) {
              await work.tools[0]!.execute({}, {
                signal: work.signal,
                request: work.request,
                toolCallId: "private-control",
              });
              throw new Error("unreachable");
            },
          }),
        },
        toolSource: async () => [{
          name: "control",
          description: "Emit a control signal.",
          effect: "control",
          inputSchema: { type: "object" },
          execute() {
            throw signal;
          },
        }],
        createRunId: () => "private-control-run",
        monotonicNow: (() => {
          let value = 0;
          return () => value += 5;
        })(),
        trace(record) {
          traces.push(record);
        },
      });

      await runRuntime(runtime, request());
      const serialized = JSON.stringify(traces);
      expect(serialized).not.toContain(privateInput);
      expect(serialized).not.toContain(privateApproval);
      expect(serialized).not.toContain("private_field");
      expect(serialized).not.toContain("private-approval-id");
    }
  });
});
