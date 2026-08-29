// Shared base class for OpenAI-compatible providers (Cerebras, Groq, xAI)
// Eliminates ~200 lines of duplicated streaming SSE parsing

import type { LLMProvider, ProviderOptions, StreamCallbacks } from "./base.js";
import { selectAccessibleModel } from "./base.js";

export abstract class OpenAICompatibleProvider implements LLMProvider {
  abstract readonly name: string;
  protected abstract readonly baseUrl: string;
  protected abstract readonly defaultModel: string;
  protected abstract readonly apiKeyEnvVar: string;

  /**
   * Preferred models in order of priority. The default model is resolved
   * against the configured key's own model list (GET /models), so a key
   * that cannot access a hardcoded model gets the first accessible
   * preference instead of a 404 (O15-04797).
   */
  protected readonly preferredModels: string[] = [];

  /**
   * Whether this provider's models accept the OpenAI `stop` parameter.
   * xAI's grok fast/reasoning models reject it with 400, so the xAI provider
   * disables it (O15-04797).
   */
  protected readonly supportsStop: boolean = true;

  protected get apiKey(): string {
    return process.env[this.apiKeyEnvVar] ?? "";
  }

  isAvailable(): boolean {
    return !!process.env[this.apiKeyEnvVar];
  }

  private _models: string[] | null = null;
  private _modelsAt = 0;

  /** Model ids the configured key can access (cached 5 min); [] on failure. */
  async listModels(): Promise<string[]> {
    const now = Date.now();
    if (this._models && now - this._modelsAt < 300_000) return this._models;
    this._models = [];
    this._modelsAt = now;
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) return this._models;
      const json = (await res.json()) as { data?: { id?: string }[] };
      this._models = (json.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    } catch {
      // Offline / network error — leave the list empty; callers fall back to static defaults.
    }
    return this._models;
  }

  private _defaultModelResolved: string | null = null;

  /** Resolve the default model against the key's accessible model list (cached per instance). */
  protected async resolveDefaultModel(): Promise<string> {
    if (this._defaultModelResolved) return this._defaultModelResolved;
    const accessible = await this.listModels();
    const preferred = this.preferredModels.length > 0 ? this.preferredModels : [this.defaultModel];
    this._defaultModelResolved = selectAccessibleModel(preferred, accessible, this.defaultModel);
    return this._defaultModelResolved;
  }

  async complete(prompt: string, options: ProviderOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? await this.resolveDefaultModel(),
        max_tokens: options.maxTokens ?? 256,
        temperature: options.temperature ?? 0,
        ...(options.stop && this.supportsStop ? { stop: options.stop } : {}),
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
        model: options.model ?? await this.resolveDefaultModel(),
        max_tokens: options.maxTokens ?? 256,
        temperature: options.temperature ?? 0,
        stream: true,
        ...(options.stop && this.supportsStop ? { stop: options.stop } : {}),
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
