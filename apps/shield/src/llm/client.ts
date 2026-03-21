import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getLLMClient(): OpenAI | null {
  if (_client) return _client;
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) return null;
  _client = new OpenAI({
    baseURL: "https://api.cerebras.ai/v1",
    apiKey,
  });
  return _client;
}

export function getModel(): string {
  return process.env.CEREBRAS_MODEL || "llama-4-scout-17b-16e-instruct";
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
        messages,
        temperature: options?.temperature ?? 0.2,
        max_tokens: options?.max_tokens ?? 2048,
      });
      return response.choices[0]?.message?.content ?? null;
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
