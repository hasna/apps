// xAI/Grok provider — uses OpenAI-compatible API
// grok-code-fast-1 for code tasks, grok-4-fast for general queries.

import type { LLMProvider, ProviderOptions, StreamCallbacks } from "./base.js";

const XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-code-fast-1";

export class XaiProvider implements LLMProvider {
  readonly name = "xai";
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.XAI_API_KEY ?? "";
  }

  isAvailable(): boolean {
    return !!process.env.XAI_API_KEY;
  }

  async complete(prompt: string, options: ProviderOptions): Promise<string> {
    const model = options.model ?? DEFAULT_MODEL;
    const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
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
      throw new Error(`xAI API error ${res.status}: ${text}`);
    }

    const json = (await res.json()) as any;
    return (json.choices?.[0]?.message?.content ?? "").trim();
  }

  async stream(prompt: string, options: ProviderOptions, callbacks: StreamCallbacks): Promise<string> {
    const model = options.model ?? DEFAULT_MODEL;
    const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
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
      throw new Error(`xAI API error ${res.status}: ${text}`);
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
