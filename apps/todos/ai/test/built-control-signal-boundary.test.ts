import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  TodosAiNeedsApprovalSignal,
  TodosAiNeedsInputSignal,
  type TodosAiRunRequest,
  type TodosAiRuntimeEvent,
  type TodosAiRuntimeHostContext,
} from "@hasna/todos";
import type {
  CreateGroqAdapterOptions,
  GroqSdkDependencies,
} from "../src/providers/groq";
import type { TodosAiRuntimeDependencies } from "../src/types";

const packageRoot = join(import.meta.dir, "..");
const hostContext: TodosAiRuntimeHostContext = {
  package_name: "@hasna/todos",
  package_version: "0.15.25",
  protocol_version: 1,
};

let builtRuntime: typeof import("../src/runtime");
let builtGroq: typeof import("../src/providers/groq");

beforeAll(async () => {
  const build = Bun.spawn(["bun", "run", "build"], {
    cwd: packageRoot,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    build.exited,
    new Response(build.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`companion build failed (${exitCode}): ${stderr}`);
  }

  const cacheKey = crypto.randomUUID();
  builtRuntime = await import(
    `${pathToFileURL(join(packageRoot, "dist/runtime.js")).href}?boundary=${cacheKey}`
  ) as typeof import("../src/runtime");
  builtGroq = await import(
    `${pathToFileURL(join(packageRoot, "dist/providers/groq.js")).href}?boundary=${cacheKey}`
  ) as typeof import("../src/providers/groq");
}, 30_000);

function request(): TodosAiRunRequest {
  return {
    schema_version: 1,
    prompt: "Exercise one host control signal.",
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
    resume_run_id: "built-boundary-run",
  };
}

function sdkThatCapturesToolFailure(): GroqSdkDependencies {
  const createGroq = (() => () => ({ fixture: "model" })) as unknown as
    GroqSdkDependencies["createGroq"];
  const generateText = (async (options: Record<string, unknown>) => {
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
        toolCallId: "built-boundary-control",
        messages: [],
        abortSignal: options["abortSignal"] as AbortSignal,
        context: {},
      });
    } catch {
      // The real SDK captures tool failures for the model. The adapter must
      // retain control signals outside that model-visible error path.
    }
    return {
      text: "The provider continued after the tool failure.",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
      steps: [{}],
    };
  }) as unknown as GroqSdkDependencies["generateText"];
  const streamText = (() => {
    throw new Error("streaming is outside this regression");
  }) as unknown as GroqSdkDependencies["streamText"];
  return { createGroq, generateText, streamText };
}

async function runAcrossBuiltBoundary(signal: Error) {
  const adapter = builtGroq.createGroqAdapter({
    apiKey: "fixture",
    model: "openai/gpt-oss-120b",
    sdk: sdkThatCapturesToolFailure(),
  } satisfies CreateGroqAdapterOptions);
  const dependencies: TodosAiRuntimeDependencies = {
    providers: {
      groq: () => adapter,
    },
    toolSource: async () => [{
      name: "control",
      description: "Throw one host-created control signal.",
      effect: "control",
      inputSchema: { type: "object" },
      execute: async () => {
        throw signal;
      },
    }],
    createRunId: () => "unexpected-new-run",
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  };
  const runtime = builtRuntime.createTodosAiRuntimeWithDependencies(
    hostContext,
    dependencies,
  );
  const events: TodosAiRuntimeEvent[] = [];
  const result = await runtime.run(request(), {
    signal: new AbortController().signal,
    emit(event) {
      events.push(event);
    },
  });
  return { events, result };
}

describe("built companion control-signal boundary", () => {
  test("recognizes host clarification and approval signals across bundled constructors", async () => {
    const cases = [
      {
        signal: new TodosAiNeedsInputSignal({
          prompt: "Which exact task should be updated?",
          fields: ["task_id"],
        }),
        status: "needs_input",
        event: "input.required",
      },
      {
        signal: new TodosAiNeedsApprovalSignal({
          id: "approval-built-boundary",
          summary: "Approve one exact task update.",
          operations: [{
            operation: "update_task",
            task_id: "10000000-0000-4000-8000-000000000001",
          }],
        }),
        status: "needs_approval",
        event: "approval.required",
      },
    ] as const;

    for (const item of cases) {
      const { events, result } = await runAcrossBuiltBoundary(item.signal);
      expect(result.status).toBe(item.status);
      expect(result.run_id).toBe("built-boundary-run");
      expect(events.at(-1)?.type).toBe(item.event);
    }
  }, 30_000);

  test("does not treat arbitrary or accessor-backed errors as control signals", async () => {
    const malformed = new Error("Todos AI input required");
    malformed.name = "TodosAiNeedsInputSignal";
    Object.defineProperty(malformed, "pending_input", {
      value: { prompt: "Which task?", fields: [] },
    });
    expect((await runAcrossBuiltBoundary(malformed)).result).toMatchObject({
      status: "answered",
      pending_input: null,
      pending_approval: null,
    });

    let accessorCalls = 0;
    const accessorBacked = new Error("Todos AI approval required");
    accessorBacked.name = "TodosAiNeedsApprovalSignal";
    Object.defineProperty(accessorBacked, "pending_approval", {
      get() {
        accessorCalls += 1;
        return {
          id: "approval-accessor",
          summary: "Must not be read.",
          operations: [{ operation: "update_task" }],
        };
      },
    });
    expect((await runAcrossBuiltBoundary(accessorBacked)).result).toMatchObject({
      status: "answered",
      pending_input: null,
      pending_approval: null,
    });
    expect(accessorCalls).toBe(0);
  }, 30_000);

  test("does not inspect Proxy-backed payloads on ordinary errors", async () => {
    let payloadGets = 0;
    const pendingInput = new Proxy(
      { prompt: "Must not be read.", fields: ["task_id"] },
      {
        get(target, property, receiver) {
          payloadGets += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const proxyBacked = new Error("Todos AI input required");
    proxyBacked.name = "TodosAiNeedsInputSignal";
    Object.defineProperty(proxyBacked, "pending_input", {
      value: pendingInput,
    });

    const { result } = await runAcrossBuiltBoundary(proxyBacked);
    expect({ payloadGets, result }).toMatchObject({
      payloadGets: 0,
      result: {
        status: "answered",
        pending_input: null,
        pending_approval: null,
      },
    });
  }, 30_000);
});
