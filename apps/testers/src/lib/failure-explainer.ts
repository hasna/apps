import { getResult } from "../db/results.js";
import type { FailureAnalysis } from "../types/index.js";

export interface FailureExplanation {
  resultId: string;
  type: FailureAnalysis["type"];
  summary: string;
  likelyCause: string;
  suggestedFix: string;
  affectedElement?: string;
  confidence: number;
  raw: {
    error: string | null;
    reasoning: string | null;
    failureAnalysis: FailureAnalysis | null;
  };
}

const TYPE_PATTERNS: Array<{ pattern: RegExp; type: FailureAnalysis["type"] }> = [
  { pattern: /not found|no element|waiting for selector|selector.*not found/i, type: "selector_not_found" },
  { pattern: /timeout|timed out|exceeded.*ms/i, type: "timeout" },
  { pattern: /auth|login|unauthorized|403|forbidden|credentials/i, type: "auth_error" },
  { pattern: /network|fetch|ERR_|ECONNREFUSED|ENOTFOUND|request failed/i, type: "network_error" },
  { pattern: /assert|expected.*got|does not contain|mismatch/i, type: "assertion_failed" },
  { pattern: /eval|eval.*failed|score/i, type: "eval_failed" },
];

const SUGGESTED_FIXES: Record<FailureAnalysis["type"], string> = {
  selector_not_found: "Update the CSS selector. The element may have been renamed, moved, or removed. Use get_elements to discover the current selector.",
  assertion_failed: "Verify the expected value matches the current app behavior. The UI text or state may have changed.",
  timeout: "Increase the scenario timeout or check if the app is responding slowly. Try reducing the number of steps.",
  auth_error: "Verify the auth credentials and login flow. Check if the session is being properly established.",
  network_error: "Check if the app is running and accessible at the target URL. Verify network connectivity.",
  eval_failed: "Review the evaluation criteria. The AI may need clearer pass/fail conditions.",
  unknown: "Review the full error message and reasoning. Check the app logs for more context.",
};

const LIKELY_CAUSES: Record<FailureAnalysis["type"], string> = {
  selector_not_found: "A CSS selector could not locate the target element — the element may not exist, be hidden, or the selector may be stale.",
  assertion_failed: "An assertion check did not match the expected value — the app output differs from what the scenario expects.",
  timeout: "The scenario exceeded the time limit — either the app is slow or the test is waiting for an element that never appears.",
  auth_error: "Authentication failed or the session was not established — the test could not access protected content.",
  network_error: "A network request failed — the app may be unreachable or returning unexpected errors.",
  eval_failed: "The AI evaluator could not determine a pass/fail verdict with sufficient confidence.",
  unknown: "The failure cause is unclear from the available error data.",
};

function detectType(error: string | null, reasoning: string | null, existingAnalysis: FailureAnalysis | null): FailureAnalysis["type"] {
  if (existingAnalysis?.type && existingAnalysis.type !== "unknown") {
    return existingAnalysis.type;
  }
  const text = [error, reasoning].filter(Boolean).join(" ");
  for (const { pattern, type } of TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return "unknown";
}

function extractAffectedElement(error: string | null, existingAnalysis: FailureAnalysis | null): string | undefined {
  if (existingAnalysis?.affectedElement) return existingAnalysis.affectedElement;
  if (!error) return undefined;
  // Extract selector from common error messages like "waiting for selector '.btn'"
  const match = error.match(/selector[:\s]+['"`]?([^'"`\s,]+)['"`]?/i)
    ?? error.match(/element[:\s]+['"`]?([^'"`\s,]+)['"`]?/i);
  return match?.[1];
}

export function explainFailure(resultId: string): FailureExplanation {
  const result = getResult(resultId);
  if (!result) throw new Error(`Result not found: ${resultId}`);

  if (result.status === "passed") {
    return {
      resultId,
      type: "unknown",
      summary: "This result passed — no failure to explain.",
      likelyCause: "N/A",
      suggestedFix: "N/A",
      confidence: 1.0,
      raw: { error: null, reasoning: result.reasoning, failureAnalysis: null },
    };
  }

  const type = detectType(result.error, result.reasoning, result.failureAnalysis);
  const affectedElement = extractAffectedElement(result.error, result.failureAnalysis);
  const existingAnalysis = result.failureAnalysis;

  const confidenceMap: Record<FailureAnalysis["type"], number> = {
    selector_not_found: 0.9,
    timeout: 0.85,
    auth_error: 0.8,
    network_error: 0.85,
    assertion_failed: 0.75,
    eval_failed: 0.7,
    unknown: 0.4,
  };
  const confidence = existingAnalysis?.confidence === "high" ? 0.9
    : existingAnalysis?.confidence === "medium" ? 0.7
    : existingAnalysis?.confidence === "low" ? 0.5
    : confidenceMap[type] ?? 0.5;

  const errorSnippet = result.error ? result.error.slice(0, 200) : "(no error message)";
  const summary = `${type.replace(/_/g, " ")} in result ${resultId.slice(0, 8)}${affectedElement ? ` — element: ${affectedElement}` : ""}. Error: ${errorSnippet}`;

  return {
    resultId,
    type,
    summary,
    likelyCause: LIKELY_CAUSES[type],
    suggestedFix: affectedElement && type === "selector_not_found"
      ? `Update selector "${affectedElement}". Use get_elements or get_page_html to find the new selector.`
      : SUGGESTED_FIXES[type],
    affectedElement,
    confidence,
    raw: {
      error: result.error,
      reasoning: result.reasoning,
      failureAnalysis: result.failureAnalysis,
    },
  };
}
