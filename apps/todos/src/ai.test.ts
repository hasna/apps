import { describe, expect, test } from "bun:test";
import {
  TODOS_AI_DEFAULTS,
  TODOS_AI_EXIT_CODES,
  TODOS_AI_LIMITS,
  TODOS_AI_RUNTIME_PROTOCOL_VERSION,
  TODOS_AI_SCHEMA_VERSION,
  TodosAiContractError,
  TodosAiNeedsApprovalSignal,
  TodosAiNeedsInputSignal,
  assertTodosAiRunResult,
  assertTodosAiRuntimeModule,
  createTodosAiFailureResult,
  createTodosAiNeedsApprovalResult,
  createTodosAiNeedsInputResult,
  isTodosAiRuntimeEvent,
  normalizeTodosAiPrompt,
  parseTodosAiJson,
  parseTodosAiOutputSchema,
  parseTodosAiVariables,
  resolveTodosAiCommandOptions,
  todosAiExitCodeForResult,
  type TodosAiRunResult,
  type TodosAiRuntimeEvent,
} from "./ai.js";

const UPDATE_DIGEST = "a".repeat(64);
const UPDATE_APPROVAL_REF = `todos-ai:update_task:${UPDATE_DIGEST}`;

function updateTaskReceipt() {
  return {
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
    approval_ref: UPDATE_APPROVAL_REF,
    payload_digest: UPDATE_DIGEST,
    idempotency: {
      key: "contract-write-1",
      scope: "run",
      replay: false,
    },
  } as const;
}

function contractError(run: () => unknown): TodosAiContractError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(TodosAiContractError);
    return error as TodosAiContractError;
  }
  throw new Error("expected TodosAiContractError");
}

function result(
  status: TodosAiRunResult["status"],
  overrides: Partial<TodosAiRunResult> = {},
): TodosAiRunResult {
  return {
    schema_version: TODOS_AI_SCHEMA_VERSION,
    run_id: "run-contract",
    status,
    answer: status === "answered" || status === "completed" ? "done" : null,
    data: status === "completed" ? updateTaskReceipt() : null,
    steps: 1,
    usage: null,
    pending_input: null,
    pending_approval: null,
    error: null,
    ...overrides,
  };
}

