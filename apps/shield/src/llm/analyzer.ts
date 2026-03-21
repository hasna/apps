import type { Finding } from "../types/index.js";
import { chat } from "./client.js";
import { ANALYZER_PROMPT } from "./prompts.js";

const cache = new Map<
  string,
  { exploitability: number; is_true_positive: boolean; confidence: number }
>();

export async function analyzeFinding(
  finding: Finding,
  codeContext: string,
): Promise<{
  exploitability: number;
  is_true_positive: boolean;
  confidence: number;
} | null> {
  const cacheKey = finding.fingerprint;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const userMessage = `Finding:
- Rule: ${finding.rule_id}
- Severity: ${finding.severity}
- File: ${finding.file}:${finding.line}
- Message: ${finding.message}

Code context:
\`\`\`
${codeContext}
\`\`\``;

  const response = await chat([
    { role: "system", content: ANALYZER_PROMPT },
    { role: "user", content: userMessage },
  ]);

  if (!response) return null;

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as {
      exploitability: number;
      is_true_positive: boolean;
      confidence: number;
    };
    const result = {
      exploitability: Math.max(0, Math.min(10, parsed.exploitability)),
      is_true_positive: !!parsed.is_true_positive,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
    };
    cache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}
