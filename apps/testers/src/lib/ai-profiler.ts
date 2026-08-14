/**
 * LLM latency and cost profiling for AI endpoints.
 *
 * Detects AI endpoints by URL path patterns or response body fields,
 * measures time-to-first-token for streaming responses, extracts token
 * counts from response bodies/headers, and estimates cost using a
 * built-in pricing table.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LLMProfile {
  endpoint: string;
  ttftMs: number | null;       // time to first token (streaming responses)
  totalMs: number;
  statusCode: number;
  inputTokens: number | null;  // from response headers or body
  outputTokens: number | null;
  estimatedCostCents: number | null;
  model: string | null;        // detected from response headers or body
  provider: string | null;     // detected from response headers (x-openai-*, x-anthropic-*)
}

// ─── Pricing table ────────────────────────────────────────────────────────────
// Per 1M tokens: [input_cents, output_cents]

export const MODEL_PRICING: Record<string, [number, number]> = {
  "claude-haiku-4-5": [80, 400],
  "claude-sonnet-4-6": [300, 1500],
  "gpt-4o-mini": [15, 60],
  "gpt-4o": [250, 1000],
  "gemini-2.0-flash": [7, 30],
  "gemini-1.5-pro": [125, 500],
};

// ─── AI endpoint detection ────────────────────────────────────────────────────

const AI_PATH_PATTERNS = [
  /chat/i,
  /completions/i,
  /generate/i,
  /\/ask\b/i,
  /\/query\b/i,
  /infer/i,
];

const AI_BODY_FIELDS = [
  "choices",
  "content",
  "candidates",
  "usage",
  "tokens",
];

export function isAIEndpoint(url: string, responseBody?: string): boolean {
  // Check URL path
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    for (const pattern of AI_PATH_PATTERNS) {
      if (pattern.test(path)) return true;
    }
  } catch {
    // url might be a path only
    for (const pattern of AI_PATH_PATTERNS) {
      if (pattern.test(url)) return true;
    }
  }

  // Check response body for AI-specific fields
  if (responseBody) {
    try {
      const parsed = JSON.parse(responseBody) as Record<string, unknown>;
      for (const field of AI_BODY_FIELDS) {
        if (field in parsed) return true;
      }
    } catch {
      // not JSON, skip body check
    }
  }

  return false;
}

// ─── Token extraction ─────────────────────────────────────────────────────────

function extractTokens(body: unknown, headers: Record<string, string>): { inputTokens: number | null; outputTokens: number | null } {
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  // Try response headers first
  if (headers["x-input-tokens"]) inputTokens = parseInt(headers["x-input-tokens"], 10) || null;
  if (headers["x-output-tokens"]) outputTokens = parseInt(headers["x-output-tokens"], 10) || null;
  if (headers["x-prompt-tokens"]) inputTokens = parseInt(headers["x-prompt-tokens"], 10) || null;
  if (headers["x-completion-tokens"]) outputTokens = parseInt(headers["x-completion-tokens"], 10) || null;

  if (inputTokens !== null && outputTokens !== null) return { inputTokens, outputTokens };

  // Parse from response body
  if (typeof body === "object" && body !== null) {
    const obj = body as Record<string, unknown>;

    // OpenAI-style: usage.prompt_tokens / usage.completion_tokens
    if (typeof obj["usage"] === "object" && obj["usage"] !== null) {
      const usage = obj["usage"] as Record<string, unknown>;
      if (typeof usage["prompt_tokens"] === "number") inputTokens = usage["prompt_tokens"];
      if (typeof usage["completion_tokens"] === "number") outputTokens = usage["completion_tokens"];
      // Anthropic-style: usage.input_tokens / usage.output_tokens
      if (typeof usage["input_tokens"] === "number") inputTokens = usage["input_tokens"];
      if (typeof usage["output_tokens"] === "number") outputTokens = usage["output_tokens"];
      // Alternative: inputTokens / outputTokens directly on usage
      if (typeof usage["inputTokens"] === "number") inputTokens = usage["inputTokens"];
      if (typeof usage["outputTokens"] === "number") outputTokens = usage["outputTokens"];
    }

    // Anthropic top-level usage
    if (typeof obj["input_tokens"] === "number") inputTokens = obj["input_tokens"];
    if (typeof obj["output_tokens"] === "number") outputTokens = obj["output_tokens"];

    // choices[0].usage (some providers)
    if (Array.isArray(obj["choices"]) && obj["choices"].length > 0) {
      const choice = obj["choices"][0] as Record<string, unknown>;
      if (typeof choice["usage"] === "object" && choice["usage"] !== null) {
        const cu = choice["usage"] as Record<string, unknown>;
        if (typeof cu["prompt_tokens"] === "number") inputTokens = cu["prompt_tokens"];
        if (typeof cu["completion_tokens"] === "number") outputTokens = cu["completion_tokens"];
      }
    }
  }

  return { inputTokens, outputTokens };
}

// ─── Model detection ──────────────────────────────────────────────────────────

function extractModel(body: unknown, headers: Record<string, string>): string | null {
  // Check headers first
  if (headers["x-model"]) return headers["x-model"];

  if (typeof body === "object" && body !== null) {
    const obj = body as Record<string, unknown>;
    if (typeof obj["model"] === "string") return obj["model"];
    // Anthropic response has model field
    if (typeof obj["model_id"] === "string") return obj["model_id"];
  }

  return null;
}

// ─── Provider detection ────────────────────────────────────────────────────────

function extractProvider(headers: Record<string, string>): string | null {
  // OpenAI headers
  if (headers["openai-organization"] || headers["openai-version"] || headers["x-openai-model"]) return "openai";
  // Anthropic headers
  if (headers["anthropic-ratelimit-requests-limit"] || headers["x-anthropic-model"]) return "anthropic";
  // Google headers
  if (headers["x-goog-api-client"] || headers["x-google-safety"]) return "google";

  // Check for openai/anthropic-specific header prefixes
  for (const key of Object.keys(headers)) {
    if (key.startsWith("x-openai-")) return "openai";
    if (key.startsWith("x-anthropic-")) return "anthropic";
    if (key.startsWith("x-goog-")) return "google";
  }

  return null;
}

// ─── Cost calculation ─────────────────────────────────────────────────────────

function calculateCost(model: string | null, inputTokens: number | null, outputTokens: number | null): number | null {
  if (!model || inputTokens === null || outputTokens === null) return null;

  // Find pricing entry — match full model name or prefix
  let pricing: [number, number] | undefined;
  for (const [key, value] of Object.entries(MODEL_PRICING)) {
    if (model === key || model.startsWith(key) || key.startsWith(model)) {
      pricing = value;
      break;
    }
  }

  if (!pricing) return null;

  const [inputCentsPerM, outputCentsPerM] = pricing;
  const inputCost = (inputTokens / 1_000_000) * inputCentsPerM;
  const outputCost = (outputTokens / 1_000_000) * outputCentsPerM;
  return Math.round((inputCost + outputCost) * 10000) / 10000; // round to 4 decimal places
}

// ─── Main profiler ────────────────────────────────────────────────────────────

export interface ProfileAIEndpointOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export async function profileAIEndpoint(
  url: string,
  options?: ProfileAIEndpointOptions,
): Promise<LLMProfile> {
  const startMs = Date.now();
  const method = options?.method ?? "POST";
  const timeoutMs = options?.timeoutMs ?? 30000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let ttftMs: number | null = null;
  let statusCode = 0;
  let responseText = "";
  let responseHeaders: Record<string, string> = {};

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {}),
      },
      signal: controller.signal,
    };

    if (options?.body && ["POST", "PUT", "PATCH"].includes(method)) {
      fetchOptions.body = options.body;
    }

    const response = await fetch(url, fetchOptions);
    statusCode = response.status;

    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const contentType = response.headers.get("content-type") ?? "";
    const isStreaming = contentType.includes("text/event-stream") || contentType.includes("stream");

    if (isStreaming && response.body) {
      // Streaming: measure time to first chunk
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (ttftMs === null) {
          ttftMs = Date.now() - startMs;
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      responseText = chunks.join("").slice(0, 10240);
    } else {
      responseText = (await response.text()).slice(0, 10240);
    }

    clearTimeout(timeoutId);
  } catch (error) {
    clearTimeout(timeoutId);
    const totalMs = Date.now() - startMs;
    return {
      endpoint: url,
      ttftMs: null,
      totalMs,
      statusCode,
      inputTokens: null,
      outputTokens: null,
      estimatedCostCents: null,
      model: null,
      provider: null,
    };
  }

  const totalMs = Date.now() - startMs;

  let parsedBody: unknown = null;
  try {
    parsedBody = JSON.parse(responseText);
  } catch {
    // not JSON
  }

  const { inputTokens, outputTokens } = extractTokens(parsedBody, responseHeaders);
  const model = extractModel(parsedBody, responseHeaders);
  const provider = extractProvider(responseHeaders);
  const estimatedCostCents = calculateCost(model, inputTokens, outputTokens);

  return {
    endpoint: url,
    ttftMs,
    totalMs,
    statusCode,
    inputTokens,
    outputTokens,
    estimatedCostCents,
    model,
    provider,
  };
}
