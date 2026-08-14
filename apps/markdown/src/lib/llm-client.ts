// LLM Client — pluggable cheap model client for OMP execution

import type { LLMClient, LLMClientOptions, CardContext } from "../types/index.js";

/**
 * Create an LLM client based on provider configuration.
 */
export function createLLMClient(options: LLMClientOptions): LLMClient {
  switch (options.provider) {
    case "anthropic":
      return new AnthropicClient(options);
    case "openai":
      return new OpenAIClient(options);
    case "ollama":
      return new OllamaClient(options);
    default:
      throw new Error(`Unknown LLM provider: ${options.provider}`);
  }
}

/**
 * Build a focused prompt for the cheap LLM from card context.
 */
export function buildPrompt(inlineContent: string, context?: CardContext): string {
  const parts: string[] = [];

  parts.push("You are filling a hole in an Open Markdown Protocol (OMP) document.");
  parts.push("Respond with ONLY the answer. No explanation, no code fences, no markdown formatting.");

  if (context?.card) {
    parts.push(`\nCard type: ${context.card.type}`);
    parts.push(`Card id: ${context.card.id}`);

    // Include relevant header data
    const headerEntries = Object.entries(context.card.headers);
    if (headerEntries.length > 0) {
      parts.push("Structured data already extracted:");
      for (const [k, v] of headerEntries) {
        parts.push(`  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
      }
    }

    // Include accepts as constraints
    if (context.card.accepts.length > 0) {
      parts.push(`\nConstraints: ${context.card.accepts.join("; ")}`);
    }
  }

  // Include related cards for context
  if (context?.relatedCards && context.relatedCards.length > 0) {
    parts.push("\nRelated cards for context:");
    for (const rel of context.relatedCards.slice(0, 5)) {
      parts.push(`  [${rel.type}:${rel.id}] ${rel.body.raw.slice(0, 200)}`);
    }
  }

  parts.push(`\nYour task: ${inlineContent}`);

  return parts.join("\n");
}

/**
 * Anthropic client (Claude Haiku).
 */
class AnthropicClient implements LLMClient {
  provider = "anthropic";
  model: string;
  private apiKey: string;
  private maxTokens: number;

  constructor(options: LLMClientOptions) {
    this.model = options.model || "claude-haiku-4-5-20251001";
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.maxTokens = options.maxTokens || 1024;
  }

  async complete(prompt: string, context?: CardContext): Promise<string> {
    const fullPrompt = buildPrompt(prompt, context);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: "user", content: fullPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as any;
    return data.content?.[0]?.text?.trim() ?? "";
  }
}

/**
 * OpenAI client (GPT-4o-mini).
 */
class OpenAIClient implements LLMClient {
  provider = "openai";
  model: string;
  private apiKey: string;
  private maxTokens: number;

  constructor(options: LLMClientOptions) {
    this.model = options.model || "gpt-4o-mini";
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
    this.maxTokens = options.maxTokens || 1024;
  }

  async complete(prompt: string, context?: CardContext): Promise<string> {
    const fullPrompt = buildPrompt(prompt, context);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [
          { role: "system", content: "You are a precise code generation assistant. Respond with ONLY the requested output." },
          { role: "user", content: fullPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as any;
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }
}

/**
 * Ollama client (local models).
 */
class OllamaClient implements LLMClient {
  provider = "ollama";
  model: string;
  private baseUrl: string;

  constructor(options: LLMClientOptions) {
    this.model = options.model || "llama3";
    this.baseUrl = options.baseUrl || "http://localhost:11434";
  }

  async complete(prompt: string, context?: CardContext): Promise<string> {
    const fullPrompt = buildPrompt(prompt, context);

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: fullPrompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as any;
    return data.response?.trim() ?? "";
  }
}

/**
 * Mock client for testing — returns predictable responses.
 */
export class MockLLMClient implements LLMClient {
  provider = "mock";
  model = "mock";
  calls: { prompt: string; context?: CardContext }[] = [];
  private responses: string[];
  private callIndex = 0;

  constructor(responses: string[] = ["mock-response"]) {
    this.responses = responses;
  }

  async complete(prompt: string, context?: CardContext): Promise<string> {
    this.calls.push({ prompt, context });
    const response = this.responses[this.callIndex % this.responses.length];
    this.callIndex++;
    return response;
  }
}
