import { type Finding, Severity } from "../types/index.js";
import { chat } from "./client.js";
import { TRIAGER_PROMPT } from "./prompts.js";

const cache = new Map<string, { severity: Severity; reasoning: string }>();

const SEVERITY_MAP: Record<string, Severity> = {
  critical: Severity.Critical,
  high: Severity.High,
  medium: Severity.Medium,
  low: Severity.Low,
  info: Severity.Info,
};

export async function triageFinding(
  finding: Finding,
  codeContext: string,
): Promise<{ severity: Severity; reasoning: string } | null> {
  const cacheKey = finding.fingerprint;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const userMessage = `Finding to triage:
- Rule: ${finding.rule_id}
- Current severity: ${finding.severity}
- File: ${finding.file}:${finding.line}
- Message: ${finding.message}

Code context:
\`\`\`
${codeContext}
\`\`\``;

  const response = await chat([
    { role: "system", content: TRIAGER_PROMPT },
    { role: "user", content: userMessage },
  ]);

  if (!response) return null;

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as {
      severity: string;
      reasoning: string;
    };
    const severity =
      SEVERITY_MAP[parsed.severity?.toLowerCase()] ?? Severity.Medium;
    const result = {
      severity,
      reasoning: parsed.reasoning || "No reasoning provided",
    };
    cache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}
