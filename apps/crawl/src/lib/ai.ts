import type { AiExtractionOptions, AiProvider } from "../types/index.js";

// ─── Provider check ───────────────────────────────────────────────────────────

export function checkAiProviders(): { openai: boolean; anthropic: boolean } {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveProvider(options?: AiExtractionOptions): AiProvider {
  if (options?.provider) return options.provider;
  const { openai, anthropic } = checkAiProviders();
  if (openai) return "openai";
  if (anthropic) return "anthropic";
  throw new Error(
    "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY."
  );
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  model: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI API error ${response.status}: ${body}`);
  }

  interface OpenAIResponse {
    choices: Array<{ message: { content: string } }>;
  }
  const data = (await response.json()) as OpenAIResponse;
  return data.choices[0]?.message?.content ?? "";
}

async function callAnthropic(
  systemPrompt: string,
  userPrompt: string,
  model: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  interface AnthropicResponse {
    content: Array<{ type: string; text: string }>;
  }
  const data = (await response.json()) as AnthropicResponse;
  const block = data.content.find((b) => b.type === "text");
  return block?.text ?? "";
}

async function callProvider(
  provider: AiProvider,
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<string> {
  if (provider === "openai") {
    return callOpenAI(systemPrompt, userPrompt, model ?? "gpt-4o-mini");
  }
  return callAnthropic(systemPrompt, userPrompt, model ?? "claude-haiku-4-5-20251001");
}

async function callWithFallback(
  primary: AiProvider,
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<string> {
  try {
    return await callProvider(primary, systemPrompt, userPrompt, model);
  } catch (primaryErr) {
    const fallback: AiProvider = primary === "openai" ? "anthropic" : "openai";
    const { openai, anthropic } = checkAiProviders();
    const fallbackAvailable = fallback === "openai" ? openai : anthropic;
    if (!fallbackAvailable) throw primaryErr;
    return callProvider(fallback, systemPrompt, userPrompt);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export async function extractWithAI<T extends Record<string, unknown>>(
  text: string,
  schema: Record<string, string>,
  options?: AiExtractionOptions
): Promise<T> {
  const provider = resolveProvider(options);

  const schemaDescription = Object.entries(schema)
    .map(([key, type]) => `  "${key}": ${type}`)
    .join(",\n");

  const systemPrompt = `You are a data extraction assistant. Extract structured data from the provided text and return it as valid JSON.

The JSON object must have exactly these fields:
{
${schemaDescription}
}

Return only the JSON object, no explanation, no markdown fences.`;

  const userPrompt = `Extract data from this text:\n\n${text.slice(0, 8000)}`;

  const raw = await callWithFallback(provider, systemPrompt, userPrompt, options?.model);

  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    const result = JSON.parse(cleaned) as T;
    // Record ai_extraction usage — fire and forget, must never block extraction
    import("../db/usage.js").then(({ recordUsage }) => {
      recordUsage({ eventType: "ai_extraction" });
    }).catch(() => {});
    return result;
  } catch {
    throw new Error(`AI returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }
}

export async function summarizePage(
  text: string,
  options?: AiExtractionOptions
): Promise<string> {
  const provider = resolveProvider(options);

  const systemPrompt =
    "You are a concise summarizer. Write a 2-3 sentence summary of the provided page content. Return only the summary text, no preamble.";

  const userPrompt = text.slice(0, 8000);

  return callWithFallback(provider, systemPrompt, userPrompt, options?.model);
}

export async function extractWithPrompt(
  text: string,
  prompt: string,
  options?: AiExtractionOptions
): Promise<string> {
  const provider = resolveProvider(options);
  const systemPrompt = "You are a data extraction assistant. Answer questions about the provided webpage content concisely and accurately.";
  const userMessage = `Webpage content:\n\n${text.slice(0, 12000)}\n\n---\n\nTask: ${prompt}`;
  return callWithFallback(provider, systemPrompt, userMessage, options?.model);
}

export async function classifyPage(
  text: string,
  categories: string[],
  options?: AiExtractionOptions
): Promise<string> {
  const provider = resolveProvider(options);

  const categoryList = categories.map((c) => `- ${c}`).join("\n");

  const systemPrompt = `You are a content classifier. Classify the provided page content into exactly one of the following categories:
${categoryList}

Return only the category name, nothing else.`;

  const userPrompt = text.slice(0, 8000);

  const result = await callWithFallback(provider, systemPrompt, userPrompt, options?.model);
  const trimmed = result.trim();

  // Return the closest matching category (case-insensitive)
  const match = categories.find(
    (c) => c.toLowerCase() === trimmed.toLowerCase()
  );
  return match ?? trimmed;
}
