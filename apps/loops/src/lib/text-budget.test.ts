import { describe, expect, test } from "bun:test";
import { budgetJsonBody, clampTextToChars, jsonBodyBytes, truncationMarker } from "./text-budget.js";

const REASON = "test budget";

describe("clampTextToChars", () => {
  test("leaves a value that already fits completely untouched", () => {
    expect(clampTextToChars("short", 100, REASON)).toBe("short");
  });

  test("never returns more characters than the budget allows", () => {
    for (const maxChars of [0, 1, 20, 40, 41, 100, 1_000]) {
      const clamped = clampTextToChars("x".repeat(5_000), maxChars, REASON);
      expect(clamped.length).toBeLessThanOrEqual(maxChars);
    }
  });

  test("drops the value rather than overrunning a budget too small for the marker", () => {
    const marker = truncationMarker(REASON);
    expect(clampTextToChars("x".repeat(500), marker.length - 1, REASON)).toBe("");
  });

  test("keeps both ends and names the truncation", () => {
    const value = `START${"m".repeat(2_000)}END`;
    const clamped = clampTextToChars(value, 200, REASON);
    expect(clamped).toContain("START");
    expect(clamped).toContain("END");
    expect(clamped).toContain("truncated by test budget");
  });

  test("a tail-biased clamp keeps the end when the budget forces a choice", () => {
    const value = `START${"m".repeat(2_000)}END`;
    const marker = truncationMarker(REASON);
    const clamped = clampTextToChars(value, marker.length + 10, REASON, { tailShare: 1 });
    expect(clamped).toContain("END");
    expect(clamped).not.toContain("START");
  });
});

describe("budgetJsonBody", () => {
  test("returns the body unchanged when it already fits", () => {
    const body = { status: "succeeded", stdout: "fine", stderr: "" };
    const result = budgetJsonBody(body, ["stdout", "stderr"], 4_096, REASON);
    expect(result.truncated).toBe(false);
    expect(result.body).toEqual(body);
    expect(result.body.stdout).toBe("fine");
  });

  // The defect this whole change exists for: two fields each individually under
  // the limit are over it together, so a per-field clamp does not bound the body.
  test("bounds the WHOLE body, not each field", () => {
    const limit = 8 * 1024;
    const body = { status: "failed", stdout: "o".repeat(7 * 1024), stderr: "e".repeat(7 * 1024) };
    const result = budgetJsonBody(body, ["stdout", "stderr"], limit, REASON);

    expect(result.truncated).toBe(true);
    expect(result.bytes).toBeLessThanOrEqual(limit);
    expect(jsonBodyBytes(result.body)).toBeLessThanOrEqual(limit);
    // Both fields survive in some form rather than one being sacrificed whole.
    expect((result.body.stdout as string).length).toBeGreaterThan(0);
    expect((result.body.stderr as string).length).toBeGreaterThan(0);
  });

  // A character budget is not a byte budget: one control character serialises to
  // six bytes, and agent JSONL output is full of them.
  test("holds the byte budget for input that expands under JSON escaping", () => {
    const limit = 4 * 1024;
    for (const filler of ["\u0000", "\u001b", "\"", "\\", "\u00e9", "\u{1f600}"]) {
      const body = { status: "failed", stdout: filler.repeat(20_000), stderr: filler.repeat(20_000) };
      const result = budgetJsonBody(body, ["stdout", "stderr"], limit, REASON);
      expect(jsonBodyBytes(result.body)).toBeLessThanOrEqual(limit);
    }
  });

  test("gives a large field the budget a small sibling does not need", () => {
    const limit = 8 * 1024;
    const body = { status: "failed", stdout: "o".repeat(64 * 1024), stderr: "tiny" };
    const result = budgetJsonBody(body, ["stdout", "stderr"], limit, REASON);

    expect(result.body.stderr).toBe("tiny");
    // Well past the even half-share a naive split would have allowed.
    expect((result.body.stdout as string).length).toBeGreaterThan(limit / 2);
    expect(jsonBodyBytes(result.body)).toBeLessThanOrEqual(limit);
  });

  test("reports overLimit when even the emptied body cannot fit", () => {
    const body = { status: "failed", note: "n".repeat(4_096), stdout: "o".repeat(4_096) };
    const result = budgetJsonBody(body, ["stdout"], 256, REASON);
    expect(result.overLimit).toBe(true);
    expect(result.body.stdout).toBe("");
  });

  test("empties rather than overruns when the budget only just clears the skeleton", () => {
    const body = { status: "failed", stdout: "o".repeat(64 * 1024) };
    const emptiedBytes = jsonBodyBytes({ status: "failed", stdout: "" });
    const result = budgetJsonBody(body, ["stdout"], emptiedBytes + 2, REASON);
    expect(jsonBodyBytes(result.body)).toBeLessThanOrEqual(emptiedBytes + 2);
    expect(result.truncated).toBe(true);
  });

  test("ignores fields that are absent or not strings", () => {
    const body = { status: "failed", stdout: "o".repeat(32 * 1024), exitCode: 137, error: undefined };
    const result = budgetJsonBody(body, ["stdout", "stderr", "error"], 2_048, REASON);
    expect(result.body.exitCode).toBe(137);
    expect(jsonBodyBytes(result.body)).toBeLessThanOrEqual(2_048);
  });
});
