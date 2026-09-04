/**
 * Provider-agnostic LLM client for the connectors monorepo.
 *
 * Supports: cerebras, groq, openai, anthropic
 * Config stored at: <connectors data root>/llm.json
 *
 * Cerebras and Groq are OpenAI-compatible (same SDK, different base URLs).
 * Anthropic has its own API format.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getConnectorsHome } from "../db/database.js";

export type LLMProvider = "cerebras" | "groq" | "openai" | "anthropic";

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  api_key: string;
  strip: boolean;
}

export interface LLMResponse {
  content: string;
  provider: LLMProvider;
  model: string;
  latency_ms: number;
}

// Provider base URLs (OpenAI-compatible APIs)
const PROVIDER_BASE_URLS: Record<string, string> = {
  cerebras: "https://api.cerebras.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
};

// Default models per provider
export const PROVIDER_DEFAULTS: Record<LLMProvider, { model: string }> = {
  cerebras: { model: "qwen-3-32b" },
  groq: { model: "llama-3.3-70b-versatile" },
  openai: { model: "gpt-4o-mini" },
  anthropic: { model: "claude-haiku-4-5-20251001" },
};

function getLlmConfigPath(): string {
  return join(getConnectorsHome(), "llm.json");
}

export function getLlmConfig(): LLMConfig | null {
  const path = getLlmConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as LLMConfig;
  } catch {
    return null;
  }
}

export function saveLlmConfig(config: LLMConfig): void {
  const dir = getConnectorsHome();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getLlmConfigPath(), JSON.stringify(config, null, 2));
}

export function setLlmStrip(enabled: boolean): void {
  const config = getLlmConfig();
  if (!config) throw new Error("No LLM config found. Run: connectors llm set --provider <provider> --key <key>");
  saveLlmConfig({ ...config, strip: enabled });
}

export function isStripEnabled(): boolean {
  return getLlmConfig()?.strip === true;
}

/** Mask API key for display: show first 8 chars + *** */
export function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 8) + "***";
}

export class LLMClient {
  constructor(private config: LLMConfig) {}

  static fromConfig(): LLMClient | null {
    const config = getLlmConfig();
    if (!config) return null;
    return new LLMClient(config);
  }

  async complete(prompt: string, content: string): Promise<LLMResponse> {
    const start = Date.now();
    const { provider, model, api_key } = this.config;

    if (provider === "anthropic") {
      return this._anthropicComplete(prompt, content, start);
    }

    // OpenAI-compatible: cerebras, groq, openai
    const baseUrl = PROVIDER_BASE_URLS[provider];
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${api_key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content },
        ],
        temperature: 0,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM request failed (${provider} ${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return {
      content: data.choices[0].message.content,
      provider,
      model,
      latency_ms: Date.now() - start,
    };
  }

  private async _anthropicComplete(
    prompt: string,
    content: string,
    start: number
  ): Promise<LLMResponse> {
    const { model, api_key } = this.config;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: prompt,
        messages: [{ role: "user", content }],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM request failed (anthropic ${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      content: Array<{ text: string }>;
    };

    return {
      content: data.content[0].text,
      provider: "anthropic",
      model,
      latency_ms: Date.now() - start,
    };
  }
}
