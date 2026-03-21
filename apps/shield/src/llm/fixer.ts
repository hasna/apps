import type { Finding } from "../types/index.js";
import { chat } from "./client.js";
import { FIXER_PROMPT } from "./prompts.js";

const cache = new Map<string, string>();

export async function suggestFix(
  finding: Finding,
  codeContext: string,
): Promise<string | null> {
  const cacheKey = finding.fingerprint;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const userMessage = `Vulnerability to fix:
- Rule: ${finding.rule_id}
- Severity: ${finding.severity}
- File: ${finding.file}:${finding.line}
- Message: ${finding.message}

Current code:
\`\`\`
${codeContext}
\`\`\``;

  const response = await chat([
    { role: "system", content: FIXER_PROMPT },
    { role: "user", content: userMessage },
  ]);

  if (!response) return null;

  cache.set(cacheKey, response);
  return response;
}
