import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export interface ResolveGoalModelOptions {
  model?: string;
  baseURL?: string;
  apiKey?: string;
  env?: NodeJS.ProcessEnv;
}

export const DEFAULT_GOAL_MODEL = "openai/gpt-4o-mini";

export function resolveGoalModel(opts: ResolveGoalModelOptions = {}): LanguageModel {
  const env = opts.env ?? process.env;
  const apiKey = opts.apiKey ?? env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required to run goals with the OpenRouter AI SDK provider");
  }
  const provider = createOpenRouter({
    apiKey,
    baseURL: opts.baseURL ?? env.LOOPS_GOAL_BASE_URL ?? env.OPENROUTER_BASE_URL,
  });
  return provider.chat(opts.model ?? env.LOOPS_GOAL_MODEL ?? DEFAULT_GOAL_MODEL);
}

export function resolveGoalVerifierModel(opts: ResolveGoalModelOptions = {}): LanguageModel {
  const env = opts.env ?? process.env;
  return resolveGoalModel({ ...opts, model: opts.model ?? env.LOOPS_GOAL_VERIFIER_MODEL });
}
