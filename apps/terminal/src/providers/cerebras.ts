// Cerebras provider — uses OpenAI-compatible API
// Default for open-source users. Fast inference on Llama models.

import type { LLMProvider, ProviderOptions, StreamCallbacks } from "./base.js";

const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";
const DEFAULT_MODEL = "qwen-3-235b-a22b-instruct-2507";

export class CerebrasProvider implements LLMProvider {
  readonly name = "cerebras";
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.CEREBRAS_API_KEY ?? "";
  }

  isAvailable(): boolean {
    return !!process.env.CEREBRAS_API_KEY;
  }

  async complete(prompt: string, options: ProviderOptions): Promise<string> {
    const model = options.model ?? DEFAULT_MODEL;
    const res = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens ?? 256,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cerebras API error ${res.status}: ${text}`);
    }

    const json = (await res.json()) as any;
    return (json.choices?.[0]?.message?.content ?? "").trim();
  }

  async stream(prompt: string, options: ProviderOptions, callbacks: StreamCallbacks): Promise<string> {
    const model = options.model ?? DEFAULT_MODEL;
    const res = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens ?? 256,
        stream: true,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cerebras API error ${res.status}: ${text}`);
    }

    let result = "";
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") break;

        try {
          const parsed = JSON.parse(data) as any;
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            result += delta;
            callbacks.onToken(result.trim());
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    return result.trim();
  }
}
