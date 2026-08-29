import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, ProviderOptions, StreamCallbacks } from "./base.js";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  /** Anthropic has no public per-key model-list endpoint — unknown means no filtering. */
  async listModels(): Promise<string[]> {
    return [];
  }

  async complete(prompt: string, options: ProviderOptions): Promise<string> {
    const message = await this.client.messages.create({
      model: options.model ?? "claude-haiku-4-5-20251001",
      max_tokens: options.maxTokens ?? 256,
      temperature: options.temperature ?? 0,
      ...(options.stop ? { stop_sequences: options.stop } : {}),
      system: [{ type: "text", text: options.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    if (block.type !== "text") throw new Error("Unexpected response type");
    return block.text.trim();
  }

  async stream(prompt: string, options: ProviderOptions, callbacks: StreamCallbacks): Promise<string> {
    let result = "";
    const stream = await this.client.messages.stream({
      model: options.model ?? "claude-haiku-4-5-20251001",
      max_tokens: options.maxTokens ?? 256,
      temperature: options.temperature ?? 0,
      ...(options.stop ? { stop_sequences: options.stop } : {}),
      system: [{ type: "text", text: options.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });
    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        result += chunk.delta.text;
        callbacks.onToken(result.trim());
      }
    }
    return result.trim();
  }
}
