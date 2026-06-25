import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { JudgeConfig, JudgeResult, Verdict } from "../types/index.js";

// Judge is ALWAYS temperature=0 — deterministic, consistent verdicts.
// Chain-of-thought reasoning is REQUIRED before verdict (never score first).
// Only three verdicts: PASS / FAIL / UNKNOWN (no numeric scales).

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_PROVIDER = "anthropic";

const JUDGE_SYSTEM_PROMPT = `You are a precise AI output evaluator. Your job is to judge whether an AI response meets a given rubric.

Rules:
1. Write your reasoning FIRST, then give your verdict. Never give a verdict before reasoning.
2. Your verdict must be exactly one of: PASS, FAIL, or UNKNOWN.
3. Use UNKNOWN only when you genuinely cannot determine pass/fail (e.g., ambiguous rubric, insufficient information).
4. Be concise in your reasoning — 2-5 sentences is usually enough.
5. Do not add qualifiers like "somewhat" — it's PASS, FAIL, or UNKNOWN.

Response format (follow exactly):
REASONING: <your step-by-step reasoning>
VERDICT: <PASS|FAIL|UNKNOWN>`;

function buildJudgePrompt(input: string, output: string, rubric: string, expected?: string): string {
  const lines = [
    "=== INPUT ===",
    input,
    "",
    "=== AI RESPONSE ===",
    output,
  ];

  if (expected) {
    lines.push("", "=== EXPECTED BEHAVIOR ===", expected);
  }

  lines.push("", "=== RUBRIC ===", rubric, "", "Judge the AI response against the rubric.");
  return lines.join("\n");
}

function parseVerdict(text: string): { reasoning: string; verdict: Verdict } {
  const reasoningMatch = text.match(/REASONING:\s*([\s\S]*?)(?=VERDICT:|$)/i);
  const verdictMatch = text.match(/VERDICT:\s*(PASS|FAIL|UNKNOWN)/i);

  const reasoning = reasoningMatch?.[1]?.trim() ?? text.trim();
  const rawVerdict = verdictMatch?.[1]?.toUpperCase();

  let verdict: Verdict;
  if (rawVerdict === "PASS") verdict = "PASS";
  else if (rawVerdict === "FAIL") verdict = "FAIL";
  else verdict = "UNKNOWN";

  return { reasoning, verdict };
}

export async function runJudge(
  input: string,
  output: string,
  config: JudgeConfig,
  expected?: string
): Promise<JudgeResult> {
  const start = Date.now();
  const provider = config.provider ?? DEFAULT_PROVIDER;
  const model = config.model ?? DEFAULT_MODEL;
  const prompt = buildJudgePrompt(input, output, config.rubric, expected);

  try {
    if (provider === "anthropic") {
      return await judgeWithAnthropic(prompt, model, config.apiKey, start);
    } else {
      return await judgeWithOpenAI(prompt, model, config.apiKey, start);
    }
  } catch (err) {
    return {
      verdict: "UNKNOWN",
      reasoning: `Judge call failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

async function judgeWithAnthropic(
  prompt: string,
  model: string,
  apiKey: string | undefined,
  start: number
): Promise<JudgeResult> {
  const client = new Anthropic({ apiKey: apiKey ?? process.env["ANTHROPIC_API_KEY"] });

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    temperature: 0, // always 0 — deterministic
    system: JUDGE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const { reasoning, verdict } = parseVerdict(text);
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  // Anthropic pricing (claude-sonnet-4-6): $3/M input, $15/M output
  const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

  return {
    verdict,
    reasoning,
    durationMs: Date.now() - start,
    inputTokens,
    outputTokens,
    costUsd,
  };
}

async function judgeWithOpenAI(
  prompt: string,
  model: string,
  apiKey: string | undefined,
  start: number
): Promise<JudgeResult> {
  const client = new OpenAI({ apiKey: apiKey ?? process.env["OPENAI_API_KEY"] });

  const response = await client.chat.completions.create({
    model,
    temperature: 0, // always 0
    max_tokens: 1024,
    messages: [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  const { reasoning, verdict } = parseVerdict(text);
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;

  // GPT-4o pricing: $2.50/M input, $10/M output (approximate)
  const costUsd = (inputTokens * 2.5 + outputTokens * 10) / 1_000_000;

  return {
    verdict,
    reasoning,
    durationMs: Date.now() - start,
    inputTokens,
    outputTokens,
    costUsd,
  };
}

/** One-shot judge: no full eval case, just input/output/rubric */
export async function judgeOnce(params: {
  input: string;
  output: string;
  rubric: string;
  expected?: string;
  model?: string;
  provider?: "anthropic" | "openai";
  apiKey?: string;
}): Promise<JudgeResult> {
  return runJudge(params.input, params.output, {
    rubric: params.rubric,
    model: params.model,
    provider: params.provider,
    apiKey: params.apiKey,
  }, params.expected);
}
