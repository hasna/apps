import { createGroq as sdkCreateGroq, type GroqProviderSettings } from "@ai-sdk/groq";
import {
  APICallError,
  Output,
  generateText as sdkGenerateText,
  jsonSchema,
  stepCountIs,
  streamText as sdkStreamText,
  tool,
  type JSONSchema7,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
import {
  type TodosAiNeedsApprovalSignal,
  type TodosAiNeedsInputSignal,
  type TodosAiJsonValue,
} from "@hasna/todos";
import { normalizeTodosAiControlSignal } from "../control-signals";
import {
  TODOS_AI_RUNTIME_LIMITS,
  TodosAiProviderError,
  TodosAiSchemaError,
  TodosAiToolError,
  type TodosAiProviderAdapter,
  type TodosAiProviderLoader,
  type TodosAiProviderUsage,
  type TodosAiProviderWorkRequest,
} from "../types";

export interface GroqSdkDependencies {
  createGroq: typeof sdkCreateGroq;
  generateText: typeof sdkGenerateText;
  streamText: typeof sdkStreamText;
}

export interface CreateGroqAdapterOptions {
  apiKey: string;
  model: string;
  fetch?: GroqProviderSettings["fetch"];
  sdk?: GroqSdkDependencies;
}

export interface CreateGroqProviderLoaderOptions {
  readApiKey?: () => string | undefined;
  createAdapter?: (options: CreateGroqAdapterOptions) => TodosAiProviderAdapter;
  fetch?: GroqProviderSettings["fetch"];
  sdk?: GroqSdkDependencies;
}

const defaultSdk: GroqSdkDependencies = {
  createGroq: sdkCreateGroq,
  generateText: sdkGenerateText,
  streamText: sdkStreamText,
};

function providerUsage(usage: LanguageModelUsage): TodosAiProviderUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError");
}

function mapProviderError(error: unknown, signal: AbortSignal): never {
  const controlSignal = normalizeTodosAiControlSignal(error);
  if (controlSignal !== null) throw controlSignal;
  if (
    error instanceof TodosAiProviderError ||
    error instanceof TodosAiToolError ||
    error instanceof TodosAiSchemaError
  ) {
    throw error;
  }
  if (isAbortError(error, signal)) {
    throw new DOMException("Aborted", "AbortError");
  }
  if (APICallError.isInstance(error)) {
    const credentialsRejected = error.statusCode === 401 || error.statusCode === 403;
    throw new TodosAiProviderError(
      credentialsRejected
        ? "credentials_rejected"
        : error.statusCode === 429
          ? "rate_limit"
          : "provider",
      credentialsRejected ? false : error.statusCode === 429 || error.isRetryable,
    );
  }
  throw new TodosAiProviderError("provider", false);
}

function sdkTools(
  work: TodosAiProviderWorkRequest,
  signal: AbortSignal,
  onControlSignal: (
    signal: TodosAiNeedsInputSignal | TodosAiNeedsApprovalSignal,
  ) => void,
): ToolSet | undefined {
  if (work.tools.length === 0) return undefined;
  const definitions: ToolSet = {};
  for (const definition of work.tools) {
    definitions[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema as JSONSchema7),
      execute: async (input, options) => {
        try {
          return await definition.execute(input, {
            signal: options.abortSignal ?? signal,
            request: work.request,
            toolCallId: options.toolCallId,
          });
        } catch (error) {
          const controlSignal = normalizeTodosAiControlSignal(error);
          if (controlSignal !== null) {
            onControlSignal(controlSignal);
            throw controlSignal;
          }
          if (isAbortError(error, signal)) throw error;
          if (error instanceof TodosAiToolError) throw error;
          throw new TodosAiToolError({ cause: error });
        }
      },
    });
  }
  return definitions;
}

function createProviderAbortScope(parent: AbortSignal): {
  signal: AbortSignal;
  abort(reason: unknown): void;
  dispose(): void;
} {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent.reason);
  if (parent.aborted) {
    abortFromParent();
  } else {
    parent.addEventListener("abort", abortFromParent, { once: true });
  }
  return {
    signal: controller.signal,
    abort(reason) {
      if (!controller.signal.aborted) controller.abort(reason);
    },
    dispose() {
      parent.removeEventListener("abort", abortFromParent);
    },
  };
}