describe("Todos AI command configuration", () => {
  test("uses provider-neutral read-only defaults", () => {
    expect(resolveTodosAiCommandOptions({ interactive: false })).toEqual({
      provider: null,
      model: null,
      profile: null,
      format: TODOS_AI_DEFAULTS.format,
      max_steps: TODOS_AI_DEFAULTS.max_steps,
      timeout_ms: TODOS_AI_DEFAULTS.timeout_ms,
      write_mode: "read-only",
      approval_mode: "deny",
      approval_refs: [],
      dry_run: false,
      interactive: false,
    });
  });

  test("applies CLI over TODOS_AI_* environment over stored config", () => {
    const config = {
      provider: "stored-provider",
      model: "stored-model",
      profile: "stored-profile",
      format: "text" as const,
      max_steps: 4,
      timeout_ms: 4_000,
      write_mode: "read-only" as const,
      approval_mode: "deny" as const,
    };
    const env = {
      TODOS_AI_PROVIDER: "env-provider",
      TODOS_AI_MODEL: "env-model",
      TODOS_AI_PROFILE: "env-profile",
      TODOS_AI_FORMAT: "json",
      TODOS_AI_MAX_STEPS: "6",
      TODOS_AI_TIMEOUT_MS: "6000",
      TODOS_AI_WRITE_MODE: "plan",
      TODOS_AI_APPROVAL_MODE: "deny",
    };

    expect(resolveTodosAiCommandOptions({ config, env, interactive: false })).toMatchObject({
      provider: "env-provider",
      model: "env-model",
      profile: "env-profile",
      format: "json",
      max_steps: 6,
      timeout_ms: 6_000,
      write_mode: "plan",
      approval_mode: "deny",
    });

    expect(resolveTodosAiCommandOptions({
      config,
      env,
      interactive: false,
      cli: {
        provider: "cli-provider",
        model: "cli-model",
        profile: "cli-profile",
        format: "stream-json",
        maxSteps: 8,
        timeoutMs: 8_000,
        writeMode: "execute",
        approvalMode: "existing",
        approvalRefs: ["approval-1", "approval-1", "approval-2"],
      },
    })).toMatchObject({
      provider: "cli-provider",
      model: "cli-model",
      profile: "cli-profile",
      format: "stream-json",
      max_steps: 8,
      timeout_ms: 8_000,
      write_mode: "execute",
      approval_mode: "existing",
      approval_refs: ["approval-1", "approval-2"],
    });
  });

  test("stored config is used when higher-precedence layers are absent", () => {
    expect(resolveTodosAiCommandOptions({
      interactive: true,
      config: {
        provider: "stored-provider",
        model: "stored-model",
        profile: "stored-profile",
        format: "json",
        max_steps: 7,
        timeout_ms: 7_000,
        write_mode: "execute",
        approval_mode: "prompt",
      },
    })).toMatchObject({
      provider: "stored-provider",
      model: "stored-model",
      profile: "stored-profile",
      format: "json",
      max_steps: 7,
      timeout_ms: 7_000,
      write_mode: "execute",
      approval_mode: "prompt",
    });
  });

  test("dry-run only narrows authority to plan", () => {
    expect(resolveTodosAiCommandOptions({
      interactive: false,
      config: { write_mode: "execute", approval_mode: "required" },
      cli: { dryRun: true },
    })).toMatchObject({
      write_mode: "plan",
      approval_mode: "deny",
      dry_run: true,
    });

    expect(contractError(() => resolveTodosAiCommandOptions({
      interactive: false,
      cli: { dryRun: true, writeMode: "execute" },
    }))).toMatchObject({
      code: "invalid_configuration",
      exitCode: TODOS_AI_EXIT_CODES.usage,
    });
  });

  test("rejects unsupported write, approval, and non-interactive combinations", () => {
    const invalid = [
      { interactive: false, cli: { writeMode: "plan", approvalMode: "required" } },
      { interactive: false, cli: { writeMode: "execute", approvalMode: "deny" } },
      { interactive: false, cli: { writeMode: "execute", approvalMode: "prompt" } },
      { interactive: false, cli: { writeMode: "execute", approvalMode: "existing" } },
      {
        interactive: false,
        cli: {
          writeMode: "execute",
          approvalMode: "required",
          approvalRefs: ["approval-1"],
        },
      },
    ] as const;

    for (const input of invalid) {
      expect(contractError(() => resolveTodosAiCommandOptions(input))).toMatchObject({
        code: "invalid_configuration",
        exitCode: TODOS_AI_EXIT_CODES.usage,
      });
    }
  });

  test("rejects invalid enums and out-of-range limits deterministically", () => {
    for (const cli of [
      { format: "yaml" },
      { writeMode: "mutate" },
      { approvalMode: "always" },
      { maxSteps: 0 },
      { maxSteps: 21 },
      { timeoutMs: 999 },
      { timeoutMs: 600_001 },
    ]) {
      expect(contractError(() => resolveTodosAiCommandOptions({
        interactive: false,
        cli,
      }))).toMatchObject({
        code: "invalid_configuration",
        exitCode: TODOS_AI_EXIT_CODES.usage,
      });
    }
  });
});

describe("Todos AI input contract", () => {
  test("normalizes positional or stdin prompt text without inventing content", () => {
    expect(normalizeTodosAiPrompt("  inspect the current plan \n")).toBe("inspect the current plan");
    expect(normalizeTodosAiPrompt(" \n\t ")).toBe("");
  });

  test("parses typed JSON input and requires an object output schema", () => {
    expect(parseTodosAiJson(
      '{"query":"open","limit":2,"include_done":false,"tags":["release"],"cursor":null}',
      "input",
    )).toEqual({
      query: "open",
      limit: 2,
      include_done: false,
      tags: ["release"],
      cursor: null,
    });
    expect(parseTodosAiOutputSchema(
      '{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}',
    )).toEqual({
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    });

    expect(contractError(() => parseTodosAiJson("{", "input"))).toMatchObject({
      code: "invalid_input",
      exitCode: TODOS_AI_EXIT_CODES.usage,
    });
    expect(contractError(() => parseTodosAiJson("1e400", "input"))).toMatchObject({
      code: "invalid_input",
      exitCode: TODOS_AI_EXIT_CODES.usage,
    });
    expect(contractError(() => parseTodosAiOutputSchema('["not","an","object"]'))).toMatchObject({
      code: "invalid_input",
      exitCode: TODOS_AI_EXIT_CODES.usage,
    });
    expect(contractError(() => parseTodosAiOutputSchema('{"maximum":1e400}'))).toMatchObject({
      code: "invalid_input",
      exitCode: TODOS_AI_EXIT_CODES.usage,
    });
  });

  test("accepts repeatable non-secret variables and preserves equals in values", () => {
    expect(parseTodosAiVariables([
      "project=alpha",
      "filter=status=in_progress",
      "include_done=false",
    ])).toEqual({
      project: "alpha",
      filter: "status=in_progress",
      include_done: "false",
    });
  });

  test("rejects duplicate, malformed, and credential-shaped variables", () => {
    for (const values of [
      ["project=one", "project=two"],
      ["missing-separator"],
      ["bad key=value"],
      ["api_key=opaque"],
      ["access-token=opaque"],
      ["PASSWORD=opaque"],
    ]) {
      expect(contractError(() => parseTodosAiVariables(values))).toMatchObject({
        code: "invalid_input",
        exitCode: TODOS_AI_EXIT_CODES.usage,
      });
    }
  });
});

