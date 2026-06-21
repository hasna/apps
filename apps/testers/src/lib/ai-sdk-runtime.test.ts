import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AI_SDK_PLANNER_MODEL,
  DEFAULT_AI_SDK_TOOL_LOOP_RETRIES,
  loadAiSdkToolLoopHelpers,
  resolveAiSdkPlannerModel,
  runAiSdkToolLoop,
  type AiSdkToolLoopModule,
} from "./ai-sdk-runtime.js";

describe("AI SDK runtime helpers", () => {
  test("resolves the default planner model", () => {
    expect(resolveAiSdkPlannerModel()).toBe(DEFAULT_AI_SDK_PLANNER_MODEL);
    expect(resolveAiSdkPlannerModel("openai/gpt-4.1")).toBe("openai/gpt-4.1");
  });

  test("loads tool construction helpers without starting a model call", async () => {
    const helpers = await loadAiSdkToolLoopHelpers();
    expect(typeof helpers.jsonSchema).toBe("function");
    expect(typeof helpers.tool).toBe("function");
  });

  test("runs the tool loop through one centralized generateText call", async () => {
    const calls: unknown[] = [];
    const stopWhen = () => true;
    const tools = {};
    const ai = {
      generateText: async (options: unknown) => {
        calls.push(options);
        return { text: "" };
      },
      hasToolCall: (toolName: string) => {
        calls.push({ toolName });
        return stopWhen;
      },
      jsonSchema: (schema: unknown) => schema,
      tool: (definition: unknown) => definition,
    } as unknown as AiSdkToolLoopModule;

    await runAiSdkToolLoop({
      tools,
      prompt: "Review workflow failures",
      finishToolName: "finish_workflow_review",
      module: ai,
    });

    expect(calls[0]).toEqual({ toolName: "finish_workflow_review" });
    expect(calls[1]).toMatchObject({
      model: DEFAULT_AI_SDK_PLANNER_MODEL,
      tools,
      prompt: "Review workflow failures",
      maxRetries: DEFAULT_AI_SDK_TOOL_LOOP_RETRIES,
    });
    expect((calls[1] as { stopWhen: unknown }).stopWhen).toBe(stopWhen);
  });
});
