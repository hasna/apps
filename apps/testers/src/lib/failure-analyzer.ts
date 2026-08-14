import type { FailureAnalysis } from "../types/index.js";

/**
 * Deterministic (no LLM) failure analysis from error message and reasoning text.
 * Returns null if both inputs are null/empty.
 */
export function analyzeFailure(error: string | null, reasoning: string | null): FailureAnalysis | null {
  const combinedText = [error, reasoning].filter(Boolean).join(" ");
  if (!combinedText.trim()) return null;

  const errorText = error ?? "";
  const reasoningText = reasoning ?? "";

  // ─── Pattern: selector_not_found ────────────────────────────────────────────
  if (
    /waiting for selector/i.test(errorText) ||
    /not found/i.test(errorText) ||
    /No element/i.test(errorText) ||
    /waiting for selector/i.test(reasoningText) ||
    /could not find element/i.test(reasoningText) ||
    /element not found/i.test(reasoningText)
  ) {
    const selectorMatch = errorText.match(/'([^']+)'/) ?? reasoningText.match(/'([^']+)'/);
    const affectedElement = selectorMatch ? selectorMatch[1] : undefined;

    // Extract step number from "step N" in reasoning
    const stepMatch = reasoningText.match(/step\s+(\d+)/i);
    const stepNumber = stepMatch ? parseInt(stepMatch[1]!, 10) : undefined;

    return {
      type: "selector_not_found",
      affectedElement,
      stepNumber,
      confidence: affectedElement ? "high" : "medium",
    };
  }

  // ─── Pattern: assertion_failed ───────────────────────────────────────────────
  if (
    /assert/i.test(errorText) ||
    /expected/i.test(errorText) ||
    /to equal/i.test(errorText) ||
    /to be/i.test(errorText) ||
    /\bgot\b/.test(errorText) ||
    /assertion.*failed/i.test(reasoningText) ||
    /expected.*but.*got/i.test(reasoningText)
  ) {
    // Try to extract expected/actual from "expected X, got Y" or "expected X to equal Y"
    const expectedActualMatch = errorText.match(/expected[:\s]+(['"]?)([^'"]+)\1[,\s]+(?:got|received|actual)[:\s]+(['"]?)([^'"]+)\3/i);
    const toEqualMatch = errorText.match(/expected[:\s]+(['"]?)([^'"]+)\1\s+to\s+equal\s+(['"]?)([^'"]+)\3/i);

    let expected: string | undefined;
    let actual: string | undefined;

    if (expectedActualMatch) {
      expected = expectedActualMatch[2];
      actual = expectedActualMatch[4];
    } else if (toEqualMatch) {
      expected = toEqualMatch[4];
      actual = toEqualMatch[2];
    }

    const stepMatch = reasoningText.match(/step\s+(\d+)/i);
    const stepNumber = stepMatch ? parseInt(stepMatch[1]!, 10) : undefined;

    return {
      type: "assertion_failed",
      expected,
      actual,
      stepNumber,
      confidence: (expected && actual) ? "high" : "medium",
    };
  }

  // ─── Pattern: timeout ────────────────────────────────────────────────────────
  if (
    /timeout/i.test(errorText) ||
    /timed out/i.test(errorText) ||
    /Timeout/i.test(reasoningText) ||
    /timed out/i.test(reasoningText)
  ) {
    const stepMatch = reasoningText.match(/step\s+(\d+)/i);
    const stepNumber = stepMatch ? parseInt(stepMatch[1]!, 10) : undefined;

    return {
      type: "timeout",
      stepNumber,
      confidence: "high",
    };
  }

  // ─── Pattern: auth_error ────────────────────────────────────────────────────
  if (
    /\b401\b/.test(errorText) ||
    /\b403\b/.test(errorText) ||
    /login/i.test(errorText) ||
    /unauthorized/i.test(errorText) ||
    /\bauth\b/i.test(errorText) ||
    /\b401\b/.test(reasoningText) ||
    /\b403\b/.test(reasoningText) ||
    /unauthorized/i.test(reasoningText) ||
    /authentication/i.test(reasoningText)
  ) {
    return {
      type: "auth_error",
      confidence: "high",
    };
  }

  // ─── Pattern: network_error ──────────────────────────────────────────────────
  if (
    /ECONNREFUSED/i.test(errorText) ||
    /ENOTFOUND/i.test(errorText) ||
    /fetch failed/i.test(errorText) ||
    /network/i.test(errorText) ||
    /ECONNREFUSED/i.test(reasoningText) ||
    /fetch failed/i.test(reasoningText) ||
    /connection refused/i.test(reasoningText)
  ) {
    return {
      type: "network_error",
      confidence: "high",
    };
  }

  // ─── Pattern: eval_failed ────────────────────────────────────────────────────
  if (
    /\beval\b/i.test(errorText) ||
    /evaluate/i.test(errorText) ||
    /\bscript\b/i.test(errorText) ||
    /\beval\b/i.test(reasoningText) ||
    /evaluate/i.test(reasoningText)
  ) {
    return {
      type: "eval_failed",
      confidence: "medium",
    };
  }

  // ─── Fallback: unknown ────────────────────────────────────────────────────────
  return {
    type: "unknown",
    confidence: "low",
  };
}
