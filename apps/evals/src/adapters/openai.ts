import OpenAI from "openai";
import type { OpenAIAdapterConfig, ConversationTurn } from "../types/index.js";
import type { AdapterResponse } from "./http.js";

function normalizeBaseURL(baseURL: string | undefined): string | undefined {
  if (!baseURL) return undefined;

  try {
    const url = new URL(baseURL);
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = "/v1";
      return url.toString();
    }
  } catch {
    return baseURL;
  }

  return baseURL;
}

function resolveApiKey(config: OpenAIAdapterConfig): string | undefined {
  if (config.apiKey) return config.apiKey;
  if (config.baseURL) return "ollama";
  return process.env["OPENAI_API_KEY"];
}

export async function callOpenAIAdapter(
  config: OpenAIAdapterConfig,
  input: string,
  turns?: ConversationTurn[]
): Promise<AdapterResponse> {
  const start = Date.now();

  try {
    const client = new OpenAI({
      apiKey: resolveApiKey(config),
      baseURL: normalizeBaseURL(config.baseURL),
    });
    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (config.systemPrompt) messages.push({ role: "system", content: config.systemPrompt });

    if (turns && turns.length > 0) {
      for (const t of turns) messages.push({ role: t.role, content: t.content });
    } else {
      messages.push({ role: "user", content: input });
    }

    const response = await client.chat.completions.create({
      model: config.model,
      max_tokens: config.maxTokens ?? 4096,
      messages,
    });

    const output = response.choices[0]?.message?.content ?? "";
    const toolCalls = response.choices[0]?.message?.tool_calls?.map((tc) => {
      // openai v6: tool call shape changed — function may be on different property
      const fn = (tc as unknown as { function?: { name: string; arguments: string } }).function ?? tc;
      return {
        name: (fn as { name: string }).name,
        arguments: JSON.parse((fn as { arguments: string }).arguments || "{}") as Record<string, unknown>,
      };
    });

    const inputTokens = response.usage?.prompt_tokens;
    const outputTokens = response.usage?.completion_tokens;
    // GPT-4o approximate pricing
    const costUsd = inputTokens && outputTokens
      ? (inputTokens * 2.5 + outputTokens * 10) / 1_000_000
      : undefined;

    return {
      output,
      durationMs: Date.now() - start,
      inputTokens,
      outputTokens,
      costUsd,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  } catch (err) {
    return {
      output: "",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
