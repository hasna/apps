import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicAdapterConfig, ConversationTurn } from "../types/index.js";
import type { AdapterResponse } from "./http.js";

export async function callAnthropicAdapter(
  config: AnthropicAdapterConfig,
  input: string,
  turns?: ConversationTurn[]
): Promise<AdapterResponse> {
  const start = Date.now();
  const client = new Anthropic({ apiKey: config.apiKey ?? process.env["ANTHROPIC_API_KEY"] });

  try {
    const messages: Anthropic.MessageParam[] = turns && turns.length > 0
      ? turns.map((t) => ({ role: t.role as "user" | "assistant", content: t.content }))
      : [{ role: "user", content: input }];

    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens ?? 4096,
      system: config.systemPrompt,
      messages,
    });

    const output = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const toolCalls = response.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        name: b.name,
        arguments: b.input as Record<string, unknown>,
      }));

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

    return {
      output,
      durationMs: Date.now() - start,
      inputTokens,
      outputTokens,
      costUsd,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  } catch (err) {
    return {
      output: "",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