export function createGroqAdapter(
  options: CreateGroqAdapterOptions,
): TodosAiProviderAdapter {
  const sdk = options.sdk ?? defaultSdk;
  const provider = sdk.createGroq({
    apiKey: options.apiKey,
    fetch: options.fetch,
  });
  const model = provider(options.model);

  return {
    async runWork(work) {
      const providerAbort = createProviderAbortScope(work.signal);
      let controlSignal: TodosAiNeedsInputSignal | TodosAiNeedsApprovalSignal | null = null;
      const tools = sdkTools(work, providerAbort.signal, (signal) => {
        controlSignal ??= signal;
        providerAbort.abort(signal);
      });
      const providerOptions = {
        groq: {
          parallelToolCalls: false,
          structuredOutputs: false,
          strictJsonSchema: false,
        },
      };

      try {
        if (work.stream) {
          const result = sdk.streamText({
            model,
            prompt: work.prompt,
            tools,
            maxRetries: 0,
            abortSignal: providerAbort.signal,
            maxOutputTokens: TODOS_AI_RUNTIME_LIMITS.max_output_tokens,
            stopWhen: stepCountIs(work.maxSteps),
            providerOptions,
            onError() {
              // Provider errors are handled from the typed stream below.
            },
          });
          for await (const part of result.stream) {
            if (part.type === "text-delta") {
              work.onTextDelta(part.text);
              continue;
            }
            if (part.type === "error") {
              if (controlSignal !== null) throw controlSignal;
              return mapProviderError(part.error, providerAbort.signal);
            }
            if (part.type === "abort") {
              if (controlSignal !== null) throw controlSignal;
              if (providerAbort.signal.aborted) {
                throw new DOMException("Aborted", "AbortError");
              }
              throw new TodosAiProviderError("provider", false);
            }
          }
          const [text, usage, steps] = await Promise.all([
            result.text,
            result.usage,
            result.steps,
          ]);
          if (controlSignal !== null) throw controlSignal;
          return {
            text,
            usage: providerUsage(usage),
            steps: steps.length,
          };
        }

        const result = await sdk.generateText({
          model,
          prompt: work.prompt,
          tools,
          maxRetries: 0,
          abortSignal: providerAbort.signal,
          maxOutputTokens: TODOS_AI_RUNTIME_LIMITS.max_output_tokens,
          stopWhen: stepCountIs(work.maxSteps),
          providerOptions,
        });
        if (controlSignal !== null) throw controlSignal;
        return {
          text: result.text,
          usage: providerUsage(result.usage),
          steps: result.steps.length,
        };
      } catch (error) {
        if (controlSignal !== null) throw controlSignal;
        return mapProviderError(error, providerAbort.signal);
      } finally {
        providerAbort.dispose();
      }
    },

    async finalize(finalize) {
      try {
        const result = await sdk.generateText({
          model,
          prompt: [
            "Return only a final answer matching the supplied JSON Schema.",
            "Do not call tools. Do not add fields not permitted by the schema.",
            "",
            "Source answer:",
            finalize.sourceText,
          ].join("\n"),
          maxRetries: 0,
          abortSignal: finalize.signal,
          maxOutputTokens: TODOS_AI_RUNTIME_LIMITS.max_output_tokens,
          output: Output.object({
            schema: jsonSchema<TodosAiJsonValue>(finalize.schema as JSONSchema7),
            name: "todos_ai_result",
          }),
          providerOptions: {
            groq: {
              parallelToolCalls: false,
              structuredOutputs: true,
              strictJsonSchema: true,
            },
          },
        });
        return {
          data: result.output,
          usage: providerUsage(result.usage),
          steps: result.steps.length,
        };
      } catch (error) {
        if (isAbortError(error, finalize.signal)) {
          throw new DOMException("Aborted", "AbortError");
        }
        if (APICallError.isInstance(error)) {
          return mapProviderError(error, finalize.signal);
        }
        if (error instanceof TodosAiProviderError) throw error;
        throw new TodosAiSchemaError({ cause: error });
      }
    },
  };
}

export function createGroqProviderLoader(
  options: CreateGroqProviderLoaderOptions = {},
): TodosAiProviderLoader {
  const readApiKey = options.readApiKey ?? (() => process.env["GROQ_API_KEY"]);
  const createAdapter = options.createAdapter ?? createGroqAdapter;

  return (selection) => {
    if (selection.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const apiKey = readApiKey();
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new TodosAiProviderError("missing_credentials", false);
    }
    return createAdapter({
      apiKey,
      model: selection.model,
      fetch: options.fetch,
      sdk: options.sdk,
    });
  };
}
