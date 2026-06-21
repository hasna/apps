import type { GenerateTextResult, LanguageModel, ToolSet } from "ai";

export const DEFAULT_AI_SDK_PLANNER_MODEL = "openai/gpt-4.1-mini";
export const DEFAULT_AI_SDK_TOOL_LOOP_RETRIES = 1;

type AiSdkModule = Pick<
  typeof import("ai"),
  "generateText" | "hasToolCall" | "jsonSchema" | "tool"
>;

export type AiSdkToolSet = ToolSet;
export type AiSdkJsonSchemaFactory = AiSdkModule["jsonSchema"];
export type AiSdkToolFactory = AiSdkModule["tool"];

export interface AiSdkToolLoopHelpers {
  jsonSchema: AiSdkJsonSchemaFactory;
  tool: AiSdkToolFactory;
}

export interface AiSdkToolLoopModule extends AiSdkToolLoopHelpers {
  generateText: AiSdkModule["generateText"];
  hasToolCall: AiSdkModule["hasToolCall"];
}

export interface AiSdkToolLoopOptions<TOOLS extends AiSdkToolSet> {
  model?: string;
  tools: TOOLS;
  prompt: string;
  finishToolName: Extract<keyof TOOLS, string> | string;
  maxRetries?: number;
  module?: AiSdkToolLoopModule;
}

export async function loadAiSdkToolLoopModule(): Promise<AiSdkToolLoopModule> {
  const { generateText, hasToolCall, jsonSchema, tool } = await import("ai");
  return { generateText, hasToolCall, jsonSchema, tool };
}

export async function loadAiSdkToolLoopHelpers(): Promise<AiSdkToolLoopHelpers> {
  const { jsonSchema, tool } = await loadAiSdkToolLoopModule();
  return { jsonSchema, tool };
}

export function resolveAiSdkPlannerModel(model?: string): LanguageModel {
  return (model ?? DEFAULT_AI_SDK_PLANNER_MODEL) as LanguageModel;
}

export async function runAiSdkToolLoop<TOOLS extends AiSdkToolSet>(
  options: AiSdkToolLoopOptions<TOOLS>,
): Promise<GenerateTextResult<TOOLS, any>> {
  const ai = options.module ?? await loadAiSdkToolLoopModule();

  return ai.generateText({
    model: resolveAiSdkPlannerModel(options.model),
    tools: options.tools,
    stopWhen: ai.hasToolCall(options.finishToolName),
    prompt: options.prompt,
    maxRetries: options.maxRetries ?? DEFAULT_AI_SDK_TOOL_LOOP_RETRIES,
  });
}
