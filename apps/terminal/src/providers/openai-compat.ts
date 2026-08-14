// Shared base class for OpenAI-compatible providers (Cerebras, Groq, xAI)
// Eliminates ~200 lines of duplicated streaming SSE parsing

import type { LLMProvider, ProviderOptions, StreamCallbacks } from "./base.js";

export abstract class OpenAICompatibleProvider implements LLMProvider {
  abstract readonly name: string;
  protected abstract readonly baseUrl: string;
  protected abstract readonly defaultModel: string;
  protected abstract readonly apiKeyEnvVar: string;

  protected get apiKey(): string {
    return process.env[this.apiKeyEnvVar] ?? "";
  }

  isAvailable(): boolean {
    return !!process.env[this.apiKeyEnvVar];
  }

  async complete(prompt: string, options: ProviderOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 256,
        temperature: options.temperature ?? 0,
        ...(options.stop ? { stop: options.stop } : {}),
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${this.name} API error ${res.status}: ${text}`);
    }

    const json = (await res.json()) as any;
    return (json.choices?.[0]?.message?.content ?? "").trim();
  }

  async stream(prompt: string, options: ProviderOptions, callbacks: StreamCallbacks): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? 256,
        temperature: options.temperature ?? 0,
        stream: true,
        ...(options.stop ? { stop: options.stop } : {}),
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${this.name} API error ${res.status}: ${text}`);
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
