import OpenAI from "openai";
import { sanitizeTextForBoundary } from "../lib/finding-safety.js";

let _client: OpenAI | null = null;
let _clientApiKey: string | null = null;

export function getLLMClient(): OpenAI | null {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    _client = null;
    _clientApiKey = null;
    return null;
  }
  if (_client && _clientApiKey === apiKey) return _client;
  _client = new OpenAI({
    baseURL: "https://api.cerebras.ai/v1",
    apiKey,
  });
  _clientApiKey = apiKey;
  return _client;
}

export function getModel(): string {
  return process.env.CEREBRAS_MODEL || "llama-4-scout-17b-16e-instruct";
}

export function sanitizeMessagesForProvider(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return JSON.parse(JSON.stringify(messages), (_key, value) =>
    typeof value === "string" ? sanitizeTextForBoundary(value, 12_000) : value,
  ) as OpenAI.Chat.ChatCompletionMessageParam[];
}

export async function chat(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: { temperature?: number; max_tokens?: number },
): Promise<string | null> {
  const client = getLLMClient();
  if (!client) return null;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: getModel(),
        messages: sanitizeMessagesForProvider(messages),
        temperature: options?.temperature ?? 0.2,
        max_tokens: options?.max_tokens ?? 2048,
      });
      const content = response.choices[0]?.message?.content;
      return content == null ? null : sanitizeTextForBoundary(content, 12_000);
    } catch (error) {
      if (attempt === maxAttempts) return null;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 500),
      );
    }
  }
  return null;
}

export function isLLMAvailable(): boolean {
  return !!process.env.CEREBRAS_API_KEY;
}
