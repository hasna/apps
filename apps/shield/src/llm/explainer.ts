import type { Finding } from "../types/index.js";
import { chat } from "./client.js";
import { EXPLAINER_PROMPT } from "./prompts.js";

const cache = new Map<string, string>();

export async function explainFinding(
  finding: Finding,
  codeContext: string,
): Promise<string | null> {
  const cacheKey = finding.fingerprint;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const userMessage = `Vulnerability:
- Rule: ${finding.rule_id}
- Severity: ${finding.severity}
- File: ${finding.file}:${finding.line}
- Message: ${finding.message}

Code context:
\`\`\`
${codeContext}
\`\`\``;

  const response = await chat([
    { role: "system", content: EXPLAINER_PROMPT },
    { role: "user", content: userMessage },
  ]);

  if (!response) return null;

  cache.set(cacheKey, response);
  return response;
}
