import type {
  TodosAiRuntime,
  TodosAiRuntimeHostContext,
} from "@hasna/todos";
import { createTodosAiOrchestrator } from "./orchestrator";
import { createGroqProviderLoader } from "./providers/groq";
import type { TodosAiRuntimeDependencies } from "./types";

export const TODOS_AI_RUNTIME_PROTOCOL_VERSION = 1 as const;

export function createTodosAiRuntimeWithDependencies(
  context: TodosAiRuntimeHostContext,
  dependencies: TodosAiRuntimeDependencies,
): TodosAiRuntime {
  return createTodosAiOrchestrator(context, {
    ...dependencies,
    toolSource: context.tool_source ?? dependencies.toolSource,
  });
}

export function createTodosAiRuntime(
  context: TodosAiRuntimeHostContext,
): TodosAiRuntime {
  return createTodosAiRuntimeWithDependencies(context, {
    providers: {
      groq: createGroqProviderLoader(),
    },
  });
}
