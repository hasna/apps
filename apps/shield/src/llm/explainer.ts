import type { Finding } from "../types/index.js";
import { isCredentialFinding, sanitizeFindingForOutput, sanitizeTextForBoundary } from "../lib/finding-safety.js";
import { chat } from "./client.js";
import { EXPLAINER_PROMPT } from "./prompts.js";

const cache = new Map<string, string>();

export async function explainFinding(
  finding: Finding,
  codeContext: string,
): Promise<string | null> {
  if (isCredentialFinding(finding)) return null;
  const safeFinding = sanitizeFindingForOutput(finding);
  const safeContext = sanitizeTextForBoundary(codeContext, 12_000);
  const cacheKey = finding.fingerprint;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const userMessage = `Vulnerability:
- Rule: ${safeFinding.rule_id}
- Severity: ${safeFinding.severity}
- File: ${safeFinding.file}:${safeFinding.line}
- Message: ${safeFinding.message}

Code context:
\`\`\`
${safeContext}
\`\`\``;

  const response = await chat([
    { role: "system", content: EXPLAINER_PROMPT },
    { role: "user", content: userMessage },
  ]);

  if (!response) return null;

  const safeResponse = sanitizeTextForBoundary(response);
  cache.set(cacheKey, safeResponse);
  return safeResponse;
}
