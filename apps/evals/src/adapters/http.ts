import type { HttpAdapterConfig, ConversationTurn } from "../types/index.js";

export interface AdapterResponse {
  output: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
  statusCode?: number;
  error?: string;
}

function getNestedValue(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce((acc: unknown, key) => {
    if (acc === null || acc === undefined) return undefined;
    // Handle array index notation: messages[-1]
    const arrMatch = key.match(/^(\w+)\[(-?\d+)\]$/);
    if (arrMatch) {
      const [, prop, idx] = arrMatch;
      const arr = (acc as Record<string, unknown>)[prop ?? ""];
      if (!Array.isArray(arr)) return undefined;
      const i = parseInt(idx ?? "0");
      return arr[i < 0 ? arr.length + i : i];
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] ?? "";
    if (!(part in cur)) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1] ?? "";
  cur[last] = value;
}

export async function callHttpAdapter(
  config: HttpAdapterConfig,
  input: string,
  turns?: ConversationTurn[]
): Promise<AdapterResponse> {
  const start = Date.now();

  try {
    let body: Record<string, unknown>;

    if (turns && turns.length > 0) {
      // Multi-turn: send full conversation
      body = {
        messages: turns.map((t) => ({ role: t.role, content: t.content })),
      };
    } else if (config.inputPath) {
      // Single-turn with custom input path
      body = {};
      setNestedValue(body, config.inputPath, input);
    } else {
      // Default: OpenAI-style chat format
      body = {
        messages: [{ role: "user", content: input }],
      };
    }

    const response = await fetch(config.url, {
      method: config.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify(body),
      signal: config.timeoutMs ? AbortSignal.timeout(config.timeoutMs) : undefined,
    });

    const durationMs = Date.now() - start;
    const data = await response.json() as Record<string, unknown>;

    // Extract output using outputPath or smart defaults
    let output: string;
    if (config.outputPath) {
      output = String(getNestedValue(data, config.outputPath) ?? "");
    } else {
      // Try common response shapes
      output =
        String(getNestedValue(data, "choices.0.message.content") ?? "") ||
        String(getNestedValue(data, "message.content") ?? "") ||
        String(getNestedValue(data, "content") ?? "") ||
        String(getNestedValue(data, "output") ?? "") ||
        String(getNestedValue(data, "text") ?? "") ||
        JSON.stringify(data);
    }

    // Extract token usage from common response shapes
    const usage = getNestedValue(data, "usage") as Record<string, unknown> | undefined;
    const inputTokens = Number(usage?.["prompt_tokens"] ?? usage?.["input_tokens"] ?? 0) || undefined;
    const outputTokens = Number(usage?.["completion_tokens"] ?? usage?.["output_tokens"] ?? 0) || undefined;

    return {
      output,
      durationMs,
      inputTokens,
      outputTokens,
      statusCode: response.status,
    };
  } catch (err) {
    return {
      output: "",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
