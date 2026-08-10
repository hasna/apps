import { describe, expect, spyOn, test } from "bun:test";
import { APICallError } from "ai";
import {
  TodosAiNeedsApprovalSignal,
  TodosAiNeedsInputSignal,
  type TodosAiRunRequest,
  type TodosAiRuntimeEvent,
} from "@hasna/todos";
import {
  TodosAiProviderError,
  type TodosAiProviderWorkRequest,
} from "../src/types";
import {
  createGroqAdapter,
  type CreateGroqAdapterOptions,
  type GroqSdkDependencies,
} from "../src/providers/groq";
import { createTodosAiRuntimeWithDependencies } from "../src/runtime";

function providerRequest(
  overrides: Partial<TodosAiProviderWorkRequest> = {},
): TodosAiProviderWorkRequest {
  const signal = new AbortController().signal;
  const request = {
    schema_version: 1,
    prompt: "Inspect the task.",
    input: null,
    variables: {},
    output_schema: null,
    provider: "groq",
    model: "openai/gpt-oss-120b",
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
  } satisfies TodosAiRunRequest;

  return {
    request,
    prompt: request.prompt,
    signal,
    maxSteps: 4,
    stream: false,
    tools: [],
    onTextDelta() {},
    ...overrides,
  };
}

function fixtureSdk(overrides: Partial<GroqSdkDependencies> = {}) {
  const model = { fixture: "model" };
  const createGroq = (() => {
    return () => model;
  }) as unknown as GroqSdkDependencies["createGroq"];
  const generateText = (async () => ({
    text: "Done.",
    usage: {
      inputTokens: 2,
      inputTokenDetails: {
        noCacheTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokens: 1,
      outputTokenDetails: {
        textTokens: 1,
        reasoningTokens: 0,
      },
      totalTokens: 3,
    },
    steps: [{}],
    output: { ok: true },
  })) as unknown as GroqSdkDependencies["generateText"];
  const streamText = (() => ({
    stream: {
      async *[Symbol.asyncIterator]() {
        yield { type: "text-delta", id: "text-1", text: "Done." };
      },
    },
    text: Promise.resolve("Done."),
    usage: Promise.resolve({
      inputTokens: 2,
      inputTokenDetails: {
        noCacheTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokens: 1,
      outputTokenDetails: {
        textTokens: 1,
        reasoningTokens: 0,
      },
      totalTokens: 3,
    }),
    steps: Promise.resolve([{}]),
  })) as unknown as GroqSdkDependencies["streamText"];

  return {
    model,
    sdk: {
      createGroq,
      generateText,
      streamText,
      ...overrides,
    } satisfies GroqSdkDependencies,
  };
}

function groqErrorStream(marker: string): Response {
  const chunks = [
    {
      id: "chatcmpl-fixture",
      created: 1,
      model: "openai/gpt-oss-120b",
      choices: [{
        index: 0,
        delta: { content: "Partial" },
        finish_reason: null,
      }],
    },
    {
      error: {
        message: marker,
        type: "server_error",
      },
    },
  ];
  const body = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

function fixtureGroqFetch(marker: string): NonNullable<CreateGroqAdapterOptions["fetch"]> {
  return (async () => groqErrorStream(marker)) as unknown as NonNullable<
    CreateGroqAdapterOptions["fetch"]
  >;
}

describe("Groq adapter", () => {
  test("uses declared generateText tool options without structured output", async () => {
    const calls: Array<Record<string, unknown>> = [];
    let toolSignal: AbortSignal | undefined;
    const generateText = (async (options: Record<string, unknown>) => {
      calls.push(options);
      const tools = options["tools"] as Record<string, {
        execute(input: unknown, options: {
          toolCallId: string;
          messages: unknown[];
          abortSignal?: AbortSignal;
          context: Record<string, never>;
        }): Promise<unknown>;
      }>;
      const value = await tools["lookup"]?.execute(
        { id: "task-1" },
        {
          toolCallId: "call-1",
          messages: [],
          abortSignal: options["abortSignal"] as AbortSignal,
          context: {},
        },
      );
      expect(value).toEqual({ title: "Task" });
      return {
        text: "Task found.",
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          totalTokens: 6,
        },
        steps: [{}, {}],
      };
    }) as unknown as GroqSdkDependencies["generateText"];
    const { sdk } = fixtureSdk({ generateText });
    const adapter = createGroqAdapter({
      apiKey: "fixture-value",
      model: "openai/gpt-oss-120b",
      sdk,
    });
    const work = providerRequest({
      tools: [{
        name: "lookup",
        description: "Look up a task.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
        async execute(_input, context) {
          toolSignal = context.signal;
          return { title: "Task" };
        },
      }],
    });

    const result = await adapter.runWork(work);

    expect(result).toEqual({
      text: "Task found.",
      usage: {
        inputTokens: 4,
        outputTokens: 2,
        totalTokens: 6,
      },
      steps: 2,
    });
    expect(toolSignal).toBe(calls[0]?.["abortSignal"] as AbortSignal);
    expect(toolSignal).not.toBe(work.signal);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      abortSignal: work.signal,
      maxRetries: 0,
      maxOutputTokens: 2_048,
      providerOptions: {
        groq: {
          parallelToolCalls: false,
          structuredOutputs: false,
          strictJsonSchema: false,
        },
      },
    });
    expect(calls[0]?.["output"]).toBeUndefined();
    expect(calls[0]?.["tools"]).toBeDefined();
  });

  test("uses generateText Output.object for a no-tool strict finalizer", async () => {
    const generateCalls: Array<Record<string, unknown>> = [];
    let streamCalls = 0;
    const generateText = (async (options: Record<string, unknown>) => {
      generateCalls.push(options);
      return {
        text: "",
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
        },
        steps: [{}],
        output: { answer: "Final." },
      };
    }) as unknown as GroqSdkDependencies["generateText"];
    const streamText = (() => {
      streamCalls += 1;
      throw new Error("streamText must not be used for strict finalization");
    }) as unknown as GroqSdkDependencies["streamText"];
    const { sdk } = fixtureSdk({ generateText, streamText });
    const adapter = createGroqAdapter({
      apiKey: "fixture-value",
      model: "openai/gpt-oss-120b",
      sdk,
    });
    const signal = new AbortController().signal;

    const result = await adapter.finalize({
      request: providerRequest().request,
      sourceText: "Draft answer.",
      schema: {
        type: "object",
        properties: {
          answer: { type: "string" },
        },
        required: ["answer"],
        additionalProperties: false,
      },
      signal,
    });

    expect(result).toEqual({
      data: { answer: "Final." },
      usage: {
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
      },
      steps: 1,
    });
    expect(streamCalls).toBe(0);
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]).toMatchObject({
      abortSignal: signal,
      maxRetries: 0,
      maxOutputTokens: 2_048,
      providerOptions: {
        groq: {
          parallelToolCalls: false,
          structuredOutputs: true,
          strictJsonSchema: true,
        },
      },
    });
    expect(generateCalls[0]?.["tools"]).toBeUndefined();
    expect(generateCalls[0]?.["output"]).toBeDefined();
  });

  test("streams declared text-delta parts and preserves the signal", async () => {
    const streamCalls: Array<Record<string, unknown>> = [];
    const streamText = ((options: Record<string, unknown>) => {
      streamCalls.push(options);
      return {
        stream: {
          async *[Symbol.asyncIterator]() {
            yield { type: "text-delta", id: "text-1", text: "Hel" };
            yield { type: "text-delta", id: "text-1", text: "lo" };
          },
        },
        text: Promise.resolve("Hello"),
        usage: Promise.resolve({
          inputTokens: 2,
          outputTokens: 1,
          totalTokens: 3,
        }),
        steps: Promise.resolve([{}]),
      };
    }) as unknown as GroqSdkDependencies["streamText"];
    const { sdk } = fixtureSdk({ streamText });
    const adapter = createGroqAdapter({
      apiKey: "fixture-value",
      model: "openai/gpt-oss-120b",
      sdk,
    });
    const deltas: string[] = [];
    const work = providerRequest({
      stream: true,
      onTextDelta(delta) {
        deltas.push(delta);
      },
    });

    const result = await adapter.runWork(work);

    expect(deltas).toEqual(["Hel", "lo"]);
    expect(result.text).toBe("Hello");
    expect(result.steps).toBe(1);
    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0]?.["abortSignal"]).not.toBe(work.signal);
    expect((streamCalls[0]?.["abortSignal"] as AbortSignal).aborted).toBe(false);
    expect(streamCalls[0]?.["output"]).toBeUndefined();
  });

  test("preserves control signals even when the SDK captures tool failures", async () => {
    const signals = [
      new TodosAiNeedsInputSignal({
        prompt: "Which exact task?",
        fields: ["task_id"],
      }),
      new TodosAiNeedsApprovalSignal({
        id: "approval-fixture",
        summary: "Approve one exact update.",
        operations: [{ operation: "update_task", task_id: "task-fixture" }],
      }),
    ];

    for (const expected of signals) {
      let sdkSignal: AbortSignal | undefined;
      const generateText = (async (options: Record<string, unknown>) => {
        sdkSignal = options["abortSignal"] as AbortSignal;
        const tools = options["tools"] as Record<string, {
          execute(input: unknown, options: {
            toolCallId: string;
            messages: unknown[];
            abortSignal?: AbortSignal;
            context: Record<string, never>;
          }): Promise<unknown>;
        }>;
        try {
          await tools["control"]!.execute({}, {
            toolCallId: "control-1",
            messages: [],
            abortSignal: sdkSignal,
            context: {},
          });
        } catch {
          // The real SDK converts tool failures into model-visible tool errors.
        }
        return {
          text: "The model continued after the tool failure.",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
          },
          steps: [{}],
        };
      }) as unknown as GroqSdkDependencies["generateText"];
      const { sdk } = fixtureSdk({ generateText });
      const adapter = createGroqAdapter({
        apiKey: "[REDACTED_SECRET]",
        model: "openai/gpt-oss-120b",
        sdk,
      });
      let failure: unknown;
      try {
        await adapter.runWork(providerRequest({
          tools: [{
            name: "control",
            description: "Emit one typed control signal.",
            effect: "control",
            inputSchema: { type: "object" },
            execute: async () => {
              throw expected;
            },
          }],
        }));
      } catch (error) {
        failure = error;
      }

      expect(failure).toBe(expected);
      expect(sdkSignal?.aborted).toBe(true);
    }
  });

  test("fails a real SDK/Groq stream after partial text without logging provider payloads", async () => {
    const marker = "fixture-private-stream-response";
    const logged: unknown[][] = [];
    const consoleError = spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args);
    });
    const adapter = createGroqAdapter({
      apiKey: "fixture-api-key",
      model: "openai/gpt-oss-120b",
      fetch: fixtureGroqFetch(marker),
    });
    const deltas: string[] = [];
    let failure: unknown;

    try {
      await adapter.runWork(providerRequest({
        stream: true,
        onTextDelta(delta) {
          deltas.push(delta);
        },
      }));
    } catch (error) {
      failure = error;
    } finally {
      consoleError.mockRestore();
    }

    expect(deltas).toEqual(["Partial"]);
    expect(failure).toBeInstanceOf(TodosAiProviderError);
    expect(failure).toMatchObject({
      kind: "provider",
      retryable: false,
      message: "AI provider failure",
    });
    expect(logged.length).toBe(0);
    expect(JSON.stringify(failure)).not.toContain(marker);
  });

  test("never returns answered after a real SDK/Groq terminal stream error", async () => {
    const marker = "fixture-private-runtime-stream-response";
    const logged: unknown[][] = [];
    const consoleError = spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args);
    });
    const adapter = createGroqAdapter({
      apiKey: "fixture-api-key",
      model: "openai/gpt-oss-120b",
      fetch: fixtureGroqFetch(marker),
    });
    const runtime = createTodosAiRuntimeWithDependencies({
      package_name: "@hasna/todos",
      package_version: "0.15.21",
      protocol_version: 1,
    }, {
      providers: {
        groq: () => adapter,
      },
      createRunId: () => "run-real-stream-error",
    });
    const events: TodosAiRuntimeEvent[] = [];

    let result;
    try {
      result = await runtime.run({
        ...providerRequest().request,
        format: "stream-json",
      }, {
        signal: new AbortController().signal,
        emit(event) {
          events.push(event);
        },
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(events.filter((event) => event.type === "text.delta")).toHaveLength(1);
    expect(result.status).toBe("failed");
    expect(result.answer).toBeNull();
    expect(result.error).toEqual({
      code: "provider_error",
      message: "The AI provider request failed.",
      retryable: false,
      details: { kind: "provider" },
    });
    expect(logged.length).toBe(0);
    expect(JSON.stringify({ events, result })).not.toContain(marker);
  });

  test("treats abort stream parts as terminal failures", async () => {
    const streamText = (() => ({
      stream: {
        async *[Symbol.asyncIterator]() {
          yield { type: "text-delta", id: "text-1", text: "Partial" };
          yield { type: "abort", reason: "provider stream aborted" };
        },
      },
      text: Promise.resolve("Partial"),
      usage: Promise.resolve({
        inputTokens: 2,
        outputTokens: 1,
        totalTokens: 3,
      }),
      steps: Promise.resolve([{}]),
    })) as unknown as GroqSdkDependencies["streamText"];
    const { sdk } = fixtureSdk({ streamText });
    const adapter = createGroqAdapter({
      apiKey: "fixture-api-key",
      model: "openai/gpt-oss-120b",
      sdk,
    });
    let failure: unknown;

    try {
      await adapter.runWork(providerRequest({ stream: true }));
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(TodosAiProviderError);
    expect(failure).toMatchObject({
      kind: "provider",
      retryable: false,
      message: "AI provider failure",
    });
  });

  test("maps APICallError rate limits without exposing provider payloads", async () => {
    const marker = "fixture-private-response";
    const generateText = (async () => {
      throw new APICallError({
        message: marker,
        url: "https://provider.invalid",
        requestBodyValues: { prompt: marker },
        statusCode: 429,
        responseBody: marker,
        isRetryable: true,
      });
    }) as unknown as GroqSdkDependencies["generateText"];
    const { sdk } = fixtureSdk({ generateText });
    const adapter = createGroqAdapter({
      apiKey: "fixture-value",
      model: "openai/gpt-oss-120b",
      sdk,
    });

    let failure: unknown;
    try {
      await adapter.runWork(providerRequest());
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(TodosAiProviderError);
    expect(failure).toMatchObject({
      kind: "rate_limit",
      retryable: true,
      message: "AI provider rate limit",
    });
    expect(JSON.stringify(failure)).not.toContain(marker);
  });
});
