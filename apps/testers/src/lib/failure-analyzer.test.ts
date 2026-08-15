import { describe, test, expect } from "bun:test";
import { analyzeFailure } from "./failure-analyzer.js";

describe("analyzeFailure", () => {
  test("returns null when both inputs are null", () => {
    expect(analyzeFailure(null, null)).toBeNull();
  });

  test("returns null when both inputs are empty strings", () => {
    expect(analyzeFailure("", "")).toBeNull();
  });

  test("returns null when both inputs are whitespace", () => {
    expect(analyzeFailure("  ", "  ")).toBeNull();
  });

  // ─── selector_not_found ────────────────────────────────────────────────────

  test("detects 'waiting for selector' as selector_not_found", () => {
    const result = analyzeFailure("waiting for selector '#submit-btn'", null);
    expect(result?.type).toBe("selector_not_found");
  });

  test("detects 'not found' as selector_not_found", () => {
    const result = analyzeFailure("Element 'button.submit' not found in DOM", null);
    expect(result?.type).toBe("selector_not_found");
  });

  test("detects 'No element' as selector_not_found", () => {
    const result = analyzeFailure("No element matches selector '.login-btn'", null);
    expect(result?.type).toBe("selector_not_found");
  });

  test("extracts selector from error using single-quote regex", () => {
    const result = analyzeFailure("waiting for selector '#main-nav'", null);
    expect(result?.type).toBe("selector_not_found");
    expect(result?.affectedElement).toBe("#main-nav");
  });

  test("extracts selector from reasoning if not in error", () => {
    const result = analyzeFailure("element not found", "Could not find '.submit-button' on step 3");
    expect(result?.type).toBe("selector_not_found");
    expect(result?.affectedElement).toBe(".submit-button");
  });

  test("extracts step number from reasoning for selector_not_found", () => {
    const result = analyzeFailure("not found", "Failed at step 5 trying to click button");
    expect(result?.type).toBe("selector_not_found");
    expect(result?.stepNumber).toBe(5);
  });

  test("has high confidence when selector is extracted", () => {
    const result = analyzeFailure("waiting for selector '#btn'", null);
    expect(result?.confidence).toBe("high");
  });

  test("has medium confidence when no selector is extracted", () => {
    const result = analyzeFailure("element not found in page", null);
    expect(result?.confidence).toBe("medium");
  });

  // ─── assertion_failed ──────────────────────────────────────────────────────

  test("detects 'assert' keyword as assertion_failed", () => {
    const result = analyzeFailure("AssertionError: expected value to be 'foo'", null);
    expect(result?.type).toBe("assertion_failed");
  });

  test("detects 'expected' keyword as assertion_failed", () => {
    const result = analyzeFailure("expected 'hello', got 'world'", null);
    expect(result?.type).toBe("assertion_failed");
  });

  test("detects 'to equal' as assertion_failed", () => {
    const result = analyzeFailure("expected status to equal 200", null);
    expect(result?.type).toBe("assertion_failed");
  });

  test("extracts expected and actual values from error", () => {
    const result = analyzeFailure("expected: 'hello', got: 'world'", null);
    expect(result?.type).toBe("assertion_failed");
    expect(result?.expected).toBe("hello");
    expect(result?.actual).toBe("world");
  });

  test("has high confidence when expected/actual extracted", () => {
    const result = analyzeFailure("expected: 'foo', got: 'bar'", null);
    expect(result?.confidence).toBe("high");
  });

  test("has medium confidence for assertion without values", () => {
    const result = analyzeFailure("assertion failed on page", null);
    expect(result?.confidence).toBe("medium");
  });

  // ─── timeout ────────────────────────────────────────────────────────────────

  test("detects 'timeout' as timeout type", () => {
    const result = analyzeFailure("Timeout: operation exceeded 30000ms", null);
    expect(result?.type).toBe("timeout");
  });

  test("detects 'timed out' as timeout type", () => {
    const result = analyzeFailure("The operation timed out after 60 seconds", null);
    expect(result?.type).toBe("timeout");
  });

  test("timeout has high confidence", () => {
    const result = analyzeFailure("Timeout exceeded", null);
    expect(result?.confidence).toBe("high");
  });

  test("timeout from reasoning", () => {
    const result = analyzeFailure(null, "Scenario timed out waiting for page load at step 2");
    expect(result?.type).toBe("timeout");
    expect(result?.stepNumber).toBe(2);
  });

  // ─── auth_error ─────────────────────────────────────────────────────────────

  test("detects 401 as auth_error", () => {
    const result = analyzeFailure("Server returned 401 Unauthorized", null);
    expect(result?.type).toBe("auth_error");
  });

  test("detects 403 as auth_error", () => {
    const result = analyzeFailure("403 Forbidden response", null);
    expect(result?.type).toBe("auth_error");
  });

  test("detects 'unauthorized' as auth_error", () => {
    const result = analyzeFailure("Access denied: unauthorized user", null);
    expect(result?.type).toBe("auth_error");
  });

  test("detects 'login' as auth_error", () => {
    const result = analyzeFailure("login required to access this resource", null);
    expect(result?.type).toBe("auth_error");
  });

  test("auth_error has high confidence", () => {
    const result = analyzeFailure("401 unauthorized", null);
    expect(result?.confidence).toBe("high");
  });

  // ─── network_error ──────────────────────────────────────────────────────────

  test("detects ECONNREFUSED as network_error", () => {
    const result = analyzeFailure("Error: ECONNREFUSED 127.0.0.1:3000", null);
    expect(result?.type).toBe("network_error");
  });

  test("detects ENOTFOUND as network_error", () => {
    const result = analyzeFailure("getaddrinfo ENOTFOUND example.com", null);
    expect(result?.type).toBe("network_error");
  });

  test("detects 'fetch failed' as network_error", () => {
    const result = analyzeFailure("fetch failed: connection refused", null);
    expect(result?.type).toBe("network_error");
  });

  test("network_error has high confidence", () => {
    const result = analyzeFailure("ECONNREFUSED localhost:3000", null);
    expect(result?.confidence).toBe("high");
  });

  // ─── eval_failed ────────────────────────────────────────────────────────────

  test("detects 'evaluate' as eval_failed", () => {
    const result = analyzeFailure("Failed to evaluate JavaScript expression", null);
    expect(result?.type).toBe("eval_failed");
  });

  test("detects 'eval' keyword as eval_failed", () => {
    const result = analyzeFailure("Error: eval execution failed", null);
    expect(result?.type).toBe("eval_failed");
  });

  test("eval_failed has medium confidence", () => {
    const result = analyzeFailure("evaluate failed", null);
    expect(result?.confidence).toBe("medium");
  });

  // ─── unknown ────────────────────────────────────────────────────────────────

  test("returns unknown type for unrecognized errors", () => {
    const result = analyzeFailure("Something went completely wrong", null);
    expect(result?.type).toBe("unknown");
  });

  test("unknown type has low confidence", () => {
    const result = analyzeFailure("Something completely mysterious happened", null);
    expect(result?.confidence).toBe("low");
  });

  // ─── priority order tests ────────────────────────────────────────────────────

  test("selector_not_found is detected before timeout when both present", () => {
    // waiting for selector mentions timeout-like language but is selector_not_found
    const result = analyzeFailure("waiting for selector '#btn' timed out", null);
    // selector_not_found is checked first
    expect(result?.type).toBe("selector_not_found");
  });

  test("works with only reasoning (null error)", () => {
    const result = analyzeFailure(null, "The test failed because element not found on step 3");
    expect(result?.type).toBe("selector_not_found");
    expect(result?.stepNumber).toBe(3);
  });

  test("works with only error (null reasoning)", () => {
    const result = analyzeFailure("ECONNREFUSED", null);
    expect(result?.type).toBe("network_error");
  });
});