describe("Todos AI runtime protocol", () => {
  test("accepts protocol-compatible modules and rejects absent protocol compatibility", () => {
    const compatible = {
      TODOS_AI_RUNTIME_PROTOCOL_VERSION,
      createTodosAiRuntime: () => ({ run: async () => result("answered") }),
    };
    expect(assertTodosAiRuntimeModule(compatible)).toBe(compatible);

    for (const incompatible of [
      null,
      {},
      { TODOS_AI_RUNTIME_PROTOCOL_VERSION: TODOS_AI_RUNTIME_PROTOCOL_VERSION + 1 },
      { TODOS_AI_RUNTIME_PROTOCOL_VERSION, createTodosAiRuntime: "not-a-function" },
    ]) {
      expect(contractError(() => assertTodosAiRuntimeModule(incompatible))).toMatchObject({
        code: "runtime_incompatible",
        exitCode: TODOS_AI_EXIT_CODES.runtime_unavailable,
      });
    }
  });

  test("validates runtime events and rejects malformed event records", () => {
    const event: TodosAiRuntimeEvent = {
      schema_version: TODOS_AI_SCHEMA_VERSION,
      run_id: "run-contract",
      sequence: 0,
      type: "run.started",
      timestamp: "2026-08-09T00:00:00.000Z",
      data: { phase: "start" },
    };
    expect(isTodosAiRuntimeEvent(event)).toBe(true);
    expect(isTodosAiRuntimeEvent({ ...event, sequence: -1 })).toBe(false);
    expect(isTodosAiRuntimeEvent({ ...event, type: "provider.delta" })).toBe(false);
    expect(isTodosAiRuntimeEvent({ ...event, data: { invalid: Number.POSITIVE_INFINITY } })).toBe(false);
  });

  test("rejects shape-changing or non-JSON extras before protocol serialization", () => {
    const event: TodosAiRuntimeEvent = {
      schema_version: TODOS_AI_SCHEMA_VERSION,
      run_id: "run-contract",
      sequence: 0,
      type: "run.started",
      timestamp: "2026-08-09T00:00:00.000Z",
      data: { phase: "start" },
    };
    const malformedResults = [
      {
        ...result("answered"),
        toJSON: () => ({ malformed: "result" }),
      },
      {
        ...result("answered"),
        non_json_extra: () => "not protocol data",
      },
    ];
    const malformedEvents = [
      {
        ...event,
        toJSON: () => ({ malformed: "event" }),
      },
      {
        ...event,
        non_json_extra: () => "not protocol data",
      },
    ];

    for (const malformed of malformedResults) {
      expect(contractError(() => assertTodosAiRunResult(malformed))).toMatchObject({
        code: "runtime_invalid_result",
        exitCode: TODOS_AI_EXIT_CODES.failed,
      });
    }
    for (const malformed of malformedEvents) {
      expect(isTodosAiRuntimeEvent(malformed)).toBe(false);
    }
  });

  test("validates terminal result envelopes and rejects malformed runtime output", () => {
    expect(assertTodosAiRunResult(result("answered"))).toEqual(result("answered"));
    expect(assertTodosAiRunResult(result("completed"))).toEqual(result("completed"));
    expect(assertTodosAiRunResult(result("needs_input", {
      steps: 0,
      pending_input: { prompt: "What should be inspected?", fields: ["prompt"] },
    }))).toMatchObject({ status: "needs_input" });

    for (const malformed of [
      null,
      {},
      { ...result("answered"), schema_version: 99 },
      { ...result("answered"), run_id: "" },
      { ...result("answered"), status: "running" },
      { ...result("answered"), data: Number.POSITIVE_INFINITY },
      { ...result("answered"), steps: -1 },
      { ...result("answered"), usage: { input_tokens: 1, output_tokens: 2 } },
      { ...result("completed"), data: null },
      {
        ...result("completed"),
        data: {
          ...updateTaskReceipt(),
          changed_fields: ["admin"],
        },
      },
      result("needs_input"),
      result("needs_approval"),
      result("failed"),
      result("answered", {
        error: {
          code: "provider_error",
          message: "terminal states must not conflict",
          retryable: false,
          details: null,
        },
      }),
    ]) {
      expect(contractError(() => assertTodosAiRunResult(malformed))).toMatchObject({
        code: "runtime_invalid_result",
        exitCode: TODOS_AI_EXIT_CODES.failed,
      });
    }
  });

  test("bounds typed pending control signals without invoking accessors", () => {
    const inputSignal = new TodosAiNeedsInputSignal({
      prompt: "Which exact task?",
      fields: ["task_id"],
    });
    const approvalSignal = new TodosAiNeedsApprovalSignal({
      id: "approval-1",
      summary: "Approve one exact update.",
      operations: [{ operation: "update_task", task_id: "task-1" }],
    });

    expect(inputSignal.pending_input).toEqual({
      prompt: "Which exact task?",
      fields: ["task_id"],
    });
    expect(createTodosAiNeedsApprovalResult(
      "run-approval",
      approvalSignal.pending_approval,
    )).toMatchObject({
      run_id: "run-approval",
      status: "needs_approval",
      pending_approval: approvalSignal.pending_approval,
    });

    let accessorCalls = 0;
    const accessor = { fields: ["task_id"] };
    Object.defineProperty(accessor, "prompt", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return "unsafe";
      },
    });
    expect(() => new TodosAiNeedsInputSignal(
      accessor as unknown as ConstructorParameters<typeof TodosAiNeedsInputSignal>[0],
    )).toThrow(TodosAiContractError);
    expect(accessorCalls).toBe(0);

    expect(() => new TodosAiNeedsInputSignal({
      prompt: "x".repeat(TODOS_AI_LIMITS.max_pending_input_prompt_bytes + 1),
      fields: ["task_id"],
    })).toThrow(TodosAiContractError);
    expect(() => new TodosAiNeedsInputSignal({
      prompt: "Which exact task?",
      fields: ["task_id", "task_id"],
    })).toThrow(TodosAiContractError);
    expect(() => new TodosAiNeedsApprovalSignal({
      id: "approval-1",
      summary: "x".repeat(TODOS_AI_LIMITS.max_pending_approval_summary_bytes + 1),
      operations: [{ operation: "update_task" }],
    })).toThrow(TodosAiContractError);
  });

  test("maps terminal statuses and stable error classes to documented exits", () => {
    expect(todosAiExitCodeForResult(result("answered"))).toBe(TODOS_AI_EXIT_CODES.success);
    expect(todosAiExitCodeForResult(result("completed"))).toBe(TODOS_AI_EXIT_CODES.success);
    expect(todosAiExitCodeForResult(createTodosAiNeedsInputResult("run-input", "Prompt required")))
      .toBe(TODOS_AI_EXIT_CODES.needs_input);
    expect(todosAiExitCodeForResult(result("needs_approval", {
      pending_approval: {
        id: "approval-1",
        summary: "Apply one task update",
        operations: [{ operation: "update_task" }],
      },
    }))).toBe(TODOS_AI_EXIT_CODES.needs_approval);

    const cases = [
      ["invalid_input", TODOS_AI_EXIT_CODES.usage],
      ["invalid_configuration", TODOS_AI_EXIT_CODES.usage],
      ["runtime_unavailable", TODOS_AI_EXIT_CODES.runtime_unavailable],
      ["runtime_incompatible", TODOS_AI_EXIT_CODES.runtime_unavailable],
      ["runtime_invalid_result", TODOS_AI_EXIT_CODES.failed],
      ["timeout", TODOS_AI_EXIT_CODES.timeout],
      ["interrupted", TODOS_AI_EXIT_CODES.interrupted],
      ["provider_error", TODOS_AI_EXIT_CODES.failed],
      ["tool_error", TODOS_AI_EXIT_CODES.failed],
      ["schema_error", TODOS_AI_EXIT_CODES.failed],
      ["internal_error", TODOS_AI_EXIT_CODES.failed],
    ] as const;

    for (const [code, exitCode] of cases) {
      expect(todosAiExitCodeForResult(createTodosAiFailureResult("run-failed", code, code)))
        .toBe(exitCode);
    }
  });
});
